const express = require('express');
const router = express.Router();
const {
  getAllAdmissions,
  getAdmissionById,
  createAdmission,
  updateAdmission,
} = require('../controllers/admissionController');
const auth = require('../middleware/auth');

router.get('/', auth, getAllAdmissions);
router.get('/:id', auth, getAdmissionById);
router.post('/', auth, createAdmission);
router.put('/:id', auth, updateAdmission);
module.exports = router;