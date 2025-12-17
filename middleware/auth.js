// server/middleware/auth.js
const jwt = require('jsonwebtoken');
const supabase = require('../db');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ---------------------------------------------------------
    // 1. CHECK IF TOKEN BELONGS TO A STUDENT
    // ---------------------------------------------------------
    // The 'role' comes from the TOKEN payload, not the database.
    if (decoded.role === 'student') {
      const { data: student, error } = await supabase
        .from('students') // We look in the 'students' table
        .select('*')      // We select whatever columns exist (id, name, etc.)
        .eq('id', decoded.id)
        .single();

      if (error || !student) {
        throw new Error('Student not found');
      }

      req.user = student;
      req.userType = 'student';
      req.locationId = student.location_id; 
      
      return next(); // ✅ Success! Exit middleware here.
    }

    // ---------------------------------------------------------
    // 2. CHECK IF TOKEN BELONGS TO FACULTY / ADMIN / STAFF
    // ---------------------------------------------------------
    // (This runs only if the role is NOT 'student')
    
    // Admins/Staff usually have 'userId' in token, Faculty have 'id'
    const userId = decoded.role === 'faculty' ? decoded.id : (decoded.userId || decoded.id);

    let userQuery;
    
    if (decoded.role === 'faculty') {
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('faculty_id', userId)
        .single();
    } else {
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    }

    const { data: user, error } = await userQuery;

    if (error || !user) {
      throw new Error('User not found');
    }

    req.user = user;
    req.userType = decoded.role; // 'faculty', 'admin', etc.
    req.locationId = user.location_id; 
    
    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;