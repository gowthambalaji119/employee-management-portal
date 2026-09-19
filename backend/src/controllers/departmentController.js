const db = require('../config/db');
const { logAudit } = require('../utils/audit');

/** GET /api/departments */
function listDepartments(req, res) {
  const rows = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.role='employee' AND u.is_active=1) as employee_count
    FROM departments d ORDER BY d.name ASC
  `).all();
  return res.json({ departments: rows });
}

/** POST /api/departments (admin) */
function createDepartment(req, res) {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Department already exists' });

  const result = db.prepare(`INSERT INTO departments (name, description) VALUES (?, ?)`).run(name, description || null);
  logAudit({ userId: req.user.id, action: 'DEPARTMENT_CREATED', details: { name }, ip: req.ip });

  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ department: dept });
}

/** PUT /api/departments/:id (admin) */
function updateDepartment(req, res) {
  const id = parseInt(req.params.id, 10);
  const { name, description } = req.body;
  const existing = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Department not found' });

  db.prepare(`UPDATE departments SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = datetime('now') WHERE id = ?`)
    .run(name || null, description || null, id);

  logAudit({ userId: req.user.id, action: 'DEPARTMENT_UPDATED', details: { id }, ip: req.ip });
  const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
  return res.json({ department: updated });
}

/** DELETE /api/departments/:id (admin) */
function deleteDepartment(req, res) {
  const id = parseInt(req.params.id, 10);
  const inUse = db.prepare('SELECT COUNT(*) as c FROM users WHERE department_id = ?').get(id).c;
  if (inUse > 0) return res.status(409).json({ error: 'Cannot delete a department with assigned employees' });

  db.prepare('DELETE FROM departments WHERE id = ?').run(id);
  logAudit({ userId: req.user.id, action: 'DEPARTMENT_DELETED', details: { id }, ip: req.ip });
  return res.json({ message: 'Department deleted' });
}

module.exports = { listDepartments, createDepartment, updateDepartment, deleteDepartment };
