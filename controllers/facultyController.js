const supabase = require("../db.js");
const { logActivity } = require("./logActivity");

const getAllFaculty = async (req, res) => {
  const { data, error } = await supabase
    .from("faculty")
    .select(`
      id,
      name,
      email,
      phone_number,
      employment_type,
      is_active,
      skills ( id, name ),
      faculty_availability ( id, day_of_week, start_time, end_time )
    `);

  if (error) {
    console.error("Error fetching faculty:", error);
    return res.status(500).json({ error: "Failed to fetch faculty" });
  }

  const transformedData = data.map(faculty => ({
      id: faculty.id,
      name: faculty.name,
      email: faculty.email,
      type: faculty.employment_type,
      isActive: faculty.is_active,
      skills: faculty.skills || [],
      availability: faculty.faculty_availability || []
  }));

  res.status(200).json(transformedData);
};

const createFaculty = async (req, res) => {
  const { name, email, phone_number, employment_type, skillIds } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // 1. Create the faculty member
  const { data: facultyData, error: facultyError } = await supabase
    .from("faculty")
    .insert([{ name, email, phone_number, employment_type }])
    .select()
    .single();

  if (facultyError) {
    console.error("Error creating faculty:", facultyError);
    return res.status(500).json({ error: "Failed to create faculty" });
  }

  // Log activity
  await logActivity("Created", `Faculty "${name}"`, "user"); // Replace "user" with actual user if available

  // 2. Link skills to the faculty member
  if (skillIds && skillIds.length > 0) {
    const facultySkills = skillIds.map((skill_id) => ({
      faculty_id: facultyData.id,
      skill_id,
    }));

    const { error: skillsError } = await supabase
      .from("faculty_skills")
      .insert(facultySkills);

    if (skillsError) {
      console.error("Error linking skills to faculty:", skillsError);
      // Note: In a real app, you might want to roll back the faculty creation here.
      return res.status(500).json({ error: "Failed to link skills" });
    }
  }

  res.status(201).json(facultyData);
};

const updateFaculty = async (req, res) => {
  const { id } = req.params;
  const { name, email, phone_number, employment_type, skillIds } = req.body;

  // 1. Update faculty details
  const { data: facultyData, error: facultyError } = await supabase
    .from("faculty")
    .update({ name, email, phone_number, employment_type })
    .eq("id", id)
    .select()
    .single();

  if (facultyError) {
    console.error("Error updating faculty:", facultyError);
    return res.status(500).json({ error: "Failed to update faculty" });
  }

  // 2. Update skills (delete old, insert new)
  const { error: deleteError } = await supabase
    .from("faculty_skills")
    .delete()
    .eq("faculty_id", id);

  if (deleteError) {
    console.error("Error removing old skills:", deleteError);
    return res.status(500).json({ error: "Failed to update skills" });
  }

  if (skillIds && skillIds.length > 0) {
    const facultySkills = skillIds.map((skill_id) => ({
      faculty_id: id,
      skill_id,
    }));

    const { error: insertError } = await supabase
      .from("faculty_skills")
      .insert(facultySkills);

    if (insertError) {
      console.error("Error adding new skills:", insertError);
      return res.status(500).json({ error: "Failed to update skills" });
    }
  }

  // Log activity
  await logActivity("Updated", `Faculty "${name}"`, "user"); // Replace "user" with actual user if available

  res.status(200).json(facultyData);
};

const deleteFaculty = async (req, res) => {
  const { id } = req.params;

  // First, get the faculty name for logging before deleting
  const { data: faculty, error: getError } = await supabase
    .from("faculty")
    .select("name")
    .eq("id", id)
    .single();

  if (getError) {
    console.error("Error fetching faculty for deletion:", getError);
    return res.status(404).json({ error: "Faculty not found" });
  }

  const { error: deleteError } = await supabase.from("faculty").delete().eq("id", id);

  if (deleteError) {
    console.error("Error deleting faculty:", deleteError);
    return res.status(500).json({ error: "Failed to delete faculty" });
  }

  // Log activity
  await logActivity("Deleted", `Faculty "${faculty.name}"`, "user"); // Replace "user" with actual user if available

  res.status(204).send();
};

module.exports = { getAllFaculty, createFaculty, updateFaculty, deleteFaculty };