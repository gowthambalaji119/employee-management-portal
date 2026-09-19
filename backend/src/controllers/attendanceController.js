const db = require('../config/db');
const { todayDateStr, formatHMS } = require('../utils/time');

/** GET /api/attendance/:userId/today */
function todayAttendance(req, res) {
  const userId = parseInt(req.params.userId, 10);
  const date = todayDateStr();
  const row = db.prepare(`SELECT * FROM attendance WHERE user_id = ? AND attendance_date = ?`).get(userId, date);
  return res.json({ attendance: row || null });
}

/** GET /api/attendance/:userId/timeline?date=YYYY-MM-DD — login/break events for the day */
function timeline(req, res) {
  const userId = parseInt(req.params.userId, 10);
  const date = req.query.date || todayDateStr();

  const sessions = db.prepare(`
    SELECT * FROM work_sessions
    WHERE user_id = ? AND date(login_time) = ?
    ORDER BY login_time ASC
  `).all(userId, date);

  const events = [];
  for (const s of sessions) {
    events.push({ type: 'LOGIN', time: s.login_time });
    const breaks = db.prepare(`SELECT * FROM breaks WHERE work_session_id = ? ORDER BY break_start ASC`).all(s.id);
    for (const b of breaks) {
      events.push({ type: 'BREAK_START', time: b.break_start });
      if (b.break_end) events.push({ type: 'BREAK_END', time: b.break_end });
    }
    if (s.logout_time) events.push({ type: 'LOGOUT', time: s.logout_time });
  }
  events.sort((a, b) => new Date(a.time) - new Date(b.time));

  return res.json({ events });
}

/** GET /api/attendance/:userId/history?from=&to= */
function history(req, res) {
  const userId = parseInt(req.params.userId, 10);
  const { from, to, limit = 60 } = req.query;

  let query = `SELECT * FROM attendance WHERE user_id = ?`;
  const params = [userId];
  if (from) {
    query += ` AND attendance_date >= ?`;
    params.push(from);
  }
  if (to) {
    query += ` AND attendance_date <= ?`;
    params.push(to);
  }
  query += ` ORDER BY attendance_date DESC LIMIT ?`;
  params.push(Number(limit));

  const rows = db.prepare(query).all(...params);
  return res.json({ attendance: rows });
}

/** GET /api/attendance/:userId/summary — totals for today/week/month */
function summary(req, res) {
  const userId = parseInt(req.params.userId, 10);

  const today = todayDateStr();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const todayRow = db.prepare(`SELECT * FROM attendance WHERE user_id = ? AND attendance_date = ?`).get(userId, today);

  const weekTotal = db.prepare(`
    SELECT COALESCE(SUM(total_work_seconds),0) as work, COALESCE(SUM(total_break_seconds),0) as brk
    FROM attendance WHERE user_id = ? AND attendance_date >= ?
  `).get(userId, weekAgo.toISOString().slice(0, 10));

  const monthTotal = db.prepare(`
    SELECT COALESCE(SUM(total_work_seconds),0) as work, COALESCE(SUM(total_break_seconds),0) as brk
    FROM attendance WHERE user_id = ? AND attendance_date >= ?
  `).get(userId, monthAgo.toISOString().slice(0, 10));

  return res.json({
    today: {
      workSeconds: todayRow ? todayRow.total_work_seconds : 0,
      breakSeconds: todayRow ? todayRow.total_break_seconds : 0,
      workFormatted: formatHMS(todayRow ? todayRow.total_work_seconds : 0),
      breakFormatted: formatHMS(todayRow ? todayRow.total_break_seconds : 0),
      status: todayRow ? todayRow.attendance_status : 'ABSENT',
    },
    week: {
      workSeconds: weekTotal.work,
      breakSeconds: weekTotal.brk,
      workFormatted: formatHMS(weekTotal.work),
    },
    month: {
      workSeconds: monthTotal.work,
      breakSeconds: monthTotal.brk,
      workFormatted: formatHMS(monthTotal.work),
    },
  });
}

/** GET /api/attendance/admin/overview — dashboard cards for admin */
function adminOverview(req, res) {
  const totalEmployees = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='employee' AND is_active=1`).get().c;
  const online = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='employee' AND status='ONLINE'`).get().c;
  const onBreak = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='employee' AND status='ON_BREAK'`).get().c;
  const offline = totalEmployees - online - onBreak;

  const today = todayDateStr();
  const presentToday = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as c FROM attendance WHERE attendance_date = ? AND attendance_status IN ('PRESENT','HALF_DAY','LATE')
  `).get(today).c;

  const onLeave = db.prepare(`
    SELECT COUNT(*) as c FROM leave_requests WHERE status='APPROVED' AND ? BETWEEN from_date AND to_date
  `).get(today).c;

  const avgWork = db.prepare(`
    SELECT AVG(total_work_seconds) as avg FROM attendance WHERE attendance_date = ? AND total_work_seconds > 0
  `).get(today).avg || 0;

  return res.json({
    totalEmployees,
    online,
    onBreak,
    offline: Math.max(0, offline),
    presentToday,
    onLeave,
    avgWorkingHours: formatHMS(avgWork),
  });
}

/** GET /api/attendance/admin/department-wise?date= */
function departmentWise(req, res) {
  const date = req.query.date || todayDateStr();
  const rows = db.prepare(`
    SELECT d.name as department, COUNT(DISTINCT a.user_id) as present_count,
           COALESCE(SUM(a.total_work_seconds),0) as total_work_seconds
    FROM departments d
    LEFT JOIN users u ON u.department_id = d.id AND u.role = 'employee'
    LEFT JOIN attendance a ON a.user_id = u.id AND a.attendance_date = ?
    GROUP BY d.id
    ORDER BY d.name
  `).all(date);
  return res.json({ departments: rows });
}

/** GET /api/attendance/admin/daily-trend?days=14 */
function dailyTrend(req, res) {
  const days = parseInt(req.query.days || '14', 10);
  const rows = db.prepare(`
    SELECT attendance_date, COUNT(DISTINCT user_id) as present_count,
           COALESCE(SUM(total_work_seconds),0) as total_work_seconds,
           COALESCE(SUM(total_break_seconds),0) as total_break_seconds
    FROM attendance
    WHERE attendance_date >= date('now', ?)
    GROUP BY attendance_date
    ORDER BY attendance_date ASC
  `).all(`-${days} days`);
  return res.json({ trend: rows });
}

module.exports = {
  todayAttendance,
  timeline,
  history,
  summary,
  adminOverview,
  departmentWise,
  dailyTrend,
};
