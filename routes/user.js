const express = require("express");
const router = express.Router();
const {
  createUser,
  createUserBySuperAdmin, // ✅ Added for Super Admin Provisioning
  getAllUsers,
  assignRole,
  login,
  getAdmins,
  studentLogin,
  deleteUser, // ✅ New
  updateUser, // ✅ New
} = require("../controllers/userController");

// --- MIDDLEWARE ---
const auth = require("../middleware/auth");
const admin = require("../middleware/admin");

/* ================= PUBLIC ROUTES ================= */

// Login MUST be public
router.post("/login", login);

// Student Portal Login
router.post('/auth/student/login', studentLogin);


/* ================= PROTECTED ROUTES ================= */

/**
 * ✅ NEW: Super Admin Provisioning
 * Exclusive to Super Admins to create users for ANY location/role.
 * auth: identifies user, admin: extra security check (optional if auth handles it)
 */
router.post("/super-provision", auth, createUserBySuperAdmin);

/**
 * Standard User Creation
 * Limited to Branch Admin's own location via req.locationId
 */
router.post("/create", auth, admin, createUser);

/**
 * Getting Users
 * Super Admin gets global list (or filtered by query param)
 * Standard Admin gets branch-locked list
 */
router.get("/", auth, getAllUsers);

/**
 * Get Admins (for assignments/dropdowns)
 * Scoped by location in the controller
 */
router.get("/admins", auth, getAdmins);

/**
 * Assigning Roles
 * Scoped by location for Admins; Global for Super Admins
 */
router.patch("/assign-role", auth, admin, assignRole);

// Add this line to your routes file
router.delete("/:userId", auth, admin, deleteUser);

/**
 * ✅ NEW: Update User
 * Scoped by location for Admins; Global for Super Admins
 */
// ✅ Ensure the ':userId' is present
router.patch("/update/:userId", auth, admin, updateUser);

module.exports = router;