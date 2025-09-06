const express = require("express");
const router = express.Router();
const {
  createUser,
  getAllUsers,
  assignRole,
  login,
} = require("../controllers/userController");

router.post("/create", createUser);
router.post("/login", login);
router.get("/", getAllUsers);
router.patch("/assign-role", assignRole);

module.exports = router;