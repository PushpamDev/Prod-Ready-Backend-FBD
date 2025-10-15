const supabase = require('../db');

// Get all courses
const getAllCourses = async (req, res) => {
  const { data, error } = await supabase.from('courses').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// Create a new course
const createCourse = async (req, res) => {
  const { name, price } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: "Name and price are required" });
  }

  const { data, error } = await supabase
    .from("courses")
    .insert([{ name, price }])
    .select();

  if (error) {
    console.error("Error creating course:", error);
    return res.status(500).json({ error: "Failed to create course" });
  }

  res.status(201).json(data[0]);
};

// Delete a course
const deleteCourse = async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("courses")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting course:", error);
    return res.status(500).json({ error: "Failed to delete course" });
  }

  res.status(204).send();
};

// Update a course
const updateCourse = async (req, res) => {
  const { id } = req.params;
  const { name, price } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: "Name and price are required" });
  }

  const { data, error } = await supabase
    .from("courses")
    .update({ name, price })
    .eq("id", id)
    .select();

  if (error) {
    console.error("Error updating course:", error);
    return res.status(500).json({ error: "Failed to update course" });
  }

  res.status(200).json(data[0]);
};

module.exports = { getAllCourses, createCourse, deleteCourse, updateCourse };