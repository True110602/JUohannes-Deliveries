const jwt = require('jsonwebtoken');

// CRITICAL: no hardcoded fallback here. A fallback secret that's visible
// in a public/shared repo means anyone could forge a valid token for any
// account (including admin) by signing their own JWT with that same
// known string. This must be set explicitly in the environment.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('------------------------------------------------------------');
  console.error('CRITICAL ERROR: JWT_SECRET is not set.');
  console.error('Set it in your environment variables (Render \u2192 Environment)');
  console.error('to a long, random string - e.g. generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('------------------------------------------------------------');
  process.exit(1);
}

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
