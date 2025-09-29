const supabase = require('../db');
const { logActivity } = require('./logActivity');

const getDynamicStatus = (startDate, endDate) => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (now < start) {
    return 'Upcoming';
  } else if (now >= start && now <= end) {
    return 'active';
  } else {
    return 'Completed';
  }
};

const getAllBatches = async (req, res) => {
  try {
    const query = supabase
      .from('batches')
      .select(`
        *,
        faculty:faculty_id(*),
        skill:skill_id(*),
        students:batch_students(students(*))
      `);

    if (req.user && req.user.role === 'faculty') {
      query.eq('faculty_id', req.user.faculty_id);
    }

    const { data, error } = await query;
    if (error) throw error;

    const formattedData = data.map(batch => {
      const status = getDynamicStatus(batch.start_date, batch.end_date);
      return {
        ...batch,
        status,
        students: batch.students.map(s => s.students).filter(Boolean)
      };
    });

    res.json(formattedData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createBatch = async (req, res) => {
  const {
    name, description, startDate, endDate, startTime, endTime,
    facultyId, skillId, maxStudents, studentIds, daysOfWeek, status
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Batch name is required' });
  }

  try {
    // --- RESTORED: Faculty availability check logic ---
    const { data: facultyAvailability, error: availabilityError } = await supabase
      .from('faculty_availability')
      .select('day_of_week, start_time, end_time')
      .eq('faculty_id', facultyId);

    if (availabilityError) throw availabilityError;

    const newStartTime = new Date(`1970-01-01T${startTime}Z`);
    const newEndTime = new Date(`1970-01-01T${endTime}Z`);
    const newStartDate = new Date(startDate);
    const newEndDate = new Date(endDate);

    for (const day of daysOfWeek) {
      const availabilityForDay = facultyAvailability.find(a => a.day_of_week.toLowerCase() === day.toLowerCase());
      if (!availabilityForDay) {
        return res.status(400).json({ error: `Faculty is not available on ${day}.` });
      }
      const facultyStartTime = new Date(`1970-01-01T${availabilityForDay.start_time}Z`);
      const facultyEndTime = new Date(`1970-01-01T${availabilityForDay.end_time}Z`);
      if (newStartTime < facultyStartTime || newEndTime > facultyEndTime) {
        return res.status(400).json({ error: `Batch time on ${day} is outside of faculty's available hours.` });
      }
    }

    // --- RESTORED: Scheduling conflict check logic ---
    const { data: existingBatches, error: existingBatchesError } = await supabase
      .from('batches')
      .select('name, start_time, end_time, days_of_week, start_date, end_date')
      .eq('faculty_id', facultyId);
      // Removed .neq('status', 'Completed') to rely on dates instead

    if (existingBatchesError) throw existingBatchesError;

    for (const batch of existingBatches) {
      const existingStartTime = new Date(`1970-01-01T${batch.start_time}Z`);
      const existingEndTime = new Date(`1970-01-01T${batch.end_time}Z`);
      const existingStartDate = new Date(batch.start_date);
      const existingEndDate = new Date(batch.end_date);
      const daysOverlap = daysOfWeek.some(day => batch.days_of_week.map(d => d.toLowerCase()).includes(day.toLowerCase()));
      const datesOverlap = newStartDate <= existingEndDate && newEndDate >= existingStartDate;

      if (daysOverlap && datesOverlap && newStartTime < existingEndTime && newEndTime > existingStartTime) {
        return res.status(409).json({ error: `Faculty has a scheduling conflict with batch: ${batch.name}.` });
      }
    }
    
    // --- CORE INSERT LOGIC ---
    const { data: batchData, error: batchError } = await supabase
      .from('batches')
      .insert([{
        name, description,
        start_date: startDate, end_date: endDate,
        start_time: startTime, end_time: endTime,
        faculty_id: facultyId, skill_id: skillId,
        max_students: maxStudents, days_of_week: daysOfWeek,
        status,
      }])
      .select('id, name')
      .single();

    if (batchError) throw batchError;

    if (studentIds && studentIds.length > 0) {
      const batchStudentData = studentIds.map((studentId) => ({ batch_id: batchData.id, student_id: studentId }));
      const { error: batchStudentError } = await supabase.from('batch_students').insert(batchStudentData);
      if (batchStudentError) throw batchStudentError;
    }

    // --- FINAL SELECT (Corrected) ---
    const { data: finalBatch, error: finalBatchError } = await supabase
      .from('batches')
      .select(`*, faculty:faculty_id(*), skill:skill_id(*), students:batch_students(students(*))`)
      .eq('id', batchData.id)
      .single();

    if (finalBatchError) throw finalBatchError;

    const formattedBatch = { ...finalBatch, students: finalBatch.students.map(s => s.students).filter(Boolean) };
    await logActivity('created', `batch ${formattedBatch.name}`, 'Admin');
    res.status(201).json(formattedBatch);

  } catch (error) {
    // --- RESTORED: Detailed error handling ---
    if (error.code === '23505' && error.message.includes('batches_name_key')) {
      return res.status(409).json({ error: `A batch with the name '${name}' already exists.` });
    }
    if (error.code === '23503') {
      if (error.message.includes('batches_faculty_id_fkey')) return res.status(400).json({ error: `Faculty with ID ${facultyId} does not exist.` });
      if (error.message.includes('batches_skill_id_fkey')) return res.status(400).json({ error: `Skill with ID ${skillId} does not exist.` });
      if (error.message.includes('batch_students_student_id_fkey')) return res.status(400).json({ error: 'One or more student IDs are invalid.' });
    }
    res.status(500).json({ error: error.message });
  }
};

const updateBatch = async (req, res) => {
  const { id } = req.params;
  const {
    name, description, startDate, endDate, startTime, endTime,
    facultyId, skillId, maxStudents, studentIds, daysOfWeek,
  } = req.body;

  try {
    const status = getDynamicStatus(startDate, endDate);

    // This \"delete and replace\" strategy for students is effective and remains.
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
        name, description,
        start_date: startDate, end_date: endDate,
        start_time: startTime, end_time: endTime,
        faculty_id: facultyId || null, skill_id: skillId || null,
        max_students: maxStudents, days_of_week: daysOfWeek,
        status,
      })
      .eq('id', id)
      .select(`*, faculty:faculty_id(*), skill:skill_id(*), students:batch_students(students(*))`)
      .single();

    if (error) throw error;
    
    const formattedBatch = { ...data, students: data.students.map(s => s.students).filter(Boolean) };
    await logActivity('updated', `batch ${formattedBatch.name}`, 'Admin');
    res.json(formattedBatch);
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
      .select('students ( id, name, admission_number, phone_number, remarks )')
      .eq('batch_id', id);

    if (error) throw error;
    const students = data.map(item => item.students).filter(Boolean);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getAllBatches, createBatch, updateBatch, deleteBatch, getBatchStudents };