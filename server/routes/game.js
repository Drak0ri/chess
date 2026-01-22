const express = require('express');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { calculateNewRatings } = require('../utils/elo');
const router = express.Router();

router.use(authenticateToken);

/**
 * Get game details
 * GET /api/game/:id
 */
router.get('/:id', (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;

  db.get(`
    SELECT g.*,
           wp.first_name || ' ' || wp.last_name as white_player_name,
           bp.first_name || ' ' || bp.last_name as black_player_name,
           wp.elo_rating as white_elo,
           bp.elo_rating as black_elo,
           t.name as tournament_name,
           t.time_control_minutes,
           t.time_increment_seconds
    FROM games g
    JOIN users wp ON g.white_player_id = wp.id
    JOIN users bp ON g.black_player_id = bp.id
    LEFT JOIN tournaments t ON g.tournament_id = t.id
    WHERE g.id = ?
  `, [gameId], (err, game) => {
    if (err || !game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if user is a player in this game
    if (game.white_player_id !== userId && game.black_player_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this game' });
    }

    // Get move history
    db.all(
      'SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC',
      [gameId],
      (err, moves) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to fetch moves' });
        }

        res.json({
          game: {
            ...game,
            myColor: game.white_player_id === userId ? 'white' : 'black'
          },
          moves
        });
      }
    );
  });
});

/**
 * Make a move
 * POST /api/game/:id/move
 * This is called via Socket.io in real-time, but also available as REST endpoint
 */
router.post('/:id/move', (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;
  const { move, timeTaken, timeRemaining } = req.body;

  // Verify game exists and user is a player
  db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
    if (err || !game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.result !== 'ongoing') {
      return res.status(400).json({ error: 'Game is already finished' });
    }

    const isWhite = game.white_player_id === userId;
    const isBlack = game.black_player_id === userId;

    if (!isWhite && !isBlack) {
      return res.status(403).json({ error: 'Not a player in this game' });
    }

    // Record the move
    const moveNumber = game.move_count + 1;

    db.run(
      'INSERT INTO moves (game_id, move_number, player_id, move_san, time_taken_ms, time_remaining_ms) VALUES (?, ?, ?, ?, ?, ?)',
      [gameId, moveNumber, userId, move, timeTaken, timeRemaining],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to record move' });
        }

        // Update game
        const updateFields = ['move_count = move_count + 1'];
        const updateParams = [];

        if (isWhite) {
          updateFields.push('white_time_remaining = ?');
          updateParams.push(timeRemaining);
        } else {
          updateFields.push('black_time_remaining = ?');
          updateParams.push(timeRemaining);
        }

        updateParams.push(gameId);

        db.run(
          `UPDATE games SET ${updateFields.join(', ')} WHERE id = ?`,
          updateParams,
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Failed to update game' });
            }

            res.json({ message: 'Move recorded successfully' });
          }
        );
      }
    );
  });
});

/**
 * End game (resign, timeout, or checkmate)
 * POST /api/game/:id/end
 */
router.post('/:id/end', (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;
  const { result, reason, pgn } = req.body; // result: 'white_win', 'black_win', 'draw'

  db.get(`
    SELECT g.*, t.use_elo
    FROM games g
    LEFT JOIN tournaments t ON g.tournament_id = t.id
    WHERE g.id = ?
  `, [gameId], (err, game) => {
    if (err || !game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.result !== 'ongoing') {
      return res.status(400).json({ error: 'Game is already finished' });
    }

    // Update game result
    db.run(
      'UPDATE games SET result = ?, pgn = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
      [result, pgn, gameId],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to end game' });
        }

        // Update tournament standings if applicable
        if (game.tournament_id) {
          updateTournamentStandings(game.tournament_id, gameId, result);
        }

        // Update ELO ratings if enabled
        if (game.use_elo && result !== 'forfeited') {
          updateEloRatings(gameId, game.white_player_id, game.black_player_id, result);
        }

        res.json({ message: 'Game ended successfully' });
      }
    );
  });
});

/**
 * Helper: Update tournament standings
 */
function updateTournamentStandings(tournamentId, gameId, result) {
  db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
    if (err) return;

    db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
      if (err) return;

      const winPoints = tournament.win_points;
      const drawPoints = tournament.draw_points;
      const lossPoints = tournament.loss_points;

      let whitePoints = 0, blackPoints = 0;
      let whiteWin = 0, blackWin = 0;
      let whiteDraw = 0, blackDraw = 0;
      let whiteLoss = 0, blackLoss = 0;

      if (result === 'white_win') {
        whitePoints = winPoints;
        blackPoints = lossPoints;
        whiteWin = 1;
        blackLoss = 1;
      } else if (result === 'black_win') {
        whitePoints = lossPoints;
        blackPoints = winPoints;
        blackWin = 1;
        whiteLoss = 1;
      } else if (result === 'draw') {
        whitePoints = drawPoints;
        blackPoints = drawPoints;
        whiteDraw = 1;
        blackDraw = 1;
      }

      // Update white player
      db.run(`
        UPDATE tournament_participants
        SET total_score = total_score + ?,
            games_played = games_played + 1,
            wins = wins + ?,
            draws = draws + ?,
            losses = losses + ?
        WHERE tournament_id = ? AND user_id = ?
      `, [whitePoints, whiteWin, whiteDraw, whiteLoss, tournamentId, game.white_player_id]);

      // Update black player
      db.run(`
        UPDATE tournament_participants
        SET total_score = total_score + ?,
            games_played = games_played + 1,
            wins = wins + ?,
            draws = draws + ?,
            losses = losses + ?
        WHERE tournament_id = ? AND user_id = ?
      `, [blackPoints, blackWin, blackDraw, blackLoss, tournamentId, game.black_player_id]);
    });
  });
}

/**
 * Helper: Update ELO ratings
 */
function updateEloRatings(gameId, whitePlayerId, blackPlayerId, result) {
  // Get current ratings
  db.get('SELECT elo_rating FROM users WHERE id = ?', [whitePlayerId], (err, whiteUser) => {
    if (err) return;

    db.get('SELECT elo_rating FROM users WHERE id = ?', [blackPlayerId], (err, blackUser) => {
      if (err) return;

      const ratings = calculateNewRatings(whiteUser.elo_rating, blackUser.elo_rating, result);

      // Update white player rating
      db.run('UPDATE users SET elo_rating = ? WHERE id = ?', [ratings.whiteRating, whitePlayerId]);

      // Update black player rating
      db.run('UPDATE users SET elo_rating = ? WHERE id = ?', [ratings.blackRating, blackPlayerId]);

      // Record in ELO history
      db.run(
        'INSERT INTO elo_history (user_id, game_id, old_rating, new_rating, rating_change) VALUES (?, ?, ?, ?, ?)',
        [whitePlayerId, gameId, whiteUser.elo_rating, ratings.whiteRating, ratings.whiteChange]
      );

      db.run(
        'INSERT INTO elo_history (user_id, game_id, old_rating, new_rating, rating_change) VALUES (?, ?, ?, ?, ?)',
        [blackPlayerId, gameId, blackUser.elo_rating, ratings.blackRating, ratings.blackChange]
      );
    });
  });
}

/**
 * Resign from game
 * POST /api/game/:id/resign
 */
router.post('/:id/resign', (req, res) => {
  const gameId = req.params.id;
  const userId = req.user.id;

  db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
    if (err || !game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.result !== 'ongoing') {
      return res.status(400).json({ error: 'Game is already finished' });
    }

    // Determine result based on who resigned
    const result = game.white_player_id === userId ? 'black_win' : 'white_win';

    // Call the end game logic
    req.body = { result, reason: 'resignation' };
    router.post('/:id/end')(req, res);
  });
});

module.exports = router;
