const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, COUNTRIES, LINE_CLASSES } = require('./db');
const auth = require('./auth');
const igfa = require('./igfa-records');

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
// No 0/O or 1/I so codes survive being read out over the radio or WhatsApp.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

// Boat length in feet: optional, but if given it must be plausible.
function lengthFt(v) {
  const n = num(v);
  return n === null || (n >= 10 && n <= 200) ? n : NaN;
}

function newCode() {
  return Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
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
  // Hosts such as Render sit behind one proxy; trust it so req.ip is the visitor's.
  app.set('trust proxy', 1);
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });
  app.use(auth.sessionMiddleware(db));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const api = express.Router();

  const photoUrl = (file) => (file ? `/uploads/${file}` : null);

  function removeUpload(file) {
    if (file) fs.rm(path.join(uploadDir, path.basename(file)), { force: true }, () => {});
  }

  function requireTeam(req, res, next) {
    if (!req.user.teamId) {
      return res.status(403).json({ error: 'Join or register a boat to log catches.' });
    }
    next();
  }

  // ---- reference data (public, needed by the sign-up form) ---------------

  api.get('/meta', (_req, res) => {
    const species = db.prepare('SELECT id, name, scientific_name AS scientificName, category FROM species ORDER BY category, name').all();
    res.json({ countries: COUNTRIES, species, lineClasses: LINE_CLASSES });
  });

  // ---- auth --------------------------------------------------------------

  const loginLimit = auth.rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: (req) => `${req.ip}|${String(req.body.email ?? '').toLowerCase()}`,
    message: 'Too many sign-in attempts. Wait 15 minutes and try again.',
  });
  const registerLimit = auth.rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    key: (req) => req.ip,
    message: 'Too many new accounts from this connection. Try again later.',
  });

  api.post('/auth/register', registerLimit, (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120)?.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const country = str(req.body.country, 60);

    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Name and a valid email are required.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, email, password_hash, country) VALUES (?, ?, ?, ?)')
      .run(name, email, auth.hashPassword(password), country);
    auth.createSession(db, res, Number(lastInsertRowid), secureCookies);
    res.status(201).json({ user: getMe(Number(lastInsertRowid)) });
  });

  api.post('/auth/login', loginLimit, (req, res) => {
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
    const me = db.prepare(`
      SELECT u.id, u.name, u.email, u.country, u.bio, u.photo,
        t.id AS teamId, t.name AS teamName, t.captain_id = u.id AS isCaptain
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    const { photo, ...rest } = me;
    return { ...rest, photoUrl: photoUrl(photo), isCaptain: !!me.isCaptain };
  }

  api.get('/me', (req, res) => {
    res.json({ user: req.user ? getMe(req.user.id) : null });
  });

  // Anyone can look around; doing anything (posting, liking, joining) needs an account.
  api.use((req, res, next) => (req.method === 'GET' ? next() : auth.requireUser(req, res, next)));

  api.patch('/me', (req, res) => {
    const u = req.user;
    const name = 'name' in req.body ? str(req.body.name, 80) : u.name;
    const country = 'country' in req.body ? str(req.body.country, 60) : u.country;
    const bio = 'bio' in req.body ? str(req.body.bio, 500) : u.bio;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    db.prepare('UPDATE users SET name = ?, country = ?, bio = ? WHERE id = ?').run(name, country, bio, u.id);
    res.json({ user: getMe(u.id) });
  });

  api.post('/me/photo', upload.single('photo'), (req, res) => {
    if (savePhoto(req, res, 'users', req.user.id)) res.json({ user: getMe(req.user.id) });
  });

  // ---- clubs -------------------------------------------------------------

  api.get('/clubs', (_req, res) => {
    const clubs = db.prepare(`
      SELECT c.id, c.name, c.country, c.city, c.description,
        (SELECT COUNT(*) FROM teams t WHERE t.club_id = c.id) AS teams,
        (SELECT COUNT(*) FROM catches k WHERE k.club_id = c.id) AS catches
      FROM clubs c ORDER BY c.country, c.name
    `).all();
    res.json({ clubs });
  });

  api.post('/clubs', (req, res) => {
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
    res.status(201).json({ club: db.prepare('SELECT * FROM clubs WHERE id = ?').get(Number(lastInsertRowid)) });
  });

  api.get('/clubs/:id', (req, res) => {
    const id = intId(req.params.id);
    const club = id && db.prepare('SELECT id, name, country, city, description, created_at AS createdAt FROM clubs WHERE id = ?').get(id);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    const teams = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members,
        (SELECT COUNT(*) FROM catches k WHERE k.team_id = t.id) AS catches
      FROM teams t WHERE t.club_id = ? ORDER BY catches DESC, t.name
    `).all(id);
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE club_id = ?
    `).get(id);
    res.json({ club, teams, stats });
  });

  // ---- teams (boats) -----------------------------------------------------

  function validClub(clubId) {
    return !clubId || !!db.prepare('SELECT 1 FROM clubs WHERE id = ?').get(clubId);
  }

  // Released and weighed counts drive the bars on the participant cards.
  const TALLY = `COUNT(k.id) AS catches, COALESCE(SUM(k.released), 0) AS released,
    COUNT(k.weight_kg) AS weighed`;

  api.get('/teams', (_req, res) => {
    const teams = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.length_ft AS lengthFt, t.make, t.photo,
        c.id AS clubId, c.name AS clubName,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, ${TALLY}
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id LEFT JOIN catches k ON k.team_id = t.id
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE
    `).all();
    res.json({ teams: teams.map(({ photo, ...t }) => ({ ...t, photoUrl: photoUrl(photo) })) });
  });

  api.get('/anglers', (_req, res) => {
    const anglers = db.prepare(`
      SELECT u.id, u.name, u.country, u.photo, t.id AS teamId, t.name AS teamName, t.photo AS teamPhoto, ${TALLY}
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN catches k ON k.user_id = u.id
      GROUP BY u.id ORDER BY u.name COLLATE NOCASE
    `).all();
    // An angler without their own photo is shown with their boat's.
    res.json({
      anglers: anglers.map(({ photo, teamPhoto, ...a }) => ({ ...a, photoUrl: photoUrl(photo || teamPhoto) })),
    });
  });

  api.post('/teams', (req, res) => {
    if (req.user.teamId) return res.status(409).json({ error: 'Leave your current boat before registering a new one.' });
    const name = str(req.body.name, 80);
    const country = str(req.body.country, 60);
    const clubId = intId(req.body.clubId);
    const length = lengthFt(req.body.lengthFt);
    if (!name) return res.status(400).json({ error: 'Enter the boat name.' });
    if (Number.isNaN(length)) return res.status(400).json({ error: 'Boat length should be in feet, between 10 and 200.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (!validClub(clubId)) return res.status(400).json({ error: 'Unknown club.' });
    if (db.prepare('SELECT 1 FROM teams WHERE name = ?').get(name)) {
      return res.status(409).json({ error: 'A boat with that name is already registered. Ask its captain for the invite code.' });
    }
    let code = newCode();
    while (db.prepare('SELECT 1 FROM teams WHERE join_code = ?').get(code)) code = newCode();
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO teams (name, home_port, country, club_id, captain_id, join_code, length_ft, make)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, str(req.body.homePort, 80), country, clubId, req.user.id, code, length, str(req.body.make, 60));
    const id = Number(lastInsertRowid);
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(id, req.user.id);
    res.status(201).json({ team: getTeam(id, req.user.id), user: getMe(req.user.id) });
  });

  function getTeam(id, viewerId) {
    const team = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.captain_id AS captainId, t.join_code AS joinCode,
        t.length_ft AS lengthFt, t.make, t.photo, t.created_at AS createdAt, c.id AS clubId, c.name AS clubName
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id WHERE t.id = ?
    `).get(id);
    if (!team) return null;
    const members = db.prepare(`
      SELECT u.id, u.name, (SELECT COUNT(*) FROM catches k WHERE k.user_id = u.id AND k.team_id = ?) AS catches
      FROM users u WHERE u.team_id = ? ORDER BY u.id = ? DESC, u.name
    `).all(id, id, team.captainId ?? 0);
    const isMember = members.some((m) => m.id === viewerId);
    // The invite code is the key to the boat: crew only.
    if (!isMember) delete team.joinCode;
    const { photo, ...rest } = team;
    return { ...rest, photoUrl: photoUrl(photo), members, isMember, isCaptain: team.captainId === viewerId };
  }

  api.get('/teams/:id', (req, res) => {
    const id = intId(req.params.id);
    const team = id && getTeam(id, req.user?.id);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE team_id = ?
    `).get(id);
    res.json({ team, stats });
  });

  api.post('/teams/join', (req, res) => {
    if (req.user.teamId) return res.status(409).json({ error: 'Leave your current boat before joining another.' });
    const code = str(req.body.code, 12)?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const team = code && db.prepare('SELECT id, captain_id FROM teams WHERE join_code = ?').get(code);
    if (!team) return res.status(404).json({ error: 'No boat has that invite code. Check it with your captain.' });
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(team.id, req.user.id);
    // A boat whose captain left gets a new one from the next person aboard.
    if (!team.captain_id) db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(req.user.id, team.id);
    res.json({ team: getTeam(team.id, req.user.id), user: getMe(req.user.id) });
  });

  api.post('/teams/leave', (req, res) => {
    const teamId = req.user.teamId;
    if (!teamId) return res.status(400).json({ error: 'You are not on a boat.' });
    const team = db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId);
    const others = db.prepare('SELECT COUNT(*) AS n FROM users WHERE team_id = ? AND id != ?').get(teamId, req.user.id).n;
    if (team.captain_id === req.user.id && others > 0) {
      return res.status(409).json({ error: 'Hand the captaincy to another crew member before leaving.' });
    }
    db.prepare('UPDATE users SET team_id = NULL WHERE id = ?').run(req.user.id);
    if (team.captain_id === req.user.id) db.prepare('UPDATE teams SET captain_id = NULL WHERE id = ?').run(teamId);
    res.json({ user: getMe(req.user.id) });
  });

  // Captain-only actions on their own boat.
  function captainOf(req, res) {
    const id = intId(req.params.id);
    const team = id && db.prepare('SELECT id, captain_id FROM teams WHERE id = ?').get(id);
    if (!team) {
      res.status(404).json({ error: 'Boat not found.' });
      return null;
    }
    if (team.captain_id !== req.user.id) {
      res.status(403).json({ error: 'Only the captain can do that.' });
      return null;
    }
    return team;
  }

  api.patch('/teams/:id', (req, res) => {
    const team = captainOf(req, res);
    if (!team) return;
    const cur = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id);
    const name = 'name' in req.body ? str(req.body.name, 80) : cur.name;
    const homePort = 'homePort' in req.body ? str(req.body.homePort, 80) : cur.home_port;
    const country = 'country' in req.body ? str(req.body.country, 60) : cur.country;
    const clubId = 'clubId' in req.body ? intId(req.body.clubId) : cur.club_id;
    const length = 'lengthFt' in req.body ? lengthFt(req.body.lengthFt) : cur.length_ft;
    const make = 'make' in req.body ? str(req.body.make, 60) : cur.make;
    if (!name) return res.status(400).json({ error: 'Enter the boat name.' });
    if (Number.isNaN(length)) return res.status(400).json({ error: 'Boat length should be in feet, between 10 and 200.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (!validClub(clubId)) return res.status(400).json({ error: 'Unknown club.' });
    if (db.prepare('SELECT 1 FROM teams WHERE name = ? AND id != ?').get(name, team.id)) {
      return res.status(409).json({ error: 'Another boat already has that name.' });
    }
    db.prepare('UPDATE teams SET name = ?, home_port = ?, country = ?, club_id = ?, length_ft = ?, make = ? WHERE id = ?')
      .run(name, homePort, country, clubId, length, make, team.id);
    res.json({ team: getTeam(team.id, req.user.id) });
  });

  // Replaces a stored photo; the old file is removed once the new one is saved.
  function savePhoto(req, res, table, id) {
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload.' });
    const old = db.prepare(`SELECT photo FROM ${table} WHERE id = ?`).get(id)?.photo;
    db.prepare(`UPDATE ${table} SET photo = ? WHERE id = ?`).run(req.file.filename, id);
    removeUpload(old);
    return photoUrl(req.file.filename);
  }

  api.post('/teams/:id/photo', upload.single('photo'), (req, res) => {
    const team = captainOf(req, res);
    if (!team) return removeUpload(req.file?.filename);
    if (savePhoto(req, res, 'teams', team.id)) res.json({ team: getTeam(team.id, req.user.id) });
  });

  api.post('/teams/:id/code', (req, res) => {
    const team = captainOf(req, res);
    if (!team) return;
    let code = newCode();
    while (db.prepare('SELECT 1 FROM teams WHERE join_code = ?').get(code)) code = newCode();
    db.prepare('UPDATE teams SET join_code = ? WHERE id = ?').run(code, team.id);
    res.json({ team: getTeam(team.id, req.user.id) });
  });

  api.post('/teams/:id/captain', (req, res) => {
    const team = captainOf(req, res);
    if (!team) return;
    const userId = intId(req.body.userId);
    if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(userId, team.id)) {
      return res.status(400).json({ error: 'The new captain must be on this boat.' });
    }
    db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(userId, team.id);
    res.json({ team: getTeam(team.id, req.user.id) });
  });

  api.delete('/teams/:id/members/:userId', (req, res) => {
    const team = captainOf(req, res);
    if (!team) return;
    const userId = intId(req.params.userId);
    if (userId === req.user.id) return res.status(400).json({ error: 'Use "Leave boat" to leave yourself.' });
    const r = db.prepare('UPDATE users SET team_id = NULL WHERE id = ? AND team_id = ?').run(userId, team.id);
    if (!r.changes) return res.status(404).json({ error: 'That angler is not on this boat.' });
    res.json({ team: getTeam(team.id, req.user.id) });
  });

  // ---- catches -----------------------------------------------------------

  const CATCH_SELECT = `
    SELECT k.id, k.weight_kg AS weightKg, k.length_cm AS lengthCm, k.released, k.tagged,
      k.caught_on AS caughtOn, k.country, k.location, k.line_class AS lineClass,
      k.notes, k.photo, k.created_at AS createdAt, k.logged_by AS loggedBy,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, u.name AS angler,
      t.id AS teamId, t.name AS teamName,
      c.id AS clubId, c.name AS clubName,
      (SELECT COUNT(*) FROM likes l WHERE l.catch_id = k.id) AS likes,
      (SELECT COUNT(*) FROM comments m WHERE m.catch_id = k.id) AS comments,
      EXISTS (SELECT 1 FROM likes l WHERE l.catch_id = k.id AND l.user_id = :viewer) AS liked
    FROM catches k
    JOIN species s ON s.id = k.species_id
    JOIN users u ON u.id = k.user_id
    LEFT JOIN teams t ON t.id = k.team_id
    LEFT JOIN clubs c ON c.id = k.club_id
  `;

  function canDelete(row, user) {
    if (!user) return false;
    if (row.userId === user.id || row.loggedBy === user.id) return true;
    const team = row.teamId && db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(row.teamId);
    return !!team && team.captain_id === user.id;
  }

  function present(row, viewer) {
    return {
      ...row,
      released: !!row.released,
      tagged: !!row.tagged,
      liked: !!row.liked,
      photoUrl: photoUrl(row.photo),
      canDelete: canDelete(row, viewer),
      worldRecordKg: igfa.igfaRecord(row.species)?.kg ?? null,
    };
  }

  api.get('/catches', (req, res) => {
    const where = [];
    const params = { viewer: req.user?.id ?? 0 };
    const filters = {
      club: ['k.club_id = :club', intId],
      team: ['k.team_id = :team', intId],
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
    res.json({ catches: rows.map((r) => present(r, req.user)), nextBefore: rows.length === limit ? rows.at(-1).id : null });
  });

  api.post('/catches', requireTeam, upload.single('photo'), (req, res) => {
    const b = req.body;
    const fail = (msg) => {
      removeUpload(req.file?.filename);
      res.status(400).json({ error: msg });
    };
    const speciesId = intId(b.speciesId);
    if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) {
      return fail('Choose a species.');
    }
    // Any crew member can log a fish for whoever on the boat caught it.
    const anglerId = intId(b.anglerId) || req.user.id;
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(anglerId, req.user.teamId)) {
      return fail('The angler must be on your boat.');
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
    const lineClass = str(b.lineClass, 20);
    if (lineClass && !LINE_CLASSES.includes(lineClass)) return fail('Choose a line class from the list.');
    const team = db.prepare('SELECT club_id, country FROM teams WHERE id = ?').get(req.user.teamId);
    const country = str(b.country, 60) || team.country || req.user.country;
    if (country && !COUNTRIES.includes(country)) return fail('Unknown country.');

    const { lastInsertRowid } = db.prepare(`
      INSERT INTO catches (user_id, logged_by, team_id, club_id, species_id, weight_kg, length_cm, released, tagged,
        caught_on, country, location, line_class, notes, photo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      anglerId, req.user.id, req.user.teamId, team.club_id, speciesId, weightKg, lengthCm, bool(b.released),
      bool(b.tagged), caughtOn, country, str(b.location, 120), lineClass, str(b.notes, 2000),
      req.file?.filename ?? null
    );
    res.status(201).json({ catch: getCatch(Number(lastInsertRowid), req.user) });
  });

  function getCatch(id, viewer) {
    const row = db.prepare(`${CATCH_SELECT} WHERE k.id = :id`).get({ id, viewer: viewer?.id ?? 0 });
    return row ? present(row, viewer) : null;
  }

  api.get('/catches/:id', (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) return res.status(404).json({ error: 'Catch not found.' });
    const comments = db.prepare(`
      SELECT m.id, m.body, m.created_at AS createdAt, u.id AS userId, u.name AS author
      FROM comments m JOIN users u ON u.id = m.user_id
      WHERE m.catch_id = ? ORDER BY m.id
    `).all(id);
    res.json({ catch: item, comments });
  });

  api.delete('/catches/:id', (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) return res.status(404).json({ error: 'Catch not found.' });
    if (!item.canDelete) {
      return res.status(403).json({ error: 'Only the angler, whoever logged it, or the boat captain can delete this catch.' });
    }
    db.prepare('DELETE FROM catches WHERE id = ?').run(id);
    removeUpload(item.photo);
    res.json({ ok: true });
  });

  api.post('/catches/:id/like', (req, res) => {
    const id = intId(req.params.id);
    if (!id || !db.prepare('SELECT 1 FROM catches WHERE id = ?').get(id)) {
      return res.status(404).json({ error: 'Catch not found.' });
    }
    const removed = db.prepare('DELETE FROM likes WHERE user_id = ? AND catch_id = ?').run(req.user.id, id);
    if (!removed.changes) db.prepare('INSERT INTO likes (user_id, catch_id) VALUES (?, ?)').run(req.user.id, id);
    const { likes } = db.prepare('SELECT COUNT(*) AS likes FROM likes WHERE catch_id = ?').get(id);
    res.json({ liked: !removed.changes, likes });
  });

  api.post('/catches/:id/comments', (req, res) => {
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

  // ---- records -----------------------------------------------------------

  // IGFA all-tackle world records beside the heaviest fish logged here, plus
  // the app's own records for each species and line class.
  api.get('/records', (_req, res) => {
    const best = db.prepare(`
      SELECT * FROM (
        SELECT k.species_id AS speciesId, k.line_class AS lineClass, k.id AS catchId, k.weight_kg AS weightKg,
          k.caught_on AS caughtOn, u.id AS userId, u.name AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS overall,
          ROW_NUMBER() OVER (PARTITION BY k.species_id, k.line_class ORDER BY k.weight_kg DESC, k.id) AS inClass
        FROM catches k JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.weight_kg IS NOT NULL
      ) WHERE overall = 1 OR (inClass = 1 AND lineClass IS NOT NULL)
    `).all();
    const species = db.prepare('SELECT id, name, category FROM species ORDER BY category, name').all();
    const names = Object.fromEntries(species.map((s) => [s.id, s.name]));
    const strip = ({ overall, inClass, ...r }) => r;
    const lineOrder = (c) => (c === 'Unlimited' ? 1e9 : parseFloat(c));

    res.json({
      checked: igfa.CHECKED,
      igfaUrl: igfa.IGFA_SEARCH_URL,
      species: species.filter((s) => s.name !== 'Other').map((s) => {
        const top = best.find((b) => b.speciesId === s.id && b.overall === 1);
        return { ...s, igfa: igfa.igfaRecord(s.name), best: top ? strip(top) : null };
      }),
      lineRecords: best
        .filter((b) => b.inClass === 1 && b.lineClass)
        .map((b) => ({ species: names[b.speciesId], ...strip(b) }))
        .sort((a, b) => a.species.localeCompare(b.species) || lineOrder(a.lineClass) - lineOrder(b.lineClass)),
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
          u.id AS userId, u.name AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS rn
        FROM catches k JOIN species s ON s.id = k.species_id JOIN users u ON u.id = k.user_id
        LEFT JOIN teams t ON t.id = k.team_id
        WHERE ${filter} AND k.weight_kg IS NOT NULL
      ) WHERE rn = 1 ORDER BY weightKg DESC
    `).all(params).map(({ rn, ...r }) => r);

    const tally = `COUNT(*) AS catches, SUM(k.released) AS released,
      SUM(CASE WHEN s.category = 'Billfish' THEN 1 ELSE 0 END) AS billfish,
      ROUND(SUM(COALESCE(k.weight_kg, 0)), 1) AS totalKg`;

    const teams = db.prepare(`
      SELECT t.id AS teamId, t.name AS teamName, c.name AS clubName, ${tally}
      FROM catches k JOIN teams t ON t.id = k.team_id JOIN species s ON s.id = k.species_id
      LEFT JOIN clubs c ON c.id = t.club_id
      WHERE ${filter}
      GROUP BY t.id ORDER BY billfish DESC, catches DESC LIMIT 20
    `).all(params);

    const anglers = db.prepare(`
      SELECT u.id AS userId, u.name AS angler, t.name AS teamName, ${tally}
      FROM catches k JOIN users u ON u.id = k.user_id JOIN species s ON s.id = k.species_id
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE ${filter}
      GROUP BY u.id ORDER BY billfish DESC, catches DESC LIMIT 20
    `).all(params);

    const clubs = db.prepare(`
      SELECT c.id AS clubId, c.name AS clubName, c.country, ${tally}
      FROM catches k JOIN clubs c ON c.id = k.club_id JOIN species s ON s.id = k.species_id
      WHERE ${filter}
      GROUP BY c.id ORDER BY catches DESC LIMIT 20
    `).all(params);

    res.json({ records, teams, anglers, clubs });
  });

  // ---- profiles ----------------------------------------------------------

  api.get('/users/:id', (req, res) => {
    const id = intId(req.params.id);
    const user = id && db.prepare(`
      SELECT u.id, u.name, u.country, u.bio, u.photo, u.created_at AS joinedAt, t.id AS teamId, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    if (!user) return res.status(404).json({ error: 'Angler not found.' });
    user.photoUrl = photoUrl(user.photo);
    delete user.photo;
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
