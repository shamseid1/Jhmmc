const crypto = require('node:crypto');

const SESSION_DAYS = 30;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires.toISOString());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires,
    path: '/',
  });
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

// Attaches req.user (or null) from the session cookie.
function sessionMiddleware(db) {
  const lookup = db.prepare(`
    SELECT u.id, u.name, u.email, u.country, u.team_id AS teamId, u.bio
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `);
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.user = token ? lookup.get(token, new Date().toISOString()) || null : null;
    next();
  };
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in first.' });
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionMiddleware,
  requireUser,
};
