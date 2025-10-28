const supabase = require('../db');
const { logActivity } = require('./logActivity');

// **FIX**: Standardized status to all lowercase to match frontend types
const getDynamicStatus = (startDate, endDate) => {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'active';
  return 'completed';
};

const getAllBatches = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [batchesResult, substitutionsResult, allFacultiesResult] = await Promise.all([
      // This query is intentionally lightweight. It fetches the COUNT of students,
      // not the full student objects. This is critical for performance.
      supabase.from('batches').select(`
        *,
        faculty:faculty_id(*),
        skill:skill_id(*),
        students:batch_students(count)
      `),
      supabase.from('faculty_substitutions').select(`*, substitute:substitute_faculty_id(*)`).lte('start_date', today).gte('end_date', today),
      supabase.from('faculty').select('*')
    ]);

    if (batchesResult.error) throw batchesResult.error;
    if (substitutionsResult.error) throw substitutionsResult.error;
    if (allFacultiesResult.error) throw allFacultiesResult.error;

    const allBatches = batchesResult.data;
    const activeSubstitutions = substitutionsResult.data;
    const allFaculties = allFacultiesResult.data;

    const formattedData = allBatches.map(batch => {
      const activeSub = activeSubstitutions.find(sub => sub.batch_id === batch.id);
      
      let finalBatch = {
        ...batch,
        status: getDynamicStatus(batch.start_date, batch.end_date),
        // The student data from the query is an object like [{ count: 15 }].
        // We extract the number here. This is what the frontend BatchTable expects.
        students: batch.students[0]?.count || 0,
        isSubstituted: false,
      };

      if (activeSub && activeSub.substitute) {
        const originalFaculty = allFaculties.find(f => f.id === activeSub.original_faculty_id);
        
        finalBatch.isSubstituted = true;
        finalBatch.faculty = activeSub.substitute;
        finalBatch.faculty_id = activeSub.substitute_faculty_id;
        finalBatch.original_faculty = originalFaculty ? { id: originalFaculty.id, name: originalFaculty.name } : null;
        finalBatch.substitutionDetails = activeSub;
      }

      return finalBatch;
    });
    
    if (req.user && req.user.role === 'faculty') {
        const facultyBatches = formattedData.filter(batch => batch.faculty_id === req.user.faculty_id);
        return res.json(facultyBatches);
    }

    res.json(formattedData);
  } catch (error) {
    console.error("Error in getAllBatches:", error);
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
    // --- Faculty availability check logic ---
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

    // --- Scheduling conflict check logic ---
    
    // --- LOGIC UPDATE ---
    // We only check for conflicts against batches that are NOT completed.
    // i.e., batches whose end_date is today or in the future.
    const today = new Date().toISOString().split('T')[0];

    const { data: existingBatches, error: existingBatchesError } = await supabase
      .from('batches')
      .select('name, start_time, end_time, days_of_week, start_date, end_date')
      .eq('faculty_id', facultyId)
      .gte('end_date', today); // <-- THIS IS THE FIX: Ignores completed batches

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

// --- CORRECTED FUNCTION ---
const updateBatch = async (req, res) => {
  const { id } = req.params; // The ID of the batch being updated
  const {
    name, description, startDate, endDate, startTime, endTime,
    facultyId, skillId, maxStudents, studentIds, daysOfWeek,
  } = req.body;

  try {
    // --- 1. ADDED: Faculty availability check (same as in createBatch) ---
    const { data: facultyAvailability, error: availabilityError } = await supabase
      .from('faculty_availability')
      .select('day_of_week, start_time, end_time')
      .eq('faculty_id', facultyId);

    if (availabilityError) throw availabilityError;
    
    const newStartTime = new Date(`1970-01-01T${startTime}Z`);
    const newEndTime = new Date(`1970-01-01T${endTime}Z`);

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

    // --- 2. FIXED: Scheduling conflict check ---
    
    // --- LOGIC UPDATE ---
    // We only check for conflicts against batches that are NOT completed.
    // i.e., batches whose end_date is today or in the future.
    const today = new Date().toISOString().split('T')[0];
    
    const { data: existingBatches, error: existingBatchesError } = await supabase
      .from('batches')
      .select('id, name, start_time, end_time, days_of_week, start_date, end_date')
      .eq('faculty_id', facultyId)
      .neq('id', id) // <-- THE CRITICAL FIX: Exclude the current batch
      .gte('end_date', today); // <-- THIS IS THE FIX: Ignores completed batches

    if (existingBatchesError) throw existingBatchesError;

    const newStartDate = new Date(startDate);
    const newEndDate = new Date(endDate);

    for (const batch of existingBatches) {
      const existingStartTime = new Date(`1970-01-01T${batch.start_time}Z`);
      const existingEndTime = new Date(`1970-01-01T${batch.end_time}Z`);
      const existingStartDate = new Date(batch.start_date);
      const existingEndDate = new Date(batch.end_date);
      const daysOverlap = daysOfWeek.some(day => batch.days_of_week.map(d => d.toLowerCase()).includes(day.toLowerCase()));
      const datesOverlap = newStartDate <= existingEndDate && newEndDate >= existingStartDate;

      if (daysOverlap && datesOverlap && newStartTime < existingEndTime && newEndTime > existingStartTime) {
        return res.status(409).json({ error: `Faculty has a scheduling conflict with other batch: ${batch.name}.` });
      }
    }
    
    // --- Original update logic now follows after successful validation ---
    const status = getDynamicStatus(startDate, endDate);

    // First, remove all existing student associations for this batch
    const { error: deleteError } = await supabase.from('batch_students').delete().eq('batch_id', id);
    if (deleteError) throw deleteError;

    // Then, add the new list of students
    if (studentIds && studentIds.length > 0) {
      const batchStudentData = studentIds.filter(Boolean).map((studentId) => ({ batch_id: id, student_id: studentId }));
      if (batchStudentData.length > 0) {
        const { error: insertError } = await supabase.from('batch_students').insert(batchStudentData);
        if (insertError) throw insertError;
      }
    }

    // Finally, update the batch details
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
     // --- 3. ADDED: Robust error handling (same as in createBatch) ---
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
    const allStudentLinks = [];
    const pageSize = 1000;
    let page = 0;
    let moreDataAvailable = true;

    while (moreDataAvailable) {
      const from = page * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('batch_students')
        .select('students ( id, name, admission_number, phone_number, remarks )')
        .eq('batch_id', id)
        .range(from, to);

      if (error) throw error;

      if (data) {
        allStudentLinks.push(...data);
      }
      
      if (!data || data.length < pageSize) {
        moreDataAvailable = false;
      }
      page++;
    }

    const students = allStudentLinks.map(item => item.students).filter(Boolean);
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getActiveStudentsCount = async (req, res) => {
  try {
    const { data: batches, error: batchesError } = await supabase
      .from("batches")
      .select("id, start_date, end_date");

    if (batchesError) throw batchesError;

    const activeBatches = batches.filter(
      (batch) => getDynamicStatus(batch.start_date, batch.end_date).toLowerCase() === "active"
    );

    if (activeBatches.length === 0) {
      return res.status(200).json({ total_active_students: 0 });
    }

    const activeBatchIds = activeBatches.map((b) => b.id);

    const { data: studentLinks, error: studentLinksError } = await supabase
      .from("batch_students")
      .select("student_id")
      .in("batch_id", activeBatchIds);

    if (studentLinksError) throw studentLinksError;

    const uniqueStudentIds = new Set(studentLinks.map((link) => link.student_id));
    const totalActiveStudents = uniqueStudentIds.size;

    res.status(200).json({ total_active_students: totalActiveStudents });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAllBatches,
  createBatch,
  updateBatch,
  deleteBatch,
  getBatchStudents,
  getActiveStudentsCount,
};