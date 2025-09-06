const jwt = require('jsonwebtoken');
const supabase = require('../db');

const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let userQuery;
    if (decoded.role === 'faculty') {
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('faculty_id', decoded.id)
        .single();
    } else {
      userQuery = supabase
        .from('users')
        .select('*')
        .eq('id', decoded.id)
        .single();
    }

    const { data: user, error } = await userQuery;

    if (error) {
      throw new Error('User not found');
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;