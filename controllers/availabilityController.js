const supabase = require("../supabaseClient");

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

  // 1. Delete all existing availability for this faculty
  const { error: deleteError } = await supabase
    .from("faculty_availability")
    .delete()
    .eq("faculty_id", facultyId);

  if (deleteError) {
    console.error("Error clearing availability:", deleteError);
    return res.status(500).json({ error: "Failed to update availability" });
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
      console.error("Error adding availability:", insertError);
      return res.status(500).json({ error: "Failed to add availability" });
    }

    return res.status(201).json(data);
  }

  // If availability array is empty, we've just cleared it.
  res.status(200).json([]);
};

module.exports = { getFacultyAvailability, setFacultyAvailability };