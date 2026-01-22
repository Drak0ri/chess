const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'chess_portal.db');
const db = new sqlite3.Database(dbPath);

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

const initializeDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Schools table
      db.run(`
        CREATE TABLE IF NOT EXISTS schools (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          email_identifier TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          school_id INTEGER NOT NULL,
          year_group INTEGER CHECK(year_group >= 4 AND year_group <= 9),
          role TEXT CHECK(role IN ('student', 'school_admin', 'super_admin')) DEFAULT 'student',
          elo_rating INTEGER DEFAULT 1200,
          is_verified BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login DATETIME,
          FOREIGN KEY (school_id) REFERENCES schools(id)
        )
      `);

      // Tournaments table
      db.run(`
        CREATE TABLE IF NOT EXISTS tournaments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          tournament_type TEXT CHECK(tournament_type IN ('school_only', 'inter_school', 'individual', 'team')) NOT NULL,
          scoring_system TEXT CHECK(scoring_system IN ('standard', 'custom')) DEFAULT 'standard',
          win_points REAL DEFAULT 1.0,
          draw_points REAL DEFAULT 0.5,
          loss_points REAL DEFAULT 0.0,
          pairing_method TEXT CHECK(pairing_method IN ('swiss', 'round_robin', 'knockout', 'manual')) DEFAULT 'swiss',
          time_control_minutes INTEGER DEFAULT 10,
          time_increment_seconds INTEGER DEFAULT 0,
          year_group_restriction TEXT,
          school_restriction TEXT,
          min_participants INTEGER DEFAULT 2,
          max_participants INTEGER,
          rounds INTEGER DEFAULT 5,
          status TEXT CHECK(status IN ('draft', 'registration', 'active', 'completed', 'archived')) DEFAULT 'draft',
          registration_deadline DATETIME,
          start_date DATETIME,
          end_date DATETIME,
          use_elo BOOLEAN DEFAULT 1,
          created_by INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id)
        )
      `);

      // Tournament participants
      db.run(`
        CREATE TABLE IF NOT EXISTS tournament_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tournament_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          total_score REAL DEFAULT 0,
          games_played INTEGER DEFAULT 0,
          wins INTEGER DEFAULT 0,
          draws INTEGER DEFAULT 0,
          losses INTEGER DEFAULT 0,
          tiebreak_score REAL DEFAULT 0,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(tournament_id, user_id)
        )
      `);

      // Games table
      db.run(`
        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tournament_id INTEGER,
          white_player_id INTEGER NOT NULL,
          black_player_id INTEGER NOT NULL,
          round_number INTEGER,
          result TEXT CHECK(result IN ('white_win', 'black_win', 'draw', 'ongoing', 'forfeited')),
          pgn TEXT,
          move_count INTEGER DEFAULT 0,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME,
          white_time_remaining INTEGER,
          black_time_remaining INTEGER,
          flagged_suspicious BOOLEAN DEFAULT 0,
          FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
          FOREIGN KEY (white_player_id) REFERENCES users(id),
          FOREIGN KEY (black_player_id) REFERENCES users(id)
        )
      `);

      // Moves table (for anti-cheat analysis)
      db.run(`
        CREATE TABLE IF NOT EXISTS moves (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id INTEGER NOT NULL,
          move_number INTEGER NOT NULL,
          player_id INTEGER NOT NULL,
          move_san TEXT NOT NULL,
          time_taken_ms INTEGER,
          time_remaining_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          FOREIGN KEY (player_id) REFERENCES users(id)
        )
      `);

      // ELO history
      db.run(`
        CREATE TABLE IF NOT EXISTS elo_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          game_id INTEGER NOT NULL,
          old_rating INTEGER NOT NULL,
          new_rating INTEGER NOT NULL,
          rating_change INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
      `);

      // Create indexes
      db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
      db.run('CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_games_tournament ON games(tournament_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_games_players ON games(white_player_id, black_player_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_tournament_participants ON tournament_participants(tournament_id, user_id)');

      console.log('Database schema initialized successfully');
      resolve();
    });
  });
};

module.exports = { db, initializeDatabase };
