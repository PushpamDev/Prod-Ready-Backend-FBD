// server/controllers/intakeController.js

const supabase = require('../db.js');
const multer = require('multer');
const crypto = require('crypto');

const upload = multer();

/**
 * CREATE ADMISSION INTAKE
 */
exports.createIntake = async (req, res) => {
  try {
    const {
      student_phone_number,
    } = req.body;

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
      student_name,
      father_name,
      father_phone_number,
      email,
      date_of_birth,
      date_of_joining,
      identification_type,
      identification_number,
      course_ids,
      fee_amount,
    } = req.body;

    const { data, error } = await supabase
      .from('admission_intakes')
      .insert({
        student_name,
        student_phone_number,
        father_name,
        father_phone_number,
        email,
        date_of_birth,
        date_of_joining,
        identification_type,
        identification_number,
        course_ids,
        fee_amount,
        video_completed: false,
        contacts_acknowledged: false,
        terms_accepted: false,
        identification_files: [],
        status: 'draft',
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
 * UPLOAD IDENTIFICATION FILES (MULTIPLE, APPEND)
 */
exports.uploadIntakeFiles = [
  upload.array('files'), // ✅ MUST match frontend: form.append('files', file)
  async (req, res) => {
    const { id } = req.params;
    const files = req.files;

    try {
      /* -------------------- VALIDATION -------------------- */
      if (!id) {
        return res.status(400).json({ error: 'Missing intake ID' });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files provided' });
      }

      /* -------------------- FETCH INTAKE -------------------- */
      const { data: intake, error: fetchError } = await supabase
        .from('admission_intakes')
        .select('id, identification_files')
        .eq('id', id)
        .single();

      if (fetchError || !intake) {
        return res.status(404).json({ error: 'Intake not found' });
      }

      const existingFiles = Array.isArray(intake.identification_files)
        ? intake.identification_files
        : [];

      const uploadedFiles = [];

      /* -------------------- UPLOAD FILES -------------------- */
      for (const file of files) {
        const safeFileName = file.originalname.replace(/\s+/g, '_');
        const filePath = `intakes/${id}/${crypto.randomUUID()}_${safeFileName}`;

        const { error: uploadError } = await supabase.storage
          .from('identification')
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        uploadedFiles.push({
          file_name: file.originalname,
          bucket: 'identification',
          path: filePath,
          uploaded_at: new Date().toISOString(),
        });
      }

      /* -------------------- UPDATE DB -------------------- */
      const { error: updateError } = await supabase
        .from('admission_intakes')
        .update({
          identification_files: [...existingFiles, ...uploadedFiles],
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        throw updateError;
      }

      /* -------------------- RESPONSE -------------------- */
      return res.status(200).json({
        success: true,
        uploaded_count: uploadedFiles.length,
        uploaded: uploadedFiles,
      });

    } catch (err) {
      console.error('Upload Intake Files Error:', err);
      return res.status(500).json({
        error: 'Failed to upload identification documents',
      });
    }
  },
];
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

    if (error || !data) {
      return res.status(404).json({ error: 'Intake not found' });
    }

    res.json({
      prefill: {
        student_name: data.student_name,
        student_phone_number: data.student_phone_number,
        father_name: data.father_name,
        father_phone_number: data.father_phone_number,
        identification_type: data.identification_type,
        identification_number: data.identification_number,
        course_ids: data.course_ids,
        course_start_date: data.date_of_joining
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
    /* 1️⃣ Fetch intake */
    const { data: intake, error: fetchError } = await supabase
      .from('admission_intakes')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !intake) {
      return res.status(404).json({ error: 'Intake not found' });
    }

    /* 2️⃣ Prevent double finalization */
      if (intake.status === 'submitted') {
      return res.status(200).json({
        success: true,
        message: 'Already submitted',
      });
    }

    /* 3️⃣ Validate flags */
    const {
      video_completed,
      contacts_acknowledged,
      terms_accepted,
    } = req.body;

    if (
      video_completed !== 'true' ||
      contacts_acknowledged !== 'true' ||
      terms_accepted !== 'true'
    ) {
      return res.status(400).json({
        error: 'All undertaking steps must be completed',
      });
    }

    /* 4️⃣ Finalize intake (NO FILE HANDLING HERE) */
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

    /* 5️⃣ Success */
    return res.status(200).json({
      success: true,
      mode: 'INTAKE',
      intake_id: id,
    });


  } catch (err) {
    console.error('Finalize Intake Error:', err);
    return res.status(500).json({
      error: 'Failed to finalize intake',
    });
  }
};