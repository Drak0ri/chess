const express = require('express');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// All student routes require authentication
router.use(authenticateToken);

/**
 * Get available tournaments for student
 * GET /api/student/tournaments
 */
router.get('/tournaments', (req, res) => {
  const userId = req.user.id;
  const yearGroup = req.user.year_group;
  const schoolId = req.user.school_id;

  const sql = `
    SELECT t.*,
           COUNT(DISTINCT tp.user_id) as participant_count,
           EXISTS(SELECT 1 FROM tournament_participants WHERE tournament_id = t.id AND user_id = ?) as is_registered
    FROM tournaments t
    LEFT JOIN tournament_participants tp ON t.id = tp.tournament_id
    WHERE t.status IN ('registration', 'active')
    GROUP BY t.id
    ORDER BY t.start_date ASC
  `;

  db.all(sql, [userId], (err, tournaments) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch tournaments' });
    }

    // Filter tournaments based on restrictions
    const eligibleTournaments = tournaments.filter(t => {
      // Check year group restriction
      if (t.year_group_restriction) {
        const allowedYears = t.year_group_restriction.split(',').map(y => parseInt(y.trim()));
        if (!allowedYears.includes(yearGroup)) {
          return false;
        }
      }

      // Check school restriction
      if (t.school_restriction) {
        const allowedSchools = t.school_restriction.split(',').map(s => parseInt(s.trim()));
        if (!allowedSchools.includes(schoolId)) {
          return false;
        }
      }

      return true;
    });

    res.json({ tournaments: eligibleTournaments });
  });
});

/**
 * Register for tournament
 * POST /api/student/tournaments/:id/register
 */
router.post('/tournaments/:id/register', (req, res) => {
  const tournamentId = req.params.id;
  const userId = req.user.id;

  // Check tournament status and restrictions
  db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
    if (err || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    if (tournament.status !== 'registration') {
      return res.status(400).json({ error: 'Tournament is not open for registration' });
    }

    // Check if already registered
    db.get(
      'SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
      [tournamentId, userId],
      (err, existing) => {
        if (existing) {
          return res.status(400).json({ error: 'Already registered for this tournament' });
        }

        // Register user
        db.run(
          'INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)',
          [tournamentId, userId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Failed to register for tournament' });
            }

            res.json({ message: 'Successfully registered for tournament' });
          }
        );
      }
    );
  });
});

/**
 * Get my games
 * GET /api/student/games
 */
router.get('/games', (req, res) => {
  const userId = req.user.id;
  const status = req.query.status; // 'ongoing', 'completed', or 'all'

  let sql = `
    SELECT g.*,
           t.name as tournament_name,
           wp.first_name || ' ' || wp.last_name as white_player_name,
           bp.first_name || ' ' || bp.last_name as black_player_name,
           wp.elo_rating as white_elo,
           bp.elo_rating as black_elo
    FROM games g
    LEFT JOIN tournaments t ON g.tournament_id = t.id
    JOIN users wp ON g.white_player_id = wp.id
    JOIN users bp ON g.black_player_id = bp.id
    WHERE (g.white_player_id = ? OR g.black_player_id = ?)
  `;

  const params = [userId, userId];

  if (status === 'ongoing') {
    sql += " AND g.result = 'ongoing'";
  } else if (status === 'completed') {
    sql += " AND g.result != 'ongoing'";
  }

  sql += ' ORDER BY g.started_at DESC';

  db.all(sql, params, (err, games) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch games' });
    }

    // Add player perspective
    const gamesWithPerspective = games.map(game => ({
      ...game,
      myColor: game.white_player_id === userId ? 'white' : 'black',
      opponentName: game.white_player_id === userId ? game.black_player_name : game.white_player_name
    }));

    res.json({ games: gamesWithPerspective });
  });
});

/**
 * Get leaderboard
 * GET /api/student/leaderboard
 */
router.get('/leaderboard', (req, res) => {
  const tournamentId = req.query.tournamentId;
  const scope = req.query.scope || 'global'; // 'global', 'school', 'year', 'tournament'

  let sql = `
    SELECT u.id, u.first_name, u.last_name, u.elo_rating, u.year_group,
           s.name as school_name,
           COUNT(DISTINCT g.id) as games_played,
           SUM(CASE
             WHEN g.result = 'white_win' AND g.white_player_id = u.id THEN 1
             WHEN g.result = 'black_win' AND g.black_player_id = u.id THEN 1
             ELSE 0
           END) as wins,
           SUM(CASE WHEN g.result = 'draw' THEN 1 ELSE 0 END) as draws
    FROM users u
    JOIN schools s ON u.school_id = s.id
    LEFT JOIN games g ON (g.white_player_id = u.id OR g.black_player_id = u.id)
                      AND g.result != 'ongoing'
  `;

  const params = [];

  if (scope === 'school') {
    sql += ' WHERE u.school_id = ?';
    params.push(req.user.school_id);
  } else if (scope === 'year') {
    sql += ' WHERE u.year_group = ?';
    params.push(req.user.year_group);
  } else if (scope === 'tournament' && tournamentId) {
    sql = `
      SELECT u.id, u.first_name, u.last_name, u.elo_rating, u.year_group,
             s.name as school_name,
             tp.total_score, tp.games_played, tp.wins, tp.draws, tp.losses, tp.tiebreak_score
      FROM tournament_participants tp
      JOIN users u ON tp.user_id = u.id
      JOIN schools s ON u.school_id = s.id
      WHERE tp.tournament_id = ?
      ORDER BY tp.total_score DESC, tp.tiebreak_score DESC
      LIMIT 100
    `;
    params.push(tournamentId);

    db.all(sql, params, (err, rankings) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch leaderboard' });
      }
      return res.json({ leaderboard: rankings });
    });
    return;
  }

  sql += ' GROUP BY u.id ORDER BY u.elo_rating DESC LIMIT 100';

  db.all(sql, params, (err, rankings) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
    res.json({ leaderboard: rankings });
  });
});

/**
 * Get my profile and statistics
 * GET /api/student/profile
 */
router.get('/profile', (req, res) => {
  const userId = req.user.id;

  // Get user stats
  db.get(`
    SELECT
      COUNT(DISTINCT g.id) as total_games,
      SUM(CASE
        WHEN g.result = 'white_win' AND g.white_player_id = ? THEN 1
        WHEN g.result = 'black_win' AND g.black_player_id = ? THEN 1
        ELSE 0
      END) as wins,
      SUM(CASE
        WHEN g.result = 'draw' AND (g.white_player_id = ? OR g.black_player_id = ?) THEN 1
        ELSE 0
      END) as draws,
      SUM(CASE
        WHEN g.result = 'white_win' AND g.black_player_id = ? THEN 1
        WHEN g.result = 'black_win' AND g.white_player_id = ? THEN 1
        ELSE 0
      END) as losses
    FROM games g
    WHERE (g.white_player_id = ? OR g.black_player_id = ?) AND g.result != 'ongoing'
  `, [userId, userId, userId, userId, userId, userId, userId, userId], (err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }

    // Get ELO history
    db.all(`
      SELECT old_rating, new_rating, rating_change, created_at
      FROM elo_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId], (err, eloHistory) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch ELO history' });
      }

      res.json({
        user: {
          id: req.user.id,
          firstName: req.user.first_name,
          lastName: req.user.last_name,
          email: req.user.email,
          school: req.user.school_name,
          yearGroup: req.user.year_group,
          eloRating: req.user.elo_rating
        },
        stats: {
          totalGames: stats.total_games || 0,
          wins: stats.wins || 0,
          draws: stats.draws || 0,
          losses: stats.losses || 0,
          winRate: stats.total_games > 0 ? ((stats.wins / stats.total_games) * 100).toFixed(1) : 0
        },
        eloHistory
      });
    });
  });
});

module.exports = router;
