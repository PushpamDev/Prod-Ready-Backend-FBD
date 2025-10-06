const express = require("express");
const router = express.Router();

// UPDATED: Importing all the new and renamed functions from the controller
const {
  addOrUpdateAttendance,
  getDailyAttendanceForBatch,
  getBatchAttendanceReport,
  getFacultyAttendanceReport,
  getOverallAttendanceReport,
} = require("../controllers/attendanceController");

const auth = require("../middleware/auth");
const admin = require("../middleware/admin");


/*
================================================================================
  I. Attendance Data Management
================================================================================
*/

/**
 * @route   POST /api/attendance
 * @desc    Add or update attendance records for a specific batch and date.
 * @access  Private (Authenticated users, typically faculty)
 */
router.post("/", auth, addOrUpdateAttendance);

/**
 * @route   GET /api/attendance/batch/:batchId/daily
 * @desc    Fetch attendance for a single batch on a specific day.
 * @access  Private
 * @query   date (Format: YYYY-MM-DD)
 */
router.get("/batch/:batchId/daily", auth, getDailyAttendanceForBatch);


/*
================================================================================
  II. Attendance Reports
================================================================================
*/

/**
 * @route   GET /api/attendance/reports/overall
 * @desc    Get a comprehensive attendance report for all faculties.
 * @access  Private (Admin only)
 */
router.get("/reports/overall", auth, admin, getOverallAttendanceReport);

/**
 * @route   GET /api/attendance/reports/faculty/:facultyId
 * @desc    Get a detailed attendance report for a specific faculty.
 * @access  Private (Admins, or the specific faculty via controller logic)
 */
router.get("/reports/faculty/:facultyId", auth, getFacultyAttendanceReport);

/**
 * @route   GET /api/attendance/reports/batch/:batchId
 * @desc    Get a student-by-student report for a batch over a date range.
 * @access  Private
 * @query   startDate, endDate (Format: YYYY-MM-DD)
 */
router.get("/reports/batch/:batchId", auth, getBatchAttendanceReport);


module.exports = router;