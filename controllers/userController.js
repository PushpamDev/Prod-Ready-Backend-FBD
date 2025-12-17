// usercontroller.js
const supabase = require("../db.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { logActivity } = require("./logActivity");

const createUser = async (req, res) => {
  // --- MODIFIED --- Now requires locationName
  const { username, phone_number, password, locationName } = req.body;

  if ((!username && !phone_number) || !password || !locationName) {
    return res
      .status(400)
      .json({ error: "Username/phone, password, and locationName are required" });
  }
  
  // --- NEW --- Get the location ID from its name
  const { data: loc, error: locError } = await supabase
    .from('locations')
    .select('id')
    .eq('name', locationName)
    .single();

  if (locError || !loc) {
    return res.status(404).json({ error: 'Location not found.' });
  }
  const locationId = loc.id;
  // --- END NEW ---

  // Hash the password
  const salt = await bcrypt.genSalt(10);
  const password_hash = await bcrypt.hash(password, 10);

  // Create the user
  const { data, error } = await supabase
    .from("users")
    // --- MODIFIED --- Insert with location_id
    .insert([{ username, phone_number, password_hash, location_id: locationId }])
    .select()
    .single();

  if (error) {
    // --- MODIFIED --- Handle unique constraint error
    if (error.code === '23505') { // unique_violation
        return res.status(409).json({ error: 'User with this username or phone already exists at this location.' });
    }
    return res.status(500).json({ error: "Failed to create user" });
  }

  await logActivity("Created", `User "${username || phoneNumber}"`, "system");

  res.status(201).json(data);
};

const login = async (req, res) => {
  try {
    const { username, password, locationName } = req.body; // --- MODIFIED ---

    if (!username || !password || !locationName) { // --- MODIFIED ---
      return res
        .status(400)
        .json({ error: "Username, password, and locationName are required" });
    }

    // --- NEW --- Get the location ID from its name
    const { data: loc, error: locError } = await supabase
      .from('locations')
      .select('id')
      .eq('name', locationName)
      .single();

    if (locError || !loc) {
      return res.status(404).json({ error: 'Location not found.' });
    }
    const locationId = loc.id;
    // --- END NEW ---

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq('location_id', locationId) // --- MODIFIED ---
      .or(`username.eq.${username},phone_number.eq.${username}`)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error finding user:", error);
      return res.status(500).json({ error: "Failed to find user" });
    }

    if (!user) {
      return res.status(404).json({ error: "User not found at this location" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // --- MODIFIED --- This is the key change
    // We add all the info the frontend needs into the token
    let tokenPayload = { 
      userId: user.id, // AuthContext expects 'userId'
      role: user.role, 
      locationId: user.location_id,
      username: user.username,     // --- NEW ---
      locationName: locationName   // --- NEW ---
    };

    if (user.role === "faculty") {
      tokenPayload.id = user.faculty_id; // AuthContext expects 'id' for faculty
    }

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({ token }); // Send only the token, as AuthContext expects
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
const getAllUsers = async (req, res) => {
  // --- MODIFIED --- This query is now filtered by location
  // Note: You must add the `auth` middleware to this route in your routes file
  const { data, error } = await supabase
    .from("users")
    .select("id, username, phone_number, role")
    .eq('location_id', req.locationId); // <-- Filter by user's location

  if (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({ error: "Failed to fetch users" });
  }

  res.status(200).json(data);
};

const getAdmins = async (req, res) => {
  // --- MODIFIED --- This query is now filtered by location
  // Note: You must add the `auth` middleware to this route in your routes file
  try {
    const { data: admins, error } = await supabase
      .from('users')
      .select('id, username')
      .eq('role', 'admin')
      .eq('location_id', req.locationId); // <-- Filter by user's location

    if (error) {
      console.error("Error fetching admins:", error);
      return res.status(500).json({ error: "Failed to fetch admins" });
    }

    res.status(200).json(admins);
  } catch (error) {
    console.error("Internal server error while fetching admins:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const assignRole = async (req, res) => {
  // --- NO CHANGE NEEDED ---
  // This function operates on a specific 'userId' (a UUID),
  // which is already unique. The filtering should happen
  // on the frontend (i.e., an admin from Faridabad should
  // only see users from Faridabad to assign roles to),
  // which is now handled by our change to `getAllUsers`.
  
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

// =======================================================
// --- NEW STUDENT LOGIN (Add this function) ---
// =======================================================
const studentLogin = async (req, res) => {
  const { admission_number, phone_number } = req.body;

  if (!admission_number || !phone_number) {
    return res.status(400).json({ error: 'Admission Number and Phone Number are required.' });
  }

  try {
    // 1. Find the student in the 'students' table
    const { data: student, error } = await supabase
      .from('students')
      .select('id, name, phone_number, admission_number, location_id') 
      .eq('admission_number', admission_number)
      .eq('phone_number', phone_number)
      .single();

    if (error || !student) {
      return res.status(401).json({ error: 'Invalid credentials. Please check your Admission ID and Registered Mobile Number.' });
    }

    // 2. Generate Token
    // We explicitly set role: 'student' so auth.js knows to look in the students table
    const token = jwt.sign(
      { 
        id: student.id, 
        role: 'student', // <--- IMPORTANT: This tells auth.js it's a student
        name: student.name,
        location_id: student.location_id 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Students get a longer session
    );

    // 3. Return Token & User Data
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: student.id,
        name: student.name,
        role: 'student',
        admission_number: student.admission_number,
        phone_number: student.phone_number,
        location_id: student.location_id
      }
    });

  } catch (err) {
    console.error('Student Login Error:', err);
    res.status(500).json({ error: 'An unexpected error occurred during login.' });
  }
};
module.exports = {
  createUser,
  login,
  getAllUsers,
  assignRole,
  getAdmins,
  studentLogin,
};