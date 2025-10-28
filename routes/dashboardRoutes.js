const express = require('express');
const router = express.Router();
const { getDashboardSummary } = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

// This will be our one and only dashboard endpoint
// GET /api/dashboard/
router.get('/', auth, getDashboardSummary);

module.exports = router;