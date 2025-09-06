const supabase = require('../db');

// Get all skills
const getAllSkills = async (req, res) => {
  const { data, error } = await supabase.from('skills').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// Create a new skill
const createSkill = async (req, res) => {
  const { name, category, description } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: "Name and category are required" });
  }

  const { data, error } = await supabase
    .from("skills")
    .insert([{ name, category, description }])
    .select();

  if (error) {
    console.error("Error creating skill:", error);
    return res.status(500).json({ error: "Failed to create skill" });
  }

  res.status(201).json(data[0]);
};

const deleteSkill = async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("skills")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting skill:", error);
    return res.status(500).json({ error: "Failed to delete skill" });
  }

  res.status(204).send();
};

// Update a skill
const updateSkill = async (req, res) => {
  const { id } = req.params;
  const { name, category, description } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: "Name and category are required" });
  }

  const { data, error } = await supabase
    .from("skills")
    .update({ name, category, description })
    .eq("id", id)
    .select();

  if (error) {
    console.error("Error updating skill:", error);
    return res.status(500).json({ error: "Failed to update skill" });
  }

  res.status(200).json(data[0]);
};

module.exports = { getAllSkills, createSkill, deleteSkill, updateSkill };