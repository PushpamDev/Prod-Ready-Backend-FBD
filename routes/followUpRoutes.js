const express = require('express');
const router = express.Router();
const {
  getFollowUpList,
  getFollowUpsForAdmission,
  createFollowUp,
} = require('../controllers/followUpController');
const auth = require('../middleware/auth');

router.get('/', auth, getFollowUpList);
router.get('/:admissionId', auth, getFollowUpsForAdmission);
router.post('/', auth, createFollowUp);

module.exports = router;