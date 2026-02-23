const jwt = require('jsonwebtoken');

function buildAuthMiddleware({ jwtSecret }) {
  function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
    try {
      req.user = jwt.verify(header.slice(7), jwtSecret);
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  function requireRole(...allowedRoles) {
    const allow = new Set(allowedRoles);
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      if (!allow.has(req.user.role || 'user')) return res.status(403).json({ error: 'Forbidden' });
      next();
    };
  }

  return { requireAuth, requireRole };
}

module.exports = { buildAuthMiddleware };
