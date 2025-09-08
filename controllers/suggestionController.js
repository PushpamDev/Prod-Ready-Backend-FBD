const supabase = require('../db');

const suggestFaculty = async (req, res) => {
    const { skillId, startDate, endDate, startTime, endTime, daysOfWeek } = req.body;

    if (!skillId || !startDate || !endDate || !startTime || !endTime || !daysOfWeek || !Array.isArray(daysOfWeek)) {
        return res.status(400).json({ error: 'skillId, startDate, endDate, startTime, endTime, and a daysOfWeek array are required' });
    }

    try {
        // 1. Fetch all faculty who have the required skill, along with their general availability.
        const { data: facultyWithSkill, error: facultyError } = await supabase
            .from('faculty_skills')
            .select(`
                faculty (
                    id,
                    name,
                    availability:faculty_availability ( day_of_week, start_time, end_time )
                )
            `)
            .eq('skill_id', skillId);

        if (facultyError) throw facultyError;

        // Un-nest the faculty objects
        const skilledFaculty = facultyWithSkill.map(item => item.faculty).filter(Boolean);

        if (skilledFaculty.length === 0) {
            return res.json({ suggestions: [] });
        }

        const facultyIds = skilledFaculty.map(f => f.id);

        // 2. Fetch all batches for these specific faculties that overlap with the given date range
        const { data: potentiallyConflictingBatches, error: batchesError } = await supabase
            .from('batches')
            .select('id, start_date, end_date, start_time, end_time, days_of_week, faculty_id')
            .in('faculty_id', facultyIds)
            .lte('start_date', endDate)
            .gte('end_date', startDate);

        if (batchesError) throw batchesError;

        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };

        const newBatchStartMins = timeToMinutes(startTime);
        const newBatchEndMins = timeToMinutes(endTime);
        const requestedDaysSet = new Set(daysOfWeek.map(d => d.toLowerCase()));

        const availableFaculty = skilledFaculty.filter(faculty => {
            // A. Check general availability for all required days
            const hasGeneralAvailability = [...requestedDaysSet].every(day => {
                const dayAvailability = faculty.availability.find(a => a.day_of_week.toLowerCase() === day);
                if (!dayAvailability) return false;

                const availableStartMins = timeToMinutes(dayAvailability.start_time);
                const availableEndMins = timeToMinutes(dayAvailability.end_time);

                return newBatchStartMins >= availableStartMins && newBatchEndMins <= availableEndMins;
            });

            if (!hasGeneralAvailability) {
                return false;
            }

            // B. Check for conflicting batches
            const facultyBatches = potentiallyConflictingBatches.filter(b => b.faculty_id === faculty.id);
            
            const hasConflict = facultyBatches.some(batch => {
                // Check for day of week overlap
                let batchDays = [];
                if (Array.isArray(batch.days_of_week)) {
                    batchDays = batch.days_of_week;
                } else if (typeof batch.days_of_week === 'string') {
                    batchDays = batch.days_of_week.replace(/[{}\"\'\\\\\\[\\\\\\]]/g, '').split(',').map(d => d.trim());
                }
                const batchDaysSet = new Set(batchDays.map(d => d.toLowerCase()));
                const daysOverlap = [...requestedDaysSet].some(day => batchDaysSet.has(day));

                if (!daysOverlap) {
                    return false; // No conflict if days don't overlap
                }

                // Check for time overlap
                const existingBatchStartMins = timeToMinutes(batch.start_time);
                const existingBatchEndMins = timeToMinutes(batch.end_time);

                const timeConflict = newBatchStartMins < existingBatchEndMins && newBatchEndMins > existingBatchStartMins;

                return timeConflict;
            });

            return !hasConflict;
        });

        const suggestions = availableFaculty.map(f => ({ id: f.id, name: f.name }));

        res.json({ suggestions });

    } catch (error) {
        console.error('Error suggesting faculty:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    suggestFaculty,
};