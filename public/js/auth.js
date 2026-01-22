// Authentication handling
const API_URL = window.location.origin;

// Get DOM elements
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterLink = document.getElementById('showRegister');
const showLoginLink = document.getElementById('showLogin');
const messageDiv = document.getElementById('message');

// Toggle between login and register forms
showRegisterLink.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.style.display = 'none';
  registerForm.style.display = 'block';
  messageDiv.innerHTML = '';
  messageDiv.className = 'message';
});

showLoginLink.addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.style.display = 'none';
  loginForm.style.display = 'block';
  messageDiv.innerHTML = '';
  messageDiv.className = 'message';
});

// Handle login
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {
      // Store token
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Show success message
      showMessage('Login successful! Redirecting...', 'success');

      // Redirect based on role
      setTimeout(() => {
        if (data.user.role === 'super_admin' || data.user.role === 'school_admin') {
          window.location.href = '/admin';
        } else {
          window.location.href = '/student';
        }
      }, 1000);
    } else {
      showMessage(data.error || 'Login failed', 'error');
    }
  } catch (error) {
    showMessage('Network error. Please try again.', 'error');
  }
});

// Handle registration
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('registerEmail').value;
  const password = document.getElementById('registerPassword').value;
  const yearGroup = parseInt(document.getElementById('yearGroup').value);

  try {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password, yearGroup })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('Registration successful! Please login.', 'success');

      // Switch to login form after 2 seconds
      setTimeout(() => {
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        document.getElementById('loginEmail').value = email;
      }, 2000);
    } else {
      showMessage(data.error || 'Registration failed', 'error');
    }
  } catch (error) {
    showMessage('Network error. Please try again.', 'error');
  }
});

// Helper function to show messages
function showMessage(message, type) {
  messageDiv.innerHTML = message;
  messageDiv.className = `message ${type}`;
}

// Check if already logged in
const token = localStorage.getItem('token');
if (token) {
  const user = JSON.parse(localStorage.getItem('user'));
  if (user.role === 'super_admin' || user.role === 'school_admin') {
    window.location.href = '/admin';
  } else {
    window.location.href = '/student';
  }
}
