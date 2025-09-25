const express = require('express');
const router = express.Router();
const {
  getAttendanceByBatch,
  addOrUpdateAttendance,
  getAttendanceReport, // 1. Import the new controller function
} = require('../controllers/attendanceController');
const auth = require('../middleware/auth');

// Existing route for fetching single-day attendance
router.get('/:facultyId/:batchId/:date', auth, getAttendanceByBatch);

// Existing route for saving attendance
router.post('/', auth, addOrUpdateAttendance);

// 2. NEW: Add the route for the attendance report generator
router.get('/report/:batchId', auth, getAttendanceReport);

module.exports = router;