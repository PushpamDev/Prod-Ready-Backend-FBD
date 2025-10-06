const supabase = require("../db.js");

const getFacultyAvailability = async (req, res) => {
  const { facultyId } = req.params;

  try {
    // Check if faculty exists to provide a clear 404
    const { data: faculty, error: facultyError } = await supabase
        .from('faculty')
        .select('id')
        .eq('id', facultyId)
        .single();

    if (facultyError || !faculty) {
        return res.status(404).json({ error: 'Faculty not found.' });
    }

    const { data, error } = await supabase
      .from("faculty_availability")
      .select("id, day_of_week, start_time, end_time")
      .eq("faculty_id", facultyId);

    if (error) {
      console.error("Error fetching availability:", error);
      return res.status(500).json({ error: "Server error: Failed to fetch availability." });
    }

    res.status(200).json(data);
  } catch (error) {
      console.error("An unexpected error occurred in getFacultyAvailability:", error);
      return res.status(500).json({ error: "An unexpected server error occurred." });
  }
};

const setFacultyAvailability = async (req, res) => {
  const { facultyId, availability } = req.body;

  if (!facultyId || !availability || !Array.isArray(availability)) {
    return res
      .status(400)
      .json({ error: "Faculty ID and availability array are required." });
  }

  try {
    // --- Conflict Check ---
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysFromNowStr = thirtyDaysFromNow.toISOString().split('T')[0];

    const { data: batches, error: batchesError } = await supabase
        .from('batches')
        .select('name, days_of_week, start_time, end_time')
        .eq('faculty_id', facultyId)
        .lte('start_date', thirtyDaysFromNowStr)
        .gte('end_date', todayStr);

    if (batchesError) {
        console.error("Error fetching batches for conflict check:", batchesError);
        return res.status(500).json({ error: "Server error: Could not verify schedule conflicts." });
    }

    if (batches && batches.length > 0) {
        for (const batch of batches) {
            for (const day of batch.days_of_week) {
                const newDayAvailability = availability.find(
                    (a) => a.day_of_week.toLowerCase() === day.toLowerCase()
                );

                if (!newDayAvailability) {
                    return res.status(409).json({
                        error: `Update failed. The faculty has batch "${batch.name}" on ${day}, but this day is not in the proposed new availability.`,
                    });
                }

                if (batch.start_time < newDayAvailability.start_time || batch.end_time > newDayAvailability.end_time) {
                    return res.status(409).json({
                        error: `Update failed. Batch "${batch.name}" (${batch.start_time}-${batch.end_time} on ${day}) conflicts with the new availability slot (${newDayAvailability.start_time}-${newDayAvailability.end_time}).`,
                    });
                }
            }
        }
    }

    // --- Update Availability ---
    const { error: deleteError } = await supabase
      .from("faculty_availability")
      .delete()
      .eq("faculty_id", facultyId);

    if (deleteError) {
      console.error("Error clearing previous availability:", deleteError);
      return res.status(500).json({ error: "Failed to update availability: Could not clear the previous schedule." });
    }

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
        console.error("Error inserting new availability:", insertError);
        let message = "Failed to save new availability. The faculty's schedule is now empty and must be set again.";
        if (insertError.code === '23503') {
            message = "Failed to save new availability due to invalid data. The faculty ID may not exist.";
        }
        return res.status(500).json({ error: message });
      }

      return res.status(201).json(data);
    }

    res.status(200).json({ message: "Faculty availability has been successfully cleared." });
  } catch (error) {
    console.error("An unexpected error occurred in setFacultyAvailability:", error);
    return res.status(500).json({ error: "An unexpected server error occurred." });
  }
};

module.exports = { getFacultyAvailability, setFacultyAvailability };