const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * **UPDATED**: Fetches all students with server-side filtering and pagination.
 */
const getAllStudents = async (req, res) => {
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
    // 1. Start building the query WITH .select()
    // This is the main fix.
    let query = supabase
      .from('students')
      .select('*', { count: 'exact' }); // Start with select to get filter methods

    // 2. Handle complex filters (faculty or unassigned)
    if (faculty_id) {
      // Find all student IDs in batches taught by this faculty
      const { data: studentIds, error } = await supabase
        .from('batches')
        .select('batch_students!inner(student_id)')
        .eq('faculty_id', faculty_id);

      if (error) throw error;

      const uniqueStudentIds = [
        ...new Set(studentIds.flatMap(b => (b.batch_students || []).map(bs => bs.student_id)))
      ];

      if (uniqueStudentIds.length === 0) {
        // No students for this faculty, return empty
        return res.status(200).json({ students: [], count: 0 });
      }

      // Use the correct .in() method
      query = query.in('id', uniqueStudentIds);

    } else if (unassigned === 'true') {
      // Find all student IDs that are in *any* batch
      const { data: studentIdsInBatches, error } = await supabase
        .from('batch_students')
        .select('student_id', { count: 'minimal' });

      if (error) throw error;

      if (studentIdsInBatches && studentIdsInBatches.length > 0) {
        const uniqueStudentIds = [...new Set(studentIdsInBatches.map(s => s.student_id))];
        
        // Use the correct .not() method
        query = query.not('id', 'in', `(${uniqueStudentIds.join(',')})`);
      }
    }

    // 3. Handle simple filters
    if (search) {
      query = query.or(`name.ilike.%${search}%,admission_number.ilike.%${search}%`);
    }
    
    if (fee_pending === 'true') {
      // This combination of filters is correct
      query = query.not('remarks', 'ilike', '%full%paid%')
                   .filter('remarks', 'not.is', null)
                   .not('remarks', 'eq', '');
    }

    // 4. Execute the final query (select() is already at the start)
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
  const { name, admission_number, phone_number, remarks } = req.body;

  if (!name || !admission_number) {
    return res.status(400).json({ error: 'Name and Admission Number are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('students')
      .insert([{ name, admission_number, phone_number, remarks }])
      .select()
      .single(); 

    if (error) throw error;

    await logActivity('created', `student ${data.name}`, req.user?.id || 'Admin');
    res.status(201).json(data);
  } catch (error) {
    if (error.code === '23505') { 
      return res.status(409).json({ error: `A student with admission number '${admission_number}' already exists.` });
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * Updates an existing student record.
 */
const updateStudent = async (req, res) => {
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
    if (error.code === '23505') {
      return res.status(409).json({ error: `A student with admission number '${admission_number}' already exists.` });
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * Deletes a student record.
 */
const deleteStudent = async (req, res) => {
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