const supabase = require('../db');
const { logActivity } = require('./logActivity');

const getAllBatches = async (req, res) => {
  try {
    let query = supabase.from('batches').select('*, faculty:faculty_id(*), skill:skill_id(*), students:students(*)');

    // If the user is a faculty, only return batches assigned to them
    if (req.user && req.user.role === 'faculty') {
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
    // Check faculty availability
    const { data: facultyAvailability, error: availabilityError } = await supabase
      .from('faculty_availability')
      .select('day_of_week, start_time, end_time')
      .eq('faculty_id', facultyId);

    if (availabilityError) {
      throw availabilityError;
    }

    const newStartTime = new Date(`1970-01-01T${startTime}Z`);
    const newEndTime = new Date(`1970-01-01T${endTime}Z`);
    const newStartDate = new Date(startDate);
    const newEndDate = new Date(endDate);

    for (const day of daysOfWeek) {
      const availabilityForDay = facultyAvailability.find(a => a.day_of_week.toLowerCase() === day.toLowerCase());

      if (!availabilityForDay) {
        return res.status(400).json({
          error: `Faculty is not available on ${day}.`,
        });
      }

      const facultyStartTime = new Date(`1970-01-01T${availabilityForDay.start_time}Z`);
      const facultyEndTime = new Date(`1970-01-01T${availabilityForDay.end_time}Z`);

      if (newStartTime < facultyStartTime || newEndTime > facultyEndTime) {
        return res.status(400).json({
          error: `Batch time on ${day} is outside of faculty's available hours (${availabilityForDay.start_time} - ${availabilityForDay.end_time}).`,
        });
      }
    }

    // Check for faculty availability
    const { data: existingBatches, error: existingBatchesError } = await supabase
      .from('batches')
      .select('name, start_time, end_time, days_of_week, start_date, end_date')
      .eq('faculty_id', facultyId)
      .neq('status', 'Completed');

    if (existingBatchesError) {
      throw existingBatchesError;
    }

    for (const batch of existingBatches) {
      const existingStartTime = new Date(`1970-01-01T${batch.start_time}Z`);
      const existingEndTime = new Date(`1970-01-01T${batch.end_time}Z`);
      const existingStartDate = new Date(batch.start_date);
      const existingEndDate = new Date(batch.end_date);

      const daysOverlap = daysOfWeek.some(day => batch.days_of_week.map(d => d.toLowerCase()).includes(day.toLowerCase()));
      const datesOverlap = newStartDate <= existingEndDate && newEndDate >= existingStartDate;

      if (
        daysOverlap &&
        datesOverlap &&
        newStartTime < existingEndTime &&
        newEndTime > existingStartTime
      ) {
        return res.status(409).json({
          error: `Faculty has a scheduling conflict with batch: ${batch.name}.`,
        });
      }
    }
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
    if (error.code === '23505' && error.message.includes('batches_name_key')) {
      return res.status(409).json({ error: `A batch with the name '${name}' already exists.` });
    }
    if (error.code === '23503') {
      if (error.message.includes('batches_faculty_id_fkey')) {
        return res.status(400).json({ error: `Faculty with ID ${facultyId} does not exist.` });
      }
      if (error.message.includes('batches_skill_id_fkey')) {
        return res.status(400).json({ error: `Skill with ID ${skillId} does not exist.` });
      }
      if (error.message.includes('batch_students_student_id_fkey')) {
        return res.status(400).json({ error: 'One or more student IDs are invalid.' });
      }
    }
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
      const batchStudentData = studentIds.filter(Boolean).map((studentId) => ({ batch_id: id, student_id: studentId }));
      if (batchStudentData.length > 0) {
        const { error: insertError } = await supabase.from('batch_students').insert(batchStudentData);
        if (insertError) throw insertError;
      }
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
        faculty_id: facultyId || null,
        skill_id: skillId || null,
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
    if (error.code === '23503' && error.message.includes('batch_students_student_id_fkey')) {
      return res.status(400).json({ error: 'One or more student IDs are invalid.' });
    }
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