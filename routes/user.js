const express = require("express");
const router = express.Router();
const {
  createUser,
  getAllUsers,
  assignRole,
  login,
  getAdmins, // UPDATED: Import the new controller function
} = require("../controllers/userController");

router.post("/create", createUser);
router.post("/login", login);
router.get("/", getAllUsers);
router.patch("/assign-role", assignRole);

// NEW: Add a dedicated route to get admin users
// This will be accessible at GET /api/users/admins
router.get("/admins", getAdmins);

module.exports = router;