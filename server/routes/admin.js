const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * Create new tournament
 * POST /api/admin/tournaments
 */
router.post('/tournaments', [
  body('name').trim().notEmpty(),
  body('tournamentType').isIn(['school_only', 'inter_school', 'individual', 'team']),
  body('pairingMethod').isIn(['swiss', 'round_robin', 'knockout', 'manual']),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    name,
    description,
    tournamentType,
    scoringSystem = 'standard',
    winPoints = 1.0,
    drawPoints = 0.5,
    lossPoints = 0.0,
    pairingMethod,
    timeControlMinutes = 10,
    timeIncrementSeconds = 0,
    yearGroupRestriction,
    schoolRestriction,
    minParticipants = 2,
    maxParticipants,
    rounds = 5,
    registrationDeadline,
    startDate,
    endDate,
    useElo = true
  } = req.body;

  const sql = `
    INSERT INTO tournaments (
      name, description, tournament_type, scoring_system, win_points, draw_points, loss_points,
      pairing_method, time_control_minutes, time_increment_seconds, year_group_restriction,
      school_restriction, min_participants, max_participants, rounds, registration_deadline,
      start_date, end_date, use_elo, created_by, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `;

  db.run(sql, [
    name, description, tournamentType, scoringSystem, winPoints, drawPoints, lossPoints,
    pairingMethod, timeControlMinutes, timeIncrementSeconds, yearGroupRestriction,
    schoolRestriction, minParticipants, maxParticipants, rounds, registrationDeadline,
    startDate, endDate, useElo ? 1 : 0, req.user.id
  ], function(err) {
    if (err) {
      console.error('Error creating tournament:', err);
      return res.status(500).json({ error: 'Failed to create tournament' });
    }

    res.status(201).json({
      message: 'Tournament created successfully',
      tournamentId: this.lastID
    });
  });
});

/**
 * Get all tournaments
 * GET /api/admin/tournaments
 */
router.get('/tournaments', (req, res) => {
  const sql = `
    SELECT t.*, u.first_name || ' ' || u.last_name as created_by_name,
           COUNT(DISTINCT tp.user_id) as participant_count
    FROM tournaments t
    LEFT JOIN users u ON t.created_by = u.id
    LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `;

  db.all(sql, [], (err, tournaments) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch tournaments' });
    }
    res.json({ tournaments });
  });
});

/**
 * Get single tournament details
 * GET /api/admin/tournaments/:id
 */
router.get('/tournaments/:id', (req, res) => {
  const tournamentId = req.params.id;

  db.get(
    'SELECT * FROM tournaments WHERE id = ?',
    [tournamentId],
    (err, tournament) => {
      if (err || !tournament) {
        return res.status(404).json({ error: 'Tournament not found' });
      }

      // Get participants
      db.all(`
        SELECT tp.*, u.first_name, u.last_name, u.email, u.year_group, u.elo_rating,
               s.name as school_name
        FROM tournament_participants tp
        JOIN users u ON tp.user_id = u.id
        JOIN schools s ON u.school_id = s.id
        WHERE tp.tournament_id = ?
        ORDER BY tp.total_score DESC, tp.tiebreak_score DESC
      `, [tournamentId], (err, participants) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to fetch participants' });
        }

        res.json({
          tournament,
          participants
        });
      });
    }
  );
});

/**
 * Update tournament
 * PUT /api/admin/tournaments/:id
 */
router.put('/tournaments/:id', (req, res) => {
  const tournamentId = req.params.id;
  const updateFields = [];
  const updateValues = [];

  // Build dynamic update query
  const allowedFields = [
    'name', 'description', 'tournament_type', 'scoring_system', 'win_points', 'draw_points',
    'loss_points', 'pairing_method', 'time_control_minutes', 'time_increment_seconds',
    'year_group_restriction', 'school_restriction', 'min_participants', 'max_participants',
    'rounds', 'status', 'registration_deadline', 'start_date', 'end_date', 'use_elo'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateFields.push(`${field} = ?`);
      updateValues.push(req.body[field]);
    }
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updateValues.push(tournamentId);

  const sql = `UPDATE tournaments SET ${updateFields.join(', ')} WHERE id = ?`;

  db.run(sql, updateValues, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to update tournament' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json({ message: 'Tournament updated successfully' });
  });
});

/**
 * Delete tournament
 * DELETE /api/admin/tournaments/:id
 */
router.delete('/tournaments/:id', (req, res) => {
  const tournamentId = req.params.id;

  db.run('DELETE FROM tournaments WHERE id = ?', [tournamentId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete tournament' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    res.json({ message: 'Tournament deleted successfully' });
  });
});

/**
 * Create manual pairing for a round
 * POST /api/admin/tournaments/:id/pairings
 */
router.post('/tournaments/:id/pairings', [
  body('roundNumber').isInt({ min: 1 }),
  body('pairings').isArray()
], (req, res) => {
  const tournamentId = req.params.id;
  const { roundNumber, pairings } = req.body;

  // Get tournament settings
  db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
    if (err || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Create games for each pairing
    const stmt = db.prepare(`
      INSERT INTO games (tournament_id, white_player_id, black_player_id, round_number, result,
                        white_time_remaining, black_time_remaining)
      VALUES (?, ?, ?, ?, 'ongoing', ?, ?)
    `);

    const timeMs = tournament.time_control_minutes * 60 * 1000;

    pairings.forEach(pairing => {
      stmt.run([
        tournamentId,
        pairing.whitePlayerId,
        pairing.blackPlayerId,
        roundNumber,
        timeMs,
        timeMs
      ]);
    });

    stmt.finalize((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to create pairings' });
      }
      res.json({ message: 'Pairings created successfully' });
    });
  });
});

/**
 * Get all users (for admin management)
 * GET /api/admin/users
 */
router.get('/users', (req, res) => {
  db.all(`
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.year_group, u.elo_rating,
           u.created_at, s.name as school_name
    FROM users u
    JOIN schools s ON u.school_id = s.id
    ORDER BY u.created_at DESC
  `, [], (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch users' });
    }
    res.json({ users });
  });
});

/**
 * Update user role
 * PUT /api/admin/users/:id/role
 */
router.put('/users/:id/role', [
  body('role').isIn(['student', 'school_admin', 'super_admin'])
], (req, res) => {
  const userId = req.params.id;
  const { role } = req.body;

  db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to update user role' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User role updated successfully' });
  });
});

/**
 * Get statistics
 * GET /api/admin/stats
 */
router.get('/stats', (req, res) => {
  const stats = {};

  // Total users
  db.get('SELECT COUNT(*) as count FROM users', [], (err, result) => {
    stats.totalUsers = result.count;

    // Total tournaments
    db.get('SELECT COUNT(*) as count FROM tournaments', [], (err, result) => {
      stats.totalTournaments = result.count;

      // Total games
      db.get('SELECT COUNT(*) as count FROM games', [], (err, result) => {
        stats.totalGames = result.count;

        // Active games
        db.get("SELECT COUNT(*) as count FROM games WHERE result = 'ongoing'", [], (err, result) => {
          stats.activeGames = result.count;

          res.json({ stats });
        });
      });
    });
  });
});

module.exports = router;
