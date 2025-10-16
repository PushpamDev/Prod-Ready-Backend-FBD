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
 * Determines if a batch is "upcoming", "active", or "completed".
 */
function getDynamicStatus(startDate, endDate) {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  now.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "active";
  return "completed";
}

// --- CONTROLLER FUNCTIONS ---

/**
 * Adds or updates attendance records for a specific date.
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
    const { data, error } = await supabase.from('student_attendance').upsert(records, { onConflict: ['batch_id', 'student_id', 'date'] }).select();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Fetches daily attendance for a single batch.
 */
const getDailyAttendanceForBatch = async (req, res) => {
  const { batchId } = req.params;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "A 'date' query parameter is required (e.g., ?date=YYYY-MM-DD)." });
  try {
    const formattedDate = date.substring(0, 10);
    const { data, error } = await supabase.from('student_attendance').select('*, student:students(*)').eq('batch_id', batchId).eq('date', formattedDate);
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generates a student-by-student attendance report for one batch.
 */
const getBatchAttendanceReport = async (req, res) => {
  const { batchId } = req.params;
  const { startDate, endDate } = req.query;
  if (!batchId || !startDate || !endDate) return res.status(400).json({ error: 'Batch ID, start date, and end date are required.' });
  try {
    const { data: studentLinks, error: studentError } = await supabase.from('batch_students').select('students(*)').eq('batch_id', batchId);
    if (studentError) throw studentError;
    if (!studentLinks || studentLinks.length === 0) return res.status(404).json({ error: 'No students found for this batch.' });
    const students = studentLinks.map(link => link.students);
    const { data: attendanceRecords, error: attendanceError } = await supabase.from('student_attendance').select('student_id, date, is_present').eq('batch_id', batchId).gte('date', startDate).lte('date', endDate);
    if (attendanceError) throw attendanceError;
    const attendance_by_date = attendanceRecords.reduce((acc, record) => {
      const dateKey = record.date;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push({ student_id: record.student_id, is_present: record.is_present });
      return acc;
    }, {});
    res.status(200).json({ students, attendance_by_date });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * UPDATED: Generates a "substitution-aware" attendance report for a single faculty.
 */
const getFacultyAttendanceReport = async (req, res) => {
  const { facultyId } = req.params;
  const { role: requestingUserRole, faculty_id: requestingUserFacultyId } = req.user;

  if (requestingUserRole !== 'admin' && requestingUserFacultyId !== facultyId) {
    return res.status(403).json({ error: "Forbidden: You do not have permission to access this report." });
  }

  try {
    const { data: facultyData, error: facultyError } = await supabase.from('faculty').select('id, name').eq('id', facultyId).single();
    if (facultyError || !facultyData) return res.status(404).json({ error: "Faculty not found." });

    const { data: permanentBatches, error: permError } = await supabase.from('batches').select('id').eq('faculty_id', facultyId);
    const { data: substituteRecords, error: subError } = await supabase.from('faculty_substitutions').select('batch_id').eq('substitute_faculty_id', facultyId);
    if (permError || subError) throw (permError || subError);

    const involvedBatchIds = new Set([...permanentBatches.map(b => b.id), ...substituteRecords.map(s => s.batch_id)]);
    if (involvedBatchIds.size === 0) {
      return res.json({ faculty_id: facultyId, faculty_name: facultyData.name, faculty_attendance_percentage: 0, batches: [] });
    }
    
    const [
      { data: allBatchDetails }, 
      { data: allSubstitutions },
      { data: studentLinks },
      { data: attendanceRecords }
    ] = await Promise.all([
      supabase.from('batches').select('id, name, faculty_id, start_date, end_date').in('id', [...involvedBatchIds]),
      supabase.from('faculty_substitutions').select('*').in('batch_id', [...involvedBatchIds]),
      supabase.from('batch_students').select('batch_id').in('batch_id', [...involvedBatchIds]),
      supabase.from('student_attendance').select('batch_id, date, is_present').in('batch_id', [...involvedBatchIds])
    ]);
    
    const activeBatches = allBatchDetails.filter(b => getDynamicStatus(b.start_date, b.end_date) === "active");
    if (activeBatches.length === 0) return res.json({ faculty_id: facultyId, faculty_name: facultyData.name, faculty_attendance_percentage: 0, batches: [] });
    
    const batchStudentCounts = studentLinks.reduce((acc, link) => ({ ...acc, [link.batch_id]: (acc[link.batch_id] || 0) + 1 }), {});
    
    let totalPresentForFaculty = 0;
    let totalPossibleForFaculty = 0;
    const reportByBatch = {};

    for (const record of attendanceRecords) {
      const recordDate = new Date(record.date);
      const substitution = allSubstitutions.find(s => s.batch_id === record.batch_id && recordDate >= new Date(s.start_date) && recordDate <= new Date(s.end_date));
      const batchDetails = allBatchDetails.find(b => b.id === record.batch_id);
      const actingFacultyId = substitution ? substitution.substitute_faculty_id : batchDetails.faculty_id;
      if (actingFacultyId === facultyId) {
        if (!reportByBatch[record.batch_id]) reportByBatch[record.batch_id] = { present: 0, dates: new Set() };
        if (record.is_present) reportByBatch[record.batch_id].present++;
        reportByBatch[record.batch_id].dates.add(record.date);
      }
    }
    
    const batchReports = activeBatches.filter(b => reportByBatch[b.id]).map(batch => {
      const studentCount = batchStudentCounts[batch.id] || 0;
      const totalSessions = reportByBatch[batch.id].dates.size;
      const totalPresent = reportByBatch[batch.id].present;
      const totalPossible = studentCount * totalSessions;
      
      totalPresentForFaculty += totalPresent;
      totalPossibleForFaculty += totalPossible;
      const percentage = totalPossible > 0 ? (totalPresent / totalPossible) * 100 : 0;
      
      return { batch_id: batch.id, batch_name: batch.name, attendance_percentage: parseFloat(percentage.toFixed(2)) };
    });

    const facultyAttendancePercentage = totalPossibleForFaculty > 0 ? (totalPresentForFaculty / totalPossibleForFaculty) * 100 : 0;

    res.status(200).json({
      faculty_id: facultyId,
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
 * UPDATED: Generates a "substitution-aware" overall attendance report with a crucial bug fix.
 */
const getOverallAttendanceReport = async (req, res) => {
  try {
    // FIX: Corrected destructuring for `fetchAll` results
    const [
        { data: faculties, error: facultyError },
        batchesData,
        substitutions,
        studentLinks,
        attendanceRecords,
    ] = await Promise.all([
        supabase.from("faculty").select("id, name"),
        fetchAll("batches", "id, name, faculty_id, start_date, end_date"),
        fetchAll("faculty_substitutions", "*"),
        fetchAll("batch_students", "batch_id"),
        fetchAll("student_attendance", "batch_id, date, is_present"),
    ]);

    if (facultyError) throw facultyError;

    const activeBatches = batchesData.filter(b => getDynamicStatus(b.start_date, b.end_date) === "active");
    if (activeBatches.length === 0) {
        return res.json({ overall_attendance_percentage: 0, faculty_reports: [] });
    }
    const activeBatchIds = new Set(activeBatches.map(b => b.id));

    const batchStudentCounts = studentLinks.filter(l => activeBatchIds.has(l.batch_id))
      .reduce((acc, link) => ({ ...acc, [link.batch_id]: (acc[link.batch_id] || 0) + 1 }), {});

    const substitutionMap = substitutions.reduce((acc, sub) => {
        if (!acc[sub.batch_id]) acc[sub.batch_id] = [];
        acc[sub.batch_id].push({ start: new Date(sub.start_date), end: new Date(sub.end_date), subId: sub.substitute_faculty_id });
        return acc;
    }, {});

    const facultyStats = faculties.reduce((acc, f) => ({ ...acc, [f.id]: { name: f.name, totalPresent: 0, batches: {} } }), {});

    for (const record of attendanceRecords) {
        if (!activeBatchIds.has(record.batch_id)) continue;
        const recordDate = new Date(record.date);
        const batchDetails = batchesData.find(b => b.id === record.batch_id);
        const subsForBatch = substitutionMap[record.batch_id];
        let actingFacultyId = batchDetails.faculty_id;
        if (subsForBatch) {
            const activeSub = subsForBatch.find(s => recordDate >= s.start && recordDate <= s.end);
            if (activeSub) actingFacultyId = activeSub.subId;
        }
        if (facultyStats[actingFacultyId]) {
            if (record.is_present) facultyStats[actingFacultyId].totalPresent++;
            if (!facultyStats[actingFacultyId].batches[record.batch_id]) {
                facultyStats[actingFacultyId].batches[record.batch_id] = new Set();
            }
            facultyStats[actingFacultyId].batches[record.batch_id].add(record.date);
        }
    }
    
    let grandTotalPresent = 0;
    let grandTotalPossible = 0;
    
    const facultyReports = Object.keys(facultyStats).map(facultyId => {
        const stats = facultyStats[facultyId];
        let facultyTotalPossible = 0;
        
        Object.keys(stats.batches).forEach(batchId => {
            const studentCount = batchStudentCounts[batchId] || 0;
            const sessionCount = stats.batches[batchId].size;
            facultyTotalPossible += studentCount * sessionCount;
        });

        const percentage = facultyTotalPossible > 0 ? (stats.totalPresent / facultyTotalPossible) * 100 : 0;
        grandTotalPresent += stats.totalPresent;
        grandTotalPossible += facultyTotalPossible;

        return {
            faculty_id: facultyId,
            faculty_name: stats.name,
            faculty_attendance_percentage: parseFloat(percentage.toFixed(2)),
        };
    });

    const overallAttendancePercentage = grandTotalPossible > 0 ? (grandTotalPresent / grandTotalPossible) * 100 : 0;

    res.status(200).json({
      overall_attendance_percentage: parseFloat(overallAttendancePercentage.toFixed(2)),
      faculty_reports: facultyReports.sort((a,b) => a.faculty_name.localeCompare(b.faculty_name)),
    });
  } catch (error) {
    console.error("Error generating overall attendance report:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  addOrUpdateAttendance,
  getDailyAttendanceForBatch,
  getBatchAttendanceReport,
  getFacultyAttendanceReport,
  getOverallAttendanceReport,
};