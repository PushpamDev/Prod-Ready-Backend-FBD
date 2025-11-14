const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * **UPDATED**: Fetches all students with server-side filtering and pagination.
 * (Now location-aware)
 */
const getAllStudents = async (req, res) => {
  // --- NEW --- This route MUST be protected by auth
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required with location.' });
  }

  const { 
    search, 
    faculty_id, 
    unassigned, 
    fee_pending,
    page = 1, 
    limit = 200 
  } = req.query;

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    // 1. Start building the query, now filtered by location
    let query = supabase
      .from('students')
      .select('*', { count: 'exact' })
      .eq('location_id', req.locationId); // --- MODIFIED --- Base query is now location-aware

    // 2. Handle complex filters (faculty or unassigned)
    if (faculty_id) {
      // Find all student IDs in batches taught by this faculty *at this location*
      const { data: studentIds, error } = await supabase
        .from('batches')
        .select('batch_students!inner(student_id)')
        .eq('faculty_id', faculty_id)
        .eq('location_id', req.locationId); // --- MODIFIED --- Filter batches by location

      if (error) throw error;

      const uniqueStudentIds = [
        ...new Set(studentIds.flatMap(b => (b.batch_students || []).map(bs => bs.student_id)))
      ];

      if (uniqueStudentIds.length === 0) {
        return res.status(200).json({ students: [], count: 0 });
      }

      query = query.in('id', uniqueStudentIds);

    } else if (unassigned === 'true') {
      // Find all student IDs *at this location* that are in *any* batch
      const { data: studentIdsInBatches, error } = await supabase
        .from('batch_students')
        .select('student_id, students!inner(location_id)') // --- MODIFIED --- Join to students
        .eq('students.location_id', req.locationId); // --- MODIFIED --- Filter by student location

      if (error) throw error;

      if (studentIdsInBatches && studentIdsInBatches.length > 0) {
        const uniqueStudentIds = [...new Set(studentIdsInBatches.map(s => s.student_id))];
        
        query = query.not('id', 'in', `(${uniqueStudentIds.join(',')})`);
      }
    }

    // 3. Handle simple filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,admission_number.ilike.%${search}%`);
    }
    
    if (fee_pending === 'true') {
      query = query.not('remarks', 'ilike', '%full%paid%')
                   .filter('remarks', 'not.is', null)
                   .not('remarks', 'eq', '');
    }

    // 4. Execute the final query
    const { data, error, count } = await query
      .order('name', { ascending: true })
      .range(from, to);

    if (error) throw error;

    res.status(200).json({ students: data || [], count: count || 0 });

  } catch (error) {
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