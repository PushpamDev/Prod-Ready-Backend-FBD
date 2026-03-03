// server/routes/intake.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const intakeController = require('../controllers/intakeController');

// ✅ CRITICAL: Initialize Multer with Memory Storage for the Mac Mini/Server environment
// This ensures file.buffer is populated for Supabase Storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * PUBLIC ROUTES (New Admissions)
 */

// Create a new admission intake
router.post(
  '/',
  intakeController.createIntake
);

// ✅ FIX: Apply 'upload.array' directly in the route definition
// This ensures 'req.files' is populated before calling the controller logic
router.post(
  '/:id/files',
  upload.array('files'), 
  intakeController.uploadIntakeFiles
);

/**
 * ADMIN ROUTES
 */

// List all admission intakes
router.get(
  '/',
  intakeController.listIntakes
);

// Proceed to Admission (prefill AdmissionForm)
router.get(
  '/:id/proceed',
  intakeController.proceedToAdmission
);

// Finalize and mark as submitted
router.put(
  '/:id/finalize',
  intakeController.finalizeIntake
);

module.exports = router;