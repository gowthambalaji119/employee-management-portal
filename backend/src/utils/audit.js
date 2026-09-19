const db = require('../config/db');

const insertAudit = db.prepare(
  `INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)`
);

function logAudit({ userId = null, action, details = '', ip = '' }) {
  try {
    insertAudit.run(userId, action, typeof details === 'string' ? details : JSON.stringify(details), ip);
  } catch (err) {
    console.error('Audit log failure:', err.message);
  }
}

module.exports = { logAudit };
