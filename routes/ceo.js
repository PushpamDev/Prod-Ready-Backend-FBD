const router = require("express").Router();
const auth = require("../middleware/auth");
const { getCEODashboard } = require("../controllers/ceoDashboardController");

router.get("/dashboard", auth, getCEODashboard);

module.exports = router;
