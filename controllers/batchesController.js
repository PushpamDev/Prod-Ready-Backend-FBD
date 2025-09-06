const supabase = require('../db');
const { logActivity } = require('./logActivity');

const getAllBatches = async (req, res) => {
  try {
    let query = supabase.from('batches').select('*, faculty:faculty_id(*), skill:skill_id(*), students:students(*)');

    // If the user is a faculty, only return batches assigned to them
    if (req.user.role === 'faculty') {
      query = query.eq('faculty_id', req.user.faculty_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createBatch = async (req, res) => {
  const {
    name,
    description,
    startDate,
    endDate,
    startTime,
    endTime,
    facultyId,
    skillId,
    maxStudents,
    status,
    studentIds,
    daysOfWeek,
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Batch name is required' });
  }

  try {
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert([
        {
          name,
          description,
          start_date: startDate,
          end_date: endDate,
          start_time: startTime,
          end_time: endTime,
          faculty_id: facultyId,
          skill_id: skillId,
          max_students: maxStudents,
          status,
          days_of_week: daysOfWeek,
        },
      ])
      .select('*, faculty:faculty_id(*), skill:skill_id(*)')
      .single();

    if (batchError) throw batchError;

    if (studentIds && studentIds.length > 0) {
      const batchStudentData = studentIds.map((studentId) => ({ batch_id: batchData.id, student_id: studentId }));
      const { error: batchStudentError } = await supabase.from('batch_students').insert(batchStudentData);
      if (batchStudentError) throw batchStudentError;
    }

    const { data, error } = await supabase
      .from('batches')
      .select('*, faculty:faculty_id(*), skill:skill_id(*), students:students(*)')
      .eq('id', batchData.id)
      .single();

    if (error) throw error;

    await logActivity('created', `batch ${data.name}`, 'Admin');

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateBatch = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    startDate,
    endDate,
    startTime,
    endTime,
    facultyId,
    skillId,
    maxStudents,
    status,
    studentIds,
    daysOfWeek,
  } = req.body;

  try {
    const { error: deleteError } = await supabase.from('batch_students').delete().eq('batch_id', id);
    if (deleteError) throw deleteError;

    if (studentIds && studentIds.length > 0) {
      const batchStudentData = studentIds.map((studentId) => ({ batch_id: id, student_id: studentId }));
      const { error: insertError } = await supabase.from('batch_students').insert(batchStudentData);
      if (insertError) throw insertError;
    }

    const { data, error } = await supabase
      .from('batches')
      .update({
        name,
        description,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime,
        end_time: endTime,
        faculty_id: facultyId,
        skill_id: skillId,
        max_students: maxStudents,
        status,
        days_of_week: daysOfWeek,
      })
      .eq('id', id)
      .select('*, faculty:faculty_id(*), skill:skill_id(*), students:students(*)')
      .single();

    if (error) throw error;

    await logActivity('updated', `batch ${data.name}`, 'Admin');

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteBatch = async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase.from('batches').delete().eq('id', id);
    if (error) throw error;

    await logActivity('deleted', `batch with id ${id}`, 'Admin');

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getBatchStudents = async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('batch_students')
      .select('students(*)')
      .eq('batch_id', id);

    if (error) throw error;

    const students = data.map(item => item.students);

    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getAllBatches, createBatch, updateBatch, deleteBatch, getBatchStudents };