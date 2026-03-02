// usercontroller.js
const supabase = require("../db.js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { logActivity } = require("./logActivity");

/**
 * Standard User Creation (Self-Registration or Branch Admin)
 */
const createUser = async (req, res) => {
  const { username, phone_number, password, locationName } = req.body;

  if ((!username && !phone_number) || !password || !locationName) {
    return res
      .status(400)
      .json({ error: "Username/phone, password, and locationName are required" });
  }
  
  // Get the location ID from its name
  const { data: loc, error: locError } = await supabase
    .from('locations')
    .select('id')
    .eq('name', locationName)
    .single();

  if (locError || !loc) {
    return res.status(404).json({ error: 'Location not found.' });
  }
  const locationId = loc.id;

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("users")
    .insert([{ username, phone_number, password_hash, location_id: locationId }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
        return res.status(409).json({ error: 'User already exists at this location.' });
    }
    return res.status(500).json({ error: "Failed to create user" });
  }

  await logActivity("Created", `User "${username || phone_number}"`, "system");
  res.status(201).json(data);
};

/**
 * Super Admin Specific User Creation
 * Allows direct role assignment and location selection
 */
const createUserBySuperAdmin = async (req, res) => {
  // ✅ FIX: Match your middleware's boolean flag for Super Admin status
  if (!req.isSuperAdmin) {
    return res.status(403).json({ error: "Unauthorized: Super Admin access required." });
  }

  const { username, phone_number, password, location_id, role, faculty_id } = req.body;

  // Validation: username and password are standard, location_id and role are required for provisioning
  if (!username || !password || !location_id || !role) {
    return res.status(400).json({ error: "Username, Password, Location, and Role are required." });
  }

  try {
    // Generate salt and hash the password
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Prepare payload matching your database terms
    const userPayload = {
      username: username.trim(),
      phone_number: phone_number || null,
      password_hash,
      location_id: parseInt(location_id), // ✅ FIX: Ensure integer type for DB
      role: role.toLowerCase(), // Ensure it matches 'faculty', 'admin', etc.
      faculty_id: faculty_id || null // Link faculty if provided
    };

    const { data, error } = await supabase
      .from("users")
      .insert([userPayload])
      .select()
      .single();

    if (error) {
      // Handle the unique constraint (username + location_id) or (phone_number + location_id)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Identity already exists at this specific branch location.' });
      }
      throw error;
    }

    // Log activity using the logged-in Super Admin's details
    await logActivity(
      "Created", 
      `SuperAdmin provisioned ${role} account for ${username} at branch ${location_id}`, 
      req.user?.id || "SuperAdmin"
    );

    res.status(201).json(data);
  } catch (error) {
    console.error("SuperAdmin Provisioning Error:", error.message);
    res.status(500).json({ error: "An internal server error occurred while creating the user." });
  }
};

const login = async (req, res) => {
  try {
    const { username, password, locationName } = req.body;

    if (!username || !password || !locationName) {
      return res.status(400).json({ error: "Username, password, and locationName are required" });
    }

    const { data: loc, error: locError } = await supabase
      .from('locations')
      .select('id')
      .eq('name', locationName)
      .single();

    if (locError || !loc) return res.status(404).json({ error: 'Location not found.' });
    const locationId = loc.id;

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq('location_id', locationId)
      .or(`username.eq.${username},phone_number.eq.${username}`)
      .single();

    if (!user) return res.status(404).json({ error: "User not found at this location" });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: "Invalid password" });

    let tokenPayload = { 
      userId: user.id, 
      role: user.role, 
      locationId: user.location_id,
      username: user.username,
      locationName: locationName,
      isSuperAdmin: user.role === 'super_admin'
    };

    if (user.role === "faculty") tokenPayload.id = user.faculty_id;

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "64h" });

    res.status(200).json({ 
      token,
      user: {
        userId: user.id,
        username: user.username,
        role: user.role,
        locationId: user.location_id,
        locationName: locationName
      }
    }); 
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get Users - Super Admin can see all, Branch Admin only sees their own
 */
const getAllUsers = async (req, res) => {
  // ✅ FIX: Use req.isSuperAdmin (as set in your auth.js middleware)
  const isSuperAdmin = req.isSuperAdmin; 
  const userLocationId = req.locationId;
  
  // ✅ Get the override from URL (?location_id=2)
  const { location_id } = req.query; 

  try {
    let query = supabase
      .from("users")
      .select("id, username, phone_number, role, location_id, created_at");

    if (isSuperAdmin) {
      // ✅ Super Admin Bypass: Only filter if a specific city is requested
      if (location_id && location_id !== 'all') {
        query = query.eq('location_id', Number(location_id));
      }
      // If 'all' or omitted, no .eq() filter is applied = Global View
    } else {
      // ✅ Standard Admin: Forced lockdown to their branch
      if (!userLocationId) {
        return res.status(401).json({ error: 'Location context missing.' });
      }
      query = query.eq('location_id', userLocationId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    // ✅ Force browser to ignore 304 cache and show fresh data
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

const getAdmins = async (req, res) => {
  const isSuperAdmin = req.role === 'super_admin';
  const { location_id } = req.query;

  try {
    let query = supabase
      .from('users')
      .select('id, username, location_id')
      .eq('role', 'admin');

    if (!isSuperAdmin) {
      query = query.eq('location_id', req.locationId);
    } else if (location_id && location_id !== 'all') {
      query = query.eq('location_id', location_id);
    }

    const { data: admins, error } = await query;
    if (error) throw error;

    res.status(200).json(admins);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
};

const assignRole = async (req, res) => {
  const { userId, role } = req.body;
  const isSuperAdmin = req.role === 'super_admin';

  if (!userId || !role) return res.status(400).json({ error: "User ID and role required" });

  try {
    // Branch Admin safety check
    if (!isSuperAdmin) {
      const { data: targetUser } = await supabase.from('users').select('location_id').eq('id', userId).single();
      if (targetUser.location_id !== req.locationId) {
        return res.status(403).json({ error: "Unauthorized: User belongs to another branch." });
      }
    }

    const { data, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;

    await logActivity("Updated", `Assigned role "${role}" to ${data.username}`, req.user.id);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to assign role" });
  }
};

const studentLogin = async (req, res) => {
  const { admission_number, phone_number } = req.body;
  if (!admission_number || !phone_number) return res.status(400).json({ error: 'Required fields missing.' });

  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('id, name, phone_number, admission_number, location_id') 
      .eq('admission_number', admission_number)
      .eq('phone_number', phone_number)
      .single();

    if (error || !student) return res.status(401).json({ error: 'Invalid credentials.' });

    const token = jwt.sign(
      { id: student.id, role: 'student', name: student.name, location_id: student.location_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      token,
      user: { id: student.id, name: student.name, role: 'student', location_id: student.location_id }
    });
  } catch (err) {
    res.status(500).json({ error: 'An unexpected error occurred.' });
  }
};

/**
 * Delete User
 * Super Admin: Can delete any user.
 * Branch Admin: Can only delete users within their assigned location.
 */
/**
 * Delete User (Full System Wipe)
 * Purges all related data across messages, batches, and faculty records 
 * to satisfy database check constraints.
 */
const deleteUser = async (req, res) => {
  const { userId } = req.params;
  const isSuperAdmin = req.isSuperAdmin;
  const adminLocationId = req.locationId;

  if (!userId) return res.status(400).json({ error: "User ID required." });

  try {
    // 1. Fetch target to get faculty_id and location context
    const { data: targetUser, error: fetchError } = await supabase
      .from("users")
      .select("id, username, location_id, faculty_id, role")
      .eq("id", userId)
      .single();

    if (fetchError || !targetUser) {
      return res.status(404).json({ error: "User identity not found." });
    }

    // 2. RBAC: Only Super Admin or the specific Branch Admin can delete
    if (!isSuperAdmin && targetUser.location_id !== adminLocationId) {
      return res.status(403).json({ error: "Unauthorized: Access denied for this branch." });
    }

    // ---------------------------------------------------------
    // 3. SEQUENTIAL PURGE (Solves chk_one_sender)
    // ---------------------------------------------------------
    
    // A. Clear Messages (The primary cause of your constraint error)
    // Delete every message where this user was either the sender or receiver
    await supabase.from("messages").delete().eq("sender_id", userId);
    await supabase.from("messages").delete().eq("receiver_id", userId);

    // B. Clear Activity Logs (If they reference the user ID directly)
    await supabase.from("activity_logs").delete().eq("user_id", userId);

    // C. Handle Faculty specific data
    if (targetUser.faculty_id) {
      // Unlink from Batches (set to null so batches aren't deleted, just unassigned)
      await supabase
        .from("batches")
        .update({ faculty_id: null })
        .eq("faculty_id", targetUser.faculty_id);

      // Delete Faculty Attendance
      await supabase.from("faculty_attendance").delete().eq("faculty_id", targetUser.faculty_id);

      // Delete the Faculty Profile itself
      await supabase.from("faculties").delete().eq("id", targetUser.faculty_id);
    }

    // D. FINALLY: Delete the User Account
    const { error: finalDeleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", userId);

    if (finalDeleteError) throw finalDeleteError;

    // 4. Audit Log
    await logActivity("Deleted", `FULL PURGE: User "${targetUser.username}" and all related assets.`, req.user?.id || "System");

    res.status(200).json({ message: "User and all related records purged successfully." });

  } catch (error) {
    console.error("Critical Purge Error:", error.message);
    res.status(500).json({ error: `System Wipe Failed: ${error.message}` });
  }
};
/**
 * Update User (Profile, Role, and Password Reset)
 * Super Admin: Full global control.
 * Branch Admin: Can update users within their own branch.
 */
const updateUser = async (req, res) => {
  const { userId } = req.params;
  const { username, phone_number, password, role, location_id } = req.body;
  const isSuperAdmin = req.isSuperAdmin;
  const adminLocationId = req.locationId;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required." });
  }

  try {
    // 1. Verification: Check if user exists and verify location access
    const { data: targetUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError || !targetUser) {
      return res.status(404).json({ error: "User not found." });
    }

    // 2. Security Bypass Check
    if (!isSuperAdmin && targetUser.location_id !== adminLocationId) {
      return res.status(403).json({ error: "Unauthorized: You cannot modify users from other branches." });
    }

    // 3. Construct Update Object
    const updates = {};
    if (username) updates.username = username.trim();
    if (phone_number !== undefined) updates.phone_number = phone_number;
    
    // Role & Location updates are high-privilege
    if (role) updates.role = role.toLowerCase();
    if (location_id && isSuperAdmin) updates.location_id = parseInt(location_id);

    // 4. Password Reset Logic (if provided)
    if (password && password.trim() !== "") {
      const salt = await bcrypt.genSalt(10);
      updates.password_hash = await bcrypt.hash(password, salt);
    }

    // 5. Execute Update
    const { data, error: updateError } = await supabase
      .from("users")
      .update(updates)
      .eq("id", userId)
      .select("id, username, role, location_id")
      .single();

    if (updateError) {
      if (updateError.code === '23505') return res.status(409).json({ error: "Conflict: Identity already exists." });
      throw updateError;
    }

    // 6. Audit Log
    const changeDesc = password ? "Reset Password & Profile" : "Updated Profile";
    await logActivity(
      "Updated", 
      `${changeDesc} for user "${targetUser.username}"`, 
      req.user?.id || "admin"
    );

    res.status(200).json({ message: "User updated successfully.", user: data });
  } catch (error) {
    console.error("Update User Error:", error.message);
    res.status(500).json({ error: "An unexpected error occurred during user update." });
  }
};

module.exports = {
  createUser,
  createUserBySuperAdmin, // ✅ New
  login,
  getAllUsers,
  assignRole,
  getAdmins,
  studentLogin,
  updateUser, // ✅ New
  deleteUser
};