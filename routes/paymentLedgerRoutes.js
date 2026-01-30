const express = require('express');
const router = express.Router();
const paymentLedgerController = require('../controllers/paymentLedgerController');
const auth = require('../middleware/auth');

/**
 * @route   GET /api/payment-ledger
 * @desc    Fetch a detailed audit log of all payments and receipts
 * @access  Private (Staff/Admin)
 */
router.get('/', auth, paymentLedgerController.getPaymentLedger);

module.exports = router;