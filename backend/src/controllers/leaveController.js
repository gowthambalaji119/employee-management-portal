const db = require('../config/db');
const { logAudit } = require('../utils/audit');
const { emitters } = require('../socket');

/** POST /api/leaves — employee applies for leave */
function applyLeave(req, res) {
  const userId = req.user.id;
  const { leave_type, from_date, to_date, reason } = req.body;
  if (!from_date || !to_date) return res.status(400).json({ error: 'from_date and to_date are required' });
  if (new Date(from_date) > new Date(to_date)) {
    return res.status(400).json({ error: 'from_date cannot be after to_date' });
  }

  const result = db.prepare(`
    INSERT INTO leave_requests (user_id, leave_type, from_date, to_date, reason, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `).run(userId, leave_type || 'CASUAL', from_date, to_date, reason || null);

  logAudit({ userId, action: 'LEAVE_APPLIED', details: { leaveId: result.lastInsertRowid }, ip: req.ip });

  const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ leave });
}

/** GET /api/leaves?user_id=&status= */
function listLeaves(req, res) {
  const { status, user_id } = req.query;
  let query = `SELECT l.*, u.name as employee_name FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE 1=1`;
  const params = [];

  if (req.user.role !== 'admin') {
    query += ` AND l.user_id = ?`;
    params.push(req.user.id);
  } else if (user_id) {
    query += ` AND l.user_id = ?`;
    params.push(user_id);
  }
  if (status) {
    query += ` AND l.status = ?`;
    params.push(status);
  }
  query += ` ORDER BY l.created_at DESC`;

  const rows = db.prepare(query).all(...params);
  return res.json({ leaves: rows });
}

/** PATCH /api/leaves/:id/decision (admin) — approve/reject */
function decideLeave(req, res) {
  const id = parseInt(req.params.id, 10);
  const { decision } = req.body; // 'APPROVED' | 'REJECTED'
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
  }

  const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found' });

  db.prepare(`
    UPDATE leave_requests SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?
  `).run(decision, req.user.id, id);

  db.prepare(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`).run(
    leave.user_id,
    `Leave ${decision === 'APPROVED' ? 'Approved' : 'Rejected'}`,
    `Your leave request (${leave.from_date} to ${leave.to_date}) was ${decision.toLowerCase()}.`
  );
  emitters.notificationCreated(leave.user_id, { title: `Leave ${decision}`, message: `${leave.from_date} - ${leave.to_date}` });

  logAudit({ userId: req.user.id, action: 'LEAVE_DECISION', details: { leaveId: id, decision }, ip: req.ip });

  const updated = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  return res.json({ leave: updated });
}

module.exports = { applyLeave, listLeaves, decideLeave };
