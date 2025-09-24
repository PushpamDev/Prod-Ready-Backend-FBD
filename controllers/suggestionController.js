const supabase = require('../db.js');

// --- Helper Functions (no changes) ---
const parseDaysOfWeek = (daysField) => {
    if (Array.isArray(daysField)) return daysField;
    if (typeof daysField === 'string') return daysField.replace(/[{}"'\\\[\\\]]/g, '').split(',').map(d => d.trim());
    return [];
};
const timeToMinutes = (timeStr) => {
    if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};
const minutesToTime = (minutes) => {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
};

// --- Main Controller ---
const suggestFaculty = async (req, res) => {
    // Now accepts optional startTime and endTime
    const { skillId, startDate, endDate, daysOfWeek, startTime, endTime } = req.body;

    if (!skillId || !startDate || !endDate || !daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
        return res.status(400).json({ error: 'Required fields are missing.' });
    }

    try {
        // Step 1 & 2: Fetch relevant faculty and their potential batch conflicts (no changes here)
        const { data: facultyWithSkill, error: facultyError } = await supabase
            .from('faculty_skills').select(`faculty (id, name, availability:faculty_availability (day_of_week, start_time, end_time))`).eq('skill_id', skillId);
        if (facultyError) throw facultyError;

        const skilledFaculty = facultyWithSkill.map(item => item.faculty).filter(Boolean);
        if (skilledFaculty.length === 0) return res.json({ suggestions: [] });

        const facultyIds = skilledFaculty.map(f => f.id);
        const { data: potentiallyConflictingBatches, error: batchesError } = await supabase
            .from('batches').select('start_time, end_time, days_of_week, faculty_id').in('faculty_id', facultyIds).lte('start_date', endDate).gte('end_date', startDate);
        if (batchesError) throw batchesError;
        
        // Step 3: First, calculate all common available slots for each faculty
        const facultyWithCommonSlots = skilledFaculty.map(faculty => {
            const dailySlots = daysOfWeek.map(day => {
                const dayAvailability = faculty.availability.find(a => a.day_of_week.toLowerCase() === day.toLowerCase());
                if (!dayAvailability) return { day, slots: [] };

                let freeSlotsInMinutes = [{ start: timeToMinutes(dayAvailability.start_time), end: timeToMinutes(dayAvailability.end_time) }];
                const bookedSlots = potentiallyConflictingBatches
                    .filter(b => {
                        if (b.faculty_id !== faculty.id) return false;
                        const batchDays = parseDaysOfWeek(b.days_of_week);
                        return batchDays.some(batchDay => batchDay.toLowerCase() === day.toLowerCase());
                    })
                    .map(b => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) }))
                    .sort((a, b) => a.start - b.start);
                
                for (const booked of bookedSlots) {
                    const nextFreeSlots = [];
                    for (const free of freeSlotsInMinutes) {
                        if (free.start < booked.start) nextFreeSlots.push({ start: free.start, end: Math.min(free.end, booked.start) });
                        if (free.end > booked.end) nextFreeSlots.push({ start: Math.max(free.start, booked.end), end: free.end });
                    }
                    freeSlotsInMinutes = nextFreeSlots;
                }
                return { day, slots: freeSlotsInMinutes };
            });

            // Calculate the INTERSECTION of slots across all requested days
            let commonSlots = dailySlots.length > 0 ? dailySlots[0].slots : [];
            for (let i = 1; i < dailySlots.length; i++) {
                const nextCommonSlots = [];
                for (const common of commonSlots) {
                    for (const daySlot of dailySlots[i].slots) {
                        const overlapStart = Math.max(common.start, daySlot.start);
                        const overlapEnd = Math.min(common.end, daySlot.end);
                        if (overlapStart < overlapEnd) nextCommonSlots.push({ start: overlapStart, end: overlapEnd });
                    }
                }
                commonSlots = nextCommonSlots;
            }
            
            return {
                id: faculty.id,
                name: faculty.name,
                commonSlots: commonSlots.map(s => ({ start: minutesToTime(s.start), end: minutesToTime(s.end) }))
            };
        }).filter(f => f.commonSlots.length > 0);


        // Step 4: Categorize the faculty based on whether a specific time was requested
        let suggestions;
        if (startTime && endTime) {
            const requestedStartMins = timeToMinutes(startTime);
            const requestedEndMins = timeToMinutes(endTime);

            suggestions = facultyWithCommonSlots.map(faculty => {
                const isAvailable = faculty.commonSlots.some(slot => 
                    timeToMinutes(slot.start) <= requestedStartMins && timeToMinutes(slot.end) >= requestedEndMins
                );

                if (isAvailable) {
                    return { ...faculty, status: 'available' };
                } else {
                    return { ...faculty, status: 'available_other_times' };
                }
            });
        } else {
            // If no specific time is given, all faculty with slots are 'available'
            suggestions = facultyWithCommonSlots.map(faculty => ({ ...faculty, status: 'available' }));
        }

        res.json({ suggestions });

    } catch (error) {
        console.error('Error suggesting faculty:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

module.exports = {
    suggestFaculty,
};
