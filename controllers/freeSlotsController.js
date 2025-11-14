const supabase = require('../db.js');

// Helper function to convert a time string (e.g., "14:30:00") into a comparable Date object.
const parseTime = (timeStr) => new Date(`1970-01-01T${timeStr}Z`);

const getFreeSlots = async (req, res) => {
    // --- NEW --- This route MUST be protected by auth
    if (!req.locationId) {
        return res.status(401).json({ error: 'Authentication required with location.' });
    }

    const { startDate, endDate, selectedFaculty, selectedSkill } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Please select a start and end date.' });
    }

    try {
        // --- Step 1: Fetch all relevant data in parallel, filtered by location ---

        // Fetch faculties, filtered by location
        let facultyQuery = supabase.from('faculty').select(`
            id, name,
            skills ( id, name ),
            availability:faculty_availability ( day_of_week, start_time, end_time )
        `)
        .eq('location_id', req.locationId); // --- MODIFIED --- Filter by location

        if (selectedFaculty) facultyQuery = facultyQuery.eq('id', selectedFaculty);

        const [
            { data: faculties, error: facultiesError },
            { data: batches, error: batchesError },
            { data: substitutions, error: substitutionsError }
        ] = await Promise.all([
            facultyQuery,
            
            // Fetch batches, filtered by location
            supabase.from('batches').select('id, name, start_date, end_date, start_time, end_time, days_of_week, faculty_id')
                .lte('start_date', endDate)
                .gte('end_date', startDate)
                .eq('location_id', req.locationId), // --- MODIFIED --- Filter by location

            // Fetch substitutions, filtered by batch location
            supabase.from('faculty_substitutions').select('*, batches!inner(location_id)') // --- MODIFIED --- Join to batches
                .lte('start_date', endDate)
                .gte('end_date', startDate)
                .eq('batches.location_id', req.locationId) // --- MODIFIED --- Filter by batch location
        ]);
        
        if (facultiesError) throw facultiesError;
        if (batchesError) throw batchesError;
        if (substitutionsError) throw substitutionsError;

        // --- Step 2: Filter faculties by skill if selected ---
        // (This logic is correct and unchanged)
        const filteredFaculties = selectedSkill
            ? faculties.filter(f => f.skills.some(s => s.id === selectedSkill))
            : faculties;

        // --- Step 3: Calculate free slots for each faculty ---
        // (All logic below is now correct, as it operates on pre-filtered data)
        const results = [];
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const timeToMinutes = (timeStr) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };
        const minutesToTime = (minutes) => {
            const h = Math.floor(minutes / 60).toString().padStart(2, '0');
            const m = (minutes % 60).toString().padStart(2, '0');
            return `${h}:${m}:00`;
        };

        for (const faculty of filteredFaculties) {
            const facultySlots = { faculty: { id: faculty.id, name: faculty.name }, slots: [] };
            
            let currentDate = new Date(`${startDate}T00:00:00Z`);
            const lastDate = new Date(`${endDate}T00:00:00Z`);

            while (currentDate <= lastDate) {
                const dayOfWeek = dayNames[currentDate.getUTCDay()];
                const dateStr = currentDate.toISOString().split('T')[0];

                const dailyAvailability = faculty.availability.find(a => a.day_of_week.toLowerCase() === dayOfWeek.toLowerCase());
                if (!dailyAvailability) {
                    currentDate.setDate(currentDate.getDate() + 1);
                    continue;
                }

                // **FIX**: Find all batches this faculty is busy with on this day
                const busyIntervals = [];

                // 1. Add batches they are PERMANENTLY assigned to
                batches.forEach(batch => {
                    const runsOnDay = batch.days_of_week.some(d => d.toLowerCase() === dayOfWeek.toLowerCase());
                    const isActiveOnDate = new Date(batch.start_date) <= currentDate && new Date(batch.end_date) >= currentDate;
                    
                    // Is this the faculty's own batch AND is there NOT an active substitution for it?
                    const isOriginalTutor = batch.faculty_id === faculty.id && !substitutions.some(s => s.batch_id === batch.id && new Date(s.start_date) <= currentDate && new Date(s.end_date) >= currentDate);

                    if (isActiveOnDate && runsOnDay && isOriginalTutor) {
                        busyIntervals.push({ start: timeToMinutes(batch.start_time), end: timeToMinutes(batch.end_time) });
                    }
                });

                // 2. Add batches they are TEMPORARILY substituting for
                substitutions.forEach(sub => {
                    const isSubstitute = sub.substitute_faculty_id === faculty.id;
                    const isSubActiveOnDate = new Date(sub.start_date) <= currentDate && new Date(sub.end_date) >= currentDate;
                    
                    if (isSubstitute && isSubActiveOnDate) {
                        const substitutedBatch = batches.find(b => b.id === sub.batch_id);
                        if (substitutedBatch && substitutedBatch.days_of_week.some(d => d.toLowerCase() === dayOfWeek.toLowerCase())) {
                            busyIntervals.push({ start: timeToMinutes(substitutedBatch.start_time), end: timeToMinutes(substitutedBatch.end_time) });
                        }
                    }
                });

                // --- Simplified Slot Calculation Algorithm ---
                if (busyIntervals.length > 0) {
                    // a. Sort and merge overlapping busy intervals
                    busyIntervals.sort((a, b) => a.start - b.start);
                    const mergedBusy = busyIntervals.reduce((acc, current) => {
                        if (acc.length === 0 || current.start >= acc[acc.length - 1].end) {
                            acc.push(current);
                        } else {
                            acc[acc.length - 1].end = Math.max(acc[acc.length - 1].end, current.end);
                        }
                        return acc;
                    }, []);

                    // b. Calculate free slots by "subtracting" busy slots from availability
                    const freeSlots = [];
                    let lastAvailableTime = timeToMinutes(dailyAvailability.start_time);
                    mergedBusy.forEach(busySlot => {
                        if (busySlot.start > lastAvailableTime) {
                            freeSlots.push({ start: lastAvailableTime, end: busySlot.start });
                        }
                        lastAvailableTime = busySlot.end;
                    });
                    if (timeToMinutes(dailyAvailability.end_time) > lastAvailableTime) {
                        freeSlots.push({ start: lastAvailableTime, end: timeToMinutes(dailyAvailability.end_time) });
                    }
                    
                    if (freeSlots.length > 0) {
                        facultySlots.slots.push({ date: dateStr, time: freeSlots.map(s => `${minutesToTime(s.start)} - ${minutesToTime(s.end)}`) });
                    }
                } else {
                    // No busy slots, so the entire availability is free
                    facultySlots.slots.push({ date: dateStr, time: [`${dailyAvailability.start_time} - ${dailyAvailability.end_time}`] });
                }

                currentDate.setDate(currentDate.getDate() + 1);
            }

            if (facultySlots.slots.length > 0) {
                results.push(facultySlots);
            }
        }

        res.json(results);

    } catch (error) {
        console.error('Error fetching free slots:', error);
        res.status(500).json({ error: 'Failed to fetch free slots' });
    }
};

module.exports = {
    getFreeSlots,
};