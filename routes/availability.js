const express = require("express");
const router = express.Router();
const {
  getFacultyAvailability,
  setFacultyAvailability,
} = require("../controllers/availabilityController");

router.get("/faculty/:facultyId", getFacultyAvailability);
router.post("/", setFacultyAvailability);

module.exports = router;