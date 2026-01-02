// server/controllers/admissionController.js

const supabase = require('../db');

/**
 * @description
 * Get Admission Dashboard rows (FLAT STRUCTURE).
 * RPC `get_admission_dashboard` returns TABLE (rows).
 * Metrics are calculated separately for clarity and stability.
 */
exports.getAllAdmissions = async (req, res) => {
  try {
    const searchTerm = req.query.search || '';

    /* ----------------------- 1. FETCH ROW DATA ----------------------- */
    const { data: rows, error } = await supabase.rpc(
      'get_admission_dashboard',
      { search_term: searchTerm }
    );

    if (error) {
      console.error('RPC Error:', error);
      throw error;
    }

    const safeRows = Array.isArray(rows) ? rows : [];

    /* ----------------------- 2. ENRICH ROW DATA ----------------------- */
    const enrichedRows = safeRows.map((r) => ({
      ...r,

      // ✅ Backend is authoritative for undertaking status
      undertaking_status:
        r.approval_status === 'Approved'
          ? 'Completed'
          : 'Pending',
    }));

    /* ----------------------- 3. CALCULATE METRICS ---------------------- */
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let totalCollected = 0;
    let revenueCollectedThisMonth = 0;
    let totalOutstanding = 0;
    let admissionsThisMonth = 0;
    let overdueCount = 0;

    enrichedRows.forEach((r) => {
      const createdAt = new Date(r.created_at);

      totalCollected += Number(r.total_paid || 0);
      totalOutstanding += Number(r.balance_due || 0);

      if (
        createdAt.getMonth() === currentMonth &&
        createdAt.getFullYear() === currentYear
      ) {
        admissionsThisMonth += 1;
        revenueCollectedThisMonth += Number(r.total_paid || 0);
      }

      if (r.status === 'Overdue') {
        overdueCount += 1;
      }
    });

    const metrics = {
      totalAdmissions: enrichedRows.length,
      admissionsThisMonth,
      totalCollected,
      revenueCollectedThisMonth,
      totalOutstanding,
      overdueCount,
    };

    /* ----------------------- 4. SEND RESPONSE ------------------------- */
    res.status(200).json({
      metrics,
      admissions: enrichedRows, // ✅ frontend-safe
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);

    if (error.code === '42883') {
      return res.status(500).json({
        error:
          "Database function 'get_admission_dashboard' not found or signature mismatch.",
      });
    }

    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description
 * Get a single admission with all related details
 */
exports.getAdmissionById = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: admission, error: admissionError } = await supabase
      .from('admissions')
      .select('*')
      .eq('id', id)
      .single();

    if (admissionError) throw admissionError;
    if (!admission) {
      return res.status(404).json({ error: 'Admission not found' });
    }

    const { data: coursesData, error: coursesError } = await supabase
      .from('admission_courses')
      .select('courses(*)')
      .eq('admission_id', id);

    if (coursesError) throw coursesError;

    const courses = coursesData
      ? coursesData.map((item) => item.courses)
      : [];

    const { data: installments, error: installmentsError } = await supabase
      .from('v_installment_status')
      .select('*')
      .eq('admission_id', id)
      .order('due_date', { ascending: true });

    if (installmentsError) throw installmentsError;

    res.status(200).json({
      ...admission,              // includes undertaking_status automatically
      courses,
      installments: installments || [],
    });
  } catch (error) {
    console.error(`Error fetching admission ${id}:`, error);

    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Admission not found' });
    }

    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description
 * Create a new admission using RPC.
 * Undertaking status is DB-driven (Pending / Completed).
 */
exports.createAdmission = async (req, res) => {
  const {
    student_name,
    student_phone_number,
    father_name,
    father_phone_number,
    permanent_address,
    current_address,
    identification_type,
    identification_number,
    date_of_admission,
    course_start_date,
    batch_preference,
    remarks,
    certificate_id,
    discount,
    course_ids,
    installments,
    source_intake_id,
  } = req.body;

  const locationId = req.locationId;

  /* ---------------------------- VALIDATION ---------------------------- */
  if (!locationId) {
    return res.status(400).json({
      error: 'User does not have an assigned Branch Location. Please contact Admin.',
    });
  }

  if (!student_name || !student_phone_number) {
    return res.status(400).json({
      error: 'Student Name and Phone Number are required.',
    });
  }

  if (!date_of_admission) {
    return res.status(400).json({
      error: 'Date of Admission is required.',
    });
  }

  if (!Array.isArray(course_ids) || course_ids.length === 0) {
    return res.status(400).json({
      error: 'At least one course must be selected.',
    });
  }

  if (!Array.isArray(installments)) {
    return res.status(400).json({
      error: 'Installments must be provided as an array.',
    });
  }

  if (discount && isNaN(parseFloat(discount))) {
    return res.status(400).json({
      error: 'Discount must be a valid number.',
    });
  }

  /* ----------------------------- RPC CALL ----------------------------- */
  try {
    const { data, error } = await supabase.rpc(
      'create_admission_and_student',
      {
        p_student_name: student_name,
        p_student_phone_number: student_phone_number,
        p_father_name: father_name,
        p_father_phone_number: father_phone_number,
        p_permanent_address: permanent_address,
        p_current_address: current_address,
        p_identification_type: identification_type || null,
        p_identification_number: identification_number || null,
        p_date_of_admission: date_of_admission,
        p_course_start_date: course_start_date || null,
        p_batch_preference: batch_preference || null,
        p_remarks: remarks,
        p_certificate_id: certificate_id || null,
        p_discount: discount || 0,
        p_course_ids: course_ids,
        p_installments: installments,
        p_location_id: locationId,
        p_source_intake_id: source_intake_id || null, // ✅ drives undertaking status
      }
    );

    if (error) throw error;

    res.status(201).json({
      message: 'Admission created successfully',
      admission_id: data,
    });
  } catch (error) {
    console.error('Error creating admission:', error);

    if (error.message?.includes('GST rate not configured')) {
      return res.status(500).json({
        error: 'Server configuration error: GST rate is not set.',
      });
    }

    if (error.code === '42883') {
      return res.status(500).json({
        error: 'Database function signature mismatch. Please update the SQL function.',
      });
    }

    res.status(500).json({
      error: error.message || 'Error creating admission.',
    });
  }
};

/**
 * @description
 * Update an existing admission.
 * STRICT SECURITY: Only user 'pushpam' can proceed.
 */
exports.updateAdmission = async (req, res) => {
  const { id } = req.params;

  if (req.user?.username !== 'pushpam') {
    return res.status(403).json({
      error: "Access denied. Only 'pushpam' can edit admissions.",
    });
  }

  const {
    student_name,
    student_phone_number,
    father_name,
    father_phone_number,
    permanent_address,
    current_address,
    identification_type,
    identification_number,
    date_of_admission,
    course_start_date,
    batch_preference,
    remarks,
    certificate_id,
    discount,
    course_ids,
    installments,
  } = req.body;

  const locationIdStr = req.locationId ? String(req.locationId) : null;

  try {
    const { error } = await supabase.rpc('update_admission_full', {
      p_admission_id: id,
      p_student_name: student_name,
      p_student_phone_number: student_phone_number,
      p_father_name: father_name || null,
      p_father_phone_number: father_phone_number || null,
      p_permanent_address: permanent_address || null,
      p_current_address: current_address || null,
      p_identification_type: identification_type || null,
      p_identification_number: identification_number || null,
      p_date_of_admission: date_of_admission,
      p_course_start_date: course_start_date || null,
      p_batch_preference: batch_preference || null,
      p_remarks: remarks || null,
      p_certificate_id:
        certificate_id && certificate_id.length > 20
          ? certificate_id
          : null,
      p_discount: Number(discount) || 0,
      p_course_ids: Array.isArray(course_ids) ? course_ids : [],
      p_installments: installments || [],
      p_location_id: locationIdStr,
    });

    if (error) throw error;

    res.status(200).json({ message: 'Admission updated successfully' });
  } catch (error) {
    console.error('Error updating admission:', error);
    res.status(500).json({
      error: error.message || 'Error updating admission.',
    });
  }
};

exports.checkAdmissionByPhone = async (req, res) => {
  try {
    const { phone } = req.params;

    const { data, error } = await supabase
      .from('admissions')
      .select('id, undertaking_completed')
      .eq('student_phone_number', phone)
      .maybeSingle();

    if (error) {
      console.error('Check Admission Error:', error);
      return res.status(500).json({ error: 'Lookup failed' });
    }

    if (!data) {
      return res.json({ mode: 'INTAKE' });
    }

    return res.json({
      mode: 'ADMISSION',
      admission_id: data.id,
      undertaking_completed: data.undertaking_completed,
    });

  } catch (err) {
    console.error('Check Admission Exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};