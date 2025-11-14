// server/middleware/auth.js

const jwt = require('jsonwebtoken');
const supabase = require('../db');

const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // --- THIS IS THE FIX ---
    // This new logic correctly reads the new token payload
    // for both faculty and other roles (like admin).
    const userId = decoded.role === 'faculty' ? decoded.id : decoded.userId;
    // --- END FIX ---

    let userQuery;
    if (decoded.role === 'faculty') {
      // Find the 'users' entry linked to this faculty ID
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('faculty_id', userId) // Use the new `userId` variable
        .single();
    } else {
      // Find the user by their direct user ID
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('id', userId) // Use the new `userId` variable
        .single();
    }

    const { data: user, error } = await userQuery;

    if (error || !user) {
      throw new Error('User not found');
    }

    req.user = user;
    req.locationId = user.location_id; // This is the goal
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;