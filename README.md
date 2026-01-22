# ♟️ Chess Tournament Portal

A comprehensive web-based chess tournament management system designed for schools. Students can play real-time chess games, participate in tournaments, track their ELO ratings, and compete with other schools.

## 🎯 Features

### For Students
- **Real-time Chess**: Play chess online with a beautiful interactive board
- **Tournament Participation**: Join and compete in school or inter-school tournaments
- **ELO Rating System**: Track your chess rating with official ELO calculations
- **Leaderboards**: View rankings globally, by school, or by year group
- **Game History**: Review all your past games with move history
- **Personal Statistics**: Track wins, losses, draws, and performance trends

### For Administrators
- **Tournament Creation**: Create flexible tournaments with customizable settings
- **Multiple Tournament Types**:
  - School-only competitions
  - Inter-school championships
  - Individual tournaments
  - Team-based events
- **Flexible Scoring Systems**:
  - Standard chess scoring (Win=1, Draw=0.5, Loss=0)
  - Custom point systems
- **Pairing Methods**:
  - Swiss System
  - Round Robin
  - Knockout
  - Manual pairing
- **Year Group Restrictions**: Limit tournaments to specific year groups (4-9)
- **Time Controls**: Set game duration and increment
- **User Management**: Assign roles and manage permissions

### Technical Features
- **Email-based Authentication**: Automatic school detection from email format
- **Real-time Updates**: Live game synchronization using Socket.io
- **Anti-cheating**: Move time tracking and pattern detection
- **Responsive Design**: Optimized for Chromebooks and desktop browsers
- **Historical Data**: Archive tournaments and maintain complete game history

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

## 🚀 Installation

1. **Clone the repository** (or download the files):
   ```bash
   cd iesv_chess
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file** with your settings:
   ```env
   PORT=3000
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   NODE_ENV=development
   DATABASE_PATH=./database/chess_portal.db
   ALLOWED_EMAIL_DOMAIN=engelska.se
   ```

   **⚠️ IMPORTANT**: Change `JWT_SECRET` to a strong random string in production!

5. **Initialize the database**:
   ```bash
   # Create database schema
   npm run init-db

   # Or create with test data
   npm run init-db -- --with-test-data
   ```

6. **Start the server**:
   ```bash
   # Development mode (with auto-reload)
   npm run dev

   # Production mode
   npm start
   ```

7. **Access the portal**:
   Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## 👥 Test Accounts

If you initialized with test data (`--with-test-data`), you can use these accounts:

**Super Admin:**
- Email: `admin.super.student.stockholm@engelska.se`
- Password: `admin123`

**Students:**
- Email: `john.doe.student.stockholm@engelska.se`
- Password: `student123`
- (Additional test students available - see initialization output)

## 📧 Email Format

All users must register with emails in this format:
```
firstname.lastname.student.school@engelska.se
```

**Examples:**
- `magnus.carlsen.student.stockholm@engelska.se`
- `anna.andersson.student.goteborg@engelska.se`

The system automatically:
- Extracts first name and last name
- Identifies the school from the email
- Creates school records as needed

## 🎮 Usage Guide

### For Students

1. **Register**:
   - Go to the portal homepage
   - Click "Register"
   - Enter your school email (correct format required)
   - Choose your password (min 6 characters)
   - Select your year group (4-9)

2. **Dashboard**:
   - View your ELO rating and statistics
   - See active games
   - Track your ELO history

3. **Join Tournaments**:
   - Go to "Tournaments" tab
   - Browse available tournaments
   - Click "Register" for tournaments you're eligible for

4. **Play Chess**:
   - Navigate to "My Games"
   - Click on an ongoing game
   - Drag and drop pieces to make moves
   - Timer counts down on your turn
   - Game automatically ends on checkmate/stalemate/timeout

5. **View Leaderboard**:
   - Check global rankings
   - Filter by school or year group
   - See tournament-specific standings

### For Administrators

1. **Access Admin Panel**:
   - Login with admin credentials
   - Automatically redirected to admin dashboard

2. **Create Tournament**:
   - Go to "Create Tournament" tab
   - Fill in tournament details:
     - **Name & Description**
     - **Type**: School-only, Inter-school, Individual, or Team
     - **Pairing Method**: Swiss, Round Robin, Knockout, or Manual
     - **Scoring System**: Standard or Custom points
     - **Time Controls**: Minutes per game + increment
     - **Eligibility**: Year group restrictions (e.g., "4,5,6" or leave empty for all)
     - **Rounds**: Number of rounds to play
     - **Schedule**: Start/end dates and registration deadline
   - Click "Create Tournament"

3. **Manage Tournaments**:
   - View all tournaments in "Tournaments" tab
   - Edit settings (status, participants, etc.)
   - Delete tournaments
   - View participant details

4. **Manage Users**:
   - View all registered users
   - Change user roles:
     - Student: Can play games and join tournaments
     - School Admin: Can create tournaments for their school
     - Super Admin: Full system access

## 🎯 Tournament Settings Explained

### Tournament Types
- **School Only**: Only students from one school can participate
- **Inter-School**: Students from multiple schools compete
- **Individual**: Players compete individually
- **Team**: Players represent their school as teams (combined scoring)

### Scoring Systems
- **Standard**: Win=1 point, Draw=0.5 points, Loss=0 points
- **Custom**: Set your own point values for wins/draws/losses

### Pairing Methods
- **Swiss System**: Players paired by similar scores (most balanced)
- **Round Robin**: Everyone plays everyone
- **Knockout**: Single elimination tournament
- **Manual**: Admin manually creates pairings

### Year Group Restrictions
- Leave empty for open tournament (all years 4-9)
- Enter comma-separated years: `4,5,6` for Years 4-6 only
- Single year: `7` for Year 7 only

### Time Controls
- **Time Control**: Minutes per player per game (e.g., 10 minutes)
- **Increment**: Seconds added after each move (e.g., 5 seconds)

## 🏆 ELO Rating System

The system uses the standard ELO rating system with:
- **Starting Rating**: 1200
- **K-Factor**: 32 (suitable for junior players)
- **Automatic Updates**: Ratings update after each rated game
- **History Tracking**: Complete ELO change history maintained

### How ELO Works:
- Beat a higher-rated player: Gain more points
- Beat a lower-rated player: Gain fewer points
- Lose to a higher-rated player: Lose fewer points
- Lose to a lower-rated player: Lose more points
- Draws: Small rating adjustments based on opponent's rating

## 🔒 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcrypt with salt rounds
- **Input Validation**: Server-side validation for all inputs
- **Email Domain Restriction**: Only allowed email domains accepted
- **SQL Injection Protection**: Parameterized queries
- **XSS Protection**: Helmet.js security headers

## 🛡️ Anti-Cheating Measures

The system includes several anti-cheating features:
- **Move Time Tracking**: Records time taken for each move
- **Pattern Detection**: Flags suspicious play patterns
- **Game Timeout**: Automatic forfeit after time expires
- **Move Validation**: Server-side chess rule enforcement

## 📊 Database Schema

The system uses SQLite with the following main tables:
- `schools`: School information
- `users`: Student and admin accounts
- `tournaments`: Tournament configurations
- `tournament_participants`: Registration and standings
- `games`: Chess game records
- `moves`: Individual move history
- `elo_history`: Rating change tracking

## 🔧 Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `JWT_SECRET` | (required) | Secret key for JWT tokens |
| `NODE_ENV` | development | Environment (development/production) |
| `DATABASE_PATH` | ./database/chess_portal.db | SQLite database file path |
| `ALLOWED_EMAIL_DOMAIN` | engelska.se | Allowed email domain |

## 📱 Browser Support

Optimized for:
- Chrome/Chromebook (primary target)
- Firefox
- Edge
- Safari

## 🐛 Troubleshooting

### Database errors
```bash
# Reset database
rm database/chess_portal.db
npm run init-db -- --with-test-data
```

### Port already in use
```bash
# Change PORT in .env file
PORT=3001
```

### Socket.io connection issues
- Check that the server is running
- Verify no firewall blocking WebSocket connections
- Check browser console for errors

## 📝 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout

### Student
- `GET /api/student/profile` - Get profile and stats
- `GET /api/student/tournaments` - Get available tournaments
- `POST /api/student/tournaments/:id/register` - Register for tournament
- `GET /api/student/games` - Get my games
- `GET /api/student/leaderboard` - Get leaderboard

### Admin
- `POST /api/admin/tournaments` - Create tournament
- `GET /api/admin/tournaments` - Get all tournaments
- `PUT /api/admin/tournaments/:id` - Update tournament
- `DELETE /api/admin/tournaments/:id` - Delete tournament
- `GET /api/admin/users` - Get all users
- `PUT /api/admin/users/:id/role` - Update user role

### Game
- `GET /api/game/:id` - Get game details
- `POST /api/game/:id/move` - Make a move
- `POST /api/game/:id/end` - End game
- `POST /api/game/:id/resign` - Resign game

## 🚀 Deployment

### Production Checklist
1. Set strong `JWT_SECRET` in `.env`
2. Set `NODE_ENV=production`
3. Use PostgreSQL instead of SQLite (recommended for production)
4. Enable HTTPS
5. Set up proper backup system
6. Configure firewall rules
7. Set up monitoring and logging

### PostgreSQL Migration
To use PostgreSQL instead of SQLite:
1. Install `pg` package: `npm install pg`
2. Update `server/config/database.js` to use PostgreSQL
3. Update connection string in `.env`

## 📞 Support

For issues, questions, or feature requests:
- Create a GitHub issue
- Contact the system administrator

## 📄 License

MIT License - See LICENSE file for details

## 🙏 Acknowledgments

- Chess logic: [chess.js](https://github.com/jhlywa/chess.js)
- Chess board UI: [chessboard.js](https://chessboardjs.com/)
- Real-time communication: [Socket.io](https://socket.io/)
- Backend: [Express.js](https://expressjs.com/)

---

**Built for educational chess competitions** ♟️

*Version 1.0.0*
