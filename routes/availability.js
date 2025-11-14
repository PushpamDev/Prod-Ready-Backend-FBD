const express = require("express");
const router = express.Router();
const {
  getFacultyAvailability,
  setFacultyAvailability,
} = require("../controllers/availabilityController");

// --- NEW --- Import your auth middleware
const auth = require("../middleware/auth");

// --- MODIFIED --- Added 'auth' middleware
router.get("/faculty/:facultyId", auth, getFacultyAvailability);

// --- MODIFIED --- Added 'auth' middleware
router.post("/", auth, setFacultyAvailability);

module.exports = router;