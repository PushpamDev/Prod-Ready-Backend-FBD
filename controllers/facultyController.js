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
      phone_number: faculty.phone_number,
      type: faculty.employment_type,
      isActive: faculty.is_active,
      skills: faculty.skills || [],
      availability: faculty.faculty_availability || []
  }));

  res.status(200).json(transformedData);
};

const createFaculty = async (req, res) => {
  const { userId, phone_number, employment_type, skillIds, email } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Check if user exists
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, username')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const name = userData.username;
  let facultyData;

  try {
    // 1. Create the faculty member
    const { data, error: facultyError } = await supabase
      .from('faculty')
      .insert([{ name, email, phone_number, employment_type }])
      .select()
      .single();

    if (facultyError) {
      if (facultyError.code === '23505' && facultyError.message.includes('faculty_email_key')) {
        return res.status(409).json({ error: `A faculty with the email '${email}' already exists.` });
      }
      throw facultyError;
    }
    facultyData = data;

    // 2. Update the user's role and link to the new faculty entry
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ role: 'faculty', faculty_id: facultyData.id })
      .eq('id', userId);

    if (updateUserError) {
      // Rollback: delete the created faculty member if user update fails
      await supabase.from('faculty').delete().eq('id', facultyData.id);
      throw updateUserError;
    }

    // 3. Link skills to the faculty member
    if (skillIds && skillIds.length > 0) {
      const facultySkills = skillIds.map((skill_id) => ({
        faculty_id: facultyData.id,
        skill_id,
      }));

      const { error: skillsError } = await supabase
        .from('faculty_skills')
        .insert(facultySkills);

      if (skillsError) {
        // If linking skills fails, we roll back the faculty creation.
        // Deleting the faculty will set the user's faculty_id to NULL due to the foreign key constraint.
        // The user will be left with a 'faculty' role but no faculty entry, which is an inconsistent state.
        // A full transaction would be required for a perfect rollback.
        await supabase.from('faculty').delete().eq('id', facultyData.id);
        if (skillsError.code === '23503') {
          return res.status(400).json({ error: 'One or more skill IDs are invalid.' });
        }
        throw skillsError;
      }
    }

    // Log activity
    await logActivity('Created', `Faculty "${name}"`, 'user'); // Replace "user" with actual user if available

    res.status(201).json(facultyData);
  } catch (error) {
    console.error('Error creating faculty:', error);
    res.status(500).json({ error: 'Failed to create faculty' });
  }
};

const updateFaculty = async (req, res) => {
  const { id } = req.params;
  const { name, phone_number, employment_type, skillIds } = req.body;

  try {
    // 1. Update faculty details
    const { data: facultyData, error: facultyError } = await supabase
      .from('faculty')
      .update({ name, phone_number, employment_type })
      .eq('id', id)
      .select()
      .single();

    if (facultyError) {
      throw facultyError;
    }

    if (!facultyData) {
      return res.status(404).json({ error: 'Faculty not found' });
    }

    // 2. Update skills (delete old, insert new)
    // This operation is not atomic. If the insert fails, the faculty will be left with no skills.
    // For a robust solution, this should be done in a transaction.
    const { error: deleteError } = await supabase
      .from('faculty_skills')
      .delete()
      .eq('faculty_id', id);

    if (deleteError) {
      throw deleteError;
    }

    if (skillIds && skillIds.length > 0) {
      const facultySkills = skillIds.map((skill_id) => ({
        faculty_id: id,
        skill_id,
      }));

      const { error: insertError } = await supabase
        .from('faculty_skills')
        .insert(facultySkills);

      if (insertError) {
        if (insertError.code === '23503') {
          return res.status(400).json({ error: 'One or more skill IDs are invalid.' });
        }
        throw insertError;
      }
    }

    // Log activity
    await logActivity('Updated', `Faculty "${facultyData.name}"`, 'user'); // Replace "user" with actual user if available

    res.status(200).json(facultyData);
  } catch (error) {
    console.error('Error updating faculty:', error);
    res.status(500).json({ error: 'Failed to update faculty' });
  }
};

const deleteFaculty = async (req, res) => {
  const { id } = req.params;

  try {
    // Find the user associated with the faculty
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('faculty_id', id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      // PGRST116 means no rows found, which is acceptable here
      throw userError;
    }

    // If a user is associated, delete them first
    if (userData) {
      const { error: deleteUserError } = await supabase
        .from('users')
        .delete()
        .eq('id', userData.id);

      if (deleteUserError) {
        throw deleteUserError;
      }
    }

    // Now, delete the faculty member
    const { data: faculty, error: deleteFacultyError } = await supabase
      .from('faculty')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (deleteFacultyError) {
      throw deleteFacultyError;
    }

    if (!faculty) {
      return res.status(404).json({ error: 'Faculty not found' });
    }

    // Log activity
    await logActivity('Deleted', `Faculty "${faculty.name}"`, 'user');

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting faculty:', error);
    res.status(500).json({ error: 'Failed to delete faculty' });
  }
};

module.exports = { getAllFaculty, createFaculty, updateFaculty, deleteFaculty };