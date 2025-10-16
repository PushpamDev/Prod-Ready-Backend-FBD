const express = require('express');
const router = express.Router();
const {
  recordPayment,
  getReceiptsForAdmission,
  getReceiptDetails,
  getInstallmentsForAdmission,
} = require('../controllers/feeController');
const auth = require('../middleware/auth');

router.post('/record-payment', auth, recordPayment);
router.get('/receipts/admission/:admissionId', auth, getReceiptsForAdmission);
router.get('/receipts/:id', auth, getReceiptDetails);
router.get('/installments/admission/:admissionId', auth, getInstallmentsForAdmission);

module.exports = router;