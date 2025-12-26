const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * **UPDATED**: Fetches all students with server-side filtering and pagination.
 * (Now location-aware)
 */
const getAllStudents = async (req, res) => {
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  const { search, faculty_id, unassigned, fee_pending, page = 1, limit = 200 } = req.query;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    // 1. Fetch Students (Simple query to avoid the PGRST200 error)
    let query = supabase
      .from('students')
      .select('*', { count: 'exact' })
      .eq('location_id', req.locationId);

    // ... (Your existing faculty_id and unassigned filters stay here) ...

    if (search) {
      query = query.or(`name.ilike.%${search}%,admission_number.ilike.%${search}%`);
    }

    const { data: students, error: studentError, count } = await query
      .order('name', { ascending: true })
      .range(from, to);

    if (studentError) throw studentError;

    // 2. Fetch Follow-up and Financial data for these students from the view
    const studentIds = students.map(s => s.id);
    const { data: followUpData, error: followUpError } = await supabase
      .from('v_follow_up_task_list')
      .select('student_id, next_task_due_date, total_due_amount')
      .in('student_id', studentIds);

    if (followUpError) throw followUpError;

    // 3. FLOW THE DATA: Create a map for quick lookup
    const followUpMap = new Map(followUpData.map(item => [item.student_id, item]));

    const processedStudents = students.map(student => {
      const info = followUpMap.get(student.id);
      let dynamicRemark = student.remarks || ""; 

      if (info) {
        const balance = Number(info.total_due_amount);
        const nextDate = info.next_task_due_date;

        // Rule: If balance is 0, show FULL PAID
        if (balance <= 0) {
          dynamicRemark = "FULL PAID";
        } 
        // Rule: Otherwise flow the Next Task Date into remarks
        else if (nextDate) {
          const d = new Date(nextDate);
          const day = String(d.getDate()).padStart(2, '0');
          const month = d.toLocaleString('en-GB', { month: 'short' });
          const year = d.getFullYear();
          dynamicRemark = `${day} ${month} ${year}`;
        }
      }

      return { ...student, remarks: dynamicRemark };
    });

    res.status(200).json({ students: processedStudents, count: count || 0 });

  } catch (error) {
    console.error('Error in getAllStudents:', error);
    res.status(500).json({ error: error.message });
  }
};
/**
 * Creates a new student record.
 */
const createStudent = async (req, res) => {
  // --- NEW --- This route MUST be protected by auth
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  const { name, admission_number, phone_number, remarks } = req.body;

  if (!name || !admission_number) {
    return res.status(400).json({ error: 'Name and Admission Number are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('students')
      .insert([{ 
        name, 
        admission_number, 
        phone_number, 
        remarks,
        location_id: req.locationId // --- MODIFIED --- Add the location ID
      }])
      .select()
      .single(); 

    if (error) throw error;

    await logActivity('created', `student ${data.name}`, req.user?.id || 'Admin');
    res.status(201).json(data);
  } catch (error) {
    // --- MODIFIED --- Updated error message for new composite key
    if (error.code === '23505' && error.message.includes('students_admission_number_location_key')) { 
      return res.status(409).json({ error: `A student with admission number '${admission_number}' already exists at this location.` });
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * Updates an existing student record.
 */
const updateStudent = async (req, res) => {
  // --- NO CHANGES NEEDED (functionally) ---
  // This operates on a unique 'id' (UUID) and is implicitly location-safe.
  const { id } = req.params;
  const { name, admission_number, phone_number, remarks } = req.body;

  try {
    const { data, error } = await supabase
      .from('students')
      .update({ name, admission_number, phone_number, remarks })
      .eq('id', id)
      .select()
      .single(); 

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Student not found.' });

    await logActivity('updated', `student ${data.name}`, req.user?.id || 'Admin');
    res.status(200).json(data);
  } catch (error) {
    // --- MODIFIED --- Updated error message for new composite key
    if (error.code === '23505' && error.message.includes('students_admission_number_location_key')) {
      return res.status(409).json({ error: `A student with admission number '${admission_number}' already exists at this location.` });
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * Deletes a student record.
 */
const deleteStudent = async (req, res) => {
  // --- NO CHANGES NEEDED ---
  // This operates on a unique 'id' (UUID) and is implicitly location-safe.
  const { id } = req.params;
  try {
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) throw error;

    await logActivity('deleted', `student with id ${id}`, req.user?.id || 'Admin');
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Fetches all batches a specific student is enrolled in.
 */
const getStudentBatches = async (req, res) => {
  // --- NO CHANGES NEEDED ---
  // This operates on a unique 'id' (student_id) and is implicitly location-safe.
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('batch_students')
      .select('batches(*, faculty:faculty_id(*))') 
      .eq('student_id', id);

    if (error) throw error;
    
    const batches = data.map(item => item.batches).filter(Boolean);
    res.json({ batches }); // Return as an object
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentBatches,
};