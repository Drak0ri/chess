require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { db, initializeDatabase } = require('./config/database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : '*',
    credentials: true
  }
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for chess board
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const studentRoutes = require('./routes/student');
const gameRoutes = require('./routes/game');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/game', gameRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/student.html'));
});

app.get('/game/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/game.html'));
});

// Socket.io for real-time chess
const activeGames = new Map(); // gameId -> { players: [socketId1, socketId2], gameState: {...} }

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.userId);

  // Join game room
  socket.on('join-game', (gameId) => {
    socket.join(`game-${gameId}`);
    console.log(`User ${socket.userId} joined game ${gameId}`);

    // Get game details
    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
      if (err || !game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Verify user is a player
      if (game.white_player_id !== socket.userId && game.black_player_id !== socket.userId) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      // Initialize game state if needed
      if (!activeGames.has(gameId)) {
        activeGames.set(gameId, {
          players: [],
          whiteSocketId: null,
          blackSocketId: null
        });
      }

      const gameState = activeGames.get(gameId);

      if (game.white_player_id === socket.userId) {
        gameState.whiteSocketId = socket.id;
      } else {
        gameState.blackSocketId = socket.id;
      }

      if (!gameState.players.includes(socket.id)) {
        gameState.players.push(socket.id);
      }

      // Notify both players
      io.to(`game-${gameId}`).emit('player-joined', {
        playerId: socket.userId,
        playersConnected: gameState.players.length
      });

      // Send current game state
      db.all('SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC', [gameId], (err, moves) => {
        socket.emit('game-state', {
          game,
          moves: moves || []
        });
      });
    });
  });

  // Handle chess move
  socket.on('make-move', ({ gameId, move, fen, pgn, timeTaken, timeRemaining }) => {
    db.get('SELECT * FROM games WHERE id = ?', [gameId], (err, game) => {
      if (err || !game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (game.result !== 'ongoing') {
        socket.emit('error', { message: 'Game is already finished' });
        return;
      }

      const isWhite = game.white_player_id === socket.userId;
      const isBlack = game.black_player_id === socket.userId;

      if (!isWhite && !isBlack) {
        socket.emit('error', { message: 'Not authorized' });
        return;
      }

      const moveNumber = game.move_count + 1;

      // Record move in database
      db.run(
        'INSERT INTO moves (game_id, move_number, player_id, move_san, time_taken_ms, time_remaining_ms) VALUES (?, ?, ?, ?, ?, ?)',
        [gameId, moveNumber, socket.userId, move.san, timeTaken, timeRemaining],
        function(err) {
          if (err) {
            socket.emit('error', { message: 'Failed to record move' });
            return;
          }

          // Update game
          const updateFields = ['move_count = move_count + 1', 'pgn = ?'];
          const updateParams = [pgn];

          if (isWhite) {
            updateFields.push('white_time_remaining = ?');
            updateParams.push(timeRemaining);
          } else {
            updateFields.push('black_time_remaining = ?');
            updateParams.push(timeRemaining);
          }

          updateParams.push(gameId);

          db.run(`UPDATE games SET ${updateFields.join(', ')} WHERE id = ?`, updateParams, (err) => {
            if (err) {
              socket.emit('error', { message: 'Failed to update game' });
              return;
            }

            // Broadcast move to both players
            io.to(`game-${gameId}`).emit('move-made', {
              move,
              fen,
              pgn,
              playerId: socket.userId,
              timeRemaining,
              moveNumber
            });
          });
        }
      );
    });
  });

  // Handle game end
  socket.on('end-game', ({ gameId, result, reason, pgn }) => {
    db.get(`
      SELECT g.*, t.use_elo
      FROM games g
      LEFT JOIN tournaments t ON g.tournament_id = t.id
      WHERE g.id = ?
    `, [gameId], (err, game) => {
      if (err || !game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      if (game.result !== 'ongoing') {
        socket.emit('error', { message: 'Game already finished' });
        return;
      }

      // Update game
      db.run(
        'UPDATE games SET result = ?, pgn = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [result, pgn, gameId],
        (err) => {
          if (err) {
            socket.emit('error', { message: 'Failed to end game' });
            return;
          }

          // Broadcast game end
          io.to(`game-${gameId}`).emit('game-ended', {
            result,
            reason,
            pgn
          });

          // Update tournament standings and ELO
          if (game.tournament_id) {
            updateTournamentStandings(game.tournament_id, gameId, result, game);
          }

          if (game.use_elo && result !== 'forfeited') {
            updateEloRatings(gameId, game.white_player_id, game.black_player_id, result);
          }

          // Clean up active game
          activeGames.delete(gameId);
        }
      );
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.userId);

    // Clean up game states
    for (const [gameId, state] of activeGames.entries()) {
      const index = state.players.indexOf(socket.id);
      if (index > -1) {
        state.players.splice(index, 1);

        if (state.whiteSocketId === socket.id) {
          state.whiteSocketId = null;
        }
        if (state.blackSocketId === socket.id) {
          state.blackSocketId = null;
        }

        io.to(`game-${gameId}`).emit('player-disconnected', {
          playerId: socket.userId,
          playersConnected: state.players.length
        });

        // Remove game state if no players connected
        if (state.players.length === 0) {
          activeGames.delete(gameId);
        }
      }
    }
  });
});

// Helper functions (same as in game.js routes)
const { calculateNewRatings } = require('./utils/elo');

function updateTournamentStandings(tournamentId, gameId, result, game) {
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

    db.run(`
      UPDATE tournament_participants
      SET total_score = total_score + ?, games_played = games_played + 1,
          wins = wins + ?, draws = draws + ?, losses = losses + ?
      WHERE tournament_id = ? AND user_id = ?
    `, [whitePoints, whiteWin, whiteDraw, whiteLoss, tournamentId, game.white_player_id]);

    db.run(`
      UPDATE tournament_participants
      SET total_score = total_score + ?, games_played = games_played + 1,
          wins = wins + ?, draws = draws + ?, losses = losses + ?
      WHERE tournament_id = ? AND user_id = ?
    `, [blackPoints, blackWin, blackDraw, blackLoss, tournamentId, game.black_player_id]);
  });
}

function updateEloRatings(gameId, whitePlayerId, blackPlayerId, result) {
  db.get('SELECT elo_rating FROM users WHERE id = ?', [whitePlayerId], (err, whiteUser) => {
    if (err) return;

    db.get('SELECT elo_rating FROM users WHERE id = ?', [blackPlayerId], (err, blackUser) => {
      if (err) return;

      const ratings = calculateNewRatings(whiteUser.elo_rating, blackUser.elo_rating, result);

      db.run('UPDATE users SET elo_rating = ? WHERE id = ?', [ratings.whiteRating, whitePlayerId]);
      db.run('UPDATE users SET elo_rating = ? WHERE id = ?', [ratings.blackRating, blackPlayerId]);

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

// Initialize database and start server
const PORT = process.env.PORT || 3000;

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n=================================`);
      console.log(`Chess Tournament Portal Server`);
      console.log(`=================================`);
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`\nAccess the portal at:`);
      console.log(`  http://localhost:${PORT}`);
      console.log(`=================================\n`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    db.close();
    console.log('HTTP server closed');
  });
});
