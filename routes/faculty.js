const express = require("express");
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getAllFaculty,
  createFaculty,
  updateFaculty,
  deleteFaculty,
  getFacultyActiveStudents,
} = require("../controllers/facultyController");

router.get("/", auth, getAllFaculty);
router.get("/active-students", auth, getFacultyActiveStudents);
router.post("/", auth, createFaculty);
router.put("/:id", auth, updateFaculty);
router.delete("/:id", auth, deleteFaculty);

module.exports = router;