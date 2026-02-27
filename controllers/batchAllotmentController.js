// server/controllers/batchAllotmentController.js
const supabase = require('../db');

/* ===========================================================
   GET BATCH ALLOTMENT LIST (LOCATION & ROLE AWARE)
   =========================================================== */
exports.getBatchAllotmentList = async (req, res) => {
  // Ensure locationId is treated as a Number for database comparison
  const userLocationId = req.locationId ? Number(req.locationId) : null;
  const isSuperAdmin = req.isSuperAdmin;

  try {
    // ✅ Extract search and optional location_id for Super Admin filtering
    const { search = '', location_id } = req.query;

    /* -------------------- 1️⃣ Fetch Unified Data from View -------------------- */
    let query = supabase
      .from('v_admission_financial_summary')
      .select(`
        admission_id,
        admission_number,
        student_name,
        student_phone_number,
        courses_str,
        date_of_admission,
        location_id,
        batch_names,
        remarks,
        course_start_date,
        joined
      `);

    /* -------------------- 🛡️ ROLE-BASED LOCATION LOGIC -------------------- */
    if (isSuperAdmin) {
      // ✅ Super Admin: Filter by specific city if provided, otherwise show global
      if (location_id && location_id !== 'all' && location_id !== 'All') {
        query = query.eq('location_id', Number(location_id));
      }
    } else {
      // ✅ Standard Admin: Strictly restricted to their own branch
      if (!userLocationId) {
        return res.status(401).json({ error: 'Location context missing.' });
      }
      query = query.eq('location_id', userLocationId);
    }

    if (search) {
      query = query.or(`student_name.ilike.%${search}%,admission_number.ilike.%${search}%,student_phone_number.ilike.%${search}%`);
    }

    const { data: admissions, error } = await query.order('date_of_admission', { ascending: false });

    if (error) throw error;
    
    if (!admissions || admissions.length === 0) return res.json([]);

    /* -------------------- 2️⃣ Final Response Construction -------------------- */
    const result = admissions.map(row => ({
        admission_id: row.admission_id,
        admission_number: row.admission_number,
        student_name: row.student_name,
        student_phone_number: row.student_phone_number,
        course_name: row.courses_str || 'No Course Selected',
        admission_date: row.date_of_admission,
        batch_names: row.batch_names || [],
        joined: row.joined ?? false,
        joining_date: row.course_start_date ?? null,
        remarks: row.remarks ?? '',
        location_id: row.location_id // ✅ Returning location_id for UI branch badges
    }));

    res.json(result);

  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      console.error('CRITICAL: Network connection to Supabase failed.');
      return res.status(503).json({ error: 'Database connection offline.' });
    }
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