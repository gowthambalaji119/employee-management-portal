const db = require('../config/db');
const { logAudit } = require('../utils/audit');
const { emitters } = require('../socket');

/** POST /api/tasks (admin) — assign task */
function createTask(req, res) {
  const { assigned_to, title, description, priority, due_date } = req.body;
  if (!assigned_to || !title) return res.status(400).json({ error: 'assigned_to and title are required' });

  const result = db.prepare(`
    INSERT INTO tasks (assigned_to, assigned_by, title, description, priority, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
  `).run(assigned_to, req.user.id, title, description || null, priority || 'MEDIUM', due_date || null);

  db.prepare(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`).run(
    assigned_to,
    'New Task Assigned',
    `You have been assigned: ${title}`
  );
  emitters.notificationCreated(assigned_to, { title: 'New Task Assigned', message: title });

  logAudit({ userId: req.user.id, action: 'TASK_CREATED', details: { taskId: result.lastInsertRowid, assigned_to }, ip: req.ip });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ task });
}

/** GET /api/tasks?assigned_to=&status= */
function listTasks(req, res) {
  const { assigned_to, status } = req.query;
  let query = `SELECT t.*, u.name as assignee_name FROM tasks t JOIN users u ON u.id = t.assigned_to WHERE 1=1`;
  const params = [];

  // Employees may only ever see their own tasks (enforced regardless of query params)
  if (req.user.role !== 'admin') {
    query += ` AND t.assigned_to = ?`;
    params.push(req.user.id);
  } else if (assigned_to) {
    query += ` AND t.assigned_to = ?`;
    params.push(assigned_to);
  }

  if (status) {
    query += ` AND t.status = ?`;
    params.push(status);
  }
  query += ` ORDER BY t.due_date IS NULL, t.due_date ASC, t.priority DESC`;

  const rows = db.prepare(query).all(...params);
  return res.json({ tasks: rows });
}

/** PATCH /api/tasks/:id/status — employee updates own task, or admin updates any */
function updateTaskStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body;
  const valid = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (req.user.role !== 'admin' && task.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Cannot modify another employee\'s task' });
  }

  db.prepare(`UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  logAudit({ userId: req.user.id, action: 'TASK_STATUS_UPDATED', details: { taskId: id, status }, ip: req.ip });

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return res.json({ task: updated });
}

module.exports = { createTask, listTasks, updateTaskStatus };
