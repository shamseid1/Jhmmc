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

// Signs a user out everywhere, e.g. after their password changes.
function destroyAllSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

const RESET_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Returns a fresh reset token for the user; only its hash is kept.
function createResetToken(db, userId, minutes = RESET_MINUTES) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + minutes * 60e3).toISOString();
  db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(userId, new Date().toISOString());
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return token;
}

// The user id for a valid, unused, unexpired token, marking it used; otherwise null.
function useResetToken(db, token) {
  if (typeof token !== 'string' || !token) return null;
  const row = db.prepare(`
    SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(sha256(token), new Date().toISOString());
  if (!row) return null;
  db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(new Date().toISOString(), sha256(token));
  return row.user_id;
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

// Attaches req.user (or null) from the session cookie.
function sessionMiddleware(db) {
  const lookup = db.prepare(`
    SELECT u.id, u.name, u.email, u.country, u.team_id AS teamId, u.bio, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `);
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.user = token ? lookup.get(token, new Date().toISOString()) || null : null;
    next();
  };
}

// Simple in-memory limiter: at most `max` attempts per key in each window.
// Enough for a single server; slows down password guessing.
function rateLimit({ windowMs, max, key, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (hits.size > 10000) {
      for (const [hk, e] of hits) if (e.reset <= now) hits.delete(hk);
    }
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
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
  destroyAllSessions,
  createResetToken,
  useResetToken,
  RESET_MINUTES,
  sessionMiddleware,
  requireUser,
  rateLimit,
};
