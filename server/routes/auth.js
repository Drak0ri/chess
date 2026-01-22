const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { parseEmail, validateEmailDomain } = require('../utils/emailParser');
const router = express.Router();

/**
 * Register new user
 * POST /api/auth/register
 */
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('yearGroup').isInt({ min: 4, max: 9 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, yearGroup } = req.body;

  // Validate email domain
  if (!validateEmailDomain(email)) {
    return res.status(400).json({ error: 'Invalid email domain. Must be from engelska.se' });
  }

  // Parse email to extract names and school
  const emailData = parseEmail(email);
  if (!emailData) {
    return res.status(400).json({
      error: 'Invalid email format. Must be: firstname.lastname.student.school@engelska.se'
    });
  }

  try {
    // Check if user already exists
    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Find or create school
      db.get(
        'SELECT id FROM schools WHERE email_identifier = ?',
        [emailData.schoolIdentifier],
        async (err, school) => {
          let schoolId;

          if (school) {
            schoolId = school.id;
            await createUser();
          } else {
            // Create new school
            db.run(
              'INSERT INTO schools (name, email_identifier) VALUES (?, ?)',
              [emailData.schoolIdentifier, emailData.schoolIdentifier],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Database error' });
                }
                schoolId = this.lastID;
                createUser();
              }
            );
          }

          async function createUser() {
            // Hash password
            const passwordHash = await bcrypt.hash(password, 10);

            // Create user
            db.run(
              `INSERT INTO users (email, password_hash, first_name, last_name, school_id, year_group, is_verified)
               VALUES (?, ?, ?, ?, ?, ?, 1)`,
              [email, passwordHash, emailData.firstName, emailData.lastName, schoolId, yearGroup],
              function(err) {
                if (err) {
                  return res.status(500).json({ error: 'Failed to create user' });
                }

                res.status(201).json({
                  message: 'Registration successful',
                  user: {
                    id: this.lastID,
                    email,
                    firstName: emailData.firstName,
                    lastName: emailData.lastName,
                    school: emailData.schoolIdentifier
                  }
                });
              }
            );
          }
        }
      );
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Login
 * POST /api/auth/login
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    db.get(
      `SELECT u.*, s.name as school_name, s.email_identifier as school_identifier
       FROM users u
       JOIN schools s ON u.school_id = s.id
       WHERE u.email = ?`,
      [email],
      async (err, user) => {
        if (err || !user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

        // Generate JWT
        const token = jwt.sign(
          { userId: user.id, email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Set cookie
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        res.json({
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            yearGroup: user.year_group,
            eloRating: user.elo_rating,
            school: user.school_name
          }
        });
      }
    );
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Logout
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
