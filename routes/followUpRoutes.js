// routes/followUpRoutes.js
const express = require('express');
const router = express.Router();
const {
  // We only need these two functions now
  getFollowUpTasks,
  createFollowUpLog,
} = require('../controllers/followUpController');
const auth = require('../middleware/auth'); // Assuming you have auth middleware

// GET /api/follow-ups?filter=today
// Fetches the main task list for the dashboard
router.get('/', auth, getFollowUpTasks);

// POST /api/follow-ups
// Saves the new follow-up communication log and schedules the next task
router.post('/', auth, createFollowUpLog);

// REMOVED: The route below was causing the error because the controller function was deleted
// router.get('/:admissionId', auth, getAdmissionFollowUpDetails);
// The frontend should now use GET /api/accounts/admissions/:admissionId instead

module.exports = router;