let CURRENT_USER = null;
let ACTIVE_VIEW = 'dashboard';
let SOCKET = null;
let DEPARTMENTS_CACHE = [];
let EMPLOYEES_CACHE = [];

const content = document.getElementById('content');
const viewTitle = document.getElementById('viewTitle');

(async function boot() {
  try {
    const { user } = await api.get('/auth/me');
    CURRENT_USER = user;
    if (user.role !== 'admin') {
      window.location.href = '/employee/dashboard.html';
      return;
    }
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userAvatar').textContent = initials(user.name);
    connectSocket();
    await loadDepartments();
    renderView('dashboard');
  } catch (err) {
    window.location.href = '/index.html';
  }
})();

function connectSocket() {
  SOCKET = io({ withCredentials: true });
  const refreshIfLive = () => { if (ACTIVE_VIEW === 'dashboard' || ACTIVE_VIEW === 'employees') renderView(ACTIVE_VIEW); };
  ['employee_online', 'employee_break_start', 'employee_break_end', 'employee_logout', 'employee_status_changed', 'attendance_updated']
    .forEach((evt) => SOCKET.on(evt, refreshIfLive));
}

async function loadDepartments() {
  const { departments } = await api.get('/departments');
  DEPARTMENTS_CACHE = departments;
}

document.getElementById('navGroup').addEventListener('click', (e) => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  item.classList.add('active');
  renderView(item.dataset.view);
  document.getElementById('sidebar').classList.remove('open');
});

const titles = {
  dashboard: 'Admin Dashboard', employees: 'Employees', departments: 'Departments',
  attendance: 'Attendance', leaves: 'Leave Requests', tasks: 'Tasks', reports: 'Reports',
};

async function renderView(view) {
  ACTIVE_VIEW = view;
  viewTitle.textContent = titles[view] || view;
  content.innerHTML = '<div class="loading-spinner"></div>';
  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'employees') await renderEmployees();
    else if (view === 'departments') await renderDepartments();
    else if (view === 'attendance') await renderAttendanceView();
    else if (view === 'leaves') await renderLeaves();
    else if (view === 'tasks') await renderTasksView();
    else if (view === 'reports') await renderReports();
  } catch (err) {
    content.innerHTML = `<div class="card"><p class="muted">Failed to load: ${err.message}</p></div>`;
  }
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api.post('/auth/logout');
    window.location.href = '/index.html';
  } catch (err) { toast(err.message, 'error'); }
});

function escapeHtmlClient(s) {
  const div = document.createElement('div');
  div.textContent = s || '';
  return div.innerHTML;
}

// ================= Dashboard =================
async function renderDashboard() {
  const [overview, deptWise, trend, online] = await Promise.all([
    api.get('/attendance/admin/overview'),
    api.get('/attendance/admin/department-wise'),
    api.get('/attendance/admin/daily-trend?days=14'),
    api.get('/employees/online'),
  ]);

  content.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:20px;">
      ${statCard('👥', 'Total Employees', overview.totalEmployees, 'var(--primary)', 'var(--primary-light)')}
      ${statCard('🟢', 'Online', overview.online, 'var(--success)', 'var(--success-light)')}
      ${statCard('☕', 'On Break', overview.onBreak, 'var(--warning)', 'var(--warning-light)')}
      ${statCard('⚪', 'Offline', overview.offline, 'var(--text-muted)', 'var(--surface-alt)')}
    </div>
    <div class="grid grid-3" style="margin-bottom:20px;">
      ${statCard('✅', 'Present Today', overview.presentToday, 'var(--success)', 'var(--success-light)')}
      ${statCard('🗓️', 'On Leave', overview.onLeave, 'var(--info)', 'var(--info-light)')}
      ${statCard('⏱️', 'Avg Working Hours', overview.avgWorkingHours, 'var(--primary)', 'var(--primary-light)')}
    </div>

    <div class="grid grid-2" style="margin-bottom:20px;">
      <div class="card">
        <p class="card-title">Daily Attendance Trend (14 days)</p>
        <p class="card-sub">Distinct employees with recorded attendance per day.</p>
        ${barChart(trend.trend.map((t) => ({ label: t.attendance_date.slice(5), value: t.present_count })))}
      </div>
      <div class="card">
        <p class="card-title">Department-wise Attendance</p>
        <p class="card-sub">Present count today, by department.</p>
        ${barChart(deptWise.departments.map((d) => ({ label: d.department, value: d.present_count })))}
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <h2>Live Employee Status</h2>
        <span class="muted" style="font-size:12px;">Updates in real time</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>Department</th><th>Status</th><th>Login Time</th><th>Working Time</th></tr></thead>
          <tbody>
            ${online.employees.length ? online.employees.map((e) => `
              <tr>
                <td><div class="cell-name"><div class="mini-avatar">${initials(e.name)}</div>${escapeHtmlClient(e.name)}</div></td>
                <td>${e.department_name || '—'}</td>
                <td>${statusBadge(e.status)}</td>
                <td>${fmtTime(e.loginTime)}</td>
                <td>${e.workingFormatted || '00:00:00'}</td>
              </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">No employees found.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function statCard(icon, label, value, color, bg) {
  return `
    <div class="card stat-card">
      <div class="icon" style="background:${bg}; color:${color};">${icon}</div>
      <div class="value">${value}</div>
      <div class="label">${label}</div>
    </div>`;
}

function barChart(items) {
  if (!items.length) return `<div class="empty-state">No data available.</div>`;
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return `
    <div style="display:flex; align-items:flex-end; gap:8px; height:140px; padding-top:10px;">
      ${items.map((i) => {
        const h = Math.max(4, Math.round((Number(i.value) / max) * 120));
        return `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px;">
            <div title="${i.value}" style="width:100%; max-width:28px; height:${h}px; background:var(--primary); border-radius:4px 4px 0 0;"></div>
            <div style="font-size:10px; color:var(--text-faint); white-space:nowrap;">${i.label}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ================= Employees =================
async function renderEmployees() {
  content.innerHTML = `
    <div class="section-head">
      <h2>Employees</h2>
      <button class="btn btn-primary btn-sm" onclick="openAddEmployeeModal()">+ Add Employee</button>
    </div>
    <div class="toolbar">
      <div class="search-input">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" id="empSearch" placeholder="Search by name, email, or ID..." />
      </div>
      <select class="select-input" id="empDeptFilter"><option value="">All Departments</option>${DEPARTMENTS_CACHE.map((d) => `<option value="${d.id}">${d.name}</option>`).join('')}</select>
      <select class="select-input" id="empStatusFilter">
        <option value="">All Status</option><option value="ONLINE">Online</option><option value="ON_BREAK">On Break</option><option value="OFFLINE">Offline</option>
      </select>
      <button class="btn btn-outline btn-sm" onclick="window.open('/api/reports/attendance?format=csv','_blank')">⬇ Export Attendance CSV</button>
    </div>
    <div class="card"><div class="table-wrap" id="empTableWrap"><div class="loading-spinner"></div></div></div>
  `;

  document.getElementById('empSearch').addEventListener('input', debounce(loadEmployeeTable, 300));
  document.getElementById('empDeptFilter').addEventListener('change', loadEmployeeTable);
  document.getElementById('empStatusFilter').addEventListener('change', loadEmployeeTable);

  await loadEmployeeTable();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function loadEmployeeTable() {
  const search = document.getElementById('empSearch').value;
  const dept = document.getElementById('empDeptFilter').value;
  const status = document.getElementById('empStatusFilter').value;
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (dept) params.set('department_id', dept);
  if (status) params.set('status', status);

  const { employees } = await api.get(`/employees?${params.toString()}`);
  EMPLOYEES_CACHE = employees;

  const wrap = document.getElementById('empTableWrap');
  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Employee ID</th><th>Name</th><th>Department</th><th>Designation</th><th>Status</th><th>Active</th><th>Actions</th></tr></thead>
      <tbody>
        ${employees.length ? employees.map((e) => `
          <tr>
            <td>${e.employee_id}</td>
            <td><div class="cell-name"><div class="mini-avatar">${initials(e.name)}</div>${escapeHtmlClient(e.name)}</div></td>
            <td>${e.department_name || '—'}</td>
            <td>${e.designation || '—'}</td>
            <td>${statusBadge(e.status)}</td>
            <td>${e.is_active ? '<span class="pill pill-success">Active</span>' : '<span class="pill pill-danger">Inactive</span>'}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-outline btn-sm" onclick="openEditEmployeeModal(${e.id})">Edit</button>
              ${e.is_active
                ? `<button class="btn btn-outline btn-sm" onclick="deactivateEmployee(${e.id})">Deactivate</button>`
                : `<button class="btn btn-outline btn-sm" onclick="activateEmployee(${e.id})">Activate</button>`}
            </td>
          </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">No employees match your filters.</div></td></tr>`}
      </tbody>
    </table>`;
}

function populateDeptSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = DEPARTMENTS_CACHE.map((d) => `<option value="${d.id}" ${String(d.id) === String(selectedId) ? 'selected' : ''}>${d.name}</option>`).join('');
}

function openAddEmployeeModal() {
  document.getElementById('employeeModalTitle').textContent = 'Add Employee';
  document.getElementById('empFormId').value = '';
  document.getElementById('empFormEmployeeId').value = '';
  document.getElementById('empFormEmployeeId').disabled = false;
  document.getElementById('empFormName').value = '';
  document.getElementById('empFormEmail').value = '';
  document.getElementById('empFormPassword').value = '';
  document.getElementById('empFormPassword').required = true;
  document.getElementById('pwHint').textContent = '(required)';
  document.getElementById('empFormDesignation').value = '';
  document.getElementById('empFormPhone').value = '';
  document.getElementById('empFormRole').value = 'employee';
  populateDeptSelect('empFormDept');
  document.getElementById('employeeModal').classList.add('open');
}

function openEditEmployeeModal(id) {
  const emp = EMPLOYEES_CACHE.find((e) => e.id === id);
  if (!emp) return;
  document.getElementById('employeeModalTitle').textContent = 'Edit Employee';
  document.getElementById('empFormId').value = emp.id;
  document.getElementById('empFormEmployeeId').value = emp.employee_id;
  document.getElementById('empFormEmployeeId').disabled = true;
  document.getElementById('empFormName').value = emp.name;
  document.getElementById('empFormEmail').value = emp.email;
  document.getElementById('empFormPassword').value = '';
  document.getElementById('empFormPassword').required = false;
  document.getElementById('pwHint').textContent = '(leave blank to keep unchanged)';
  document.getElementById('empFormDesignation').value = emp.designation || '';
  document.getElementById('empFormPhone').value = emp.phone || '';
  document.getElementById('empFormRole').value = emp.role;
  populateDeptSelect('empFormDept', emp.department_id);
  document.getElementById('employeeModal').classList.add('open');
}

document.getElementById('employeeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('empFormId').value;
  const payload = {
    name: document.getElementById('empFormName').value,
    email: document.getElementById('empFormEmail').value,
    department_id: Number(document.getElementById('empFormDept').value) || null,
    designation: document.getElementById('empFormDesignation').value,
    phone: document.getElementById('empFormPhone').value,
    role: document.getElementById('empFormRole').value,
  };
  const password = document.getElementById('empFormPassword').value;
  if (password) payload.password = password;

  try {
    if (id) {
      await api.put(`/employees/${id}`, payload);
      toast('Employee updated', 'success');
    } else {
      payload.employee_id = document.getElementById('empFormEmployeeId').value;
      await api.post('/employees', payload);
      toast('Employee created', 'success');
    }
    document.getElementById('employeeModal').classList.remove('open');
    loadEmployeeTable();
  } catch (err) { toast(err.message, 'error'); }
});

async function deactivateEmployee(id) {
  if (!confirm('Deactivate this employee? They will no longer be able to log in.')) return;
  try {
    await api.patch(`/employees/${id}/deactivate`);
    toast('Employee deactivated', 'success');
    loadEmployeeTable();
  } catch (err) { toast(err.message, 'error'); }
}
async function activateEmployee(id) {
  try {
    await api.patch(`/employees/${id}/activate`);
    toast('Employee activated', 'success');
    loadEmployeeTable();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= Departments =================
async function renderDepartments() {
  await loadDepartments();
  content.innerHTML = `
    <div class="section-head">
      <h2>Departments</h2>
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('deptModal').classList.add('open')">+ Add Department</button>
    </div>
    <div class="grid grid-3">
      ${DEPARTMENTS_CACHE.map((d) => `
        <div class="card">
          <p class="card-title">${escapeHtmlClient(d.name)}</p>
          <p class="card-sub">${escapeHtmlClient(d.description || 'No description')}</p>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="pill pill-info">${d.employee_count} employees</span>
            <button class="btn btn-outline btn-sm" onclick="deleteDepartment(${d.id})">Delete</button>
          </div>
        </div>`).join('') || `<div class="empty-state">No departments yet.</div>`}
    </div>`;
}

document.getElementById('deptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.post('/departments', {
      name: document.getElementById('deptFormName').value,
      description: document.getElementById('deptFormDesc').value,
    });
    document.getElementById('deptModal').classList.remove('open');
    toast('Department created', 'success');
    renderDepartments();
  } catch (err) { toast(err.message, 'error'); }
});

async function deleteDepartment(id) {
  if (!confirm('Delete this department?')) return;
  try {
    await api.del(`/departments/${id}`);
    toast('Department deleted', 'success');
    renderDepartments();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= Attendance =================
async function renderAttendanceView() {
  content.innerHTML = `
    <div class="section-head">
      <h2>Attendance Records</h2>
      <button class="btn btn-outline btn-sm" id="exportAttBtn">⬇ Export CSV</button>
    </div>
    <div class="toolbar">
      <input type="date" class="text-input" id="attFrom" />
      <span class="muted">to</span>
      <input type="date" class="text-input" id="attTo" />
      <select class="select-input" id="attDept"><option value="">All Departments</option>${DEPARTMENTS_CACHE.map((d) => `<option value="${d.id}">${d.name}</option>`).join('')}</select>
      <button class="btn btn-primary btn-sm" id="attFilterBtn">Filter</button>
    </div>
    <div class="card"><div class="table-wrap" id="attTableWrap"><div class="loading-spinner"></div></div></div>
  `;

  async function load() {
    const from = document.getElementById('attFrom').value;
    const to = document.getElementById('attTo').value;
    const dept = document.getElementById('attDept').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (dept) params.set('department_id', dept);

    const { report } = await api.get(`/reports/attendance?${params.toString()}`);
    document.getElementById('attTableWrap').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>First Login</th><th>Last Logout</th><th>Worked</th><th>Break</th><th>OT</th><th>Status</th></tr></thead>
        <tbody>
          ${report.length ? report.map((r) => `
            <tr>
              <td>${r.attendance_date}</td>
              <td>${escapeHtmlClient(r.employee_name)} <span class="muted">(${r.emp_code})</span></td>
              <td>${r.department || '—'}</td>
              <td>${fmtTime(r.first_login)}</td>
              <td>${fmtTime(r.last_logout)}</td>
              <td>${r.total_work_hms}</td>
              <td>${r.total_break_hms}</td>
              <td>${r.overtime_hms}</td>
              <td>${attendanceStatusPill(r.attendance_status)}</td>
            </tr>`).join('') : `<tr><td colspan="9"><div class="empty-state">No records found for the selected range.</div></td></tr>`}
        </tbody>
      </table>`;

    document.getElementById('exportAttBtn').onclick = () => window.open(`/api/reports/attendance?${params.toString()}&format=csv`, '_blank');
  }
  document.getElementById('attFilterBtn').addEventListener('click', load);
  await load();
}

function attendanceStatusPill(status) {
  const map = { PRESENT: 'pill-success', LATE: 'pill-warning', HALF_DAY: 'pill-warning', ABSENT: 'pill-danger', ON_LEAVE: 'pill-info' };
  return `<span class="pill ${map[status] || 'pill-muted'}">${(status || '').replace('_', ' ')}</span>`;
}

// ================= Leave Requests =================
async function renderLeaves() {
  const { leaves } = await api.get('/leaves');
  content.innerHTML = `
    <div class="card">
      <div class="section-head"><h2>Leave Requests</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${leaves.length ? leaves.map((l) => `
              <tr>
                <td>${escapeHtmlClient(l.employee_name)}</td>
                <td>${l.leave_type}</td>
                <td>${l.from_date}</td>
                <td>${l.to_date}</td>
                <td>${escapeHtmlClient(l.reason || '—')}</td>
                <td>${leaveStatusPill(l.status)}</td>
                <td>
                  ${l.status === 'PENDING' ? `
                    <button class="btn btn-outline btn-sm" onclick="decideLeave(${l.id},'APPROVED')">Approve</button>
                    <button class="btn btn-outline btn-sm" onclick="decideLeave(${l.id},'REJECTED')">Reject</button>
                  ` : '<span class="muted" style="font-size:12px;">Decided</span>'}
                </td>
              </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state">No leave requests.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
function leaveStatusPill(status) {
  const map = { PENDING: 'pill-warning', APPROVED: 'pill-success', REJECTED: 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-muted'}">${status}</span>`;
}
async function decideLeave(id, decision) {
  try {
    await api.patch(`/leaves/${id}/decision`, { decision });
    toast(`Leave ${decision.toLowerCase()}`, 'success');
    renderLeaves();
  } catch (err) { toast(err.message, 'error'); }
}

// ================= Tasks =================
async function renderTasksView() {
  const { tasks } = await api.get('/tasks');
  content.innerHTML = `
    <div class="section-head">
      <h2>All Tasks</h2>
      <button class="btn btn-primary btn-sm" onclick="openTaskModal()">+ Assign Task</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Assignee</th><th>Priority</th><th>Due Date</th><th>Status</th></tr></thead>
          <tbody>
            ${tasks.length ? tasks.map((t) => `
              <tr>
                <td><b>${escapeHtmlClient(t.title)}</b><div class="muted" style="font-size:12px;">${escapeHtmlClient(t.description || '')}</div></td>
                <td>${escapeHtmlClient(t.assignee_name)}</td>
                <td>${priorityPill(t.priority)}</td>
                <td>${t.due_date ? fmtDate(t.due_date) : '—'}</td>
                <td>${taskStatusPill(t.status)}</td>
              </tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">No tasks yet.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
function priorityPill(p) {
  const map = { LOW: 'pill-muted', MEDIUM: 'pill-info', HIGH: 'pill-warning', URGENT: 'pill-danger' };
  return `<span class="pill ${map[p] || 'pill-muted'}">${p}</span>`;
}
function taskStatusPill(status) {
  const map = { PENDING: 'pill-warning', IN_PROGRESS: 'pill-info', COMPLETED: 'pill-success', CANCELLED: 'pill-muted' };
  return `<span class="pill ${map[status] || 'pill-muted'}">${status.replace('_', ' ')}</span>`;
}

function openTaskModal() {
  const sel = document.getElementById('taskFormAssignee');
  sel.innerHTML = EMPLOYEES_CACHE.length
    ? EMPLOYEES_CACHE.map((e) => `<option value="${e.id}">${e.name} (${e.employee_id})</option>`).join('')
    : '';
  if (!EMPLOYEES_CACHE.length) {
    api.get('/employees').then(({ employees }) => {
      EMPLOYEES_CACHE = employees;
      sel.innerHTML = employees.map((e) => `<option value="${e.id}">${e.name} (${e.employee_id})</option>`).join('');
    });
  }
  document.getElementById('taskModal').classList.add('open');
}

document.getElementById('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.post('/tasks', {
      assigned_to: Number(document.getElementById('taskFormAssignee').value),
      title: document.getElementById('taskFormTitle').value,
      description: document.getElementById('taskFormDesc').value,
      priority: document.getElementById('taskFormPriority').value,
      due_date: document.getElementById('taskFormDue').value || null,
    });
    document.getElementById('taskModal').classList.remove('open');
    toast('Task assigned', 'success');
    if (ACTIVE_VIEW === 'tasks') renderTasksView();
  } catch (err) { toast(err.message, 'error'); }
});

// ================= Reports =================
async function renderReports() {
  const reports = [
    { key: 'daily', label: 'Daily Attendance Report', desc: 'Attendance for today.' },
    { key: 'weekly', label: 'Weekly Attendance Report', desc: 'Last 7 days of attendance.' },
    { key: 'monthly', label: 'Monthly Attendance Report', desc: 'Current month attendance.' },
    { key: 'attendance', label: 'Full Attendance Report', desc: 'All attendance records (optionally filtered).' },
    { key: 'breaks', label: 'Break Report', desc: 'All recorded break sessions.' },
    { key: 'overtime', label: 'Overtime Report', desc: 'Days where employees exceeded standard hours.' },
    { key: 'leaves', label: 'Leave Report', desc: 'All leave requests and their status.' },
  ];
  content.innerHTML = `
    <div class="grid grid-3">
      ${reports.map((r) => `
        <div class="card">
          <p class="card-title">${r.label}</p>
          <p class="card-sub">${r.desc}</p>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="window.open('/api/reports/${r.key}?format=json','_blank')">View JSON</button>
            <button class="btn btn-primary btn-sm" onclick="window.open('/api/reports/${r.key}?format=csv','_blank')">⬇ CSV</button>
          </div>
        </div>`).join('')}
    </div>`;
}
