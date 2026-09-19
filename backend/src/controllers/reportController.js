const { Parser } = require('json2csv');
const db = require('../config/db');
const { todayDateStr, formatHMS } = require('../utils/time');

function withFormatted(rows) {
  return rows.map((r) => ({
    ...r,
    total_work_hms: formatHMS(r.total_work_seconds),
    total_break_hms: formatHMS(r.total_break_seconds),
    overtime_hms: formatHMS(r.overtime_seconds || 0),
  }));
}

/** Shared query builder for attendance-based reports */
function queryAttendanceReport({ from, to, department_id }) {
  let query = `
    SELECT a.*, u.name as employee_name, u.employee_id as emp_code, d.name as department
    FROM attendance a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { query += ` AND a.attendance_date >= ?`; params.push(from); }
  if (to) { query += ` AND a.attendance_date <= ?`; params.push(to); }
  if (department_id) { query += ` AND u.department_id = ?`; params.push(department_id); }
  query += ` ORDER BY a.attendance_date DESC, u.name ASC`;
  return db.prepare(query).all(...params);
}

/** GET /api/reports/attendance?from=&to=&department_id=&format=json|csv */
function attendanceReport(req, res) {
  const { from, to, department_id, format = 'json' } = req.query;
  const rows = withFormatted(queryAttendanceReport({ from, to, department_id }));

  if (format === 'csv') return sendCsv(res, rows, 'attendance_report');
  return res.json({ report: rows });
}

/** GET /api/reports/daily?date=&format= */
function dailyReport(req, res) {
  const date = req.query.date || todayDateStr();
  const rows = withFormatted(queryAttendanceReport({ from: date, to: date }));
  if (req.query.format === 'csv') return sendCsv(res, rows, `daily_report_${date}`);
  return res.json({ report: rows });
}

/** GET /api/reports/weekly?format= */
function weeklyReport(req, res) {
  const to = todayDateStr();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 7);
  const from = fromDate.toISOString().slice(0, 10);
  const rows = withFormatted(queryAttendanceReport({ from, to }));
  if (req.query.format === 'csv') return sendCsv(res, rows, 'weekly_report');
  return res.json({ report: rows });
}

/** GET /api/reports/monthly?month=YYYY-MM&format= */
function monthlyReport(req, res) {
  const month = req.query.month || todayDateStr().slice(0, 7);
  const from = `${month}-01`;
  const to = `${month}-31`;
  const rows = withFormatted(queryAttendanceReport({ from, to }));
  if (req.query.format === 'csv') return sendCsv(res, rows, `monthly_report_${month}`);
  return res.json({ report: rows });
}

/** GET /api/reports/work-hours/:userId?from=&to= — single employee report */
function employeeWorkHoursReport(req, res) {
  const userId = parseInt(req.params.userId, 10);
  const { from, to, format = 'json' } = req.query;
  let query = `SELECT * FROM attendance WHERE user_id = ?`;
  const params = [userId];
  if (from) { query += ` AND attendance_date >= ?`; params.push(from); }
  if (to) { query += ` AND attendance_date <= ?`; params.push(to); }
  query += ` ORDER BY attendance_date DESC`;

  const rows = withFormatted(db.prepare(query).all(...params));
  if (format === 'csv') return sendCsv(res, rows, `work_hours_${userId}`);
  return res.json({ report: rows });
}

/** GET /api/reports/breaks?from=&to=&format= */
function breakReport(req, res) {
  const { from, to, format = 'json' } = req.query;
  let query = `
    SELECT b.id, u.name as employee_name, u.employee_id as emp_code, b.break_start, b.break_end, b.duration_seconds
    FROM breaks b JOIN users u ON u.id = b.user_id WHERE 1=1
  `;
  const params = [];
  if (from) { query += ` AND date(b.break_start) >= ?`; params.push(from); }
  if (to) { query += ` AND date(b.break_start) <= ?`; params.push(to); }
  query += ` ORDER BY b.break_start DESC LIMIT 1000`;

  const rows = db.prepare(query).all(...params).map((r) => ({ ...r, duration_hms: formatHMS(r.duration_seconds) }));
  if (format === 'csv') return sendCsv(res, rows, 'break_report');
  return res.json({ report: rows });
}

/** GET /api/reports/overtime?from=&to=&format= */
function overtimeReport(req, res) {
  const { from, to, format = 'json' } = req.query;
  let query = `
    SELECT a.*, u.name as employee_name, u.employee_id as emp_code
    FROM attendance a JOIN users u ON u.id = a.user_id
    WHERE a.overtime_seconds > 0
  `;
  const params = [];
  if (from) { query += ` AND a.attendance_date >= ?`; params.push(from); }
  if (to) { query += ` AND a.attendance_date <= ?`; params.push(to); }
  query += ` ORDER BY a.attendance_date DESC`;

  const rows = withFormatted(db.prepare(query).all(...params));
  if (format === 'csv') return sendCsv(res, rows, 'overtime_report');
  return res.json({ report: rows });
}

/** GET /api/reports/leaves?from=&to=&status=&format= */
function leaveReport(req, res) {
  const { from, to, status, format = 'json' } = req.query;
  let query = `
    SELECT l.*, u.name as employee_name, u.employee_id as emp_code
    FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE 1=1
  `;
  const params = [];
  if (from) { query += ` AND l.from_date >= ?`; params.push(from); }
  if (to) { query += ` AND l.to_date <= ?`; params.push(to); }
  if (status) { query += ` AND l.status = ?`; params.push(status); }
  query += ` ORDER BY l.created_at DESC`;

  const rows = db.prepare(query).all(...params);
  if (format === 'csv') return sendCsv(res, rows, 'leave_report');
  return res.json({ report: rows });
}

function sendCsv(res, rows, filename) {
  try {
    const parser = new Parser();
    const csv = rows.length ? parser.parse(rows) : '';
    res.header('Content-Type', 'text/csv');
    res.attachment(`${filename}.csv`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate CSV', details: err.message });
  }
}

module.exports = {
  attendanceReport,
  dailyReport,
  weeklyReport,
  monthlyReport,
  employeeWorkHoursReport,
  breakReport,
  overtimeReport,
  leaveReport,
};
