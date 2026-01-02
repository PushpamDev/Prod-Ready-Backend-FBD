const express = require('express');
const router = express.Router();
const admissionUndertakingController =
  require('../controllers/admissionUndertakingController');

router.put(
  '/admissions/:id/undertaking',
  admissionUndertakingController.completeAdmissionUndertaking
);

module.exports = router;
