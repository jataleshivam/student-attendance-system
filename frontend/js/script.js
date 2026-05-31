/* ============================================
   Student Attendance System - Core JavaScript
   Auth Guard | Session Management | Utilities
   ============================================ */

// ============================================
// AUTH GUARD - Protect dashboard pages
// ============================================
function requireAuth() {
  const token = sessionStorage.getItem('token');
  if (!token) {
    window.location.replace('/login.html');
    return false;
  }
  preventBackNavigation(); // Auto-added
  // Verify token with server
  fetch('/api/auth/verify-token', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(res => {
    if (!res.ok) {
      sessionStorage.clear();
      window.location.replace('/login.html');
    }
  }).catch(() => {
    sessionStorage.clear();
    window.location.replace('/login.html');
  });
  return true;
}

// ============================================
// SESSION TIMEOUT - Auto logout after 10 min
// ============================================
let sessionTimer = null;
const SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

function initSessionTimeout() {
  resetSessionTimer();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetSessionTimer, { passive: true });
  });
}

function resetSessionTimer() {
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    showToast('Session expired due to inactivity.', 'error');
    setTimeout(() => logout(), 1500);
  }, SESSION_TIMEOUT);
}

// ============================================
// PREVENT BACK NAVIGATION after logout
// ============================================
function preventBackNavigation() {
  window.history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', function () {
    if (!sessionStorage.getItem('token')) {
      window.location.replace('/login.html');
    } else {
      window.history.pushState(null, '', window.location.href);
    }
  });
}

// ============================================
// LOGOUT
// ============================================
function logout() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('pendingEmail');
  sessionStorage.removeItem('resetEmail');
  // Prevent back navigation
  window.location.replace('/login.html');
}

// ============================================
// AUTH FETCH - Wrapper with JWT header
// ============================================
async function authFetch(url, options = {}) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    window.location.replace('/login.html');
    throw new Error('No token');
  }

  const headers = options.headers || {};
  headers['Authorization'] = 'Bearer ' + token;
  options.headers = headers;

  const response = await fetch(url, options);

  if (response.status === 401) {
    sessionStorage.clear();
    window.location.replace('/login.html');
    throw new Error('Unauthorized');
  }

  return response;
}

// ============================================
// LOAD USER INFO
// ============================================
function loadUserInfo() {
  const user = JSON.parse(sessionStorage.getItem('user') || '{}');
  const nameEl = document.getElementById('adminName');
  const usernameEl = document.getElementById('headerUsername');
  const emailEl = document.getElementById('headerEmail');
  const avatarEl = document.getElementById('userAvatar');

  if (nameEl) nameEl.textContent = user.username || 'Admin';
  if (usernameEl) usernameEl.textContent = user.username || 'Admin';
  if (emailEl) emailEl.textContent = user.email || '';
  if (avatarEl) avatarEl.textContent = (user.username || 'A').charAt(0).toUpperCase();
}

// ============================================
// SIDEBAR TOGGLE (Mobile)
// ============================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ============================================
// MESSAGE DISPLAY
// ============================================
function showMessage(element, text, type) {
  if (!element) return;
  element.textContent = text;
  element.className = 'message show ' + type;
  setTimeout(() => { element.classList.remove('show'); }, 5000);
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = { success: '', error: '', info: '' };
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => { toast.remove(); }, 4000);
}

// ============================================
// OTP INPUT HELPERS
// ============================================
function setupOTPInputs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const inputs = container.querySelectorAll('.otp-input');

  inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val;
      if (val && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').replace(/[^0-9]/g, '');
      for (let i = 0; i < Math.min(pasteData.length, inputs.length); i++) {
        inputs[i].value = pasteData[i];
      }
      const nextIndex = Math.min(pasteData.length, inputs.length - 1);
      inputs[nextIndex].focus();
    });
  });

  if (inputs[0]) inputs[0].focus();
}

function getOTPValue(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return '';
  const inputs = container.querySelectorAll('.otp-input');
  return Array.from(inputs).map(i => i.value).join('');
}

// ============================================
// PASSWORD TOGGLE
// ============================================
function togglePassword(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}
