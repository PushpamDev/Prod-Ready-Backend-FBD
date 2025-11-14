const express = require("express");
const router = express.Router();
const {
  createUser,
  getAllUsers,
  assignRole,
  login,
  getAdmins,
} = require("../controllers/userController");

// --- NEW --- Import middleware
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

// --- MODIFIED ---
// Create user should be an admin-only action
// It needs 'auth' so the controller can get 'req.locationId'
router.post("/create", auth, admin, createUser);

// --- NO CHANGE ---
// Login MUST be public
router.post("/login", login);

// --- MODIFIED ---
// Getting all users should be an admin-only action
// It needs 'auth' to filter by location
router.get("/", auth, admin, getAllUsers);

// --- MODIFIED ---
// Assigning roles is a critical admin-only action
router.patch("/assign-role", auth, admin, assignRole);

// --- MODIFIED ---
// Get admins (for dropdowns, etc.) should be for any logged-in user
// It needs 'auth' to filter by location
router.get("/admins", auth, getAdmins);

module.exports = router;