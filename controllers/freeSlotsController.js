const supabase = require('../db.js');

const getFreeSlots = async (req, res) => {
    const { startDate, endDate, selectedFaculty, selectedSkill } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Please select a start and end date.' });
    }

    try {
        // 1. Fetch all data
        let facultyQuery = supabase
            .from('faculty')
            .select(`
                id,
                name,
                skills ( id, name ),
                availability:faculty_availability ( day_of_week, start_time, end_time )
            `);

        if (selectedFaculty) {
            facultyQuery = facultyQuery.eq('id', selectedFaculty);
        }

        const { data: faculties, error: facultiesError } = await facultyQuery;
        if (facultiesError) throw facultiesError;

        const { data: batches, error: batchesError } = await supabase
            .from('batches')
            .select(`
                id,
                name,
                start_date,
                end_date,
                start_time,
                end_time,
                days_of_week,
                faculty_id
            `);
        if (batchesError) throw batchesError;

        // 2. Filter faculties by skill if selected
        let filteredFaculties = faculties;
        if (selectedSkill) {
            filteredFaculties = filteredFaculties.filter(f =>
                f.skills.some(s => s.id === selectedSkill)
            );
        }

        // 3. The rest of the logic from the frontend's handleSearch
        const results = [];
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        filteredFaculties.forEach(faculty => {
            const facultySlots = { faculty, slots: [] };
            
            const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
            let currentDate = new Date(Date.UTC(sYear, sMonth - 1, sDay));
            const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
            const lastDate = new Date(Date.UTC(eYear, eMonth - 1, eDay));

            while (currentDate <= lastDate) {
                const dayOfWeek = dayNames[currentDate.getUTCDay()];
                const dateStr = currentDate.toISOString().split('T')[0];

                const dailyAvailability = faculty.availability.find(a => a.day_of_week.toLowerCase() === dayOfWeek.toLowerCase());
                if (!dailyAvailability) {
                    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
                    continue;
                }

                const dailyBatches = batches.filter(b => {
                    if (!b.faculty_id || !b.days_of_week) return false;

                    const [bsYear, bsMonth, bsDay] = b.start_date.split('-').map(Number);
                    const batchStartDate = new Date(Date.UTC(bsYear, bsMonth - 1, bsDay));
                    const [beYear, beMonth, beDay] = b.end_date.split('-').map(Number);
                    const batchEndDate = new Date(Date.UTC(beYear, beMonth - 1, beDay));

                    let batchDays = [];
                    if (Array.isArray(b.days_of_week)) {
                        batchDays = b.days_of_week;
                    } else if (typeof b.days_of_week === 'string') {
                        batchDays = b.days_of_week.replace(/[{}"'\\\[\\\]]/g, '').split(',').map(d => d.trim());
                    }

                    const runsOnDay = batchDays.some(d => d.toLowerCase() === dayOfWeek.toLowerCase());

                    return b.faculty_id === faculty.id &&
                        batchStartDate <= currentDate &&
                        batchEndDate >= currentDate &&
                        runsOnDay;
                });



                console.log(`[${dateStr}] Faculty ${faculty.name} availability: ${dailyAvailability.start_time} - ${dailyAvailability.end_time}`);

                dailyBatches.sort((a, b) => a.start_time.localeCompare(b.start_time));

                console.log(`[${dateStr}] Found ${dailyBatches.length} batches for ${faculty.name}.`);
                dailyBatches.forEach(b => {
                    console.log(`  - Batch ${b.name} (${b.id}): ${b.start_time} - ${b.end_time}`);
                });

                const timeToMinutes = (timeStr) => {
                    const [hours, minutes] = timeStr.split(':').map(Number);
                    return hours * 60 + minutes;
                };

                const minutesToTimeForLog = (minutes) => {
                    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
                    const m = (minutes % 60).toString().padStart(2, '0');
                    return `${h}:${m}:00`;
                };

                let availableSlots = [{ start: timeToMinutes(dailyAvailability.start_time), end: timeToMinutes(dailyAvailability.end_time) }];
                console.log(`[${dateStr}] Initial available slots:`, availableSlots.map(s => `${minutesToTimeForLog(s.start)}-${minutesToTimeForLog(s.end)}`));

                dailyBatches.forEach(batch => {
                    const batchStart = timeToMinutes(batch.start_time);
                    const batchEnd = timeToMinutes(batch.end_time);
                    let nextAvailableSlots = [];

                    availableSlots.forEach(slot => {
                        // Case 1: Batch is completely outside the slot
                        if (batchEnd <= slot.start || batchStart >= slot.end) {
                            nextAvailableSlots.push(slot);
                            return;
                        }

                        // Case 2: Slot is completely within the batch
                        if (batchStart <= slot.start && batchEnd >= slot.end) {
                            // The slot is completely taken by the batch, so we add nothing to the next available slots.
                            return;
                        }

                        // Case 3: Batch starts before the slot and ends within the slot
                        if (batchStart < slot.start && batchEnd > slot.start && batchEnd < slot.end) {
                            nextAvailableSlots.push({ start: batchEnd, end: slot.end });
                            return;
                        }

                        // Case 4: Batch starts within the slot and ends after the slot
                        if (batchStart > slot.start && batchStart < slot.end && batchEnd > slot.end) {
                            nextAvailableSlots.push({ start: slot.start, end: batchStart });
                            return;
                        }

                        // Case 5: Batch is completely within the slot
                        if (batchStart > slot.start && batchEnd < slot.end) {
                            nextAvailableSlots.push({ start: slot.start, end: batchStart });
                            nextAvailableSlots.push({ start: batchEnd, end: slot.end });
                            return;
                        }
                        
                        // Case 6: The batch start is the same as the slot start
                        if (batchStart === slot.start && batchEnd < slot.end) {
                            nextAvailableSlots.push({ start: batchEnd, end: slot.end });
                            return;
                        }

                        // Case 7: The batch end is the same as the slot end
                        if (batchEnd === slot.end && batchStart > slot.start) {
                            nextAvailableSlots.push({ start: slot.start, end: batchStart });
                            return;
                        }
                    });
                    availableSlots = nextAvailableSlots;
                });

                const minutesToTime = (minutes) => {
                    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
                    const m = (minutes % 60).toString().padStart(2, '0');
                    return `${h}:${m}:00`;
                };

                timeSlots = availableSlots.map(slot => ({
                    start: minutesToTime(slot.start),
                    end: minutesToTime(slot.end)
                }));

                if (timeSlots.length > 0 && timeSlots.some(s => s.start < s.end)) {
                    facultySlots.slots.push({
                        date: dateStr,
                        time: timeSlots.filter(s => s.start < s.end).map(s => `${s.start} - ${s.end}`)
                    });
                }

                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }

            if (facultySlots.slots.length > 0) {
                results.push(facultySlots);
            }
        });

        res.json(results);

    } catch (error) {
        console.error('Error fetching free slots:', error);
        res.status(500).json({ error: 'Failed to fetch free slots' });
    }
};

module.exports = {
    getFreeSlots,
};