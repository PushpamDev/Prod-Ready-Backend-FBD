const supabase = require('../db.js');
const multer = require('multer');
const crypto = require('crypto');

const upload = multer();

/**
 * COMPLETE UNDERTAKING FOR EXISTING ADMISSION
 */
exports.completeAdmissionUndertaking = [
  upload.array('files'), // ✅ MUST be "files"
  async (req, res) => {
    const { id } = req.params;
    const files = req.files;

    try {
      if (!files || files.length === 0) {
        return res.status(400).json({
          error: 'Identification documents are required',
        });
      }

      // upload to Supabase storage here (same logic you already have)

      // update admissions table
      const { error } = await supabase
        .from('admissions')
        .update({
          undertaking_completed: true,
          undertaking_completed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      res.status(200).json({
        success: true,
        message: 'Admission undertaking completed',
      });
    } catch (err) {
      console.error('Admission Undertaking Error:', err);
      res.status(500).json({ error: 'Failed to submit undertaking' });
    }
  },
];
