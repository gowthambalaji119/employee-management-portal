/**
 * Restrict a route to specific role(s).
 * Usage: requireRole('admin') or requireRole('admin', 'employee')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient privileges' });
    }
    next();
  };
}

/**
 * Ensures an employee can only access their OWN resource unless they are admin.
 * Expects the target user id to be available as req.params.userId (or req.params.id).
 */
function requireSelfOrAdmin(paramName = 'userId') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const targetId = parseInt(req.params[paramName], 10);
    if (req.user.role === 'admin') return next();
    if (req.user.id === targetId) return next();
    return res.status(403).json({ error: 'Forbidden: cannot access another employee\'s data' });
  };
}

module.exports = { requireRole, requireSelfOrAdmin };
