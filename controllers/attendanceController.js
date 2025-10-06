const supabase = require('../db');

// --- UTILITY HELPERS ---

/**
 * Fetches all records from a table, handling Supabase's pagination limit.
 */
const fetchAll = async (tableName, selectQuery) => {
  const allData = [];
  const pageSize = 1000;
  let page = 0;
  let moreDataAvailable = true;

  while (moreDataAvailable) {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from(tableName)
      .select(selectQuery)
      .range(from, to);

    if (error) {
      console.error(`Error fetching from ${tableName}:`, error);
      throw error;
    }

    if (data) {
      allData.push(...data);
    }

    if (!data || data.length < pageSize) {
      moreDataAvailable = false;
    }
    page++;
  }
  return allData;
};

/**
 * Determines if a batch is "Upcoming", "Active", or "Completed".
 */
function getDynamicStatus(startDate, endDate) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (now < start) {
    return "Upcoming";
  } else if (now >= start && now <= end) {
    return "Active";
  } else {
    return "Completed";
  }
}

/**
 * Centralized helper to calculate attendance metrics for a given set of batches.
 * This prevents code duplication and ensures consistent calculations.
 */
const calculateBatchReports = (batches, batchStudentCounts, attendanceByBatch) => {
  let totalPresentForSet = 0;
  let totalPossibleForSet = 0;

  const batchReports = batches.map((batch) => {
    const studentCount = batchStudentCounts[batch.id] || 0;
    const attendanceData = attendanceByBatch[batch.id];

    if (!attendanceData || studentCount === 0) {
      return {
        batch_id: batch.id,
        batch_name: batch.name,
        attendance_percentage: 0,
        student_count: studentCount,
        total_sessions: 0,
        total_present: 0,
      };
    }

    const totalSessions = attendanceData.dates.size;
    const totalPresent = attendanceData.present;
    const totalPossible = studentCount * totalSessions;

    totalPresentForSet += totalPresent;
    totalPossibleForSet += totalPossible;

    const attendancePercentage =
      totalPossible > 0 ? (totalPresent / totalPossible) * 100 : 0;

    return {
      batch_id: batch.id,
      batch_name: batch.name,
      attendance_percentage: parseFloat(attendancePercentage.toFixed(2)),
      student_count: studentCount,
      total_sessions: totalSessions,
      total_present: totalPresent,
    };
  });

  return {
    batchReports,
    totalPresent: totalPresentForSet,
    totalPossible: totalPossibleForSet,
  };
};

// --- CONTROLLER FUNCTIONS ---

/**
 * Adds or updates attendance records.
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

    const { data, error } = await supabase
      .from('student_attendance')
      .upsert(records, { onConflict: ['batch_id', 'student_id', 'date'] })
      .select();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Fetches attendance records for a single batch on a specific date.
 * RENAMED from getAttendanceByBatch for clarity.
 */
const getDailyAttendanceForBatch = async (req, res) => {
  const { batchId } = req.params;
  const { date } = req.query; // UPDATED: Gets date from query parameter

  if (!date) {
    return res.status(400).json({ error: "A 'date' query parameter is required (e.g., ?date=YYYY-MM-DD)." });
  }

  try {
    const formattedDate = date.substring(0, 10);
    const { data, error } = await supabase
      .from('student_attendance')
      .select('*, student:students(*)')
      .eq('batch_id', batchId)
      .eq('date', formattedDate);

    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generates a student-by-student attendance report for one batch over a date range.
 * RENAMED from getAttendanceReport for clarity.
 */
const getBatchAttendanceReport = async (req, res) => {
  const { batchId } = req.params;
  const { startDate, endDate } = req.query;

  if (!batchId || !startDate || !endDate) {
    return res.status(400).json({ error: 'Batch ID, start date, and end date are required.' });
  }

  try {
    const { data: studentLinks, error: studentError } = await supabase
      .from('batch_students')
      .select('students(*)')
      .eq('batch_id', batchId);

    if (studentError) throw studentError;
    if (!studentLinks || studentLinks.length === 0) {
      return res.status(404).json({ error: 'No students found for this batch.' });
    }
    const students = studentLinks.map(link => link.students);

    const { data: attendanceRecords, error: attendanceError } = await supabase
      .from('student_attendance')
      .select('student_id, date, is_present')
      .eq('batch_id', batchId)
      .gte('date', startDate)
      .lte('date', endDate);

    if (attendanceError) throw attendanceError;

    const attendance_by_date = attendanceRecords.reduce((acc, record) => {
      const dateKey = record.date;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push({
        student_id: record.student_id,
        is_present: record.is_present,
      });
      return acc;
    }, {});

    res.status(200).json({
      students,
      attendance_by_date,
    });
  } catch (error)
  {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generates a detailed attendance report for a single faculty.
 */
const getFacultyAttendanceReport = async (req, res) => {
  const { facultyId } = req.params;
  const { role: requestingUserRole, faculty_id: requestingUserFacultyId } = req.user;

  // --- ADDED: Authorization Security Check ---
  if (requestingUserRole !== 'admin' && requestingUserFacultyId !== facultyId) {
    return res.status(403).json({ error: "Forbidden: You do not have permission to access this report." });
  }

  try {
    const { data: facultyData, error: facultyError } = await supabase
      .from('faculty').select('id, name').eq('id', facultyId).single();

    if (facultyError) throw facultyError;
    if (!facultyData) return res.status(404).json({ error: "Faculty not found." });

    const { data: batchesData, error: batchesError } = await supabase
      .from("batches").select("id, name, start_date, end_date").eq("faculty_id", facultyId);

    if (batchesError) throw batchesError;

    const activeBatches = batchesData.filter(b => getDynamicStatus(b.start_date, b.end_date) === "Active");

    if (activeBatches.length === 0) {
      return res.status(200).json({
        faculty_id: facultyData.id,
        faculty_name: facultyData.name,
        faculty_attendance_percentage: 0,
        batches: [],
      });
    }

    const batchIds = activeBatches.map(b => b.id);

    const [{ data: studentLinks }, { data: allAttendance }] = await Promise.all([
      supabase.from("batch_students").select("batch_id, student_id").in("batch_id", batchIds),
      supabase.from("student_attendance").select("batch_id, date, is_present").in("batch_id", batchIds),
    ]);

    const batchStudentCounts = studentLinks.reduce((acc, link) => {
      acc[link.batch_id] = (acc[link.batch_id] || 0) + 1;
      return acc;
    }, {});

    const attendanceByBatch = allAttendance.reduce((acc, record) => {
      if (!acc[record.batch_id]) acc[record.batch_id] = { present: 0, dates: new Set() };
      if (record.is_present) acc[record.batch_id].present++;
      acc[record.batch_id].dates.add(record.date);
      return acc;
    }, {});

    const { batchReports, totalPresent, totalPossible } = calculateBatchReports(
      activeBatches, batchStudentCounts, attendanceByBatch
    );

    const facultyAttendancePercentage = totalPossible > 0 ? (totalPresent / totalPossible) * 100 : 0;

    res.status(200).json({
      faculty_id: facultyData.id,
      faculty_name: facultyData.name,
      faculty_attendance_percentage: parseFloat(facultyAttendancePercentage.toFixed(2)),
      batches: batchReports,
    });
  } catch (error) {
    console.error("Error generating faculty attendance report:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generates a comprehensive attendance report for all faculties.
 */
const getOverallAttendanceReport = async (req, res) => {
  try {
    const [
        { data: faculties, error: facultyError },
        batchesData,
        studentLinks,
        allAttendance,
    ] = await Promise.all([
        supabase.from("faculty").select("id, name"),
        fetchAll("batches", "id, name, faculty_id, start_date, end_date"),
        fetchAll("batch_students", "batch_id, student_id"),
        fetchAll("student_attendance", "batch_id, date, is_present"),
    ]);

    if (facultyError) throw facultyError;

    const activeBatches = batchesData.filter(b => getDynamicStatus(b.start_date, b.end_date) === "Active");
    const batchStudentCounts = studentLinks.reduce((acc, link) => {
      acc[link.batch_id] = (acc[link.batch_id] || 0) + 1;
      return acc;
    }, {});
    const attendanceByBatch = allAttendance.reduce((acc, record) => {
      if (!acc[record.batch_id]) acc[record.batch_id] = { present: 0, dates: new Set() };
      if (record.is_present) acc[record.batch_id].present++;
      acc[record.batch_id].dates.add(record.date);
      return acc;
    }, {});

    let grandTotalPresent = 0;
    let grandTotalPossible = 0;

    const facultyReports = faculties.map((faculty) => {
      const facultyBatches = activeBatches.filter(b => b.faculty_id === faculty.id);
      const { batchReports, totalPresent, totalPossible } = calculateBatchReports(
        facultyBatches, batchStudentCounts, attendanceByBatch
      );
      const facultyAttendancePercentage = totalPossible > 0 ? (totalPresent / totalPossible) * 100 : 0;
      grandTotalPresent += totalPresent;
      grandTotalPossible += totalPossible;

      return {
        faculty_id: faculty.id,
        faculty_name: faculty.name,
        faculty_attendance_percentage: parseFloat(facultyAttendancePercentage.toFixed(2)),
        batches: batchReports,
      };
    });

    const overallAttendancePercentage = grandTotalPossible > 0 ? (grandTotalPresent / grandTotalPossible) * 100 : 0;

    res.status(200).json({
      overall_attendance_percentage: parseFloat(overallAttendancePercentage.toFixed(2)),
      faculty_reports: facultyReports,
    });
  } catch (error) {
    console.error("Error generating overall attendance report:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- EXPORTS ---

module.exports = {
  addOrUpdateAttendance,
  getDailyAttendanceForBatch,
  getBatchAttendanceReport,
  getFacultyAttendanceReport,
  getOverallAttendanceReport,
};