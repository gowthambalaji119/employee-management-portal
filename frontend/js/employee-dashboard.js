let CURRENT_USER = null;
let LIVE = { status: 'OFFLINE', workingSeconds: 0, breakSeconds: 0, serverTime: null, session: null };
let TICK_INTERVAL = null;
let SYNC_INTERVAL = null;
let HEARTBEAT_INTERVAL = null;
let ACTIVE_VIEW = 'dashboard';
let SOCKET = null;

const content = document.getElementById('content');
const viewTitle = document.getElementById('viewTitle');

// ---------- Boot ----------
(async function boot() {
  try {
    const { user } = await api.get('/auth/me');
    CURRENT_USER = user;
    if (user.role !== 'employee') {
      window.location.href = '/admin/dashboard.html';
      return;
    }
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = user.designation || 'Employee';
    document.getElementById('userAvatar').textContent = initials(user.name);

    connectSocket();
    await syncLiveState();
    startTimers();
    renderView('dashboard');
    refreshNotifBadge();
  } catch (err) {
    window.location.href = '/index.html';
  }
})();

function connectSocket() {
  SOCKET = io({ withCredentials: true });
  SOCKET.on('notification_created', (payload) => {
    toast(`${payload.title}: ${payload.message || ''}`, 'info');
    refreshNotifBadge();
    if (ACTIVE_VIEW === 'notifications') renderView('notifications');
  });
  SOCKET.on('employee_status_changed', (payload) => {
    if (payload.userId === CURRENT_USER.id) syncLiveState();
  });
  SOCKET.on('attendance_updated', (payload) => {
    if (payload.userId === CURRENT_USER.id && ACTIVE_VIEW === 'dashboard') renderView('dashboard');
  });
}

async function syncLiveState() {
  try {
    const data = await api.get('/session/current');
    LIVE = {
      status: data.status,
      workingSeconds: data.workingSeconds || 0,
      breakSeconds: data.breakSeconds || 0,
      serverTime: data.serverTime,
      session: data.session,
      _syncedAt: Date.now(),
    };
    updateTimerUI();
  } catch (err) { /* ignore transient errors */ }
}

function startTimers() {
  if (TICK_INTERVAL) clearInterval(TICK_INTERVAL);
  if (SYNC_INTERVAL) clearInterval(SYNC_INTERVAL);
  if (HEARTBEAT_INTERVAL) clearInterval(HEARTBEAT_INTERVAL);

  // Visual tick every second, interpolated from the last server sync.
  TICK_INTERVAL = setInterval(() => {
    if (!LIVE.session) return;
    const elapsed = Math.floor((Date.now() - LIVE._syncedAt) / 1000);
    let working = LIVE.workingSeconds;
    let brk = LIVE.breakSeconds;
    if (LIVE.status === 'ON_BREAK') brk += elapsed; else working += elapsed;
    renderTimerNumbers(working, brk);
  }, 1000);

  // Re-sync with the server (authoritative) every 15s.
  SYNC_INTERVAL = setInterval(syncLiveState, 15000);

  // Heartbeat every 25s to support session recovery detection.
  HEARTBEAT_INTERVAL = setInterval(() => {
    if (LIVE.session) api.post('/session/heartbeat').catch(() => {});
  }, 25000);
}

function updateTimerUI() {
  renderTimerNumbers(LIVE.workingSeconds, LIVE.breakSeconds);
  const statusEl = document.getElementById('liveStatusBadge');
  if (statusEl) statusEl.outerHTML = `<span id="liveStatusBadge">${statusBadge(LIVE.status)}</span>`;
  const startBreakBtn = document.getElementById('startBreakBtn');
  const endBreakBtn = document.getElementById('endBreakBtn');
  const startSessionBtn = document.getElementById('startSessionBtn');
  const logoutBtnHero = document.getElementById('logoutBtnHero');
  if (startBreakBtn && endBreakBtn) {
    const onBreak = LIVE.status === 'ON_BREAK';
    startBreakBtn.style.display = LIVE.session && !onBreak ? 'inline-flex' : 'none';
    endBreakBtn.style.display = LIVE.session && onBreak ? 'inline-flex' : 'none';
  }
  if (startSessionBtn) startSessionBtn.style.display = LIVE.session ? 'none' : 'inline-flex';
  if (logoutBtnHero) logoutBtnHero.style.display = LIVE.session ? 'inline-flex' : 'none';
}

function renderTimerNumbers(working, brk) {
  const w = document.getElementById('workingTimeVal');
  const b = document.getElementById('breakTimeVal');
  if (w) w.textContent = fmtHMS(working);
  if (b) b.textContent = fmtHMS(brk);
}

// ---------- Navigation ----------
const navGroup = document.getElementById('navGroup');

if (navGroup) {
  navGroup.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;

    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    item.classList.add('active');

    renderView(item.dataset.view);

    document.getElementById('sidebar')?.classList.remove('open');
  });
}

const titles = {
  dashboard: 'Dashboard', attendance: 'My Attendance', tasks: 'My Tasks',
  leave: 'Leave', notifications: 'Notifications', profile: 'Profile',
};

async function renderView(view) {
  ACTIVE_VIEW = view;
  viewTitle.textContent = titles[view] || view;
  content.innerHTML = '<div class="loading-spinner"></div>';
  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'attendance') await renderAttendance();
    else if (view === 'tasks') await renderTasks();
    else if (view === 'leave') await renderLeave();
    else if (view === 'notifications') await renderNotifications();
    else if (view === 'profile') await renderProfile();
  } catch (err) {
    content.innerHTML = `<div class="card"><p class="muted">Failed to load: ${err.message}</p></div>`;
  }
}

// ---------- Dashboard ----------
async function renderDashboard() {
  const uid = CURRENT_USER.id;
  const [summary, timelineData, tasksData, leavesData] = await Promise.all([
    api.get(`/attendance/${uid}/summary`),
    api.get(`/attendance/${uid}/timeline`),
    api.get(`/tasks?assigned_to=${uid}`),
    api.get(`/leaves?user_id=${uid}`),
  ]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const pendingTasks = tasksData.tasks.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;
  const completedTasks = tasksData.tasks.filter((t) => t.status === 'COMPLETED').length;
  const approvedLeaves = leavesData.leaves.filter((l) => l.status === 'APPROVED').length;

  content.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-head">
        <div>
          <h2>${greeting}, ${CURRENT_USER.name.split(' ')[0]} 👋</h2>
          <p class="muted" style="margin:2px 0 0;">Here's what's happening with your work session today.</p>
        </div>
        <span id="liveStatusBadge">${statusBadge(LIVE.status)}</span>
      </div>
      <div class="timer-hero">
        <div class="timer-block">
          <div class="timer-stat"><div class="t-label">Working Time</div><div class="t-value" id="workingTimeVal">${fmtHMS(LIVE.workingSeconds)}</div></div>
          <div class="timer-stat"><div class="t-label">Break Time</div><div class="t-value" id="breakTimeVal">${fmtHMS(LIVE.breakSeconds)}</div></div>
          <div class="timer-stat"><div class="t-label">Login Time</div><div class="t-value" style="font-size:18px;">${LIVE.session ? fmtTime(LIVE.session.loginTime) : '—'}</div></div>
        </div>
        <div class="timer-actions">
          <button class="btn btn-primary" id="startSessionBtn" style="display:none">
  Start Work Session
</button>

<button class="btn btn-outline" id="startBreakBtn" style="display:none">
  Start Break
</button>

<button class="btn btn-outline" id="endBreakBtn" style="display:none">
  End Break
</button>

<button class="btn btn-danger" id="logoutBtnHero" style="display:none">
  Logout
</button>
        </div>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:20px;">
      ${statCard('🕒', 'Today Worked', summary.today.workFormatted, 'var(--primary)', 'var(--primary-light)')}
      ${statCard('📅', 'Weekly Hours', summary.week.workFormatted, 'var(--info)', 'var(--info-light)')}
      ${statCard('📈', 'Monthly Hours', summary.month.workFormatted, 'var(--success)', 'var(--success-light)')}
      ${statCard('☕', 'Total Break Today', summary.today.breakFormatted, 'var(--warning)', 'var(--warning-light)')}
    </div>

    <div class="grid grid-3" style="margin-bottom:20px;">
      ${statCard('✅', 'Pending Tasks', pendingTasks, 'var(--warning)', 'var(--warning-light)')}
      ${statCard('🏁', 'Completed Tasks', completedTasks, 'var(--success)', 'var(--success-light)')}
      ${statCard('🗓️', 'Approved Leaves', approvedLeaves, 'var(--info)', 'var(--info-light)')}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <p class="card-title">Today's Timeline</p>
        <p class="card-sub">Login, break, and logout events recorded by the server.</p>
        ${renderTimeline(timelineData.events)}
      </div>
      <div class="card">
        <p class="card-title">Recent Tasks</p>
        <p class="card-sub">Your most recently assigned tasks.</p>
        ${renderTaskListMini(tasksData.tasks.slice(0, 5))}
      </div>
    </div>
  `;
  updateTimerUI();

document.getElementById('startSessionBtn')?.addEventListener('click', handleStartSession);
document.getElementById('startBreakBtn')?.addEventListener('click', handleStartBreak);
document.getElementById('endBreakBtn')?.addEventListener('click', handleEndBreak);
document.getElementById('logoutBtnHero')?.addEventListener('click', openLogoutModal);
}

function statCard(icon, label, value, color, bg) {
  return `
    <div class="card stat-card">
      <div class="icon" style="background:${bg}; color:${color};">${icon}</div>
      <div class="value">${value}</div>
      <div class="label">${label}</div>
    </div>`;
}

function renderTimeline(events) {
  if (!events || !events.length) {
    return `<div class="empty-state"><p>No activity recorded yet today.</p></div>`;
  }
  const labelMap = { LOGIN: 'Login', LOGOUT: 'Logout', BREAK_START: 'Break Started', BREAK_END: 'Break Ended' };
  return `<div class="timeline">${events.map((e) => `
    <div class="timeline-item">
      <span class="timeline-time">${fmtTime(e.time)}</span>
      <span class="timeline-label">${labelMap[e.type] || e.type}</span>
    </div>`).join('')}</div>`;
}

function renderTaskListMini(tasks) {
  if (!tasks.length) return `<div class="empty-state"><p>No tasks assigned yet.</p></div>`;
  return tasks.map((t) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border);">
      <div>
        <div style="font-weight:600; font-size:13.5px;">${escapeHtmlClient(t.title)}</div>
        <div class="muted" style="font-size:12px;">${t.due_date ? 'Due ' + fmtDate(t.due_date) : 'No due date'}</div>
      </div>
      ${taskStatusPill(t.status)}
    </div>`).join('');
}

function taskStatusPill(status) {
  const map = { PENDING: 'pill-warning', IN_PROGRESS: 'pill-info', COMPLETED: 'pill-success', CANCELLED: 'pill-muted' };
  return `<span class="pill ${map[status] || 'pill-muted'}">${status.replace('_', ' ')}</span>`;
}

function escapeHtmlClient(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// ---------- Session actions ----------
async function handleStartSession() {
  try {
    await api.post('/auth/session/start');
    toast('Work session started', 'success');
    await syncLiveState();
    if (ACTIVE_VIEW === 'dashboard') renderDashboard();
  } catch (err) { toast(err.message, 'error'); }
}
async function handleStartBreak() {
  try {
    await api.post('/breaks/start');
    toast('Break started', 'success');
    await syncLiveState();
  } catch (err) { toast(err.message, 'error'); }
}
async function handleEndBreak() {
  try {
    const res = await api.post('/breaks/end');
    toast(`Break ended (${fmtHMS(res.durationSeconds)})`, 'success');
    await syncLiveState();
  } catch (err) { toast(err.message, 'error'); }
}

function openLogoutModal() {
  document.getElementById('logoutModal').classList.add('open');
}

const logoutBtn = document.getElementById('logoutBtn');

if (logoutBtn) {
  logoutBtn.addEventListener('click', openLogoutModal);
}

const confirmLogoutBtn = document.getElementById('confirmLogoutBtn');

if (confirmLogoutBtn) {
  confirmLogoutBtn.addEventListener('click', async () => {
    try {
      await api.post('/auth/logout');

      document.getElementById('logoutModal').classList.remove('open');

      toast('Logged out successfully', 'success');

      setTimeout(() => {
        window.location.href = '/index.html';
      }, 700);

    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- Attendance view ----------
async function renderAttendance() {
  const uid = CURRENT_USER.id;
  const history = await api.get(`/attendance/${uid}/history?limit=30`);
  const rows = history.attendance;

  content.innerHTML = `
    <div class="card">
      <div class="section-head"><h2>Attendance History</h2><span class="muted">Last 30 records</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date</th><th>First Login</th><th>Last Logout</th><th>Worked</th><th>Break</th><th>Overtime</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td>${r.attendance_date}</td>
                <td>${fmtTime(r.first_login)}</td>
                <td>${fmtTime(r.last_logout)}</td>
                <td>${fmtHMS(r.total_work_seconds)}</td>
                <td>${fmtHMS(r.total_break_seconds)}</td>
                <td>${fmtHMS(r.overtime_seconds)}</td>
                <td>${attendanceStatusPill(r.attendance_status)}</td>
              </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">No attendance records yet.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function attendanceStatusPill(status) {
  const map = { PRESENT: 'pill-success', LATE: 'pill-warning', HALF_DAY: 'pill-warning', ABSENT: 'pill-danger', ON_LEAVE: 'pill-info' };
  return `<span class="pill ${map[status] || 'pill-muted'}">${(status || '').replace('_', ' ')}</span>`;
}

// ---------- Tasks view ----------
async function renderTasks() {
  const { tasks } = await api.get(`/tasks?assigned_to=${CURRENT_USER.id}`);
  content.innerHTML = `
    <div class="card">
      <div class="section-head"><h2>My Tasks</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Update</th></tr></thead>
          <tbody>
            ${tasks.length ? tasks.map((t) => `
              <tr>
                <td><b>${escapeHtmlClient(t.title)}</b><div class="muted" style="font-size:12px;">${escapeHtmlClient(t.description || '')}</div></td>
                <td>${priorityPill(t.priority)}</td>
                <td>${t.due_date ? fmtDate(t.due_date) : '—'}</td>
                <td>${taskStatusPill(t.status)}</td>
                <td>
                  <select class="select-input task-status-select" data-task-id="${t.id}">
                    ${['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
                  </select>
                </td>
              </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">No tasks assigned.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  content.querySelectorAll('.task-status-select').forEach((select) => {
    select.addEventListener('change', (e) => {
      updateTaskStatus(e.target.dataset.taskId, e.target.value);
    });
  });
}

function priorityPill(p) {
  const map = { LOW: 'pill-muted', MEDIUM: 'pill-info', HIGH: 'pill-warning', URGENT: 'pill-danger' };
  return `<span class="pill ${map[p] || 'pill-muted'}">${p}</span>`;
}

async function updateTaskStatus(id, status) {
  try {
    await api.patch(`/tasks/${id}/status`, { status });
    toast('Task updated', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- Leave view ----------
async function renderLeave() {
  const { leaves } = await api.get(`/leaves?user_id=${CURRENT_USER.id}`);

  content.innerHTML = `
    <div class="section-head">
      <h2>Leave Requests</h2>

      <button class="btn btn-primary btn-sm" id="applyLeaveBtn">
        + Apply for Leave
      </button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th>Reason</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            ${
              leaves.length
                ? leaves.map((l) => `
                  <tr>
                    <td>${l.leave_type}</td>
                    <td>${l.from_date}</td>
                    <td>${l.to_date}</td>
                    <td>${escapeHtmlClient(l.reason || '—')}</td>
                    <td>${leaveStatusPill(l.status)}</td>
                  </tr>
                `).join('')
                : `
                  <tr>
                    <td colspan="5">
                      <div class="empty-state">No leave requests yet.</div>
                    </td>
                  </tr>
                `
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('applyLeaveBtn')?.addEventListener('click', () => {
    document.getElementById('leaveModal')?.classList.add('open');
  });
}

function leaveStatusPill(status) {
  const map = {
    PENDING: 'pill-warning',
    APPROVED: 'pill-success',
    REJECTED: 'pill-danger'
  };

  return `<span class="pill ${map[status] || 'pill-muted'}">${status}</span>`;
}

const leaveForm = document.getElementById('leaveForm');

if (leaveForm) {
  leaveForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
      await api.post('/leaves', {
        leave_type: document.getElementById('leaveType').value,
        from_date: document.getElementById('leaveFrom').value,
        to_date: document.getElementById('leaveTo').value,
        reason: document.getElementById('leaveReason').value,
      });

      document.getElementById('leaveModal').classList.remove('open');

      toast('Leave request submitted', 'success');

      if (ACTIVE_VIEW === 'leave') {
        renderLeave();
      }

    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- Notifications view ----------
async function renderNotifications() {
  const { notifications } = await api.get('/notifications');

  content.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h2>Notifications</h2>

        <button class="btn btn-outline btn-sm" id="markAllReadBtn">
          Mark all as read
        </button>
      </div>

      ${
        notifications.length
          ? notifications.map((n) => `
            <div style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); ${n.is_read ? 'opacity:.6;' : ''}">
              <div style="font-size:20px;">
                ${n.is_read ? '📭' : '📬'}
              </div>

              <div style="flex:1;">
                <div style="font-weight:600; font-size:13.5px;">
                  ${escapeHtmlClient(n.title)}
                </div>

                <div class="muted" style="font-size:12.5px; margin-top:2px;">
                  ${escapeHtmlClient(n.message || '')}
                </div>

                <div class="muted" style="font-size:11px; margin-top:4px;">
                  ${fmtDate(n.created_at)} ${fmtTime(n.created_at)}
                </div>
              </div>
            </div>
          `).join('')
          : `
            <div class="empty-state">
              No notifications yet.
            </div>
          `
      }
    </div>
  `;

  document.getElementById('markAllReadBtn')?.addEventListener('click', markAllRead);

  refreshNotifBadge();
}


async function markAllRead() {
  try {
    await api.patch('/notifications/read-all');

    renderNotifications();
    refreshNotifBadge();

  } catch (err) {
    toast(err.message, 'error');
  }
}


async function refreshNotifBadge() {
  try {
    const { unreadCount } = await api.get('/notifications');

    const notifDot = document.getElementById('notifDot');

    if (notifDot) {
      notifDot.style.display = unreadCount > 0 ? 'block' : 'none';
    }

  } catch (err) {
    // ignore
  }
}


const notifBtn = document.getElementById('notifBtn');

if (notifBtn) {
  notifBtn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.remove('active');
    });

    const notificationNav = document.querySelector(
      '[data-view="notifications"]'
    );

    if (notificationNav) {
      notificationNav.classList.add('active');
    }

    renderView('notifications');
  });
}

// ---------- Profile view ----------
async function renderProfile() {
  const { user } = await api.get('/auth/me');

  content.innerHTML = `
    <div class="card" style="max-width:520px;">
      <div class="section-head"><h2>My Profile</h2></div>
      <div class="form-field" style="margin-bottom:14px;"><label>Employee ID</label><input class="text-input" style="width:100%" value="${user.employee_id}" disabled /></div>
      <div class="form-field" style="margin-bottom:14px;"><label>Full Name</label><input class="text-input" style="width:100%" value="${escapeHtmlClient(user.name)}" disabled /></div>
      <div class="form-field" style="margin-bottom:14px;"><label>Email</label><input class="text-input" style="width:100%" value="${user.email}" disabled /></div>
      <div class="form-field" style="margin-bottom:14px;"><label>Phone</label><input class="text-input" style="width:100%" id="profilePhone" value="${user.phone || ''}" /></div>
      <div class="form-field" style="margin-bottom:14px;"><label>Designation</label><input class="text-input" style="width:100%" id="profileDesignation" value="${user.designation || ''}" /></div>
      <p class="muted" style="font-size:12px;">Name, email and employee ID are managed by your administrator. You can update your phone and designation.</p>
      <button class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
    </div>`;

  const saveProfileBtn = document.getElementById('saveProfileBtn');

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', saveProfile);
  }
}

async function saveProfile() {
  try {
    await api.put(`/employees/${CURRENT_USER.id}/profile`, {
      phone: document.getElementById('profilePhone').value,
      designation: document.getElementById('profileDesignation').value,
    });

    toast('Profile updated', 'success');

  } catch (err) {
    toast(err.message, 'error');
  }
}
