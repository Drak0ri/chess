// Admin Dashboard
const API_URL = window.location.origin;
let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user'));

// Check authentication and admin role
if (!token || !user || (user.role !== 'super_admin' && user.role !== 'school_admin')) {
  window.location.href = '/';
}

// Set user info
document.getElementById('userName').textContent = `${user.firstName} ${user.lastName} (${user.role.replace('_', ' ')})`;

// Logout
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

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    button.classList.add('active');
    document.getElementById(tabName).classList.add('active');

    loadTabData(tabName);
  });
});

// Load tab data
function loadTabData(tabName) {
  switch (tabName) {
    case 'overview':
      loadOverview();
      break;
    case 'tournaments':
      loadTournaments();
      break;
    case 'users':
      loadUsers();
      break;
  }
}

// Load overview stats
async function loadOverview() {
  try {
    const response = await fetch(`${API_URL}/api/admin/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      document.getElementById('totalUsers').textContent = data.stats.totalUsers;
      document.getElementById('totalTournaments').textContent = data.stats.totalTournaments;
      document.getElementById('totalGames').textContent = data.stats.totalGames;
      document.getElementById('activeGames').textContent = data.stats.activeGames;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load tournaments
async function loadTournaments() {
  try {
    const response = await fetch(`${API_URL}/api/admin/tournaments`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('tournamentsList');

      if (data.tournaments.length === 0) {
        container.innerHTML = '<p>No tournaments created yet</p>';
      } else {
        container.innerHTML = data.tournaments.map(tournament => `
          <div class="admin-card">
            <h4>${tournament.name}</h4>
            <div class="admin-card-meta">
              Status: ${tournament.status} | Type: ${tournament.tournament_type} |
              Participants: ${tournament.participant_count} | Rounds: ${tournament.rounds}
            </div>
            <p>${tournament.description || 'No description'}</p>
            <div class="admin-card-actions">
              <button class="btn btn-primary btn-small" onclick="editTournament(${tournament.id})">Edit</button>
              <button class="btn btn-secondary btn-small" onclick="viewTournamentDetails(${tournament.id})">Details</button>
              <button class="btn btn-danger btn-small" onclick="deleteTournament(${tournament.id})">Delete</button>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (error) {
    console.error('Error loading tournaments:', error);
  }
}

// Load users
async function loadUsers() {
  try {
    const response = await fetch(`${API_URL}/api/admin/users`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      const container = document.getElementById('usersList');

      container.innerHTML = `
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>School</th>
              <th>Year</th>
              <th>ELO</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.users.map(u => `
              <tr>
                <td>${u.first_name} ${u.last_name}</td>
                <td>${u.email}</td>
                <td>${u.school_name}</td>
                <td>${u.year_group}</td>
                <td>${u.elo_rating}</td>
                <td>${u.role}</td>
                <td>
                  <select onchange="updateUserRole(${u.id}, this.value)">
                    <option value="">Change role...</option>
                    <option value="student">Student</option>
                    <option value="school_admin">School Admin</option>
                    ${user.role === 'super_admin' ? '<option value="super_admin">Super Admin</option>' : ''}
                  </select>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

// Update user role
async function updateUserRole(userId, newRole) {
  if (!newRole) return;

  if (!confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: newRole })
    });

    const data = await response.json();

    if (response.ok) {
      alert('User role updated successfully');
      loadUsers();
    } else {
      alert(data.error || 'Failed to update user role');
    }
  } catch (error) {
    alert('Network error. Please try again.');
  }
}

// Delete tournament
async function deleteTournament(tournamentId) {
  if (!confirm('Are you sure you want to delete this tournament? This cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/admin/tournaments/${tournamentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();

    if (response.ok) {
      alert('Tournament deleted successfully');
      loadTournaments();
    } else {
      alert(data.error || 'Failed to delete tournament');
    }
  } catch (error) {
    alert('Network error. Please try again.');
  }
}

// View tournament details
async function viewTournamentDetails(tournamentId) {
  alert('Tournament details view coming soon!');
  // TODO: Implement detailed tournament view with participants and games
}

// Edit tournament
async function editTournament(tournamentId) {
  alert('Tournament editing coming soon!');
  // TODO: Implement tournament editing
}

// Custom scoring toggle
document.getElementById('scoringSystem').addEventListener('change', (e) => {
  const customScoring = document.getElementById('customScoring');
  if (e.target.value === 'custom') {
    customScoring.style.display = 'block';
  } else {
    customScoring.style.display = 'none';
  }
});

// Create tournament form
document.getElementById('createTournamentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const data = {};

  // Convert form data to object
  formData.forEach((value, key) => {
    if (value !== '') {
      data[key] = value;
    }
  });

  // Convert numeric fields
  if (data.timeControlMinutes) data.timeControlMinutes = parseInt(data.timeControlMinutes);
  if (data.timeIncrementSeconds) data.timeIncrementSeconds = parseInt(data.timeIncrementSeconds);
  if (data.minParticipants) data.minParticipants = parseInt(data.minParticipants);
  if (data.maxParticipants) data.maxParticipants = parseInt(data.maxParticipants);
  if (data.rounds) data.rounds = parseInt(data.rounds);
  if (data.winPoints) data.winPoints = parseFloat(data.winPoints);
  if (data.drawPoints) data.drawPoints = parseFloat(data.drawPoints);
  if (data.lossPoints) data.lossPoints = parseFloat(data.lossPoints);

  // Convert checkbox
  data.useElo = document.getElementById('useElo').checked;

  try {
    const response = await fetch(`${API_URL}/api/admin/tournaments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (response.ok) {
      alert('Tournament created successfully!');
      e.target.reset();

      // Switch to tournaments tab
      document.querySelector('[data-tab="tournaments"]').click();
    } else {
      alert(result.error || 'Failed to create tournament');
    }
  } catch (error) {
    alert('Network error. Please try again.');
  }
});

// Reset form
document.getElementById('resetForm').addEventListener('click', () => {
  document.getElementById('createTournamentForm').reset();
});

// Initial load
loadOverview();
