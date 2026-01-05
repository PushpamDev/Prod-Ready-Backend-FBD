const supabase = require('../db');
const { logActivity } = require('./logActivity');

/**
 * **UPDATED**: Fetches all students with server-side filtering and pagination.
 * Includes defensive checks to prevent frontend crashes from null/undefined records.
 */
const getAllStudents = async (req, res) => {
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const { search, page = 1, limit = 200 } = req.query;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    let query = supabase
      .from('v_students_with_followup')
      .select('*', { count: 'exact' })
      .eq('location_id', req.locationId);

    /* ✅ FIXED SEARCH LOGIC */
    if (search) {
      const safeSearch = search.replace(/%/g, ''); // safety
      query = query.or(
        `name.ilike.%${safeSearch}%,admission_number.ilike.%${safeSearch}%,phone_number.ilike.%${safeSearch}%`
      );
    }

    const { data: students, error, count } = await query
      .order('name', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const processedStudents = (students || []).map(student => {
      let dynamicRemark = student.remarks || '';
      const balance = Number(student.total_due_amount || 0);
      const nextDate = student.next_task_due_date;

      if (balance <= 0 && student.total_due_amount !== null) {
        dynamicRemark = 'FULL PAID';
      } else if (nextDate) {
        const d = new Date(nextDate);
        dynamicRemark = `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
      }

      return { ...student, remarks: dynamicRemark };
    });

    res.status(200).json({
      students: processedStudents,
      count: count || 0,
    });

  } catch (error) {
    console.error('Error in getAllStudents:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Creates a new student record.
 */
const createStudent = async (req, res) => {
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
        location_id: req.locationId 
      }])
      .select()
      .single(); 

    if (error) throw error;

    await logActivity('created', `student ${data.name}`, req.user?.id || 'Admin');
    res.status(201).json(data);
  } catch (error) {
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
    
    const batches = (data || []).map(item => item.batches).filter(Boolean);
    res.json({ batches }); 
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// controllers/studentsController.js

const setDefaulterStatus = async (req, res) => {
  const { id } = req.params;
  // If is_defaulter isn't in body (from mark-defaulter route), 
  // we assume true if calling the mark route, or false if forced by middleware
  const is_defaulter = req.body.is_defaulter !== undefined ? req.body.is_defaulter : true;
  const { reason } = req.body;

  try {
    const updateData = { is_defaulter };

    if (is_defaulter) {
      updateData.defaulter_reason = reason || null;
      updateData.defaulter_marked_at = new Date().toISOString();
    } else {
      updateData.defaulter_reason = null;
      updateData.defaulter_marked_at = null;
    }

    const { data, error } = await supabase
      .from('students')
      .update(updateData)
      .eq('id', id)
      .select('id, is_defaulter, defaulter_reason')
      .single();

    if (error) throw error;

    res.json({
      is_defaulter: data.is_defaulter,
      reason: data.defaulter_reason,
      message: is_defaulter ? "Marked as defaulter" : "Removed from defaulters"
    });
  } catch (err) {
    console.error("Defaulter update error:", err);
    res.status(500).json({ error: "Failed to update defaulter status" });
  }
};


module.exports = {
  getAllStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentBatches,
  setDefaulterStatus
};