const express = require("express");
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getAllFaculty,
  createFaculty,
  updateFaculty,
  deleteFaculty,
  getFacultyActiveStudents,
  getFacultyTotalStudents,
  getFacultyStudentCounts, // 1. Import the new function
} = require("../controllers/facultyController");

router.get("/", auth, getAllFaculty);
router.get("/active-students", auth, getFacultyActiveStudents);

// 2. Add the new route for student counts
router.get("/student-counts", auth, getFacultyStudentCounts);

// Routes with parameters come after more specific routes
router.get("/total-students/:faculty_id", getFacultyTotalStudents);
router.post("/", auth, createFaculty);
router.put("/:id", auth, updateFaculty);
router.delete("/:id", auth, deleteFaculty);

module.exports = router;