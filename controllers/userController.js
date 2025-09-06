const supabase = require("../db.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { logActivity } = require("./logActivity");

const createUser = async (req, res) => {
  const { username, phone_number, password } = req.body;

  if ((!username && !phone_number) || !password) {
    return res
      .status(400)
      .json({ error: "Username or phone number, and a password are required" });
  }

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  const password_hash = await bcrypt.hash(password, 10);

  // Create the user
  const { data, error } = await supabase
    .from("users")
    .insert([{ username, phone_number, password_hash }])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: "Failed to create user" });
  }

  await logActivity("Created", `User "${username || phoneNumber}"`, "system");

  res.status(201).json(data);
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username or phone number, and a password are required" });
    }

    // Find the user by username or phone number
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .or(`username.eq.${username},phone_number.eq.${username}`)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 means no rows found, which is not an error in this case
      console.error("Error finding user:", error);
      return res.status(500).json({ error: "Failed to find user" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Compare passwords
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    let tokenPayload = { id: user.id, role: user.role };

    if (user.role === "faculty") {
      if (!user.faculty_id) {
        return res
          .status(404)
          .json({ error: "Faculty details not found for this user." });
      }
      tokenPayload.id = user.faculty_id;
    }

    // Create and sign a JWT
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    res.status(200).json({ token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getAllUsers = async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, username, phone_number, role");

  if (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({ error: "Failed to fetch users" });
  }

  res.status(200).json(data);
};

const assignRole = async (req, res) => {
  const { userId, role } = req.body;

  if (!userId || !role) {
    return res.status(400).json({ error: "User ID and role are required" });
  }

  if (role !== "admin" && role !== "faculty") {
    return res.status(400).json({ error: "Invalid role specified" });
  }

  const { data, error } = await supabase
    .from("users")
    .update({ role })
    .eq("id", userId)
    .select()
    .single();

  if (error) {
    console.error("Error assigning role:", error);
    return res.status(500).json({ error: "Failed to assign role" });
  }

  if (!data) {
    return res.status(404).json({ error: "User not found" });
  }

  await logActivity(
    "Updated",
    `Assigned role "${role}" to user ${data.username || data.phone_number}`,
    "admin"
  );

  res.status(200).json(data);
};

module.exports = {
  createUser,
  login,
  getAllUsers,
  assignRole,
};