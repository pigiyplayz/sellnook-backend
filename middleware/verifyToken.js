const { auth } = require('../firebase');

const DEVELOPER_EMAIL = 'austinmalick9@gmail.com';

// ── Verify Firebase ID token ───────────────────────────────
// Attach this to any route that requires a logged-in user.
// The frontend sends the token in the Authorization header.
async function verifyToken(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split('Bearer ')[1];

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded; // uid, email, etc. now available on req.user
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Developer-only middleware ──────────────────────────────
// Must be used AFTER verifyToken so req.user is populated.
function devOnly(req, res, next) {
  if (req.user.email !== DEVELOPER_EMAIL) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { verifyToken, devOnly, DEVELOPER_EMAIL };
