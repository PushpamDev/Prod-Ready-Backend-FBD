const supabase = require('../db.js');
const multer = require('multer');
const crypto = require('crypto');

// ✅ CRITICAL: Explicitly use Memory Storage for cloud-bound buffers
const storage = multer.memoryStorage();
const uploadMiddleware = multer({ 
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 } // Increased limit to 15MB for high-res IDs
}).array('files'); // Matches the key name used in the frontend

/**
 * CREATE ADMISSION INTAKE
 */
exports.createIntake = async (req, res) => {
  try {
    const { student_phone_number } = req.body;

    /* 1️⃣ Check if a pending intake already exists */
    const { data: existing } = await supabase
      .from('admission_intakes')
      .select('id, status')
      .eq('student_phone_number', student_phone_number)
      .is('admission_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        intake_id: existing.id,
        reused: true,
      });
    }

    /* 2️⃣ Create fresh intake */
    const {
      location_id, student_name, father_name, father_phone_number,
      email, date_of_birth, date_of_joining, identification_type,
      identification_number, course_ids, fee_amount, current_address, permanent_address     
    } = req.body;

    const { data, error } = await supabase
      .from('admission_intakes')
      .insert({
        location_id, student_name, student_phone_number, father_name,
        father_phone_number, email, date_of_birth, date_of_joining,
        identification_type, identification_number, course_ids, fee_amount,
        current_address, permanent_address,  
        video_completed: false, contacts_acknowledged: false, terms_accepted: false,
        identification_files: [], status: 'draft',
      })
      .select('id')
      .single();

    if (error) throw error;

    return res.status(201).json({
      intake_id: data.id,
      reused: false,
    });

  } catch (err) {
    console.error('Create Intake Error:', err);
    res.status(500).json({ error: 'Failed to create intake' });
  }
};

/**
 * UPLOAD IDENTIFICATION FILES
 * Now simplified because Multer handles the parsing at the route level.
 */
exports.uploadIntakeFiles = async (req, res) => {
  const { id } = req.params;
  const files = req.files; // Already parsed by the route middleware

  try {
    if (!id || id === 'undefined') return res.status(400).json({ error: 'Invalid ID' });
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files received by server.' });

    /* 1️⃣ Determine Target Table */
    let { data: targetRecord } = await supabase
      .from('admission_intakes')
      .select('id, identification_files')
      .eq('id', id)
      .maybeSingle();

    let targetTable = 'admission_intakes';

    if (!targetRecord) {
      const { data: admission } = await supabase
        .from('admissions')
        .select('id, identification_files')
        .eq('id', id)
        .maybeSingle();

      if (!admission) return res.status(404).json({ error: 'Record not found.' });
      
      targetRecord = admission;
      targetTable = 'admissions';
    }

    const existingFiles = Array.isArray(targetRecord.identification_files) ? targetRecord.identification_files : [];
    const uploadedFilesMetadata = [];

    /* 2️⃣ Process Uploads */
    for (const file of files) {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
      const filePath = `intakes/${id}/${crypto.randomUUID()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('identification')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('identification').getPublicUrl(filePath);

      uploadedFilesMetadata.push({
        file_name: file.originalname,
        path: filePath,
        url: urlData.publicUrl,
        uploaded_at: new Date().toISOString()
      });
    }

    /* 3️⃣ Update DB */
    const { error: updateError } = await supabase
      .from(targetTable)
      .update({
        identification_files: [...existingFiles, ...uploadedFilesMetadata],
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.status(200).json({ success: true, files: uploadedFilesMetadata });

  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * LIST ALL INTAKES
 */
exports.listIntakes = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admission_intakes')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('List Intakes Error:', err);
    res.status(500).json({ error: 'Failed to fetch intakes' });
  }
};

/**
 * PROCEED TO ADMISSION (PREFILL ONLY)
 */
exports.proceedToAdmission = async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('admission_intakes')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Intake not found' });

    res.json({
      prefill: {
        location_id: data.location_id,
        student_name: data.student_name,
        student_phone_number: data.student_phone_number,
        father_name: data.father_name,
        father_phone_number: data.father_phone_number,
        identification_type: data.identification_type,
        identification_number: data.identification_number,
        course_ids: data.course_ids,
        course_start_date: data.date_of_joining,
        current_address: data.current_address,    
        permanent_address: data.permanent_address  
      }
    });
  } catch (err) {
    console.error('Proceed To Admission Error:', err);
    res.status(500).json({ error: 'Failed to proceed to admission' });
  }
};

/**
 * FINALIZE INTAKE (ATOMIC SUBMISSION)
 */
exports.finalizeIntake = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: intake, error: fetchError } = await supabase
      .from('admission_intakes')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !intake) return res.status(404).json({ error: 'Intake record not found' });
    if (intake.status === 'submitted') return res.status(200).json({ success: true, message: 'Already submitted' });

    const { video_completed, contacts_acknowledged, terms_accepted } = req.body;

    const isVideoDone = video_completed === true || String(video_completed) === 'true';
    const isContactsDone = contacts_acknowledged === true || String(contacts_acknowledged) === 'true';
    const isTermsDone = terms_accepted === true || String(terms_accepted) === 'true';

    if (!isVideoDone || !isContactsDone || !isTermsDone) {
      return res.status(400).json({ error: 'All undertaking steps must be completed' });
    }

    const { error: updateError } = await supabase
      .from('admission_intakes')
      .update({
        video_completed: true,
        contacts_acknowledged: true,
        terms_accepted: true,
        status: 'submitted',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, mode: 'INTAKE', intake_id: id });
  } catch (err) {
    console.error('Finalize Intake Error:', err);
    return res.status(500).json({ error: 'Failed to finalize intake' });
  }
};