const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { logAudit } = require('../utils/audit');
const { findActiveSession } = require('./authController');
const { diffSeconds, formatHMS } = require('../utils/time');

function sanitize(user) {
  if (!user) return user;
  const { password_hash, ...rest } = user;
  return rest;
}

/** GET /api/employees  (admin) — list with search/filter */
function listEmployees(req, res) {
  const { search = '', department_id, status, is_active } = req.query;
  let query = `
    SELECT u.*, d.name as department_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.role = 'employee'
  `;
  const params = [];

  if (search) {
    query += ` AND (u.name LIKE ? OR u.email LIKE ? OR u.employee_id LIKE ?)`;
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (department_id) {
    query += ` AND u.department_id = ?`;
    params.push(department_id);
  }
  if (status) {
    query += ` AND u.status = ?`;
    params.push(status);
  }
  if (is_active !== undefined) {
    query += ` AND u.is_active = ?`;
    params.push(is_active === 'true' ? 1 : 0);
  }
  query += ` ORDER BY u.name ASC`;

  const rows = db.prepare(query).all(...params).map(sanitize);
  return res.json({ employees: rows });
}

/** GET /api/employees/online — admin live roster with computed working/break time */
function listOnlineStatus(req, res) {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.employee_id, u.status, d.name as department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.role = 'employee' AND u.is_active = 1
    ORDER BY (u.status = 'ONLINE') DESC, (u.status = 'ON_BREAK') DESC, u.name ASC
  `).all();

  const now = new Date().toISOString();
  const enriched = rows.map((u) => {
    const session = findActiveSession.get(u.id);
    if (!session) return { ...u, loginTime: null, workingSeconds: 0, workingFormatted: '00:00:00' };

    const openBreak = db
      .prepare(`SELECT break_start FROM breaks WHERE work_session_id = ? AND break_end IS NULL`)
      .get(session.id);
    const closedBreaks = db
      .prepare(`SELECT COALESCE(SUM(duration_seconds),0) as total FROM breaks WHERE work_session_id = ? AND break_end IS NOT NULL`)
      .get(session.id).total;
    let breakSeconds = closedBreaks;
    if (openBreak) breakSeconds += diffSeconds(openBreak.break_start, now);

    const totalElapsed = diffSeconds(session.login_time, now);
    const workingSeconds = Math.max(0, totalElapsed - breakSeconds);

    return {
      ...u,
      loginTime: session.login_time,
      workingSeconds,
      workingFormatted: formatHMS(workingSeconds),
      breakSeconds,
      breakFormatted: formatHMS(breakSeconds),
    };
  });

  return res.json({ employees: enriched });
}

/** GET /api/employees/:id */
function getEmployee(req, res) {
  const id = parseInt(req.params.id, 10);
  const user = db.prepare(`
    SELECT u.*, d.name as department_name FROM users u
    LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?
  `).get(id);
  if (!user) return res.status(404).json({ error: 'Employee not found' });
  return res.json({ employee: sanitize(user) });
}

/** POST /api/employees (admin) — add employee */
function createEmployee(req, res) {
  const { employee_id, name, email, password, department_id, designation, phone, role } = req.body;
  if (!employee_id || !name || !email || !password) {
    return res.status(400).json({ error: 'employee_id, name, email, password are required' });
  }

  const existing = db.prepare(`SELECT id FROM users WHERE email = ? OR employee_id = ?`).get(email, employee_id);
  if (existing) return res.status(409).json({ error: 'Employee ID or email already in use' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (employee_id, name, email, password_hash, role, department_id, designation, phone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE')
  `).run(employee_id, name, email, hash, role === 'admin' ? 'admin' : 'employee', department_id || null, designation || null, phone || null);

  logAudit({ userId: req.user.id, action: 'EMPLOYEE_CREATED', details: { newEmployeeId: result.lastInsertRowid }, ip: req.ip });

  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ employee: sanitize(created) });
}

/** PUT /api/employees/:id (admin) — edit employee */
function updateEmployee(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  const fields = ['name', 'email', 'department_id', 'designation', 'phone', 'role'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (req.body.password) {
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(req.body.password, 12));
  }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  updates.push(`updated_at = datetime('now')`);
  params.push(id);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logAudit({ userId: req.user.id, action: 'EMPLOYEE_UPDATED', details: { targetId: id, fields: Object.keys(req.body) }, ip: req.ip });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return res.json({ employee: sanitize(updated) });
}

/** PATCH /api/employees/:id/deactivate (admin) */
function deactivateEmployee(req, res) {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Employee not found' });

  db.prepare(`UPDATE users SET is_active = 0, status = 'OFFLINE', updated_at = datetime('now') WHERE id = ?`).run(id);
  logAudit({ userId: req.user.id, action: 'EMPLOYEE_DEACTIVATED', details: { targetId: id }, ip: req.ip });

  return res.json({ message: 'Employee deactivated' });
}

/** PATCH /api/employees/:id/activate (admin) */
function activateEmployee(req, res) {
  const id = parseInt(req.params.id, 10);
  db.prepare(`UPDATE users SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
  logAudit({ userId: req.user.id, action: 'EMPLOYEE_ACTIVATED', details: { targetId: id }, ip: req.ip });
  return res.json({ message: 'Employee activated' });
}

/** PUT /api/employees/:userId/profile — self-service update (limited fields), self-or-admin enforced by route */
function updateOwnProfile(req, res) {
  const id = parseInt(req.params.userId, 10);
  const allowed = ['phone', 'designation']; // employees may only touch non-sensitive fields
  const updates = [];
  const params = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (req.body.password) {
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(req.body.password, 12));
  }
  if (!updates.length) return res.status(400).json({ error: 'No editable fields provided' });

  updates.push(`updated_at = datetime('now')`);
  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return res.json({ employee: sanitize(updated) });
}

module.exports = {
  listEmployees,
  listOnlineStatus,
  getEmployee,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  updateOwnProfile,
};
