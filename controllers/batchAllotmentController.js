// server/controllers/batchAllotmentController.js

const supabase = require('../db');

/* ===========================================================
   GET BATCH ALLOTMENT LIST (MULTI-BRANCH & ROLE SAFE)
   =========================================================== */

exports.getBatchAllotmentList = async (req, res) => {
  const locationId = req.locationId;
  const isSuperAdmin = req.isSuperAdmin; // ✅ From updated auth middleware

  try {
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
        date_of_admission,
        location_id
      `);

    // ✅ ROLE-BASED FILTER: Only apply location restriction if NOT super_admin
    if (!isSuperAdmin) {
      if (!locationId) return res.status(401).json({ error: 'Location context missing.' });
      query = query.eq('location_id', locationId);
    }

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
   UPDATE BATCH ALLOTMENT (CONTROLLER FIX)
   =========================================================== */
exports.updateBatchAllotment = async (req, res) => {
  const { admissionId } = req.params;
  const { joined, joining_date, remarks } = req.body;
  const isSuperAdmin = req.isSuperAdmin;
  const locationId = req.locationId;
  
  const staffIdentifier = req.user?.username || 'System'; 

  try {
    // ✅ SECURITY CHECK: Ensure the user belongs to the same branch or is super_admin
    const { data: targetAdmission, error: checkErr } = await supabase
      .from('admissions')
      .select('location_id')
      .eq('id', admissionId)
      .single();

    if (checkErr || !targetAdmission) return res.status(404).json({ error: "Admission not found." });

    if (!isSuperAdmin && Number(targetAdmission.location_id) !== Number(locationId)) {
      return res.status(403).json({ error: "Unauthorized: You can only update students in your own branch." });
    }

    // 1. Update main admission
    const { error: admissionErr } = await supabase
      .from('admissions')
      .update({
        joined,
        course_start_date: joining_date,
        remarks,
      })
      .eq('id', admissionId);

    if (admissionErr) throw admissionErr;

    // 2. Log History
    if (remarks && remarks.trim() !== "") {
      await supabase
        .from('admission_remarks')
        .insert({
            admission_id: admissionId,
            remark_text: remarks,
            created_by: staffIdentifier 
        });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Batch Allotment Update Error:', err);
    res.status(500).json({ error: 'Failed to update batch allotment' });
  }
};


exports.getRemarkHistory = async (req, res) => {
  const { admissionId } = req.params;
  try {
    const { data, error } = await supabase
      .from('admission_remarks')
      .select('remark_text, created_at, created_by')
      .eq('admission_id', admissionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Fetch History Error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
};