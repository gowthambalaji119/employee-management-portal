const db = require('../config/db');
const { nowISO, diffSeconds } = require('../utils/time');
const { findActiveSession } = require('./authController');
const { emitters } = require('../socket');
const { logAudit } = require('../utils/audit');

/** POST /api/breaks/start */
function startBreak(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) return res.status(400).json({ error: 'No active work session' });
  if (session.session_status === 'ON_BREAK') {
    return res.status(409).json({ error: 'Already on break' });
  }

  const openBreak = db
    .prepare(`SELECT id FROM breaks WHERE work_session_id = ? AND break_end IS NULL`)
    .get(session.id);
  if (openBreak) return res.status(409).json({ error: 'Break already in progress' });

  const start = nowISO();
  const result = db
    .prepare(`INSERT INTO breaks (work_session_id, user_id, break_start) VALUES (?, ?, ?)`)
    .run(session.id, userId, start);

  db.prepare(`UPDATE work_sessions SET session_status = 'ON_BREAK', last_heartbeat = ? WHERE id = ?`).run(start, session.id);
  db.prepare(`UPDATE users SET status = 'ON_BREAK', updated_at = datetime('now') WHERE id = ?`).run(userId);

  emitters.employeeBreakStart({ userId, breakId: result.lastInsertRowid, breakStart: start });
  emitters.employeeStatusChanged({ userId, status: 'ON_BREAK' });

  logAudit({ userId, action: 'BREAK_START', details: { breakId: result.lastInsertRowid }, ip: req.ip });

  return res.json({ breakId: result.lastInsertRowid, breakStart: start });
}

/** POST /api/breaks/end */
function endBreak(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) return res.status(400).json({ error: 'No active work session' });

  const openBreak = db
    .prepare(`SELECT * FROM breaks WHERE work_session_id = ? AND user_id = ? AND break_end IS NULL`)
    .get(session.id, userId);
  if (!openBreak) return res.status(400).json({ error: 'No break in progress' });

  const end = nowISO();
  const duration = diffSeconds(openBreak.break_start, end);

  db.prepare(`UPDATE breaks SET break_end = ?, duration_seconds = ? WHERE id = ?`).run(end, duration, openBreak.id);

  const newTotalBreak = (session.total_break_seconds || 0) + duration;
  db.prepare(`
    UPDATE work_sessions
    SET session_status = 'ACTIVE', total_break_seconds = ?, last_heartbeat = ?
    WHERE id = ?
  `).run(newTotalBreak, end, session.id);

  db.prepare(`UPDATE users SET status = 'ONLINE', updated_at = datetime('now') WHERE id = ?`).run(userId);

  emitters.employeeBreakEnd({ userId, breakId: openBreak.id, breakEnd: end, durationSeconds: duration });
  emitters.employeeStatusChanged({ userId, status: 'ONLINE' });

  logAudit({ userId, action: 'BREAK_END', details: { breakId: openBreak.id, durationSeconds: duration }, ip: req.ip });

  return res.json({ breakId: openBreak.id, breakEnd: end, durationSeconds: duration });
}

/** GET /api/breaks/history/:userId — self or admin only (route enforces) */
function breakHistory(req, res) {
  const userId = parseInt(req.params.userId, 10);
  const rows = db
    .prepare(`
      SELECT b.*, ws.login_time as session_login_time
      FROM breaks b
      JOIN work_sessions ws ON ws.id = b.work_session_id
      WHERE b.user_id = ?
      ORDER BY b.break_start DESC
      LIMIT 200
    `)
    .all(userId);
  return res.json({ breaks: rows });
}

module.exports = { startBreak, endBreak, breakHistory };
