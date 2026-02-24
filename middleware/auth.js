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
    if (decoded.role === 'student') {
      const { data: student, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', decoded.id)
        .single();

      if (error || !student) {
        throw new Error('Student not found');
      }

      // Students are never super_admins
      student.role = 'student'; 
      
      req.user = student;
      req.userType = 'student';
      req.isSuperAdmin = false; 
      req.locationId = student.location_id; 
      
      return next(); 
    }

    // ---------------------------------------------------------
    // 2. CHECK IF TOKEN BELONGS TO FACULTY / ADMIN / STAFF / SUPER_ADMIN
    // ---------------------------------------------------------
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

    // Attach user to request
    req.user = user;
    
    // ---------------------------------------------------------
    // 3. ROLE-BASED ACCESS CONTROL (RBAC) INJECTION
    // ---------------------------------------------------------
    // We prioritize the role from the Database over the Token for security
    req.userType = user.role || decoded.role; 
    
    // Set a global flag for 'super_admin' to bypass branch/location restrictions
    req.isSuperAdmin = user.role === 'super_admin'; 
    
    req.locationId = user.location_id; 
    
    next();

  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;