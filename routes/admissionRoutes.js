const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const {
  getAllAdmissions,
  getAdmissionById,
  createAdmission,
  updateAdmission,
  checkAdmissionByPhone,
} = require('../controllers/admissionController');

/* -------------------- UNDERTAKING LOOKUP (PUBLIC) -------------------- */
router.get('/by-phone/:phone', checkAdmissionByPhone);

/* -------------------- ADMISSIONS (PROTECTED) -------------------- */
router.get('/', auth, getAllAdmissions);
router.post('/', auth, createAdmission);
router.get('/:id', auth, getAdmissionById);
router.put('/:id', auth, updateAdmission);

module.exports = router;
