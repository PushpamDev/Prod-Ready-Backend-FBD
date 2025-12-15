const express = require('express');
const router = express.Router();
// UPDATED: Import the correct function name
const { getDashboardData } = require('../controllers/dashboardController');
const auth = require('../middleware/auth');

// This will be our one and only dashboard endpoint
// GET /api/dashboard/
// UPDATED: Use the correct function
router.get('/', auth, getDashboardData);

module.exports = router;