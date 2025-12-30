// server/routes/intake.js

const express = require('express');
const router = express.Router();

const intakeController = require('../controllers/intakeController');

/**
 * PUBLIC ROUTES (New Admissions)
 */

// Create a new admission intake
router.post(
  '/',
  intakeController.createIntake
);

// Upload identification files (multiple)
router.post(
  '/:id/files',
  intakeController.uploadIntakeFiles
);

/**
 * ADMIN ROUTES
 * (Add auth middleware here later if required)
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

module.exports = router;
