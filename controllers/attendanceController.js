
const supabase = require("../db.js");
/**
 * NEW HELPER: Generates a list of dates a batch WAS SUPPOSED to have class
 * from start_date up to 'today' (or batch end_date).
 * Default schedule is Mon-Sat (1,2,3,4,5,6).
 */
const getExpectedSessionDates = (startDate, endDate, scheduleDays = [1, 2, 3, 4, 5, 6]) => {
  const dates = [];
  let current = new Date(startDate);
  const today = new Date();
  const finalBoundary = new Date(endDate) > today ? today : new Date(endDate);

  while (current <= finalBoundary) {
    // 0 is Sunday, 1 is Monday...
    if (scheduleDays.includes(current.getDay())) {
      dates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

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

const getDailyAttendanceForBatch = async (req, res) => {
  const { batchId } = req.params;
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "A 'date' query parameter is required." });
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
 * UPDATED: Returns a report including students with a specific remark hierarchy.
 * Priority: 
 * - If RVM: (Balance <= 0) ? 'FULL PAID' : (Next Date) ? formattedDate : student.remarks
 * - If Legacy: student.remarks
 */
const getBatchAttendanceReport = async (req, res) => {
  const { batchId } = req.params;
  const { startDate, endDate } = req.query;
  
  if (!batchId || !startDate || !endDate) {
    return res.status(400).json({ error: 'Batch ID, start date, and end date are required.' });
  }
  
  try {
    const [
      { data: batchInfo, error: batchError },
      { data: studentLinks, error: studentError },
      { data: attendanceRecords, error: attendanceError }
    ] = await Promise.all([
      supabase.from('batches').select('start_date, end_date, schedule').eq('id', batchId).single(),
      // ✅ Fetching via 'students' table bridge to avoid PGRST200 join errors
      supabase.from('batch_students')
        .select(`
          student_id,
          students:student_id (
            *,
            follow_up:v_follow_up_task_list (
              next_task_due_date,
              total_due,
              task_count
            )
          )
        `)
        .eq('batch_id', batchId),
      supabase.from('student_attendance')
        .select('student_id, date, is_present')
        .eq('batch_id', batchId)
        .gte('date', startDate)
        .lte('date', endDate)
    ]);

    if (batchError || studentError || attendanceError) throw (batchError || studentError || attendanceError);
    if (!studentLinks || studentLinks.length === 0) return res.status(404).json({ error: 'No students found for this batch.' });

    // Process students to apply the standardized hybrid logic
    const processedStudents = studentLinks.map(link => {
      const student = link.students;
      if (!student) return null;

      const admissionNo = (student.admission_number || "").trim();
      const followData = Array.isArray(student.follow_up) ? student.follow_up[0] : student.follow_up;
      const balance = followData ? Number(followData.total_due || 0) : 0;
      const nextDate = followData?.next_task_due_date;
      
      let dynamicRemark = '';

      // ✅ LOGIC A: Modern Students (RVM-)
      if (admissionNo.startsWith('RVM-')) {
        if (balance <= 0) {
          dynamicRemark = 'FULL PAID';
        } else if (nextDate) {
          const d = new Date(nextDate);
          dynamicRemark = !isNaN(d.getTime()) 
            ? `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`
            : 'Date Pending';
        } else {
          dynamicRemark = student.remarks || 'No Remark';
        }
      } 
      // ✅ LOGIC B: Legacy Students (Numeric)
      else {
        dynamicRemark = student.remarks || 'No Remark';
      }

      return {
        id: student.id,
        name: student.name?.trim() || 'Unknown',
        admission_number: student.admission_number || 'N/A',
        phone_number: student.phone_number || '',
        remarks: dynamicRemark,
        total_due_amount: balance,
        is_defaulter: !!student.is_defaulter 
      };
    }).filter(Boolean);

    const markedDates = [...new Set(attendanceRecords.map(r => r.date))];
    const expectedDates = typeof getExpectedSessionDates === 'function' 
      ? getExpectedSessionDates(startDate, endDate, batchInfo.schedule || [1,2,3,4,5,6])
      : [];
      
    const missingDates = expectedDates.filter(d => !markedDates.includes(d));

    const attendance_by_date = attendanceRecords.reduce((acc, record) => {
      const dateKey = record.date;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push({ student_id: record.student_id, is_present: record.is_present });
      return acc;
    }, {});

    res.status(200).json({ 
      students: processedStudents, 
      attendance_by_date, 
      compliance: {
        missing_attendance_dates: missingDates,
        expected_days_count: expectedDates.length,
        marked_days_count: markedDates.length
      }
    });
  } catch (error) {
    console.error("Batch Report Error:", error);
    res.status(500).json({ error: error.message });
  }
};
/**
 * UPDATED: Single Faculty Audit Report
 * Now includes BOTH Active and Completed batches.
 * Includes Date Filters and Math Guards to prevent 100%+ attendance discrepancies.
 */
const getFacultyAttendanceReport = async (req, res) => {
  const { facultyId } = req.params;
  const { startDate, endDate } = req.query; // New Date Filter Params
  const { locationId } = req;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "Start date and end date are required for the audit." });
  }

  try {
    const { data: facultyData } = await supabase.from('faculty').select('id, name').eq('id', facultyId).single();
    if (!facultyData) return res.status(404).json({ error: "Faculty not found" });

    // 1. Fetch involved batches (Permanent + Substitutions)
    const [permBatches, subRecords] = await Promise.all([
      supabase.from('batches').select('id').eq('faculty_id', facultyId).eq('location_id', locationId),
      supabase.from('faculty_substitutions').select('batch_id').eq('substitute_faculty_id', facultyId)
    ]);

    const involvedBatchIds = [...new Set([...(permBatches.data || []).map(b => b.id), ...(subRecords.data || []).map(s => s.batch_id)])];
    
    if (involvedBatchIds.length === 0) {
      return res.json({ faculty_id: facultyId, faculty_name: facultyData.name, faculty_attendance_percentage: 0, batches: [], missing_logs: [] });
    }

    // 2. Fetch data within the specific Date Range
    const [allBatches, studentLinks, attendanceRecords, substitutions] = await Promise.all([
      supabase.from('batches').select('id, name, faculty_id, start_date, end_date, schedule').in('id', involvedBatchIds),
      supabase.from('batch_students').select('batch_id').in('batch_id', involvedBatchIds),
      supabase.from('student_attendance').select('batch_id, date, is_present').in('batch_id', involvedBatchIds).gte('date', startDate).lte('date', endDate),
      supabase.from('faculty_substitutions').select('*').in('batch_id', involvedBatchIds)
    ]);

    // ✅ REMOVED: .filter(b => getDynamicStatus(...) === "active")
    // This allows the engine to process batches regardless of their current status.
    const batchesToProcess = allBatches.data || [];
    
    const batchStudentCounts = studentLinks.data.reduce((acc, link) => ({ ...acc, [link.batch_id]: (acc[link.batch_id] || 0) + 1 }), {});

    let totalPresentGlobal = 0;
    let globalPossibleGlobal = 0;

    const batchReports = batchesToProcess.map(batch => {
      const studentCount = batchStudentCounts[batch.id] || 0;
      
      // Calculate expected sessions strictly within the user-defined Audit Range
      const auditStart = new Date(startDate) > new Date(batch.start_date) ? startDate : batch.start_date;
      const auditEnd = new Date(endDate) < new Date(batch.end_date) ? endDate : batch.end_date;
      const expectedDates = getExpectedSessionDates(auditStart, auditEnd, batch.schedule);
      
      // Filter attendance to only count days this specific faculty was responsible
      const relevantAttendance = attendanceRecords.data.filter(rec => {
        if (rec.batch_id !== batch.id) return false;
        const sub = substitutions.data.find(s => s.batch_id === batch.id && rec.date >= s.start_date && rec.date <= s.end_date);
        const actingFacultyId = sub ? sub.substitute_faculty_id : batch.faculty_id;
        return actingFacultyId === facultyId;
      });

      const markedDates = [...new Set(relevantAttendance.map(a => a.date))];
      const sessionCount = markedDates.length;
      
      /** * MATH GUARD: Prevents > 100% 
       * Caps present marks by (current_students * sessions_logged)
       */
      const maxPossibleMarks = studentCount * sessionCount;
      const actualPresentCount = relevantAttendance.filter(a => a.is_present).length;
      const cappedPresentCount = Math.min(actualPresentCount, maxPossibleMarks);
      
      const missingDates = expectedDates.filter(d => !markedDates.includes(d));

      totalPresentGlobal += cappedPresentCount;
      globalPossibleGlobal += maxPossibleMarks;

      return {
        batch_id: batch.id,
        batch_name: batch.name,
        // ✅ Added status helper so the frontend can display the correct badge
        status: getDynamicStatus(batch.start_date, batch.end_date),
        student_count: studentCount,
        total_sessions: sessionCount,
        attendance_percentage: maxPossibleMarks > 0 
            ? parseFloat(((cappedPresentCount / maxPossibleMarks) * 100).toFixed(2)) 
            : 0,
        compliance: { missing_attendance_dates: missingDates, is_complete: missingDates.length === 0 }
      };
    });

    res.status(200).json({
      faculty_id: facultyId,
      faculty_name: facultyData.name,
      faculty_attendance_percentage: globalPossibleGlobal > 0 
        ? parseFloat(((totalPresentGlobal / globalPossibleGlobal) * 100).toFixed(2)) 
        : 0,
      batches: batchReports,
      missing_logs: batchReports
        .filter(b => !b.compliance.is_complete)
        .map(b => ({ batch_name: b.batch_name, count: b.compliance.missing_attendance_dates.length }))
    });
  } catch (error) {
    console.error("Faculty Report Filter Error:", error);
    res.status(500).json({ error: error.message });
  }
};
const getOverallAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { locationId } = req;

    if (!locationId) return res.status(401).json({ error: 'Authentication required.' });
    
    // Safety Check: Backend now strictly requires these for accurate compliance math
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Start date and end date are required for the audit." });
    }

    // 1. Fetch base data for the location
    const { data: faculties } = await supabase.from("faculty").select("id, name").eq('location_id', locationId);
    const { data: batchesData } = await supabase.from("batches").select("id, name, faculty_id, start_date, end_date, schedule").eq('location_id', locationId);

    const activeBatches = batchesData.filter(b => getDynamicStatus(b.start_date, b.end_date) === "active");
    if (activeBatches.length === 0) return res.json({ overall_attendance_percentage: 0, faculty_reports: [] });

    const activeBatchIds = activeBatches.map(b => b.id);

    // 2. Fetch all records strictly filtered by the Audit Date Range
    const [substitutions, studentLinks, attendanceRecords] = await Promise.all([
        supabase.from("faculty_substitutions").select("*").in('batch_id', activeBatchIds),
        supabase.from("batch_students").select("batch_id").in('batch_id', activeBatchIds),
        supabase.from("student_attendance")
          .select("batch_id, date, is_present")
          .in('batch_id', activeBatchIds)
          .gte('date', startDate)
          .lte('date', endDate)
    ]);

    const batchStudentCounts = studentLinks.data.reduce((acc, link) => {
        acc[link.batch_id] = (acc[link.batch_id] || 0) + 1;
        return acc;
    }, {});
    
    // 3. Initialize storage for Faculty metrics
    const facultyStats = faculties.reduce((acc, f) => ({ 
      ...acc, 
      [f.id]: { id: f.id, name: f.name, batchStats: {} } 
    }), {});

    // 4. Process Attendance: Attribute each record to the CORRECT acting faculty on that specific date
    for (const record of attendanceRecords.data) {
        const batchDetails = activeBatches.find(b => b.id === record.batch_id);
        if (!batchDetails) continue;

        const subs = substitutions.data.filter(s => s.batch_id === record.batch_id);
        let actingId = batchDetails.faculty_id;
        
        // Substitution check
        const activeSub = subs.find(s => record.date >= s.start_date && record.date <= s.end_date);
        if (activeSub) actingId = activeSub.substitute_faculty_id;

        if (facultyStats[actingId]) {
            const stats = facultyStats[actingId];
            if (!stats.batchStats[record.batch_id]) {
                stats.batchStats[record.batch_id] = { presentCount: 0, dates: new Set() };
            }
            if (record.is_present) stats.batchStats[record.batch_id].presentCount++;
            stats.batchStats[record.batch_id].dates.add(record.date);
        }
    }

    let globalTotalPresent = 0;
    let globalTotalPossible = 0;

    // 5. Generate individual reports for each faculty
    const facultyReports = Object.keys(facultyStats).map(fId => {
        const stats = facultyStats[fId];
        const missingLogs = [];
        const batchBreakdown = [];
        let facultyPresent = 0;
        let facultyPossible = 0;

        activeBatches.forEach(batch => {
            const bData = stats.batchStats[batch.id];
            const markedDates = Array.from(bData?.dates || []);
            const sessionCount = markedDates.length;
            const isPrimary = batch.faculty_id === fId;
            const hasMarkedData = sessionCount > 0;

            if (isPrimary || hasMarkedData) {
                const studentCount = batchStudentCounts[batch.id] || 0;
                
                // Math Guard: Prevents > 100% attendance due to orphaned records
                const maxPossibleForThisBatch = studentCount * sessionCount;
                const cappedPresentCount = Math.min(bData?.presentCount || 0, maxPossibleForThisBatch);
                
                facultyPresent += cappedPresentCount;
                facultyPossible += maxPossibleForThisBatch;

                // COMPLIANCE LOGIC: Calculate expected sessions only within the Audit window
                // Ensure we don't look for class dates before the audit startDate
                const auditStart = new Date(startDate) > new Date(batch.start_date) ? startDate : batch.start_date;
                const auditEnd = new Date(endDate) < new Date(batch.end_date) ? endDate : batch.end_date;
                
                const expectedDates = getExpectedSessionDates(auditStart, auditEnd, batch.schedule);
                const missing = expectedDates.filter(d => !markedDates.includes(d));

                batchBreakdown.push({
                    batch_id: batch.id,
                    batch_name: batch.name,
                    student_count: studentCount,
                    total_sessions: sessionCount,
                    attendance_percentage: maxPossibleForThisBatch > 0 
                        ? parseFloat(((cappedPresentCount / maxPossibleForThisBatch) * 100).toFixed(2)) 
                        : 0
                });

                // Only the primary owner is penalized for missing logs
                if (isPrimary && missing.length > 0) {
                    missingLogs.push({ batch_name: batch.name, count: missing.length });
                }
            }
        });

        globalTotalPresent += facultyPresent;
        globalTotalPossible += facultyPossible;

        return {
            faculty_id: stats.id,
            faculty_name: stats.name,
            faculty_attendance_percentage: facultyPossible > 0 
                ? parseFloat(((facultyPresent / facultyPossible) * 100).toFixed(2)) 
                : 0,
            missing_logs: missingLogs,
            batches: batchBreakdown 
        };
    });

    // 6. Return response with Institute-wide Weighted Average
    res.status(200).json({ 
        overall_attendance_percentage: globalTotalPossible > 0 
            ? parseFloat(((globalTotalPresent / globalTotalPossible) * 100).toFixed(2)) 
            : 0,
        faculty_reports: facultyReports.sort((a, b) => a.faculty_name.localeCompare(b.faculty_name))
    });

  } catch (error) {
    console.error("Overall Report Logic Error:", error);
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