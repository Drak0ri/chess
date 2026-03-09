# IES Chess Club Portal

A real-time, multi-school chess platform for competitive school chess. Players can challenge each other online, join tournaments, track rankings, and improve their game — all from a browser with no installation required.

---

## Table of Contents

- [For Players](#for-players)
  - [Getting Started](#getting-started)
  - [Playing a Game](#playing-a-game)
  - [Competitions & Ladders](#competitions--ladders)
  - [Leaderboard](#leaderboard)
  - [Find a Player](#find-a-player)
  - [Chess Coach](#chess-coach)
  - [News](#news)
- [For Admins](#for-admins)
  - [Requesting Admin Access](#requesting-admin-access)
  - [Admin Dashboard Overview](#admin-dashboard-overview)
  - [Managing Schools](#managing-schools)
  - [Managing Competitions](#managing-competitions)
  - [Ladder (Knockout Tournaments)](#ladder-knockout-tournaments)
  - [News & Announcements](#news--announcements)
  - [Appearance & Theming](#appearance--theming)
  - [Game Integrity](#game-integrity)
  - [Audit Log](#audit-log)
  - [Settings](#settings)
  - [Super Admin Features](#super-admin-features)
- [Pages at a Glance](#pages-at-a-glance)
- [Technical Overview](#technical-overview)

---

## For Players

### Getting Started

1. Open the portal link provided by your school or teacher.
2. Select your **school**, **year**, and **class** from the dropdown menus.
3. Click **Enter Lobby** — a nickname (e.g. `Player 042`) is assigned to you automatically.

No account, password, or name entry is required.

> Your school link may include an access token in the URL. Use the link given to you by your teacher to ensure you are placed in the correct school.

---

### Playing a Game

From the lobby you can:

| Option | Description |
|--------|-------------|
| **Challenge a Player** | Select an online player from your school or another school and send a challenge |
| **Play vs Computer** | Choose a difficulty level (Beginner → Expert) and play against the built-in AI |
| **Accept a Challenge** | Incoming challenges appear automatically — click to accept |

**During a game:**
- Moves are made by clicking a piece then clicking the destination square.
- The clock counts down for the active player. Running out of time ends the game.
- Piece moves, captures, check, and checkmate all have sound effects.
- If you lose your connection briefly, you have a short grace period to reconnect before the game is forfeited.

**Game results** (win, draw, or loss) are recorded automatically and update your leaderboard stats.

---

### Competitions & Ladders

**Competitions** (`/comp.html`) are timed events that run for a set period. During an active competition, games you play count towards the competition standings. Competitions can be:

- **Live** — currently running, games count now
- **Upcoming** — scheduled to start soon
- **Paused** — temporarily suspended by an admin
- **Ended** — results are final

**Ladder Matches** (`/bracket.html`) are knockout elimination tournaments. Players are seeded into a bracket and progress by winning matches. Results update the bracket in real time.

---

### Leaderboard

`/leaderboard.html` shows live rankings for all players and schools.

- Filter by school or view the overall standings.
- Stats shown include: wins, losses, draws, and points.
- Rankings update automatically as games are completed.

---

### Find a Player

`/findaplayer.html` shows a calendar-style view of when each school is scheduled to be online and available to play. Use this to plan when to look for opponents from other schools.

---

### Chess Coach

`/coach.html` is an interactive coaching tool to help you improve.

- Work through chess **puzzles** at your own pace.
- Review classic positions with on-screen guidance.
- Analyse positions with AI-powered feedback.

This area is for practice and learning — games here do not count towards your leaderboard stats.

---

### News

`/chess_news.html` displays the latest announcements and updates from your school admins. Check here for competition dates, rule changes, and other club news.

---

## For Admins

Admin access is managed through `/admin.html`. You must be logged in with an authorised admin account to use these features.

### Requesting Admin Access

If you are a teacher or club organiser and need admin access:

1. Open `/admin.html`.
2. Click **Request Admin Access**.
3. Enter your school email address.
4. Your request will be reviewed by a super admin. If approved, your account will be linked to your school automatically based on your email domain.

---

### Admin Dashboard Overview

The admin panel is divided into sections accessible from the navigation menu:

| Section | Purpose |
|---------|---------|
| **Dashboard** | Overview of active players, ongoing games, and portal status |
| **Competitions** | Create and manage timed competition events |
| **Ladder** | Set up and manage knockout tournament brackets |
| **Schools** | Configure school details, years, classes, and access tokens |
| **Appearance** | Customise the look and feel of the portal for your school |
| **News** | Post announcements visible to all players |
| **Integrity** | Review flagged games and check move histories |
| **Audit Log** | Full log of admin actions across the platform |
| **Settings** | Platform-wide settings |

---

### Managing Schools

Under **Schools** you can:

- Add or edit school names.
- Configure the **year groups** and **classes** available to players at login.
- Set the **access token** used in school-specific portal URLs — share this link with your students, not the raw token.
- Enable or disable a school's access to the portal.
- Set the school's **play availability schedule** (days and times when students can be online).

> Keep your school's access token confidential. Anyone with the link can join as a player from that school.

---

### Managing Competitions

Under **Competitions** you can:

- **Create** a new competition with a name, start time, and end time.
- **Pause** a running competition to temporarily freeze standings.
- **End** a competition early if needed.
- View which schools and players are participating.

Competitions run on a schedule — games played outside the competition window do not count towards competition standings.

---

### Ladder (Knockout Tournaments)

Under **Ladder** you can:

- Create a new **knockout bracket** for a set of players or schools.
- View the current bracket and match results.
- The bracket updates automatically as match results are submitted.

---

### News & Announcements

Under **News** you can:

- Write and publish announcements visible on the `/chess_news.html` page.
- Edit or remove existing announcements.

---

### Appearance & Theming

Under **Appearance** you can customise the portal for your school:

- **Colours** — primary and accent colours for buttons, headers, and highlights.
- **Fonts** — choose display fonts for the portal.
- **Piece style** — select the chess piece graphic set.

Changes apply to your school's view of the portal only and take effect immediately.

---

### Game Integrity

Under **Integrity** you can:

- View games that have been flagged for review.
- Inspect the full **move history** of any completed game.
- Review timing data for suspicious patterns.

This section is for reviewing potential rule violations — it does not automatically penalise players.

---

### Audit Log

The **Audit Log** records all significant admin actions on the platform, including:

- Competition created, paused, or ended
- School settings changed
- News posted or removed
- Admin access granted or revoked

This log is read-only and is intended for accountability and troubleshooting.

---

### Settings

Under **Settings** you can:

- **Open or close the portal** — when closed, students cannot log in or start games.
- Toggle **smooth piece animation** on or off platform-wide.

---

### Super Admin Features

Super admins have access to all schools and all settings. Additional capabilities include:

- **School impersonation** — view the portal as if you were an admin for a specific school, useful for troubleshooting.
- **Grant or revoke admin access** for teachers across any school.
- **Review admin access requests** from new teachers.

Super admin status is assigned manually and is not requestable through the portal.

---

## Pages at a Glance

| URL | Who uses it | Description |
|-----|-------------|-------------|
| `/index.html` | Players | Main game portal — login, lobby, and chess board |
| `/admin.html` | Admins | Full admin management dashboard |
| `/coach.html` | Players | Interactive chess coaching and puzzles |
| `/comp.html` | Players | Browse current and upcoming competitions |
| `/bracket.html` | Players | View knockout ladder brackets and results |
| `/leaderboard.html` | Players | Live player and school rankings |
| `/findaplayer.html` | Players | School availability calendar |
| `/chess_news.html` | Players | Announcements and club news |

---

## Technical Overview

This section is for developers or technical admins maintaining the platform.

- **Architecture:** Static HTML/CSS/JavaScript — no server-side build step required.
- **Backend:** Firebase Realtime Database for game state, player stats, and configuration. Firebase Authentication for admin accounts.
- **Chess engine:** Fully embedded in the frontend — no external chess library dependency.
- **AI opponents:** Multi-difficulty bot logic built into the frontend (Beginner through Expert).
- **Audio:** Procedurally generated sound effects using the Web Audio API — no audio files to host.
- **Deployment:** Serve the files from any static host (GitHub Pages, Netlify, Vercel, or a standard web server). HTTPS is recommended.
- **No build tools required:** All pages work directly from the file system when served over HTTP.

**To run locally:**
```bash
# Any simple HTTP server works, for example:
python -m http.server 8000
# Then open http://localhost:8000/index.html
```

**Firebase configuration** is held in `js/firebase-init.js`. Firebase security rules govern what data each user role can read or write — do not remove or loosen these rules.
