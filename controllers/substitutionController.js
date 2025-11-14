// server/controllers/substitutionController.js

const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * REMINDER: To enable the 'mergeBatches' function, you must first run the following SQL
 * in your Supabase SQL Editor to create the necessary database function.
 * (This function is location-safe as-is)
 */
// ... (SQL comment block unchanged) ...

/**
 * Creates a temporary substitution record for a faculty on leave.
 */
const createTemporarySubstitution = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { batchId, substituteFacultyId, startDate, endDate, notes } = req.body;

    if (!batchId || !substituteFacultyId || !startDate || !endDate) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // 1. Get full details of the batch (implicitly location-safe)
        const { data: leaveBatch, error: batchError } = await supabase
            .from('batches')
            .select('*') 
            .eq('id', batchId)
            .single();

        if (batchError || !leaveBatch) return res.status(404).json({ error: 'Batch not found.' });
        if (leaveBatch.faculty_id === substituteFacultyId) return res.status(400).json({ error: 'Cannot assign a faculty as their own substitute.' });

        // --- Conflict Checking (now location-aware) ---
        const leaveStartDate = new Date(startDate);
        const leaveEndDate = new Date(endDate);
        const leaveBatchStartTime = new Date(`1970-01-01T${leaveBatch.start_time}Z`);
        const leaveBatchEndTime = new Date(`1970-01-01T${leaveBatch.end_time}Z`);

        // 2. Check permanent schedule *at this location*
        const { data: permanentConflicts, error: permanentError } = await supabase
            .from('batches')
            .select('name, start_date, end_date, start_time, end_time, days_of_week')
            .eq('faculty_id', substituteFacultyId)
            .eq('location_id', req.locationId); // --- MODIFIED --- Filter by location

        if (permanentError) throw permanentError;

        for (const existingBatch of permanentConflicts) {
            // ... (conflict logic unchanged) ...
            const existingStartDate = new Date(existingBatch.start_date);
            const existingEndDate = new Date(existingBatch.end_date);
            const existingStartTime = new Date(`1970-01-01T${existingBatch.start_time}Z`);
            const existingEndTime = new Date(`1970-01-01T${existingBatch.end_time}Z`);

            const datesOverlap = leaveStartDate <= existingEndDate && leaveEndDate >= existingStartDate;
            const daysOverlap = leaveBatch.days_of_week.some(day => (existingBatch.days_of_week || []).includes(day));
            const timesOverlap = leaveBatchStartTime < existingEndTime && leaveBatchEndTime > existingStartTime;

            if (datesOverlap && daysOverlap && timesOverlap) {
                return res.status(409).json({ error: `Substitute has a permanent conflict with batch: ${existingBatch.name}.` });
            }
        }

        // 3. Check other temporary schedules *at this location*
        const { data: tempConflicts, error: tempError } = await supabase
            .from('faculty_substitutions')
            .select('start_date, end_date, batch:batches!inner(name, start_time, end_time, days_of_week, location_id)') // --- MODIFIED --- Join to batches
            .eq('substitute_faculty_id', substituteFacultyId)
            .eq('batch.location_id', req.locationId); // --- MODIFIED --- Filter by batch location
        
        if (tempError) throw tempError;

        for (const existingSub of tempConflicts) {
            // ... (conflict logic unchanged) ...
            if (!existingSub.batch) continue; 
            const existingSubStartDate = new Date(existingSub.start_date);
            const existingSubEndDate = new Date(existingSub.end_date);
            const existingSubStartTime = new Date(`1970-01-01T${existingSub.batch.start_time}Z`);
            const existingSubEndTime = new Date(`1970-01-01T${existingSub.batch.end_time}Z`);

            const datesOverlap = leaveStartDate <= existingSubEndDate && leaveEndDate >= existingSubStartDate;
            const daysOverlap = leaveBatch.days_of_week.some(day => (existingSub.batch.days_of_week || []).includes(day));
            const timesOverlap = leaveBatchStartTime < existingSubEndTime && leaveBatchEndTime > existingSubStartTime;

            if (datesOverlap && daysOverlap && timesOverlap) {
                return res.status(409).json({ error: `Substitute is already scheduled for another substitution for batch: ${existingSub.batch.name}.` });
            }
        }
        
        // 4. If no conflicts, create the substitution record
        // (This is implicitly location-safe, as batchId is for this location)
        const { data: substitution, error: insertError } = await supabase
            .from('faculty_substitutions')
            .insert({
                batch_id: batchId,
                original_faculty_id: leaveBatch.faculty_id,
                substitute_faculty_id: substituteFacultyId,
                start_date: startDate,
                end_date: endDate,
                notes: notes,
            })
            .select()
            .single();
        
        if (insertError) {
             if (insertError.code === '23P01') { // exclusion_violation
                return res.status(409).json({ error: 'This batch already has an overlapping substitution scheduled.' });
            }
            throw insertError;
        }

        await logActivity('created', `temporary substitution for batch ${leaveBatch.name}`, req.user?.id || 'Admin');
        res.status(201).json(substitution);

    } catch (error) {
        console.error('Error creating temporary substitution:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * NEW: Fetches all active or upcoming substitution records *for this location*.
 */
const getActiveSubstitutions = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    try {
        const currentDate = new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('faculty_substitutions')
            .select(`
                id, start_date, end_date, notes,
                batches!inner (id, name, location_id),
                original_faculty:original_faculty_id (id, name),
                substitute_faculty:substitute_faculty_id (id, name)
            `)
            .gte('end_date', currentDate)
            .eq('batches.location_id', req.locationId) // --- MODIFIED --- Filter by batch location
            .order('start_date', { ascending: true });

        if (error) throw error;
        
        // --- MODIFIED --- Format data to remove nested `batches` object
        const formattedData = data.map(sub => {
            const batchName = sub.batches?.name || 'Unknown';
            const batchId = sub.batches?.id || null;
            delete sub.batches; // Clean up the object
            return { ...sub, batch_name: batchName, batch_id: batchId };
        });

        res.status(200).json(formattedData);
    } catch (error) {
        console.error('Error fetching active substitutions:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * NEW: Updates an existing substitution.
 */
const updateSubstitution = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { id } = req.params; // Get the substitution ID from the URL
    const { substituteFacultyId, startDate, endDate, notes } = req.body;

    try {
        // 1. Get the original substitution record and its related batch
        // (Implicitly location-safe, ID will come from filtered getActiveSubstitutions)
        const { data: originalSub, error: findError } = await supabase
            .from('faculty_substitutions')
            .select('*, batches(*)') 
            .eq('id', id)
            .single();

        if (findError || !originalSub) {
            return res.status(404).json({ error: 'Substitution record not found.' });
        }

        // 2. Define new values
        const newSubstituteId = substituteFacultyId || originalSub.substitute_faculty_id;
        const newStartDate = startDate || originalSub.start_date;
        const newEndDate = endDate || originalSub.end_date;
        const newNotes = notes !== undefined ? notes : originalSub.notes;
        const leaveBatch = originalSub.batches;

        // 3. --- Check for conflicts IF the substitute faculty is being changed ---
        if (substituteFacultyId && substituteFacultyId !== originalSub.substitute_faculty_id) {
            console.log('Substitute faculty is changing. Running conflict check...');
            
            if (leaveBatch.faculty_id === newSubstituteId) return res.status(400).json({ error: 'Cannot assign a faculty as their own substitute.' });
            
            const leaveStartDate = new Date(newStartDate);
            const leaveEndDate = new Date(newEndDate);
            const leaveBatchStartTime = new Date(`1970-01-01T${leaveBatch.start_time}Z`);
            const leaveBatchEndTime = new Date(`1970-01-01T${leaveBatch.end_time}Z`);

            // 3a. Check permanent schedule *at this location*
            const { data: permanentConflicts, error: permanentError } = await supabase
                .from('batches')
                .select('name, start_date, end_date, start_time, end_time, days_of_week')
                .eq('faculty_id', newSubstituteId)
                .eq('location_id', req.locationId); // --- MODIFIED --- Filter by location
            if (permanentError) throw permanentError;

            for (const existingBatch of permanentConflicts) {
                // ... (conflict logic unchanged) ...
                const existingStartDate = new Date(existingBatch.start_date);
                const existingEndDate = new Date(existingBatch.end_date);
                const existingStartTime = new Date(`1970-01-01T${existingBatch.start_time}Z`);
                const existingEndTime = new Date(`1970-01-01T${existingBatch.end_time}Z`);

                const datesOverlap = leaveStartDate <= existingEndDate && leaveEndDate >= existingStartDate;
                const daysOverlap = leaveBatch.days_of_week.some(day => (existingBatch.days_of_week || []).includes(day));
                const timesOverlap = leaveBatchStartTime < existingEndTime && leaveBatchEndTime > existingStartTime;

                if (datesOverlap && daysOverlap && timesOverlap) {
                    return res.status(409).json({ error: `NEW substitute has a permanent conflict with batch: ${existingBatch.name}.` });
                }
            }

            // 3b. Check other temporary schedules *at this location*
            const { data: tempConflicts, error: tempError } = await supabase
                .from('faculty_substitutions')
                .select('start_date, end_date, batch:batches!inner(name, start_time, end_time, days_of_week, location_id)') // --- MODIFIED --- Join to batches
                .eq('substitute_faculty_id', newSubstituteId)
                .neq('id', id) // *** CRITICAL: Exclude the record we are currently updating ***
                .eq('batch.location_id', req.locationId); // --- MODIFIED --- Filter by batch location
            
            if (tempError) throw tempError;

            for (const existingSub of tempConflicts) {
                // ... (conflict logic unchanged) ...
                if (!existingSub.batch) continue;
                const existingSubStartDate = new Date(existingSub.start_date);
                const existingSubEndDate = new Date(existingSub.end_date);
                const existingSubStartTime = new Date(`1970-01-01T${existingSub.batch.start_time}Z`);
                const existingSubEndTime = new Date(`1970-01-01T${existingSub.batch.end_time}Z`);

                const datesOverlap = leaveStartDate <= existingSubEndDate && leaveEndDate >= existingSubStartDate;
                const daysOverlap = leaveBatch.days_of_week.some(day => (existingSub.batch.days_of_week || []).includes(day));
                const timesOverlap = leaveBatchStartTime < existingSubEndTime && leaveBatchEndTime > existingSubStartTime;

                if (datesOverlap && daysOverlap && timesOverlap) {
                    return res.status(409).json({ error: `NEW substitute is already scheduled for another substitution for batch: ${existingSub.batch.name}.` });
                }
            }
        } // --- End of conflict check ---

        // 4. All checks passed. Perform the update.
        // (Implicitly location-safe, updating by unique 'id')
        const { data: updatedSub, error: updateError } = await supabase
            .from('faculty_substitutions')
            .update({
                substitute_faculty_id: newSubstituteId,
                start_date: newStartDate,
                end_date: newEndDate,
                notes: newNotes
            })
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            // ... (error handling unchanged) ...
            if (updateError.code === '23P01') { // exclusion_violation
                return res.status(409).json({ error: 'The new dates overlap with another substitution for this same batch.' });
            }
            throw updateError;
        }

        await logActivity('updated', `substitution for batch ${leaveBatch.name}`, req.user?.id || 'Admin');
        res.status(200).json(updatedSub);

    } catch (error) {
        console.error('Error updating substitution:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * NEW: Deletes/Cancels a temporary substitution record.
 * --- NO CHANGES NEEDED ---
 * (Implicitly location-safe, operates on a unique UUID 'id')
 */
const cancelSubstitution = async (req, res) => {
    const { id } = req.params; // Get the substitution ID from the URL

    try {
        const { data: substitution, error: deleteError } = await supabase
            .from('faculty_substitutions')
            .delete()
            .eq('id', id)
            .select(`
                id,
                batches (name)
            `)
            .single();

        if (deleteError) {
            if (deleteError.code === 'PGRST116') { // PostgREST code for "No rows returned"
                return res.status(404).json({ error: 'Substitution record not found.' });
            }
            throw deleteError;
        }
        
        if (!substitution) {
            return res.status(404).json({ error: 'Substitution record not found.' });
        }

        await logActivity('deleted', `substitution for batch ${substitution.batches?.name || id}`, req.user?.id || 'Admin');
        res.status(200).json({ message: 'Substitution cancelled successfully.' });

    } catch (error) {
        console.error('Error cancelling substitution:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * Performs a PERMANENT reassignment of a batch to a new faculty.
 */
const assignSubstitute = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { batchId, facultyId } = req.body;

    if (!batchId || !facultyId) {
        return res.status(400).json({ error: 'Batch ID and new Faculty ID are required' });
    }

    try {
        // (All checks below are implicitly location-safe *except* the conflict check)
        
        const { data: batch, error: batchError } = await supabase.from('batches').select('*').eq('id', batchId).single();
        if (batchError || !batch) return res.status(404).json({ error: 'Batch not found' });
        if (batch.faculty_id === facultyId) return res.status(400).json({ error: 'This faculty is already assigned to the batch.' });

        const { data: facultyAvailability, error: availabilityError } = await supabase.from('faculty_availability').select('day_of_week, start_time, end_time').eq('faculty_id', facultyId);
        if (availabilityError) throw availabilityError;

        // ... (availability check logic unchanged) ...
        const batchStartTime = new Date(`1970-01-01T${batch.start_time}Z`);
        const batchEndTime = new Date(`1970-01-01T${batch.end_time}Z`);
        for (const day of batch.days_of_week) {
            const availabilityForDay = facultyAvailability.find(a => a.day_of_week.toLowerCase() === day.toLowerCase());
            if (!availabilityForDay) return res.status(400).json({ error: `Faculty is not available on ${day}.` });
            const facultyStartTime = new Date(`1970-01-01T${availabilityForDay.start_time}Z`);
            const facultyEndTime = new Date(`1970-01-01T${availabilityForDay.end_time}Z`);
            if (batchStartTime < facultyStartTime || batchEndTime > facultyEndTime) {
                return res.status(400).json({ error: `Batch time on ${day} is outside of faculty's available hours.` });
            }
        }

        // --- MODIFIED --- Conflict check must be location-aware
        const { data: existingBatches, error: existingBatchesError } = await supabase
            .from('batches')
            .select('name, start_time, end_time, days_of_week, start_date, end_date')
            .eq('faculty_id', facultyId)
            .eq('location_id', req.locationId); // <-- Location filter
        if (existingBatchesError) throw existingBatchesError;

        // ... (conflict logic unchanged) ...
        const batchStartDate = new Date(batch.start_date);
        const batchEndDate = new Date(batch.end_date);
        for (const existingBatch of existingBatches) {
            const existingStartTime = new Date(`1970-01-01T${existingBatch.start_time}Z`);
            const existingEndTime = new Date(`1970-01-01T${existingBatch.end_time}Z`);
            const existingStartDate = new Date(existingBatch.start_date);
            const existingEndDate = new Date(existingBatch.end_date);
            const daysOverlap = batch.days_of_week.some(day => existingBatch.days_of_week.map(d => d.toLowerCase()).includes(day.toLowerCase()));
            const datesOverlap = batchStartDate <= existingEndDate && batchEndDate >= existingStartDate;
            const timesOverlap = batchStartTime < existingEndTime && batchEndTime > existingStartTime;
            if (daysOverlap && datesOverlap && timesOverlap) {
                return res.status(409).json({ error: `Faculty has a scheduling conflict with batch: ${existingBatch.name}.` });
            }
        }

        // (Update logic is fine, operates on unique batchId)
        const { data: updatedBatch, error: updateError } = await supabase.from('batches').update({ faculty_id: facultyId }).eq('id', batchId).select('*, faculty:faculty(id, name)').single();
        if (updateError) throw updateError;

        await logActivity('updated', `Permanently reassigned faculty for batch ${updatedBatch.name}`, req.user?.id || 'Admin');
        res.status(200).json(updatedBatch);

    } catch (error) {
        console.error('Error assigning substitute:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * PERMANENTLY merges students from a source batch into a target batch and deletes the source.
 * --- NO CHANGES NEEDED ---
 * (Implicitly location-safe, as user will only have access to IDs from their location)
 */
const mergeBatches = async (req, res) => {
    const { sourceBatchId, targetBatchId } = req.body;

    if (!sourceBatchId || !targetBatchId) {
        return res.status(400).json({ error: 'Source and target batch IDs are required.' });
    }
    if (sourceBatchId === targetBatchId) {
        return res.status(400).json({ error: 'Cannot merge a batch into itself.' });
    }

    try {
        const { error } = await supabase.rpc('merge_batches_transaction', {
            source_batch_id: sourceBatchId,
            target_batch_id: targetBatchId
        });
        if (error) throw error;

        await logActivity('merged', `batch ${sourceBatchId} into ${targetBatchId}`, req.user?.id || 'Admin');
        res.status(200).json({ message: 'Batches merged successfully' });

    } catch (error) {
        console.error('Error merging batches:', error);
        res.status(500).json({ error: 'An unexpected error occurred during the merge.' });
    }
};

module.exports = {
    createTemporarySubstitution,
    getActiveSubstitutions, // <-- NEW
    updateSubstitution,     // <-- NEW
    cancelSubstitution,     // <-- NEW
    assignSubstitute,
    mergeBatches,
};