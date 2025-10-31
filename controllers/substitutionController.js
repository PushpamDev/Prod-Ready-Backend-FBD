// server/controllers/substitutionController.js

const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * REMINDER: To enable the 'mergeBatches' function, you must first run the following SQL
 * in your Supabase SQL Editor to create the necessary database function.
 *
 * CREATE OR REPLACE FUNCTION merge_batches_transaction(source_batch_id uuid, target_batch_id uuid)
 * RETURNS void AS $$
 * BEGIN
 * -- Copy unique students from the source batch to the target batch.
 * INSERT INTO batch_students (batch_id, student_id)
 * SELECT target_batch_id, s.student_id
 * FROM batch_students s
 * WHERE s.batch_id = source_batch_id
 * ON CONFLICT (batch_id, student_id) DO NOTHING;
 *
 * -- Delete the original source batch.
 * DELETE FROM batches
 * WHERE id = source_batch_id;
 * END;
 * $$ LANGUAGE plpgsql;
 *
 */

/**
 * Creates a temporary substitution record for a faculty on leave.
 * This is NON-DESTRUCTIVE and does not change the original batch record.
 */
const createTemporarySubstitution = async (req, res) => {
    const { batchId, substituteFacultyId, startDate, endDate, notes } = req.body;

    if (!batchId || !substituteFacultyId || !startDate || !endDate) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        // 1. Get full details of the batch needing a substitute (the "leave batch")
        const { data: leaveBatch, error: batchError } = await supabase
            .from('batches')
            .select('*') // Get all details for conflict checking
            .eq('id', batchId)
            .single();

        if (batchError || !leaveBatch) return res.status(404).json({ error: 'Batch not found.' });
        if (leaveBatch.faculty_id === substituteFacultyId) return res.status(400).json({ error: 'Cannot assign a faculty as their own substitute.' });

        // --- **IMPROVEMENT**: Detailed Conflict Checking ---
        const leaveStartDate = new Date(startDate);
        const leaveEndDate = new Date(endDate);
        const leaveBatchStartTime = new Date(`1970-01-01T${leaveBatch.start_time}Z`);
        const leaveBatchEndTime = new Date(`1970-01-01T${leaveBatch.end_time}Z`);

        // 2. Check for conflicts in the substitute's PERMANENT schedule
        const { data: permanentConflicts, error: permanentError } = await supabase
            .from('batches')
            .select('name, start_date, end_date, start_time, end_time, days_of_week')
            .eq('faculty_id', substituteFacultyId);

        if (permanentError) throw permanentError;

        for (const existingBatch of permanentConflicts) {
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

        // 3. Check for conflicts in the substitute's OTHER TEMPORARY schedules
        const { data: tempConflicts, error: tempError } = await supabase
            .from('faculty_substitutions')
            .select('start_date, end_date, batch:batches(name, start_time, end_time, days_of_week)')
            .eq('substitute_faculty_id', substituteFacultyId);
        
        if (tempError) throw tempError;

        for (const existingSub of tempConflicts) {
            if (!existingSub.batch) continue; // Skip if the related batch was deleted
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

// ===============================================
// === NEW FUNCTIONS START HERE ===
// ===============================================

/**
 * NEW: Fetches all active or upcoming substitution records.
 * This is for display on a management dashboard.
 */
const getActiveSubstitutions = async (req, res) => {
    try {
        const currentDate = new Date().toISOString().split('T')[0];
        
        const { data, error } = await supabase
            .from('faculty_substitutions')
            .select(`
                id, start_date, end_date, notes,
                batches (id, name),
                original_faculty:original_faculty_id (id, name),
                substitute_faculty:substitute_faculty_id (id, name)
            `)
            .gte('end_date', currentDate) // Only get subs that haven't ended yet
            .order('start_date', { ascending: true });

        if (error) throw error;
        
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching active substitutions:', error);
        res.status(500).json({ error: 'An unexpected error occurred.' });
    }
};

/**
 * NEW: Updates an existing substitution.
 * Use Case: Faculty returns early (update end_date).
 * Use Case: Student/Admin dissatisfaction (update substitute_faculty_id).
 * Use Case: Substitute overloaded (update substitute_faculty_id).
 * Use Case: Faculty extends leave (update end_date).
 */
const updateSubstitution = async (req, res) => {
    const { id } = req.params; // Get the substitution ID from the URL
    const { substituteFacultyId, startDate, endDate, notes } = req.body;

    try {
        // 1. Get the original substitution record and its related batch
        const { data: originalSub, error: findError } = await supabase
            .from('faculty_substitutions')
            .select('*, batches(*)') // Get sub and all batch details
            .eq('id', id)
            .single();

        if (findError || !originalSub) {
            return res.status(404).json({ error: 'Substitution record not found.' });
        }

        // 2. Define new values, falling back to original values if not provided
        const newSubstituteId = substituteFacultyId || originalSub.substitute_faculty_id;
        const newStartDate = startDate || originalSub.start_date;
        const newEndDate = endDate || originalSub.end_date;
        // Allow notes to be explicitly set to null or empty string
        const newNotes = notes !== undefined ? notes : originalSub.notes;
        const leaveBatch = originalSub.batches;

        // 3. --- Check for conflicts IF the substitute faculty is being changed ---
        if (substituteFacultyId && substituteFacultyId !== originalSub.substitute_faculty_id) {
            console.log('Substitute faculty is changing. Running conflict check...');
            
            if (leaveBatch.faculty_id === newSubstituteId) return res.status(400).json({ error: 'Cannot assign a faculty as their own substitute.' });
            
            // Use the new dates for conflict checking
            const leaveStartDate = new Date(newStartDate);
            const leaveEndDate = new Date(newEndDate);
            const leaveBatchStartTime = new Date(`1970-01-01T${leaveBatch.start_time}Z`);
            const leaveBatchEndTime = new Date(`1970-01-01T${leaveBatch.end_time}Z`);

            // --- Re-run conflict checks for the NEW substitute ---
            
            // 3a. Check permanent schedule
            const { data: permanentConflicts, error: permanentError } = await supabase
                .from('batches')
                .select('name, start_date, end_date, start_time, end_time, days_of_week')
                .eq('faculty_id', newSubstituteId);
            if (permanentError) throw permanentError;

            for (const existingBatch of permanentConflicts) {
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

            // 3b. Check other temporary schedules
            const { data: tempConflicts, error: tempError } = await supabase
                .from('faculty_substitutions')
                .select('start_date, end_date, batch:batches(name, start_time, end_time, days_of_week)')
                .eq('substitute_faculty_id', newSubstituteId)
                .neq('id', id); // *** CRITICAL: Exclude the record we are currently updating ***
            
            if (tempError) throw tempError;

            for (const existingSub of tempConflicts) {
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

        // 4. All checks passed (or faculty didn't change). Perform the update.
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
            if (updateError.code === '23P01') { // exclusion_violation
                // This can happen if *only* the dates were changed, and they now
                // overlap with another substitution for the *same* batch.
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
 * Use Case: Original faculty's leave is cancelled entirely.
 * Use Case: Admin error, just need to delete the record.
 * Alternative for: Faculty returns early (just delete it instead of updating end_date).
 */
const cancelSubstitution = async (req, res) => {
    const { id } = req.params; // Get the substitution ID from the URL

    try {
        // We select the batch name before deleting for logging purposes
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
        
        // This check handles the case where PGRST116 is not thrown but data is null
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

// ===============================================
// === NEW FUNCTIONS END HERE ===
// ===============================================


/**
 * Performs a PERMANENT reassignment of a batch to a new faculty.
 */
const assignSubstitute = async (req, res) => {
    const { batchId, facultyId } = req.body;

    if (!batchId || !facultyId) {
        return res.status(400).json({ error: 'Batch ID and new Faculty ID are required' });
    }

    try {
        const { data: batch, error: batchError } = await supabase.from('batches').select('*').eq('id', batchId).single();
        if (batchError || !batch) return res.status(404).json({ error: 'Batch not found' });
        if (batch.faculty_id === facultyId) return res.status(400).json({ error: 'This faculty is already assigned to the batch.' });

        const { data: facultyAvailability, error: availabilityError } = await supabase.from('faculty_availability').select('day_of_week, start_time, end_time').eq('faculty_id', facultyId);
        if (availabilityError) throw availabilityError;

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

        const { data: existingBatches, error: existingBatchesError } = await supabase.from('batches').select('name, start_time, end_time, days_of_week, start_date, end_date').eq('faculty_id', facultyId);
        if (existingBatchesError) throw existingBatchesError;

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