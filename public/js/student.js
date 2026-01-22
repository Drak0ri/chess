// Student Dashboard
const API_URL = window.location.origin;
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));

// Check authentication
if (!token || !user) {
  window.location.href = '/';
}

// Set user info in navbar
document.getElementById('userName').textContent = `${user.firstName} ${user.lastName}`;
document.getElementById('userElo').textContent = `ELO: ${user.eloRating}`;
document.getElementById('dashUserName').textContent = user.firstName;

// Logout handler
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
});

// Tab switching
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const tabName = button.dataset.tab;

    // Update active states
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    button.classList.add('active');
    document.getElementById(tabName).classList.add('active');

    // Load tab data
    loadTabData(tabName);
  });
});

// Load tab data
function loadTabData(tabName) {
  switch (tabName) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'tournaments':
      loadTournaments();
      break;
    case 'games':
      loadGames('all');
      break;
    case 'leaderboard':
      loadLeaderboard('global');
      break;
  }
}

// Load dashboard
async function loadDashboard() {
  try {
    const response = await fetch(`${API_URL}/api/student/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      // Update stats
      document.getElementById('statElo').textContent = data.user.eloRating;
      document.getElementById('statGames').textContent = data.stats.totalGames;
      document.getElementById('statWins').textContent = data.stats.wins;
      document.getElementById('statWinRate').textContent = `${data.stats.winRate}%`;

      // Load active games
      loadActiveGames();

      // Display ELO history
      displayEloHistory(data.eloHistory);
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Load active games
async function loadActiveGames() {
  try {
    const response = await fetch(`${API_URL}/api/student/games?status=ongoing`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('activeGames');

      if (data.games.length === 0) {
        container.innerHTML = '<p>No active games</p>';
      } else {
        container.innerHTML = data.games.map(game => `
          <div class="game-card">
            <div class="game-card-info">
              <h4>vs ${game.opponentName}</h4>
              <p>Playing as ${game.myColor}</p>
            </div>
            <button class="btn btn-primary" onclick="goToGame(${game.id})">Continue</button>
          </div>
        `).join('');
      }
    }
  } catch (error) {
    console.error('Error loading active games:', error);
  }
}

// Display ELO history
function displayEloHistory(history) {
  const container = document.getElementById('eloHistory');

  if (history.length === 0) {
    container.innerHTML = '<p>No ELO history yet</p>';
  } else {
    container.innerHTML = history.map(entry => {
      const change = entry.rating_change;
      const changeClass = change > 0 ? 'elo-up' : 'elo-down';
      const changeSymbol = change > 0 ? '+' : '';

      return `
        <div class="elo-change">
          <span>${entry.old_rating} → ${entry.new_rating}</span>
          <span class="${changeClass}">${changeSymbol}${change}</span>
        </div>
      `;
    }).join('');
  }
}

// Load tournaments
async function loadTournaments() {
  try {
    const response = await fetch(`${API_URL}/api/student/tournaments`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('tournamentsList');

      if (data.tournaments.length === 0) {
        container.innerHTML = '<p>No tournaments available</p>';
      } else {
        container.innerHTML = data.tournaments.map(tournament => `
          <div class="tournament-card">
            <h3>${tournament.name}</h3>
            <p>${tournament.description || 'No description'}</p>
            <div class="tournament-meta">
              <span>Type: ${tournament.tournament_type.replace('_', ' ')}</span>
              <span>Participants: ${tournament.participant_count}/${tournament.max_participants || '∞'}</span>
              <span>Rounds: ${tournament.rounds}</span>
            </div>
            <div class="tournament-actions">
              ${tournament.is_registered
                ? '<span class="status-badge">Registered</span>'
                : tournament.status === 'registration'
                  ? `<button class="btn btn-primary" onclick="registerTournament(${tournament.id})">Register</button>`
                  : `<span>Status: ${tournament.status}</span>`
              }
            </div>
          </div>
        `).join('');
      }
    }
  } catch (error) {
    console.error('Error loading tournaments:', error);
  }
}

// Register for tournament
async function registerTournament(tournamentId) {
  try {
    const response = await fetch(`${API_URL}/api/student/tournaments/${tournamentId}/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      alert('Successfully registered for tournament!');
      loadTournaments();
    } else {
      alert(data.error || 'Failed to register');
    }
  } catch (error) {
    alert('Network error. Please try again.');
  }
}

// Load games
async function loadGames(filter) {
  try {
    const url = filter === 'all'
      ? `${API_URL}/api/student/games`
      : `${API_URL}/api/student/games?status=${filter}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('gamesList');

      if (data.games.length === 0) {
        container.innerHTML = '<p>No games found</p>';
      } else {
        container.innerHTML = data.games.map(game => {
          let statusBadge, statusClass;

          if (game.result === 'ongoing') {
            statusBadge = 'Ongoing';
            statusClass = 'status-ongoing';
          } else if (game.result === 'white_win') {
            if (game.myColor === 'white') {
              statusBadge = 'Won';
              statusClass = 'status-won';
            } else {
              statusBadge = 'Lost';
              statusClass = 'status-lost';
            }
          } else if (game.result === 'black_win') {
            if (game.myColor === 'black') {
              statusBadge = 'Won';
              statusClass = 'status-won';
            } else {
              statusBadge = 'Lost';
              statusClass = 'status-lost';
            }
          } else {
            statusBadge = 'Draw';
            statusClass = 'status-draw';
          }

          return `
            <div class="game-card">
              <div class="game-card-info">
                <h4>vs ${game.opponentName}</h4>
                <p>${game.tournament_name || 'Casual game'} • Playing as ${game.myColor}</p>
              </div>
              <div>
                <span class="game-status-badge ${statusClass}">${statusBadge}</span>
                ${game.result === 'ongoing'
                  ? `<button class="btn btn-primary btn-small" onclick="goToGame(${game.id})">Continue</button>`
                  : `<button class="btn btn-secondary btn-small" onclick="goToGame(${game.id})">View</button>`
                }
              </div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (error) {
    console.error('Error loading games:', error);
  }
}

// Game filter buttons
const gameFilterButtons = document.querySelectorAll('.game-filters .filter-btn');
gameFilterButtons.forEach(button => {
  button.addEventListener('click', () => {
    const filter = button.dataset.filter;
    gameFilterButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    loadGames(filter);
  });
});

// Load leaderboard
async function loadLeaderboard(scope) {
  try {
    const response = await fetch(`${API_URL}/api/student/leaderboard?scope=${scope}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('leaderboardTable');

      if (data.leaderboard.length === 0) {
        container.innerHTML = '<p>No data available</p>';
      } else {
        const table = `
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>School</th>
                <th>Year</th>
                <th>ELO</th>
                <th>Games</th>
                <th>W/D/L</th>
              </tr>
            </thead>
            <tbody>
              ${data.leaderboard.map((player, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
                const isMe = player.id === user.id ? 'style="background: #fffbea;"' : '';

                return `
                  <tr ${isMe}>
                    <td><span class="rank-medal">${medal}</span>${index + 1}</td>
                    <td>${player.first_name} ${player.last_name}</td>
                    <td>${player.school_name}</td>
                    <td>Year ${player.year_group}</td>
                    <td><strong>${player.elo_rating}</strong></td>
                    <td>${player.games_played || 0}</td>
                    <td>${player.wins || 0}/${player.draws || 0}/${player.losses || 0}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;

        container.innerHTML = table;
      }
    }
  } catch (error) {
    console.error('Error loading leaderboard:', error);
  }
}

// Leaderboard filter buttons
const leaderboardFilterButtons = document.querySelectorAll('.leaderboard-filters .filter-btn');
leaderboardFilterButtons.forEach(button => {
  button.addEventListener('click', () => {
    const scope = button.dataset.scope;
    leaderboardFilterButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    loadLeaderboard(scope);
  });
});

// Navigate to game
function goToGame(gameId) {
  window.location.href = `/game/${gameId}`;
}

// Initial load
loadDashboard();
