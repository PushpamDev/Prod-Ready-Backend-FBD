const router = require("express").Router();
const auth = require("../middleware/auth");
const { 
  getCEODashboard, 
  getCEOTrends 
} = require("../controllers/ceoDashboardController");

/**
 * @route   GET /api/ceo/dashboard
 * @desc    Get snapshot metrics for CEO dashboard cards and funnel
 * @access  Private (Pushpam only)
 */
router.get("/dashboard", auth, getCEODashboard);

/**
 * @route   GET /api/ceo/trends
 * @desc    Get time-series data for performance velocity charts
 * @access  Private (Pushpam only)
 */
router.get("/trends", auth, getCEOTrends);

module.exports = router;