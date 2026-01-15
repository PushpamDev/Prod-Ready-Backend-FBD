const supabase = require('../db');

/* ===========================================================
   GET BATCH ALLOTMENT LIST (MULTI-BATCH SAFE)
   =========================================================== */

exports.getBatchAllotmentList = async (req, res) => {
  try {
    // ✅ CAPTURE SEARCH FROM QUERY PARAMS
    const { search = '' } = req.query;

    /* -------------------- 1️⃣ Base admission data -------------------- */
    let query = supabase
      .from('v_admission_financial_summary')
      .select(`
        admission_id,
        student_id,
        admission_number,
        student_name,
        student_phone_number,
        courses_str,
        date_of_admission
      `);

    // ✅ APPLY SEARCH FILTER ON DATABASE LEVEL
    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data: admissions, error } = await query.order('date_of_admission', { ascending: false });

    if (error) throw error;
    if (!admissions || admissions.length === 0) return res.json([]);

    const admissionIds = admissions.map(a => a.admission_id);
    const studentIds = admissions.map(a => a.student_id);

    /* -------------------- 2️⃣ Admission meta -------------------- */
    const { data: admissionMeta, error: metaErr } = await supabase
      .from('admissions')
      .select('id, joined, course_start_date, remarks')
      .in('id', admissionIds);

    if (metaErr) throw metaErr;

    const metaMap = Object.fromEntries((admissionMeta || []).map(a => [a.id, a]));

    /* -------------------- 3️⃣ Batch mappings -------------------- */
    const { data: batchRows, error: batchErr } = await supabase
      .from('batch_students')
      .select(`student_id, batches ( name )`)
      .in('student_id', studentIds);

    if (batchErr) throw batchErr;

    const batchMap = {};
    (batchRows || []).forEach(row => {
      if (!row?.batches?.name) return;
      if (!batchMap[row.student_id]) batchMap[row.student_id] = [];
      batchMap[row.student_id].push(row.batches.name);
    });

    /* -------------------- 4️⃣ Final response -------------------- */
    const result = admissions.map(row => ({
        admission_id: row.admission_id,
        admission_number: row.admission_number,
        student_name: row.student_name,
        student_phone_number: row.student_phone_number,
        course_name: row.courses_str,
        admission_date: row.date_of_admission,
        batch_names: batchMap[row.student_id] || [],
        joined: metaMap[row.admission_id]?.joined ?? false,
        joining_date: metaMap[row.admission_id]?.course_start_date ?? null,
        remarks: metaMap[row.admission_id]?.remarks ?? '',
    }));

    res.json(result);

  } catch (err) {
    console.error('Batch Allotment Fetch Error:', err);
    res.status(500).json({ error: 'Failed to load batch allotment list' });
  }
};

/* ===========================================================
   UPDATE BATCH ALLOTMENT (SAFE FOR MULTI-BATCH)
   =========================================================== */
exports.updateBatchAllotment = async (req, res) => {
  const { admissionId } = req.params;
  const { joined, joining_date, remarks } = req.body;

  try {
    const { error: admissionErr } = await supabase
      .from('admissions')
      .update({
        joined,
        course_start_date: joining_date,
        remarks,
      })
      .eq('id', admissionId);

    if (admissionErr) throw admissionErr;

    res.json({ success: true });

  } catch (err) {
    console.error('Batch Allotment Update Error:', err);
    res.status(500).json({
      error: 'Failed to update batch allotment',
    });
  }
};
