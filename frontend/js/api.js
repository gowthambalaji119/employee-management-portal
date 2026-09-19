// ============================================================
// Employee Management Portal - API Helper
// ============================================================

const API_BASE = '/api';

/**
 * Common API request handler
 */
async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body = undefined,
  } = options;

  try {
    const response = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Try to read JSON response
    let data = null;

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
    } else {
      try {
        const text = await response.text();
        data = text ? { message: text } : null;
      } catch (error) {
        data = null;
      }
    }

    // Handle HTTP errors
    if (!response.ok) {
      const message =
        (data && data.error) ||
        (data && data.message) ||
        `Request failed (${response.status})`;

      const error = new Error(message);

      error.status = response.status;
      error.details = data && data.details;
      error.data = data;

      throw error;
    }

    return data;
  } catch (error) {
    // Network/server error
    if (error instanceof TypeError) {
      const networkError = new Error(
        'Unable to connect to the server. Please make sure the backend is running.'
      );

      networkError.status = 0;
      networkError.originalError = error;

      throw networkError;
    }

    throw error;
  }
}


// ============================================================
// API METHODS
// ============================================================

window.api = {
  get(path) {
    return apiRequest(path, {
      method: 'GET',
    });
  },

  post(path, body = undefined) {
    return apiRequest(path, {
      method: 'POST',
      body,
    });
  },

  put(path, body = undefined) {
    return apiRequest(path, {
      method: 'PUT',
      body,
    });
  },

  patch(path, body = undefined) {
    return apiRequest(path, {
      method: 'PATCH',
      body,
    });
  },

  del(path) {
    return apiRequest(path, {
      method: 'DELETE',
    });
  },
};


// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function ensureToastStack() {
  let stack = document.querySelector('.toast-stack');

  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';

    document.body.appendChild(stack);
  }

  return stack;
}


function toast(message, type = 'info', timeout = 3500) {
  const stack = ensureToastStack();

  const el = document.createElement('div');

  el.className = `toast ${type}`;

  el.textContent = message;

  stack.appendChild(el);

  window.setTimeout(() => {
    if (el && el.parentNode) {
      el.remove();
    }
  }, timeout);
}


// ============================================================
// TIME FORMAT
// ============================================================

function fmtHMS(totalSeconds) {
  const seconds = Math.max(
    0,
    Math.floor(Number(totalSeconds) || 0)
  );

  const hours = Math.floor(seconds / 3600);

  const minutes = Math.floor(
    (seconds % 3600) / 60
  );

  const secs = seconds % 60;

  return [hours, minutes, secs]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}


// ============================================================
// DATE / TIME FORMAT
// ============================================================

function fmtTime(iso) {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}


function fmtDate(iso) {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}


// ============================================================
// USER INITIALS
// ============================================================

function initials(name) {
  if (!name) {
    return '?';
  }

  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}


// ============================================================
// STATUS BADGE
// ============================================================

function statusBadge(status) {
  const map = {
    ONLINE: ['status-online', 'ONLINE'],
    ON_BREAK: ['status-break', 'ON BREAK'],
    OFFLINE: ['status-offline', 'OFFLINE'],
  };

  const normalizedStatus = String(status || 'OFFLINE')
    .trim()
    .toUpperCase();

  const [className, label] =
    map[normalizedStatus] || map.OFFLINE;

  return `
    <span class="status-badge ${className}">
      <span class="dot"></span>
      ${label}
    </span>
  `;
}


// ============================================================
// THEME
// ============================================================

function initTheme() {
  try {
    const savedTheme =
      localStorage.getItem('emp-portal-theme');

    if (savedTheme === 'dark') {
      document.documentElement.setAttribute(
        'data-theme',
        'dark'
      );
    } else {
      document.documentElement.removeAttribute(
        'data-theme'
      );
    }
  } catch (error) {
    console.warn('Theme initialization failed:', error);
  }
}


function toggleTheme() {
  const isDark =
    document.documentElement.getAttribute('data-theme') ===
    'dark';

  try {
    if (isDark) {
      document.documentElement.removeAttribute(
        'data-theme'
      );

      localStorage.setItem(
        'emp-portal-theme',
        'light'
      );
    } else {
      document.documentElement.setAttribute(
        'data-theme',
        'dark'
      );

      localStorage.setItem(
        'emp-portal-theme',
        'dark'
      );
    }
  } catch (error) {
    console.warn('Theme change failed:', error);
  }
}


// ============================================================
// INITIALIZE THEME
// ============================================================

initTheme();