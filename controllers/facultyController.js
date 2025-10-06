const supabase = require("../db.js");
const { logActivity } = require("./logActivity");

// Helper function to determine batch status
function getDynamicStatus(startDate, endDate) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (now < start) {
    return "Upcoming";
  } else if (now >= start && now <= end) {
    return "Active";
  } else {
    return "Completed";
  }
}

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

if (error){
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
    await logActivity('Created', `Faculty \"${name}\"`, 'user'); // Replace "user" with actual user if available

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
    // --- 1. Update faculty details (name, phone, etc.) ---
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

    // --- 2. Update skills (if provided) ---
    if (skillIds) {
        const { error: deleteError } = await supabase
            .from('faculty_skills')
            .delete()
            .eq('faculty_id', id);

        if (deleteError) throw deleteError;

        if (skillIds.length > 0) {
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
    }

    // --- 4. Log and Respond ---
    await logActivity('Updated', `Faculty \"${facultyData.name}\"`, 'user');

    // Refetch the updated faculty data to include everything
    const { data: updatedFaculty, error: refetchError } = await supabase
        .from("faculty")
        .select(`
            id, name, email, phone_number, employment_type, is_active,
            skills ( id, name ),
            faculty_availability ( id, day_of_week, start_time, end_time )
        `)
        .eq('id', id)
        .single();

    if(refetchError) throw refetchError;

    const transformedData = {
        id: updatedFaculty.id,
        name: updatedFaculty.name,
        email: updatedFaculty.email,
        phone_number: updatedFaculty.phone_number,
        type: updatedFaculty.employment_type,
        isActive: updatedFaculty.is_active,
        skills: updatedFaculty.skills || [],
        availability: updatedFaculty.faculty_availability || []
    };

    res.status(200).json(transformedData);

  } catch (error) {
    console.error('Error updating faculty:', error);
    res.status(500).json({ error: 'Failed to update faculty' });
  }
};

const deleteFaculty = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if faculty is assigned to any batches
    const { data: batches, error: batchesError } = await supabase
      .from('batches')
      .select('id')
      .eq('faculty_id', id)
      .limit(1);

    if (batchesError) {
      throw batchesError;
    }

    if (batches && batches.length > 0) {
      return res.status(400).json({
        error: 'Cannot delete faculty with assigned batches. Please reassign batches first.',
      });
    }

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
    await logActivity('Deleted', `Faculty \"${faculty.name}\"`, 'user');

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting faculty:', error);
    res.status(500).json({ error: 'Failed to delete faculty' });
  }
};

const getFacultyActiveStudents = async (req, res) => {
  try {
    const { data: faculties, error: facultyError } = await supabase
      .from("faculty")
      .select("id, name");

    if (facultyError) throw facultyError;

    const { data: batches, error: batchesError } = await supabase
      .from("batches")
      .select("id, faculty_id, start_date, end_date");

    if (batchesError) throw batchesError;

    const activeBatches = batches.filter(
      (batch) => getDynamicStatus(batch.start_date, batch.end_date) === "Active"
    );

    const activeBatchIds = activeBatches.map((b) => b.id);

    if (activeBatchIds.length === 0) {
      const facultyData = faculties.map((faculty) => ({
        faculty_id: faculty.id,
        faculty_name: faculty.name,
        active_students: 0,
      }));
      return res.status(200).json(facultyData);
    }

    const { data: studentLinks, error: studentLinksError } = await supabase
      .from("batch_students")
      .select("batch_id, student_id")
      .in("batch_id", activeBatchIds);

    if (studentLinksError) throw studentLinksError;

    const studentsPerBatch = activeBatches.reduce((acc, batch) => {
      const uniqueStudents = new Set(
        studentLinks
          .filter((link) => link.batch_id === batch.id)
          .map((link) => link.student_id)
      );
      acc[batch.id] = {
        faculty_id: batch.faculty_id,
        student_count: uniqueStudents.size,
      };
      return acc;
    }, {});

    const facultyActiveStudents = faculties.map((faculty) => {
      const count = Object.values(studentsPerBatch).reduce(
        (total, batch) => {
          if (batch.faculty_id === faculty.id) {
            return total + batch.student_count;
          }
          return total;
        },
        0
      );
      return {
        faculty_id: faculty.id,
        faculty_name: faculty.name,
        active_students: count,
      };
    });

    res.status(200).json(facultyActiveStudents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllFaculty,
  createFaculty,
  updateFaculty,
  deleteFaculty,
  getFacultyActiveStudents,
};