const supabase = require("../db.js");

const getFacultyAvailability = async (req, res) => {
  const { facultyId } = req.params;

  const { data, error } = await supabase
    .from("faculty_availability")
    .select("*")
    .eq("faculty_id", facultyId);

  if (error) {
    console.error("Error fetching availability:", error);
    return res.status(500).json({ error: "Failed to fetch availability" });
  }

  res.status(200).json(data);
};

const setFacultyAvailability = async (req, res) => {
  const { facultyId, availability } = req.body;

  if (!facultyId || !availability || !Array.isArray(availability)) {
    return res
      .status(400)
      .json({ error: "Faculty ID and availability array are required" });
  }

  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysFromNowStr = thirtyDaysFromNow.toISOString().split('T')[0];

    // Get batches active in the next 30 days
    const { data: batches, error: batchesError } = await supabase
        .from('batches')
        .select('name, days_of_week, start_time, end_time')
        .eq('faculty_id', facultyId)
        .lte('start_date', thirtyDaysFromNowStr) // Starts before end of window
        .gte('end_date', todayStr); // Ends after start of window

    if (batchesError) throw batchesError;

    if (batches && batches.length > 0) {
        for (const batch of batches) {
            for (const day of batch.days_of_week) {
                const newDayAvailability = availability.find(
                    (a) => a.day_of_week.toLowerCase() === day.toLowerCase()
                );

                // Conflict 1: Day is removed
                if (!newDayAvailability) {
                    return res.status(409).json({
                        error: `Update failed. The faculty has batch "${batch.name}" on ${day}, but this day is not in the proposed new availability.`,
                    });
                }

                // Conflict 2: Time has changed and batch no longer fits
                if (batch.start_time < newDayAvailability.start_time || batch.end_time > newDayAvailability.end_time) {
                    return res.status(409).json({
                        error: `Update failed. Batch "${batch.name}" (${batch.start_time}-${batch.end_time} on ${day}) conflicts with the new availability slot (${newDayAvailability.start_time}-${newDayAvailability.end_time}).`,
                    });
                }
            }
        }
    }
    // 1. Delete all existing availability for this faculty
    const { error: deleteError } = await supabase
      .from("faculty_availability")
      .delete()
      .eq("faculty_id", facultyId);

    if (deleteError) {
        throw deleteError
    }

    // 2. Insert the new availability slots, if any
    if (availability.length > 0) {
      const availabilityData = availability.map((slot) => ({
        faculty_id: facultyId,
        day_of_week: slot.day_of_week,
        start_time: slot.start_time,
        end_time: slot.end_time,
      }));

      const { data, error: insertError } = await supabase
        .from("faculty_availability")
        .insert(availabilityData)
        .select();

      if (insertError) {
        throw insertError
      }

      return res.status(201).json(data);
    }

    // If availability array is empty, we've just cleared it.
    res.status(200).json([]);
  } catch (error) {
    console.error("Error setting availability:", error);
    return res.status(500).json({ error: "Failed to set availability" });
  }
};

module.exports = { getFacultyAvailability, setFacultyAvailability };