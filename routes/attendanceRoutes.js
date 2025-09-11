const express = require('express');
const router = express.Router();
const {
  getAttendanceByBatch,
  addOrUpdateAttendance,
} = require('../controllers/attendanceController');
const auth = require('../middleware/auth');

router.get('/:facultyId/:batchId/:date', auth, getAttendanceByBatch);
router.post('/', auth, addOrUpdateAttendance);

module.exports = router;