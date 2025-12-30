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
      video_completed,
      contacts_acknowledged,
      terms_accepted
    } = req.body;

    if (!student_name || !student_phone_number || !Array.isArray(course_ids)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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
        video_completed,
        contacts_acknowledged,
        terms_accepted,
        identification_files: []
      })
      .select('id')
      .single();

    if (error) throw error;

    res.status(201).json({
      intake_id: data.id,
      upload_path: `identification/intakes/${data.id}/`
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
  upload.array('files'),
  async (req, res) => {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    try {
      // Fetch existing files
      const { data: intake, error: fetchError } = await supabase
        .from('admission_intakes')
        .select('identification_files')
        .eq('id', id)
        .single();

      if (fetchError || !intake) {
        return res.status(404).json({ error: 'Intake not found' });
      }

      const existingFiles = intake.identification_files || [];
      const uploadedFiles = [];

      for (const file of files) {
        const filePath = `intakes/${id}/${crypto.randomUUID()}_${file.originalname}`;

        const { error: uploadError } = await supabase.storage
          .from('identification')
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false
          });

        if (uploadError) throw uploadError;

        uploadedFiles.push({
          file_name: file.originalname,
          bucket: 'identification',
          path: filePath
        });
      }

      const mergedFiles = [...existingFiles, ...uploadedFiles];

      await supabase
        .from('admission_intakes')
        .update({ identification_files: mergedFiles })
        .eq('id', id);

      res.status(200).json({ uploaded: uploadedFiles });

    } catch (err) {
      console.error('Upload Intake Files Error:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
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
