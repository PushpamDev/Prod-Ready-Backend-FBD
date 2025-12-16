// server/controllers/admissionController.js

// Import the configured Supabase client from your db setup file
const supabase = require('../db');

/**
 * @description Get the complete Dashboard Data (Metrics + Admissions List).
 * [UPDATED] Uses the SQL RPC function 'get_admission_dashboard' instead of the table view.
 * This ensures the Frontend gets the exact JSON structure { metrics: ..., admissions: ... }
 * with correct fields like 'admission_number' and 'certificate_name'.
 */

exports.getAllAdmissions = async (req, res) => {
  try {
    // 1. Extract search term (This will be 'RVM-2025-0001' or 'Pushpam')
    const searchTerm = req.query.search || '';

    // 2. Call the Updated RPC Function
    const { data, error } = await supabase.rpc('get_admission_dashboard', {
      search_term: searchTerm
    });

    if (error) {
      console.error("RPC Error:", error);
      throw error;
    }

    // 3. Return data (Structure: { metrics: {...}, admissions: [...] })
    res.status(200).json(data);

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    
    if (error.code === '42883') {
       return res.status(500).json({ error: "Database function 'get_admission_dashboard' not found. Please run the SQL script." });
    }

    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Get a single admission with all related details using multiple, efficient Supabase queries.
 */
exports.getAdmissionById = async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Fetch the main admission record
    const { data: admission, error: admissionError } = await supabase
      .from('admissions')
      .select('*')
      .eq('id', id)
      .single();

    if (admissionError) throw admissionError;
    if (!admission) {
      return res.status(404).json({ error: 'Admission not found' });
    }

    // 2. Fetch the associated courses
    const { data: coursesData, error: coursesError } = await supabase
      .from('admission_courses')
      .select('courses(*)')
      .eq('admission_id', id);

    if (coursesError) throw coursesError;
    // Flatten the structure: array of course objects
    const courses = coursesData ? coursesData.map(item => item.courses) : [];

    // 3. Fetch the associated installments from the status view
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
    if (error.code === 'PGRST116') { // Supabase/Postgres code for "row not found" with .single()
         return res.status(404).json({ error: 'Admission not found' });
    }
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * @description Create a new admission by calling the database function via Supabase RPC.
 */
exports.createAdmission = async (req, res) => {
  // 1. Extract fields from the request body
  const {
    student_name, student_phone_number, father_name, father_phone_number,
    permanent_address, current_address, 
    identification_type, identification_number, 
    date_of_admission, course_start_date, batch_preference,
    remarks, certificate_id, discount, course_ids, installments
  } = req.body;

  // 2. Extract Location ID from the Auth Middleware
  // Your auth.js middleware attaches this to req.locationId
  const locationId = req.locationId; 

  // --- Validation ---
  if (!locationId) {
    console.error("Critical Error: User has no location_id attached to request.");
    return res.status(400).json({ error: 'User does not have an assigned Branch Location. Please contact Admin.' });
  }

  if (!student_name || !student_phone_number) {
    return res.status(400).json({ error: 'Student Name and Phone Number are required.' });
  }
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

  // --- Call the database function ---
  try {
    const { data, error } = await supabase.rpc('create_admission_and_student', {
      // Pass parameters to the SQL function
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
      
      // CRITICAL: Pass the location ID explicitly from middleware
      p_location_id: locationId 
    });

    if (error) throw error;

    res.status(201).json({ message: 'Admission created successfully', admission_id: data });
  } catch (error) {
    console.error('Error creating admission:', error);
    
    // Handle specific errors
    if (error.message && error.message.includes('GST rate not configured')) {
        return res.status(500).json({ error: 'Server configuration error: GST rate is not set.' });
    }
    // Handle argument mismatch (e.g. if we forget a parameter in the SQL function)
    if (error.code === '42883') {
       console.error("Database function error: Mismatching arguments.", error.message);
       return res.status(500).json({ error: "Database function signature mismatch. Please update the SQL function." });
    }
    
    res.status(500).json({ error: error.message || 'An error occurred while creating the admission.' });
  }
};