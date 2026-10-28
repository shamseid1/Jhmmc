const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, COUNTRIES } = require('./db');
const auth = require('./auth');

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function str(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function bool(v) {
  return v === true || v === 'true' || v === '1' || v === 'on' ? 1 : 0;
}

function intId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function createApp({ dbFile = 'data/fishing.db', uploadDir = 'uploads', secureCookies = false } = {}) {
  const db = openDb(dbFile);
  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) =>
        cb(null, crypto.randomBytes(12).toString('hex') + PHOTO_TYPES[file.mimetype]),
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (PHOTO_TYPES[file.mimetype]) cb(null, true);
      else cb(Object.assign(new Error('Photo must be JPEG, PNG or WebP.'), { status: 400 }));
    },
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });
  app.use(auth.sessionMiddleware(db));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();

  // ---- reference data ----------------------------------------------------

  api.get('/meta', (_req, res) => {
    const species = db.prepare('SELECT id, name, scientific_name AS scientificName, category FROM species ORDER BY category, name').all();
    res.json({ countries: COUNTRIES, species });
  });

  // ---- auth --------------------------------------------------------------

  api.post('/auth/register', (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120)?.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const country = str(req.body.country, 60);
    const clubId = intId(req.body.clubId);

    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Name and a valid email are required.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (clubId && !db.prepare('SELECT 1 FROM clubs WHERE id = ?').get(clubId)) {
      return res.status(400).json({ error: 'Unknown club.' });
    }
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash, country, club_id) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, auth.hashPassword(password), country, clubId);
    auth.createSession(db, res, Number(lastInsertRowid), secureCookies);
    res.status(201).json({ user: getMe(Number(lastInsertRowid)) });
  });

  api.post('/auth/login', (req, res) => {
    const email = str(req.body.email, 120)?.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const row = email && db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!row || !auth.verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    auth.createSession(db, res, row.id, secureCookies);
    res.json({ user: getMe(row.id) });
  });

  api.post('/auth/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  function getMe(id) {
    return db.prepare(`
      SELECT u.id, u.name, u.email, u.country, u.bio, u.club_id AS clubId, c.name AS clubName
      FROM users u LEFT JOIN clubs c ON c.id = u.club_id WHERE u.id = ?
    `).get(id);
  }

  api.get('/me', (req, res) => {
    res.json({ user: req.user ? getMe(req.user.id) : null });
  });

  api.patch('/me', auth.requireUser, (req, res) => {
    const u = req.user;
    const name = 'name' in req.body ? str(req.body.name, 80) : u.name;
    const country = 'country' in req.body ? str(req.body.country, 60) : u.country;
    const bio = 'bio' in req.body ? str(req.body.bio, 500) : u.bio;
    const clubId = 'clubId' in req.body ? intId(req.body.clubId) : u.clubId;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (clubId && !db.prepare('SELECT 1 FROM clubs WHERE id = ?').get(clubId)) {
      return res.status(400).json({ error: 'Unknown club.' });
    }
    db.prepare('UPDATE users SET name = ?, country = ?, bio = ?, club_id = ? WHERE id = ?')
      .run(name, country, bio, clubId, u.id);
    res.json({ user: getMe(u.id) });
  });

  // ---- clubs -------------------------------------------------------------

  api.get('/clubs', (_req, res) => {
    const clubs = db.prepare(`
      SELECT c.id, c.name, c.country, c.city, c.description,
        (SELECT COUNT(*) FROM users u WHERE u.club_id = c.id) AS members,
        (SELECT COUNT(*) FROM catches k WHERE k.club_id = c.id) AS catches
      FROM clubs c ORDER BY c.country, c.name
    `).all();
    res.json({ clubs });
  });

  api.post('/clubs', auth.requireUser, (req, res) => {
    const name = str(req.body.name, 100);
    const country = str(req.body.country, 60);
    if (!name || !COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'Club name and a West African country are required.' });
    }
    if (db.prepare('SELECT 1 FROM clubs WHERE name = ?').get(name)) {
      return res.status(409).json({ error: 'A club with that name already exists.' });
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO clubs (name, country, city, description, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(name, country, str(req.body.city, 80), str(req.body.description, 1000), req.user.id);
    const id = Number(lastInsertRowid);
    // The founder joins the new club if they are not in one yet.
    if (!req.user.clubId) db.prepare('UPDATE users SET club_id = ? WHERE id = ?').run(id, req.user.id);
    res.status(201).json({ club: db.prepare('SELECT * FROM clubs WHERE id = ?').get(id) });
  });

  api.get('/clubs/:id', (req, res) => {
    const id = intId(req.params.id);
    const club = id && db.prepare('SELECT id, name, country, city, description, created_at AS createdAt FROM clubs WHERE id = ?').get(id);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    const members = db.prepare(`
      SELECT u.id, u.name,
        (SELECT COUNT(*) FROM catches k WHERE k.user_id = u.id) AS catches
      FROM users u WHERE u.club_id = ? ORDER BY catches DESC, u.name
    `).all(id);
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released,
        MAX(weight_kg) AS heaviestKg
      FROM catches WHERE club_id = ?
    `).get(id);
    res.json({ club, members, stats });
  });

  // ---- catches -----------------------------------------------------------

  const CATCH_SELECT = `
    SELECT k.id, k.weight_kg AS weightKg, k.length_cm AS lengthCm, k.released, k.tagged,
      k.caught_on AS caughtOn, k.country, k.location, k.boat, k.line_class AS lineClass,
      k.notes, k.photo, k.created_at AS createdAt,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, u.name AS angler,
      c.id AS clubId, c.name AS clubName,
      (SELECT COUNT(*) FROM likes l WHERE l.catch_id = k.id) AS likes,
      (SELECT COUNT(*) FROM comments m WHERE m.catch_id = k.id) AS comments,
      EXISTS (SELECT 1 FROM likes l WHERE l.catch_id = k.id AND l.user_id = :viewer) AS liked
    FROM catches k
    JOIN species s ON s.id = k.species_id
    JOIN users u ON u.id = k.user_id
    LEFT JOIN clubs c ON c.id = k.club_id
  `;

  function present(row) {
    return {
      ...row,
      released: !!row.released,
      tagged: !!row.tagged,
      liked: !!row.liked,
      photoUrl: row.photo ? `/uploads/${row.photo}` : null,
    };
  }

  api.get('/catches', (req, res) => {
    const where = [];
    const params = { viewer: req.user?.id ?? 0 };
    const filters = {
      club: ['k.club_id = :club', intId],
      species: ['k.species_id = :species', intId],
      user: ['k.user_id = :user', intId],
      country: ['k.country = :country', (v) => str(v, 60)],
      before: ['k.id < :before', intId],
    };
    for (const [key, [clause, parse]] of Object.entries(filters)) {
      const v = req.query[key] !== undefined ? parse(req.query[key]) : null;
      if (v !== null) {
        where.push(clause);
        params[key] = v;
      }
    }
    if (req.query.released === 'true') where.push('k.released = 1');
    const limit = Math.min(intId(req.query.limit) || 20, 50);
    const rows = db.prepare(
      `${CATCH_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.id DESC LIMIT ${limit}`
    ).all(params);
    res.json({ catches: rows.map(present), nextBefore: rows.length === limit ? rows.at(-1).id : null });
  });

  function removeUpload(file) {
    if (file) fs.rm(path.join(uploadDir, path.basename(file)), { force: true }, () => {});
  }

  api.post('/catches', auth.requireUser, upload.single('photo'), (req, res) => {
    const b = req.body;
    const fail = (msg) => {
      removeUpload(req.file?.filename);
      res.status(400).json({ error: msg });
    };
    const speciesId = intId(b.speciesId);
    if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) {
      return fail('Choose a species.');
    }
    const weightKg = num(b.weightKg);
    const lengthCm = num(b.lengthCm);
    if (Number.isNaN(weightKg) || Number.isNaN(lengthCm)) return fail('Weight and length must be positive numbers.');
    if (weightKg !== null && weightKg > 1500) return fail('Weight looks too large — enter it in kilograms.');
    const caughtOn = str(b.caughtOn, 10);
    if (!caughtOn || !/^\d{4}-\d{2}-\d{2}$/.test(caughtOn) || Number.isNaN(Date.parse(caughtOn))) {
      return fail('Enter the date of the catch.');
    }
    if (Date.parse(caughtOn) > Date.now() + 864e5) return fail('Catch date cannot be in the future.');
    const country = str(b.country, 60) || req.user.country;
    if (country && !COUNTRIES.includes(country)) return fail('Unknown country.');

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO catches (user_id, club_id, species_id, weight_kg, length_cm, released, tagged,
        caught_on, country, location, boat, line_class, notes, photo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, req.user.clubId, speciesId, weightKg, lengthCm, bool(b.released), bool(b.tagged),
      caughtOn, country, str(b.location, 120), str(b.boat, 80), str(b.lineClass, 20),
      str(b.notes, 2000), req.file?.filename ?? null
    );
    res.status(201).json({ catch: getCatch(Number(lastInsertRowid), req.user.id) });
  });

  function getCatch(id, viewer) {
    const row = db.prepare(`${CATCH_SELECT} WHERE k.id = :id`).get({ id, viewer: viewer ?? 0 });
    return row ? present(row) : null;
  }

  api.get('/catches/:id', (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user?.id);
    if (!item) return res.status(404).json({ error: 'Catch not found.' });
    const comments = db.prepare(`
      SELECT m.id, m.body, m.created_at AS createdAt, u.id AS userId, u.name AS author
      FROM comments m JOIN users u ON u.id = m.user_id
      WHERE m.catch_id = ? ORDER BY m.id
    `).all(id);
    res.json({ catch: item, comments });
  });

  api.delete('/catches/:id', auth.requireUser, (req, res) => {
    const id = intId(req.params.id);
    const row = id && db.prepare('SELECT user_id, photo FROM catches WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Catch not found.' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own catches.' });
    db.prepare('DELETE FROM catches WHERE id = ?').run(id);
    removeUpload(row.photo);
    res.json({ ok: true });
  });

  api.post('/catches/:id/like', auth.requireUser, (req, res) => {
    const id = intId(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM catches WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Catch not found.' });
    }
    const removed = db.prepare('DELETE FROM likes WHERE user_id = ? AND catch_id = ?').run(req.user.id, id);
    if (!removed.changes) db.prepare('INSERT INTO likes (user_id, catch_id) VALUES (?, ?)').run(req.user.id, id);
    const { likes } = db.prepare('SELECT COUNT(*) AS likes FROM likes WHERE catch_id = ?').get(id);
    res.json({ liked: !removed.changes, likes });
  });

  api.post('/catches/:id/comments', auth.requireUser, (req, res) => {
    const id = intId(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM catches WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Catch not found.' });
    }
    const body = str(req.body.body, 1000);
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
    const { lastInsertRowid } = db
      .prepare('INSERT INTO comments (catch_id, user_id, body) VALUES (?, ?, ?)')
      .run(id, req.user.id, body);
    res.status(201).json({
      comment: { id: Number(lastInsertRowid), body, userId: req.user.id, author: req.user.name },
    });
  });

  // ---- leaderboard -------------------------------------------------------

  api.get('/leaderboard', (req, res) => {
    const year = /^\d{4}$/.test(req.query.year ?? '') ? req.query.year : null;
    const country = str(req.query.country, 60);
    const where = ['1 = 1'];
    const params = {};
    if (year) {
      where.push("strftime('%Y', k.caught_on) = :year");
      params.year = year;
    }
    if (country) {
      where.push('k.country = :country');
      params.country = country;
    }
    const filter = where.join(' AND ');

    // Heaviest weighed fish of each species.
    const records = db.prepare(`
      SELECT * FROM (
        SELECT s.name AS species, s.category, k.id, k.weight_kg AS weightKg, k.caught_on AS caughtOn,
          u.id AS userId, u.name AS angler, c.name AS clubName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS rn
        FROM catches k JOIN species s ON s.id = k.species_id JOIN users u ON u.id = k.user_id
        LEFT JOIN clubs c ON c.id = k.club_id
        WHERE ${filter} AND k.weight_kg IS NOT NULL
      ) WHERE rn = 1 ORDER BY weightKg DESC
    `).all(params).map(({ rn, ...r }) => r);

    const anglers = db.prepare(`
      SELECT u.id AS userId, u.name AS angler, c.name AS clubName,
        COUNT(*) AS catches, SUM(k.released) AS released,
        SUM(CASE WHEN s.category = 'Billfish' THEN 1 ELSE 0 END) AS billfish
      FROM catches k JOIN users u ON u.id = k.user_id JOIN species s ON s.id = k.species_id
      LEFT JOIN clubs c ON c.id = u.club_id
      WHERE ${filter}
      GROUP BY u.id ORDER BY billfish DESC, catches DESC LIMIT 20
    `).all(params);

    const clubs = db.prepare(`
      SELECT c.id AS clubId, c.name AS clubName, c.country,
        COUNT(*) AS catches, SUM(k.released) AS released, ROUND(SUM(COALESCE(k.weight_kg, 0)), 1) AS totalKg
      FROM catches k JOIN clubs c ON c.id = k.club_id
      WHERE ${filter}
      GROUP BY c.id ORDER BY catches DESC LIMIT 20
    `).all(params);

    res.json({ records, anglers, clubs });
  });

  // ---- profiles ----------------------------------------------------------

  api.get('/users/:id', (req, res) => {
    const id = intId(req.params.id);
    const user = id && db.prepare(`
      SELECT u.id, u.name, u.country, u.bio, u.created_at AS joinedAt, c.id AS clubId, c.name AS clubName
      FROM users u LEFT JOIN clubs c ON c.id = u.club_id WHERE u.id = ?
    `).get(id);
    if (!user) return res.status(404).json({ error: 'Angler not found.' });
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE user_id = ?
    `).get(id);
    res.json({ user, stats });
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Single-page app: let the client router handle everything else.
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use((err, req, res, _next) => {
    removeUpload(req.file?.filename);
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 8 MB.' : status === 500 ? 'Something went wrong.' : err.message,
    });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
