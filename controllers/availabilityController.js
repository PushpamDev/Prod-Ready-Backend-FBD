const supabase = require("../db.js");

// Helper function to convert a time string (e.g., "14:30:00") into a comparable Date object.
const parseTime = (timeStr) => new Date(`1970-01-01T${timeStr}Z`);

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
    const todayStr = today.toISOString().split("T")[0];
    const thirtyDaysFromNowStr = thirtyDaysFromNow.toISOString().split("T")[0];

    const { data: batches, error: batchesError } = await supabase
      .from("batches")
      .select("name, days_of_week, start_time, end_time")
      .eq("faculty_id", facultyId)
      .lte("start_date", thirtyDaysFromNowStr)
      .gte("end_date", todayStr);

    if (batchesError) {
      console.error("Error fetching batches for conflict check:", batchesError);
      return res
        .status(500)
        .json({ error: "Server error: Could not verify schedule conflicts." });
    }

    if (batches && batches.length > 0) {
      for (const batch of batches) {
        for (const day of batch.days_of_week) {
          // Find the proposed new availability for the day the batch runs
          const newDayAvailability = availability.find(
            (a) => a.day_of_week.toLowerCase() === day.toLowerCase() && a.start_time && a.end_time
          );

          // If the day is being removed from availability, it's a conflict.
          if (!newDayAvailability) {
            return res.status(409).json({
              error: `Update failed. The faculty has batch "${batch.name}" on ${day}, but this day is being removed from the new availability.`,
            });
          }
          
          // --- FIXED LOGIC: Convert strings to Dates for correct comparison ---
          const batchStartTime = parseTime(batch.start_time);
          const batchEndTime = parseTime(batch.end_time);
          const newAvailabilityStartTime = parseTime(newDayAvailability.start_time);
          const newAvailabilityEndTime = parseTime(newDayAvailability.end_time);

          if (
            batchStartTime < newAvailabilityStartTime ||
            batchEndTime > newAvailabilityEndTime
          ) {
            return res.status(409).json({
              error: `Update failed. Batch "${batch.name}" (${batch.start_time.substring(0,5)}-${batch.end_time.substring(0,5)} on ${day}) conflicts with the new availability slot (${newDayAvailability.start_time.substring(0,5)}-${newDayAvailability.end_time.substring(0,5)}).`,
            });
          }
        }
      }
    }

    // --- Update Availability (Transaction) ---
    // Start a transaction
    const { error: transactionError } = await supabase.rpc('update_faculty_availability', {
        p_faculty_id: facultyId,
        p_availability: availability.filter(a => a.start_time && a.end_time) // only pass valid slots
    });

    if (transactionError) {
        console.error('Error during transaction:', transactionError);
        return res.status(500).json({ error: `Failed to update availability: ${transactionError.message}`});
    }

    // Refetch the data to return it
    const { data: updatedAvailability, error: refetchError } = await supabase
      .from('faculty_availability')
      .select('id, day_of_week, start_time, end_time')
      .eq('faculty_id', facultyId);

    if (refetchError) {
        // The update succeeded, but we can't return the new data.
        // It's better to send success with a warning.
        console.error("Error refetching availability post-update:", refetchError);
        return res.status(200).json({ message: "Availability updated successfully, but could not fetch new data."});
    }

    return res.status(201).json(updatedAvailability);

  } catch (error) {
    console.error(
      "An unexpected error occurred in setFacultyAvailability:",
      error
    );
    return res
      .status(500)
      .json({ error: "An unexpected server error occurred." });
  }
};

module.exports = { getFacultyAvailability, setFacultyAvailability };