const supabase = require('../db');

const getAttendanceByBatch = async (req, res) => {
  const { facultyId, batchId, date } = req.params;

  try {
    const formattedDate = date.substring(0, 10);
    const { data, error } = await supabase
      .from('student_attendance')
      .select('*, student:students(*)')
      .eq('batch_id', batchId)
      .eq('date', formattedDate);

    if (error) {
      throw error;
    }

    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const addOrUpdateAttendance = async (req, res) => {
  const { batchId, date, attendance } = req.body;

  try {
    const formattedDate = date.substring(0, 10);

    const records = attendance.map(item => ({
      batch_id: batchId,
      student_id: item.student_id,
      date: formattedDate,
      is_present: item.is_present,
    }));

    // Upsert attendance records
    const { data, error } = await supabase
      .from('student_attendance')
      .upsert(records, { onConflict: ['batch_id', 'student_id', 'date'] })
      .select();

    if (error) {
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAttendanceByBatch,
  addOrUpdateAttendance,
};