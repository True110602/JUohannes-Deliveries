const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied.' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    req.user = decoded;
    next();
  });
}

// Combines token auth with a role check, e.g.
// app.post('/api/catalog', ...requireRole('merchant'), handler)
function requireRole(...roles) {
  return [authenticateToken, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: your account does not have access to this.' });
    }
    next();
  }];
}

module.exports = { authenticateToken, requireRole, JWT_SECRET };
