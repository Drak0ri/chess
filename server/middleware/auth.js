const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

/**
 * Verify JWT token and attach user to request
 */
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get fresh user data
    db.get(
      `SELECT u.*, s.name as school_name, s.email_identifier as school_identifier
       FROM users u
       JOIN schools s ON u.school_id = s.id
       WHERE u.id = ?`,
      [decoded.userId],
      (err, user) => {
        if (err || !user) {
          return res.status(401).json({ error: 'Invalid token.' });
        }

        req.user = user;
        next();
      }
    );
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Verify user is a school admin or super admin
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'school_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
}

/**
 * Verify user is a super admin
 */
function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Access denied. Super admin privileges required.' });
  }
  next();
}

/**
 * Verify user is a student (or higher)
 */
function requireStudent(req, res, next) {
  if (!req.user) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireSuperAdmin,
  requireStudent
};
