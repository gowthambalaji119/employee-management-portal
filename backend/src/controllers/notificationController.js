const db = require('../config/db');

/** GET /api/notifications — current user's notifications */
function listNotifications(req, res) {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id);
  const unreadCount = db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0`).get(req.user.id).c;
  return res.json({ notifications: rows, unreadCount });
}

/** PATCH /api/notifications/:id/read */
function markRead(req, res) {
  const id = parseInt(req.params.id, 10);
  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  if (notif.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id);
  return res.json({ message: 'Marked as read' });
}

/** PATCH /api/notifications/read-all */
function markAllRead(req, res) {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user.id);
  return res.json({ message: 'All marked as read' });
}

module.exports = { listNotifications, markRead, markAllRead };
