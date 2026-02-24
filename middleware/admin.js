// server/middleware/admin.js

const admin = (req, res, next) => {
  // Check if user exists and if their role is either 'admin' OR 'super_admin'
  const isAuthorized = req.user && (req.user.role === "admin" || req.user.role === "super_admin");

  if (isAuthorized) {
    next();
  } else {
    res.status(403).json({ 
      error: "Access denied. Admin or Super Admin privileges required." 
    });
  }
};

module.exports = admin;