// Import the configured Supabase client from your db setup file
const supabase = require('../db');

/**
 * @description Get all admissions using the summary view with the Supabase client.
 */
exports.getAllAdmissions = async (req, res) => {
  // ... (No changes needed here)
  try {
    const { data, error } = await supabase
      .from('v_admission_financial_summary')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching all admissions:', error);
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Get a single admission with all related details using multiple, efficient Supabase queries.
 */
exports.getAdmissionById = async (req, res) => {
  // ... (No changes needed here)
  const { id } = req.params;
  try {
    // 1. Fetch the main admission record
    const { data: admission, error: admissionError } = await supabase
      .from('admissions')
      .select('*')
      .eq('id', id)
      .single(); // Use .single() to get one object, not an array

    if (admissionError) throw admissionError;
    if (!admission) {
      return res.status(404).json({ error: 'Admission not found' });
    }

    // 2. Fetch the associated courses
    const { data: coursesData, error: coursesError } = await supabase
      .from('admission_courses')
      .select('courses(*)') // Supabase can fetch nested data from related tables
      .eq('admission_id', id);

    if (coursesError) throw coursesError;
    // Clean up the nested structure from Supabase
    const courses = coursesData ? coursesData.map(item => item.courses) : [];


    // 3. Fetch the associated installments from the view
    const { data: installments, error: installmentsError } = await supabase
      .from('v_installment_status')
      .select('*')
      .eq('admission_id', id)
      .order('due_date', { ascending: true });
    
    if (installmentsError) throw installmentsError;

    // 4. Combine all data into a single response object
    const result = {
      ...admission,
      courses: courses,
      installments: installments || [],
    };

    res.status(200).json(result);
  } catch (error) {
    console.error(`Error fetching admission ${id}:`, error);
    if (error.code === 'PGRST116') { // Supabase code for "not found" with .single()
         return res.status(404).json({ error: 'Admission not found' });
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a new admission by calling the database function via Supabase RPC.
 */
exports.createAdmission = async (req, res) => {
  // UPDATED: Destructure all fields from the new frontend form
  const {
    student_name, student_phone_number, father_name, father_phone_number,
    permanent_address, current_address, 
    // NEW: Fields from the frontend form
    identification_type, identification_number, 
    date_of_admission, course_start_date, batch_preference,
    remarks, certificate_id, discount, course_ids, installments
    // REMOVED: address_proof_id_number (replaced by identification fields)
  } = req.body;

  // --- UPDATED: Robust Validation ---
  if (!student_name || !student_phone_number) {
    return res.status(400).json({ error: 'Student Name and Phone Number are required.' });
  }
  // NEW: Validate required fields from frontend
  if (!date_of_admission) {
    return res.status(400).json({ error: 'Date of Admission is required.' });
  }
  if (!Array.isArray(course_ids) || course_ids.length === 0) {
    return res.status(400).json({ error: 'At least one course must be selected.' });
  }
  if (!Array.isArray(installments)) {
    return res.status(400).json({ error: 'Installments must be provided as an array.' });
  }
  if (discount && isNaN(parseFloat(discount))) {
      return res.status(400).json({ error: 'Discount must be a valid number.' });
  }

  // --- Call the database function using rpc() ---
  try {
    const { data, error } = await supabase.rpc('create_admission_and_student', {
      // Pass parameters as a single JSON object with matching names
      p_student_name: student_name,
      p_student_phone_number: student_phone_number,
      p_father_name: father_name,
      p_father_phone_number: father_phone_number,
      p_permanent_address: permanent_address,
      p_current_address: current_address,
      
      // UPDATED: Pass new parameters to the SQL function
      p_identification_type: identification_type || null,
      p_identification_number: identification_number || null,
      p_date_of_admission: date_of_admission, // This is required
      p_course_start_date: course_start_date || null,
      p_batch_preference: batch_preference || null,
      
      p_remarks: remarks,
      p_certificate_id: certificate_id || null,
      p_discount: discount || 0,
      p_course_ids: course_ids,
      p_installments: installments, // No need to stringify for rpc
    });

    if (error) throw error;

    res.status(201).json({ message: 'Admission created successfully', admission_id: data });
  } catch (error) {
    console.error('Error creating admission:', error);
    // --- Specific Error Handling for RPC calls ---
    if (error.message.includes('GST rate not configured')) {
        return res.status(500).json({ error: 'Server configuration error: GST rate is not set.' });
    }
    // NEW: Handle function not found or argument mismatch
    if (error.code === '42883') {
       console.error("Database function error: Most likely 'create_admission_and_student' does not exist or has mismatching arguments.", error.message);
       return res.status(500).json({ error: "Database function signature mismatch. Please update the SQL function." });
    }
    res.status(500).json({ error: 'An error occurred while creating the admission.' });
  }
};