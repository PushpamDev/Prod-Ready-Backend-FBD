const express = require('express');
const router = express.Router();
const {
  getAllAdmissions,
  getAdmissionById,
  createAdmission,
} = require('../controllers/admissionController');
const auth = require('../middleware/auth');

router.get('/', auth, getAllAdmissions);
router.get('/:id', auth, getAdmissionById);
router.post('/', auth, createAdmission);

module.exports = router;