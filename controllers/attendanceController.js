const supabase = require('../db');

/**
 * Fetches attendance records for a single batch on a specific date.
 */
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

/**
 * Adds or updates attendance records for a batch on a specific date.
 */
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

    // Upsert attendance records to either insert or update if they already exist.
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

/**
 * Generates a comprehensive attendance report for a batch over a specified date range.
 */
const getAttendanceReport = async (req, res) => {
  const { batchId } = req.params;
  const { startDate, endDate } = req.query;

  // 1. Validate input
  if (!batchId || !startDate || !endDate) {
    return res.status(400).json({ error: 'Batch ID, start date, and end date are required.' });
  }

  try {
    // 2. Fetch all students enrolled in the batch
    const { data: studentLinks, error: studentError } = await supabase
      .from('batch_students')
      .select('students(*)') // Select all columns from the related students table
      .eq('batch_id', batchId);

    if (studentError) throw studentError;
    if (!studentLinks || studentLinks.length === 0) {
      return res.status(404).json({ error: 'No students found for this batch.' });
    }
    // Flatten the result to get a simple array of student objects
    const students = studentLinks.map(link => link.students);

    // 3. Fetch all attendance records for this batch within the date range
    const { data: attendanceRecords, error: attendanceError } = await supabase
      .from('student_attendance')
      .select('student_id, date, is_present')
      .eq('batch_id', batchId)
      .gte('date', startDate) // gte = "greater than or equal to"
      .lte('date', endDate);   // lte = "less than or equal to"

    if (attendanceError) throw attendanceError;

    // 4. Group the attendance records by date for the frontend
    const attendance_by_date = attendanceRecords.reduce((acc, record) => {
      const dateKey = record.date;
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push({
        student_id: record.student_id,
        is_present: record.is_present,
      });
      return acc;
    }, {});

    // 5. Send the structured response
    res.status(200).json({
      students,
      attendance_by_date,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getAttendanceByBatch,
  addOrUpdateAttendance,
  getAttendanceReport, // Export the new function
};