const supabase = require('../db');
const { logActivity } = require('./logActivity');

const getAllStudents = async (req, res) => {
  if (!req.locationId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const { search } = req.query;

  try {
    let query = supabase
      .from('students')
      .select(`
        *,
        follow_up:v_follow_up_task_list (
          next_task_due_date,
          total_due,
          task_count
        )
      `)
      .eq('location_id', req.locationId);

    if (search) {
      const safeSearch = search.replace(/%/g, ''); 
      query = query.or(`name.ilike.%${safeSearch}%,admission_number.ilike.%${safeSearch}%,phone_number.ilike.%${safeSearch}%`);
    }

    const { data: students, error } = await query.order('name', { ascending: true });
    if (error) throw error;

    const processedStudents = (students || []).map(student => {
      /**
       * ✅ FIX 1: Support both Array and Object responses. 
       * Supabase joins usually return an array: [ { ... } ]
       */
      const followData = Array.isArray(student.follow_up) 
        ? student.follow_up[0] 
        : student.follow_up;
      
      /**
       * ✅ FIX 2: Default balance to 0 if no follow-up exists, 
       * or use the correct 'total_due' key.
       */
      const balance = followData ? Number(followData.total_due || 0) : 0;
      const nextDate = followData?.next_task_due_date;
      const hasTasks = Number(followData?.task_count || 0) > 0;
      
      let dynamicRemark = '';

      if (followData && hasTasks) {
        // Priority 1: Full Paid (Balance is 0 and they have a follow-up history)
        if (balance <= 0) {
          dynamicRemark = 'FULL PAID';
        } 
        // Priority 2: Next Follow-up Date (They owe money and have a date)
        else if (nextDate) {
          const d = new Date(nextDate);
          dynamicRemark = !isNaN(d.getTime()) 
            ? `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`
            : 'Date Pending';
        } 
        // Priority 3: Fallback within follow-up
        else {
          dynamicRemark = student.remarks || 'Follow-up Active';
        }
      } else {
        // ✅ FIX 3: No follow-up record at all - use Student Table Remarks
        dynamicRemark = student.remarks || 'No Remark';
      }

      return { 
        ...student, 
        remarks: dynamicRemark,
        total_due_amount: balance, // Now returns 16500 instead of 1
        follow_up: followData      // Flattens it for easier frontend use
      };
    });

    res.status(200).json({ 
      students: processedStudents, 
      count: processedStudents.length 
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

/**
 * Updates a student's defaulter status.
 */
const setDefaulterStatus = async (req, res) => {
  const { id } = req.params;
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