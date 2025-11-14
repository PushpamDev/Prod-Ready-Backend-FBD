const supabase = require('../db');

// Get all skills
const getAllSkills = async (req, res) => {
  // --- NEW --- This route MUST be protected by auth
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  const { data, error } = await supabase
    .from('skills')
    .select('*')
    .eq('location_id', req.locationId); // --- MODIFIED --- Filter by location

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

// Create a new skill
const createSkill = async (req, res) => {
  // --- NEW --- This route MUST be protected by auth
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  const { name, category, description } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: "Name and category are required" });
  }

  const { data, error } = await supabase
    .from("skills")
    .insert([{ 
      name, 
      category, 
      description,
      location_id: req.locationId // --- MODIFIED --- Add the location ID
    }])
    .select()
    .single(); // --- MODIFIED --- .single() is cleaner

  if (error) {
    // --- MODIFIED --- Handle new location-aware unique constraint
    if (error.code === '23505' && error.message.includes('skills_name_location_key')) {
        return res.status(409).json({ error: `A skill with the name '${name}' already exists at this location.` });
    }
    console.error("Error creating skill:", error);
    return res.status(500).json({ error: "Failed to create skill" });
  }

  res.status(201).json(data);
};

const deleteSkill = async (req, res) => {
  // --- NO CHANGES NEEDED ---
  // This operates on a unique 'id' (UUID).
  // The frontend (using the now-filtered getAllSkills)
  // will only ever provide an ID for a skill at the user's location.
  // This is implicitly location-safe.
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
  // --- NO CHANGES NEEDED (functionally) ---
  // This operates on a unique 'id' (UUID) and is also
  // implicitly location-safe.
  const { id } = req.params;
  const { name, category, description } = req.body;

  if (!name || !category) {
    return res.status(400).json({ error: "Name and category are required" });
  }

  const { data, error } = await supabase
    .from("skills")
    .update({ name, category, description })
    .eq("id", id)
    .select()
    .single(); // --- MODIFIED --- .single() is cleaner

  if (error) {
    // --- MODIFIED --- Handle unique constraint error
    if (error.code === '23505' && error.message.includes('skills_name_location_key')) {
        return res.status(409).json({ error: `A skill with the name '${name}' already exists at this location.` });
    }
    console.error("Error updating skill:", error);
    return res.status(500).json({ error: "Failed to update skill" });
  }

  res.status(200).json(data);
};

module.exports = { getAllSkills, createSkill, deleteSkill, updateSkill };