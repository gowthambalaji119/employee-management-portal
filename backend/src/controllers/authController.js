const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { nowISO, todayDateStr, diffSeconds } = require('../utils/time');
const { logAudit } = require('../utils/audit');
const { emitters } = require('../socket');

require('dotenv').config();

const findUserByLogin = db.prepare(
  `SELECT * FROM users WHERE (email = ? OR employee_id = ?) AND is_active = 1`
);

const findActiveSession = db.prepare(
  `SELECT * FROM work_sessions WHERE user_id = ? AND session_status != 'CLOSED' ORDER BY id DESC LIMIT 1`
);

const insertSession = db.prepare(`
  INSERT INTO work_sessions (user_id, login_time, session_status, ip_address, user_agent, last_heartbeat)
  VALUES (?, ?, 'ACTIVE', ?, ?, ?)
`);

const updateUserStatus = db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`);

const upsertAttendanceOnLogin = db.prepare(`
  INSERT INTO attendance (user_id, attendance_date, first_login, attendance_status)
  VALUES (?, ?, ?, 'PRESENT')
  ON CONFLICT(user_id, attendance_date)
  DO UPDATE SET first_login = COALESCE(first_login, excluded.first_login)
`);

function signToken(user) {
  return jwt.sign(
    { id: user.id, employee_id: user.employee_id, role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

/**
 * POST /api/auth/login
 * Validates credentials. If a previous ACTIVE/ON_BREAK session exists for this user,
 * it is NOT auto-closed — the client is informed so it can offer session recovery.
 */
function login(req, res) {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier and password are required' });
  }

  const user = findUserByLogin.get(identifier, identifier);
  if (!user) {
    logAudit({ action: 'LOGIN_FAILED', details: `Unknown identifier: ${identifier}`, ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    logAudit({ userId: user.id, action: 'LOGIN_FAILED', details: 'Bad password', ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  setAuthCookie(res, token);

  const existingSession = findActiveSession.get(user.id);

  logAudit({ userId: user.id, action: 'LOGIN_SUCCESS', ip: req.ip });

  return res.json({
    user: sanitizeUser(user),
    recoverableSession: existingSession
      ? {
          sessionId: existingSession.id,
          loginTime: existingSession.login_time,
          lastActivity: existingSession.last_heartbeat,
          status: existingSession.session_status,
        }
      : null,
  });
}

/**
 * POST /api/auth/session/start
 * Starts a brand-new work session (only if none active), OR is called after
 * the user explicitly chooses "Close Previous Session" then wants a fresh one.
 */
function startSession(req, res) {
  const userId = req.user.id;
  const existing = findActiveSession.get(userId);
  if (existing) {
    return res.status(409).json({ error: 'An active session already exists', session: existing });
  }

  const loginTime = nowISO();
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] || 'unknown';

  const result = insertSession.run(userId, loginTime, ip, userAgent, loginTime);
  updateUserStatus.run('ONLINE', userId);
  upsertAttendanceOnLogin.run(userId, todayDateStr(), loginTime);

  const session = db.prepare('SELECT * FROM work_sessions WHERE id = ?').get(result.lastInsertRowid);

  const user = db.prepare('SELECT id, name, employee_id, department_id FROM users WHERE id = ?').get(userId);
  emitters.employeeOnline({ userId, name: user.name, employeeId: user.employee_id, loginTime });
  emitters.employeeStatusChanged({ userId, status: 'ONLINE', loginTime });

  logAudit({ userId, action: 'SESSION_START', details: { sessionId: session.id }, ip });

  return res.json({ session });
}

/**
 * POST /api/auth/session/resume
 * Resumes a previously detected active/on-break session after reconnect.
 */
function resumeSession(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) return res.status(404).json({ error: 'No recoverable session found' });

  db.prepare(`UPDATE work_sessions SET last_heartbeat = ? WHERE id = ?`).run(nowISO(), session.id);
  updateUserStatus.run(session.session_status === 'ON_BREAK' ? 'ON_BREAK' : 'ONLINE', userId);

  logAudit({ userId, action: 'SESSION_RESUME', details: { sessionId: session.id }, ip: req.ip });

  return res.json({ session });
}

/**
 * POST /api/auth/session/close-previous
 * Forcefully closes a stale/previous session (e.g. user chooses not to resume).
 * Server computes final totals based on last_heartbeat as the effective end time.
 */
function closePreviousSession(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) return res.status(404).json({ error: 'No active session to close' });

  const endTime = session.last_heartbeat || nowISO();
  finalizeSession(session, endTime);

  logAudit({ userId, action: 'SESSION_FORCE_CLOSED', details: { sessionId: session.id }, ip: req.ip });

  return res.json({ message: 'Previous session closed' });
}

/** Shared finalize logic used by both explicit logout and force-close */
function finalizeSession(session, logoutTimeISO) {
  // Close any dangling open break first
  const openBreak = db
    .prepare(`SELECT * FROM breaks WHERE work_session_id = ? AND break_end IS NULL`)
    .get(session.id);
  let totalBreakSeconds = session.total_break_seconds || 0;

  if (openBreak) {
    const dur = diffSeconds(openBreak.break_start, logoutTimeISO);
    db.prepare(`UPDATE breaks SET break_end = ?, duration_seconds = ? WHERE id = ?`).run(
      logoutTimeISO,
      dur,
      openBreak.id
    );
    totalBreakSeconds += dur;
  }

  const totalSessionSeconds = diffSeconds(session.login_time, logoutTimeISO);
  const totalWorkSeconds = Math.max(0, totalSessionSeconds - totalBreakSeconds);

  db.prepare(`
    UPDATE work_sessions
    SET logout_time = ?, session_status = 'CLOSED',
        total_session_seconds = ?, total_break_seconds = ?, total_work_seconds = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(logoutTimeISO, totalSessionSeconds, totalBreakSeconds, totalWorkSeconds, session.id);

  updateUserStatus.run('OFFLINE', session.user_id);

  // Roll up into attendance table for the day of login
  const attDate = todayDateStr(new Date(session.login_time));
  const { computeOvertimeSeconds, computeAttendanceStatus } = require('../utils/time');
  const overtime = computeOvertimeSeconds(totalWorkSeconds);
  const status = computeAttendanceStatus(totalWorkSeconds);

  db.prepare(`
    INSERT INTO attendance (user_id, attendance_date, first_login, last_logout, total_work_seconds, total_break_seconds, overtime_seconds, attendance_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, attendance_date) DO UPDATE SET
      last_logout = excluded.last_logout,
      total_work_seconds = excluded.total_work_seconds,
      total_break_seconds = excluded.total_break_seconds,
      overtime_seconds = excluded.overtime_seconds,
      attendance_status = excluded.attendance_status,
      updated_at = datetime('now')
  `).run(session.user_id, attDate, session.login_time, logoutTimeISO, totalWorkSeconds, totalBreakSeconds, overtime, status);

  emitters.employeeLogout({ userId: session.user_id, logoutTime: logoutTimeISO, totalWorkSeconds, totalBreakSeconds });
  emitters.employeeStatusChanged({ userId: session.user_id, status: 'OFFLINE' });
  emitters.attendanceUpdated({ userId: session.user_id, date: attDate });

  return { totalSessionSeconds, totalBreakSeconds, totalWorkSeconds, overtime, status };
}

/**
 * POST /api/auth/logout
 * Ends the active work session AND clears the auth cookie.
 */
function logout(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);

  let summary = null;
  if (session) {
    summary = finalizeSession(session, nowISO());
    logAudit({ userId, action: 'LOGOUT', details: { sessionId: session.id, ...summary }, ip: req.ip });
  } else {
    logAudit({ userId, action: 'LOGOUT_NO_SESSION', ip: req.ip });
  }

  res.clearCookie('token');
  return res.json({ message: 'Logged out', summary });
}

/** GET /api/auth/me */
function me(req, res) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const session = findActiveSession.get(user.id);
  return res.json({ user: sanitizeUser(user), activeSession: session || null });
}

function sanitizeUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

module.exports = {
  login,
  logout,
  me,
  startSession,
  resumeSession,
  closePreviousSession,
  finalizeSession,
  findActiveSession,
};
