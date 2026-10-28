const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, COUNTRIES, LINE_CLASSES, HOME_CLUB, WEIGH_STATIONS } = require('./db');
const scoring = require('./scoring');
const auth = require('./auth');
const igfa = require('./igfa-records');
const { createMailer } = require('./mail');

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

function createApp({
  dbFile = 'data/fishing.db',
  uploadDir = 'uploads',
  secureCookies = false,
  mailer = createMailer(),
  appUrl = process.env.APP_URL,
  // The person members contact for help; their account is the app's admin.
  adminEmail = process.env.ADMIN_EMAIL,
} = {}) {
  adminEmail = adminEmail?.trim().toLowerCase() || null;
  const db = openDb(dbFile);
  fs.mkdirSync(uploadDir, { recursive: true });

  const MAX_FISH_PER_SHEET = 30;
  const photoUploads = (files) => multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) =>
        cb(null, crypto.randomBytes(12).toString('hex') + PHOTO_TYPES[file.mimetype]),
    }),
    limits: { fileSize: 8 * 1024 * 1024, files },
    fileFilter: (_req, file, cb) => {
      if (PHOTO_TYPES[file.mimetype]) cb(null, true);
      else cb(Object.assign(new Error('Photo must be JPEG, PNG or WebP.'), { status: 400 }));
    },
  });
  const upload = photoUploads(1);
  const sheetUpload = photoUploads(MAX_FISH_PER_SHEET);

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
  app.get('/scoring.js', (_req, res) => res.sendFile(path.join(__dirname, 'scoring.js')));

  const api = express.Router();

  const photoUrl = (file) => (file ? `/uploads/${file}` : null);

  function removeUpload(file) {
    if (file) fs.rm(path.join(uploadDir, path.basename(file)), { force: true }, () => {});
  }

  const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  // JHMMC's own scoring (weigh-in, approval, points) applies to its boats only.
  const homeClubId = () => db.prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(HOME_CLUB.name)?.id ?? null;
  // Two separate books: members' feed posts (status 'unofficial') make the
  // West Africa feed, leaderboards and records; JHMMC's own figures come only
  // from weighmaster registrations the secretary approved.
  const clubBook = (clubId) => (clubId === homeClubId() ? 'approved' : 'unofficial');

  // Club officials: the admin (ADMIN_EMAIL), secretaries who approve points,
  // and weighmasters who record official weights at the dock.
  const isAdminUser = (u) => !!adminEmail && u?.email?.toLowerCase() === adminEmail;
  const canReview = (u) => isAdminUser(u) || u?.role === 'secretary';
  const canWeigh = (u) => canReview(u) || u?.role === 'weighmaster';
  const requireOfficial = (check, who) => (req, res, next) =>
    check(req.user) ? next() : res.status(403).json({ error: `Only ${who} can do that.` });
  const requireWeigh = requireOfficial(canWeigh, 'a JHMMC weighmaster or the secretary');
  const requireReview = requireOfficial(canReview, 'the JHMMC secretary');

  // ---- reference data (public, needed by the sign-up form) ---------------

  api.get('/meta', (_req, res) => {
    const species = db.prepare(`
      SELECT id, name, scientific_name AS scientificName, category, points_per_kg AS pointsPerKg FROM species ORDER BY category, name
    `).all();
    res.json({
      countries: COUNTRIES, species, lineClasses: LINE_CLASSES, homeClub: HOME_CLUB.name,
      emailEnabled: mailer.configured, adminEmail, weighStations: WEIGH_STATIONS, homeClubId: homeClubId(),
      season: { start: setting('season_start'), end: setting('season_end') },
    });
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

  // ---- password reset and change ---------------------------------------

  const forgotLimit = auth.rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    key: (req) => `${req.ip}|${String(req.body.email ?? '').toLowerCase()}`,
    message: 'Too many reset requests. Try again in an hour.',
  });

  // The address people reach the app at, for links in emails.
  const baseUrl = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  function passwordChangedEmail(user, req) {
    return mailer.send({
      to: user.email,
      subject: 'Your West Africa Big Game password was changed',
      text: `Hello ${user.name},\n\nThe password for your West Africa Big Game account was just changed. ` +
        `If this was you, there is nothing to do.\n\nIf it wasn't, reset your password straight away at ` +
        `${baseUrl(req)}/#/forgot and tell your club.\n`,
    }).catch((err) => console.error('Password-changed email failed:', err.message));
  }

  api.post('/auth/forgot', forgotLimit, async (req, res) => {
    const email = str(req.body.email, 120)?.toLowerCase();
    // Same answer whether or not the account exists, so emails can't be probed.
    const reply = { ok: true, message: 'If an account uses that email, a reset link is on its way. Check your inbox and spam folder.' };
    if (!mailer.configured) {
      return res.status(503).json({
        error: adminEmail
          ? `Password reset by email isn't available yet. Email ${adminEmail} from the address you signed up with and the admin will send you a reset link.`
          : "Password reset by email isn't available yet. Ask your club for help.",
      });
    }
    const user = email && db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) return res.json(reply);
    const link = `${baseUrl(req)}/#/reset?token=${auth.createResetToken(db, user.id)}`;
    try {
      await mailer.send({
        to: user.email,
        subject: 'Reset your West Africa Big Game password',
        text: `Hello ${user.name},\n\nSomeone asked to reset the password for your West Africa Big Game account. ` +
          `To choose a new password, open this link within ${auth.RESET_MINUTES} minutes:\n\n${link}\n\n` +
          `If you didn't ask for this, ignore this email; your password stays the same.\n`,
      });
    } catch (err) {
      console.error('Reset email failed:', err.message);
      return res.status(502).json({ error: "We couldn't send the email just now. Try again in a few minutes." });
    }
    res.json(reply);
  });

  api.post('/auth/reset', (req, res) => {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const userId = auth.useResetToken(db, req.body.token);
    if (!userId) {
      return res.status(400).json({ error: 'This reset link has expired or was already used. Ask for a new one.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), userId);
    auth.destroyAllSessions(db, userId);
    auth.createSession(db, res, userId, secureCookies);
    const user = getMe(userId);
    passwordChangedEmail(user, req);
    res.json({ user });
  });

  api.post('/auth/logout', (req, res) => {
    auth.destroySession(db, req, res);
    res.json({ ok: true });
  });

  function getMe(id) {
    const me = db.prepare(`
      SELECT u.id, u.name, u.email, u.country, u.bio, u.photo,
        t.id AS teamId, t.name AS teamName, t.captain_id = u.id AS isCaptain, t.club_id AS clubId, u.role, u.weigh_station AS weighStation
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    const { photo, ...rest } = me;
    return {
      ...rest, photoUrl: photoUrl(photo), isCaptain: !!me.isCaptain,
      isAdmin: isAdminUser(me), canWeigh: canWeigh(me), canReview: canReview(me),
    };
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

  api.post('/me/password', (req, res) => {
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(current, row.password_hash)) return res.status(400).json({ error: 'Your current password is not right.' });
    if (password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), req.user.id);
    // Sign out every other device, keep this one signed in.
    auth.destroyAllSessions(db, req.user.id);
    auth.createSession(db, res, req.user.id, secureCookies);
    passwordChangedEmail(getMe(req.user.id), req);
    res.json({ ok: true });
  });

  // ---- admin -------------------------------------------------------------

  const ADMIN_LINK_HOURS = 24;

  function requireAdmin(req, res, next) {
    if (!adminEmail || req.user?.email?.toLowerCase() !== adminEmail) {
      return res.status(403).json({ error: 'Only the club admin can do that.' });
    }
    next();
  }

  api.get('/admin/users', requireAdmin, (_req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.weigh_station AS weighStation, u.created_at AS joinedAt, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.name COLLATE NOCASE
    `).all();
    res.json({ users });
  });

  api.patch('/admin/users/:id', requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const cur = id && db.prepare('SELECT role, weigh_station FROM users WHERE id = ?').get(id);
    if (!cur) return res.status(404).json({ error: 'Member not found.' });
    const role = 'role' in req.body ? req.body.role || null : cur.role;
    if (role && !['weighmaster', 'secretary'].includes(role)) return res.status(400).json({ error: 'Unknown role.' });
    // Each weighmaster works at one weigh station, chosen here by the admin.
    let station = 'weighStation' in req.body ? req.body.weighStation || null : cur.weigh_station;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    if (!role) station = null;
    db.prepare('UPDATE users SET role = ?, weigh_station = ? WHERE id = ?').run(role, station, id);
    res.json({ ok: true, role, weighStation: station });
  });

  // A one-time link the admin passes on (e.g. by WhatsApp) to a member who forgot their password.
  api.post('/admin/users/:id/reset-link', requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const user = id && db.prepare('SELECT id, name FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    const token = auth.createResetToken(db, user.id, ADMIN_LINK_HOURS * 60);
    res.json({ link: `${baseUrl(req)}/#/reset?token=${token}`, hours: ADMIN_LINK_HOURS, name: user.name });
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
        (SELECT COUNT(*) FROM catches k WHERE k.team_id = t.id AND k.status = ?) AS catches
      FROM teams t WHERE t.club_id = ? ORDER BY catches DESC, t.name
    `).all(clubBook(id), id);
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE club_id = ? AND status = ?
    `).get(id, clubBook(id));
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
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.length_ft AS lengthFt, t.make, t.photo, t.division,
        c.id AS clubId, c.name AS clubName,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, ${TALLY}
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id LEFT JOIN catches k ON k.team_id = t.id AND k.status = 'unofficial'
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE
    `).all();
    res.json({ teams: teams.map(({ photo, ...t }) => ({ ...t, photoUrl: photoUrl(photo) })) });
  });

  api.get('/anglers', (_req, res) => {
    const anglers = db.prepare(`
      SELECT u.id, u.name, u.country, u.photo, t.id AS teamId, t.name AS teamName, t.photo AS teamPhoto, ${TALLY}
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN catches k ON k.user_id = u.id AND k.status = 'unofficial'
      GROUP BY u.id ORDER BY u.name COLLATE NOCASE
    `).all();
    // Anglers without an account, known only by the name typed on their catches.
    const guests = db.prepare(`
      SELECT NULL AS id, k.angler_name AS name, t.id AS teamId, t.name AS teamName,
        t.photo AS teamPhoto, MIN(k.id) AS first, ${TALLY}
      FROM catches k LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.user_id IS NULL AND k.status = 'unofficial' GROUP BY lower(k.angler_name)
    `).all();
    // An angler without their own photo is shown with their boat's.
    res.json({
      anglers: [...anglers, ...guests]
        .map(({ photo, teamPhoto, first, ...a }) => ({ ...a, hasAccount: a.id !== null, photoUrl: photoUrl(photo || teamPhoto) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    });
  });

  api.post('/teams', (req, res) => {
    if (req.user.teamId) return res.status(409).json({ error: 'Leave your current boat before registering a new one.' });
    const name = str(req.body.name, 80);
    const country = str(req.body.country, 60);
    const clubId = intId(req.body.clubId);
    const length = lengthFt(req.body.lengthFt);
    const division = clubId === homeClubId() && req.body.division === 'river' ? 'river' : 'ocean';
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
      INSERT INTO teams (name, home_port, country, club_id, captain_id, join_code, length_ft, make, division)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, str(req.body.homePort, 80), country, clubId, req.user.id, code, length, str(req.body.make, 60), division);
    const id = Number(lastInsertRowid);
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(id, req.user.id);
    res.status(201).json({ team: getTeam(id, req.user.id), user: getMe(req.user.id) });
  });

  function getTeam(id, viewerId) {
    const team = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.captain_id AS captainId, t.join_code AS joinCode,
        t.length_ft AS lengthFt, t.make, t.photo, t.division, t.created_at AS createdAt, c.id AS clubId, c.name AS clubName
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
    // Names typed for anglers without an account, so the captain can move them to one.
    const guests = db.prepare(`
      SELECT angler_name AS name, MIN(id) AS first, COUNT(*) AS catches FROM catches
      WHERE team_id = ? AND user_id IS NULL GROUP BY lower(angler_name) ORDER BY name COLLATE NOCASE
    `).all(id).map(({ first, ...g }) => g);
    const { photo, ...rest } = team;
    return { ...rest, photoUrl: photoUrl(photo), members, guests, isMember, isCaptain: team.captainId === viewerId };
  }

  api.get('/teams/:id', (req, res) => {
    const id = intId(req.params.id);
    const team = id && getTeam(id, req.user?.id);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE team_id = ? AND status = 'unofficial'
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
    const division = clubId !== homeClubId() ? 'ocean'
      : 'division' in req.body ? (req.body.division === 'river' ? 'river' : 'ocean') : cur.division;
    if (!name) return res.status(400).json({ error: 'Enter the boat name.' });
    if (Number.isNaN(length)) return res.status(400).json({ error: 'Boat length should be in feet, between 10 and 200.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (!validClub(clubId)) return res.status(400).json({ error: 'Unknown club.' });
    if (db.prepare('SELECT 1 FROM teams WHERE name = ? AND id != ?').get(name, team.id)) {
      return res.status(409).json({ error: 'Another boat already has that name.' });
    }
    db.prepare('UPDATE teams SET name = ?, home_port = ?, country = ?, club_id = ?, length_ft = ?, make = ?, division = ? WHERE id = ?')
      .run(name, homePort, country, clubId, length, make, division, team.id);
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

  // Captain: credit every catch this boat logged under a typed name to a crew member's account.
  api.post('/teams/:id/guests/link', (req, res) => {
    const team = captainOf(req, res);
    if (!team) return;
    const name = str(req.body.name, 80);
    const userId = intId(req.body.userId);
    if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(userId, team.id)) {
      return res.status(400).json({ error: 'Choose a crew member. The angler has to join the boat first.' });
    }
    const { changes } = db.prepare(`
      UPDATE catches SET user_id = ?, angler_name = NULL
      WHERE team_id = ? AND user_id IS NULL AND angler_name = ? COLLATE NOCASE
    `).run(userId, team.id, name ?? '');
    if (!changes) return res.status(404).json({ error: 'No catches on this boat are logged under that name.' });
    res.json({ moved: changes, team: getTeam(team.id, req.user.id) });
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
      k.lat, k.lng, k.spot_public AS spotPublic,
      k.status, k.weigh_station AS weighStation, k.scale_photo AS scalePhoto, k.points, k.points_note AS pointsNote,
      t.division,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, COALESCE(u.name, k.angler_name) AS angler,
      t.id AS teamId, t.name AS teamName,
      c.id AS clubId, c.name AS clubName,
      (SELECT COUNT(*) FROM likes l WHERE l.catch_id = k.id) AS likes,
      (SELECT COUNT(*) FROM comments m WHERE m.catch_id = k.id) AS comments,
      EXISTS (SELECT 1 FROM likes l WHERE l.catch_id = k.id AND l.user_id = :viewer) AS liked
    FROM catches k
    JOIN species s ON s.id = k.species_id
    LEFT JOIN users u ON u.id = k.user_id
    LEFT JOIN teams t ON t.id = k.team_id
    LEFT JOIN clubs c ON c.id = k.club_id
  `;

  function canDelete(row, user) {
    if (!user) return false;
    if (canReview(user)) return true;
    // JHMMC registrations belong to the officials: the weighmaster who made
    // one can withdraw it until the secretary decides.
    if (row.status !== 'unofficial') return row.status === 'pending_review' && row.loggedBy === user.id;
    if (row.userId === user.id || row.loggedBy === user.id) return true;
    const team = row.teamId && db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(row.teamId);
    return !!team && team.captain_id === user.id;
  }

  // The exact GPS spot is shown to everyone only if the poster chose to;
  // otherwise just to the boat's crew, whoever posted it and the officials.
  function canSeeSpot(row, viewer) {
    if (row.spotPublic) return true;
    if (!viewer) return false;
    return viewer.teamId === row.teamId || row.loggedBy === viewer.id || row.userId === viewer.id || canReview(viewer);
  }

  function present(row, viewer) {
    const showSpot = row.lat != null && canSeeSpot(row, viewer);
    return {
      ...row,
      lat: showSpot ? row.lat : null,
      lng: showSpot ? row.lng : null,
      spotPublic: !!row.spotPublic,
      hasSpot: row.lat != null,
      released: !!row.released,
      tagged: !!row.tagged,
      liked: !!row.liked,
      photoUrl: photoUrl(row.photo),
      scalePhotoUrl: photoUrl(row.scalePhoto),
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
      angler: ['k.user_id IS NULL AND k.angler_name = :angler COLLATE NOCASE', (v) => str(v, 80)],
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
    where.push(req.query.official === '1' ? "k.status != 'unofficial'" : "k.status = 'unofficial'");
    const limit = Math.min(intId(req.query.limit) || 20, 50);
    const rows = db.prepare(
      `${CATCH_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.id DESC LIMIT ${limit}`
    ).all(params);
    res.json({ catches: rows.map((r) => present(r, req.user)), nextBefore: rows.length === limit ? rows.at(-1).id : null });
  });

  // Where an official registration is weighed: a weighmaster's assigned
  // station; the secretary and admin, who have none, choose one.
  function stationFor(user, chosen) {
    if (user.weighStation) return { station: user.weighStation };
    if (canReview(user) && WEIGH_STATIONS.includes(chosen)) return { station: chosen };
    if (canReview(user)) return { error: 'Choose the weigh station.' };
    return { error: 'You have no weigh station yet. Ask the admin to assign you one.' };
  }

  // Checks one catch for a boat and returns the values to save, or an error.
  // Crews post their own boat's catches; weighmasters register fish for any
  // JHMMC boat at the dock.
  function checkCatch(user, b, file, { teamId, official }) {
    const team = db.prepare('SELECT club_id, country FROM teams WHERE id = ?').get(teamId);
    if (!team) return { error: 'Choose the boat.' };
    const jhmmcBoat = team.club_id === homeClubId();
    if (official && !jhmmcBoat) return { error: 'Only JHMMC boats are registered for points.' };
    const speciesId = intId(b.speciesId);
    if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) {
      return { error: 'Choose a species.' };
    }
    // The angler is a crew member of that boat, or anyone else by name
    // (guests don't need an account).
    const anglerName = b.anglerId === 'other' ? str(b.anglerName, 80) : null;
    if (b.anglerId === 'other' && !anglerName) return { error: "Type the angler's name." };
    const anglerId = anglerName ? null : intId(b.anglerId) || (official ? null : user.id);
    if (!anglerId && !anglerName) return { error: 'Choose the angler.' };
    if (anglerId && !db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(anglerId, teamId)) {
      return { error: 'The angler must be on the boat, or choose "Guest" and type their name.' };
    }
    const weightKg = num(b.weightKg);
    const lengthCm = num(b.lengthCm);
    if (Number.isNaN(weightKg) || Number.isNaN(lengthCm)) return { error: 'Weight and length must be positive numbers.' };
    if (weightKg !== null && weightKg > 1500) return { error: 'Weight looks too large — enter it in kilograms.' };
    const caughtOn = str(b.caughtOn, 10);
    if (!caughtOn || !/^\d{4}-\d{2}-\d{2}$/.test(caughtOn) || Number.isNaN(Date.parse(caughtOn))) {
      return { error: 'Enter the date of the catch.' };
    }
    if (Date.parse(caughtOn) > Date.now() + 864e5) return { error: 'Catch date cannot be in the future.' };
    // Weighmasters register at the dock on the day: today only (Monrovia time is UTC).
    // The secretary may enter an earlier day's paper form.
    if (official && !canReview(user) && caughtOn !== new Date().toISOString().slice(0, 10)) {
      return { error: "Registrations are for today's fish only." };
    }
    const lineClass = str(b.lineClass, 20);
    if (lineClass && !LINE_CLASSES.includes(lineClass)) return { error: 'Choose a line class from the list.' };
    // JHMMC crews' weights come only from the weighmaster's registration.
    if (!official && jhmmcBoat && (weightKg !== null || lengthCm !== null || lineClass)) {
      return { error: "JHMMC boats can't add a weight to a post: the weighmaster records it at the dock." };
    }
    const country = str(b.country, 60) || team.country || user.country;
    if (country && !COUNTRIES.includes(country)) return { error: 'Unknown country.' };
    const coord = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const lat = coord(b.lat);
    const lng = coord(b.lng);
    if ((lat === null) !== (lng === null) || (lat !== null && !(Math.abs(lat) <= 90 && Math.abs(lng) <= 180))) {
      return { error: 'The GPS location is not valid. Try "Use my location" again.' };
    }
    const released = bool(b.released);
    let station = null;
    if (official) {
      const s = stationFor(user, str(b.weighStation, 40));
      if (s.error) return s;
      station = s.station;
      if (!released && weightKg === null) return { error: 'Enter the official weight.' };
      // Rule 8: every fish weighed is photographed hanging on the scale.
      if (!released && !file) return { error: 'Add the photo of the fish hanging on the scale.' };
    }
    const weighed = official && !released;
    // Crew posts are for the feed only; weighmaster registrations go to the secretary.
    return {
      values: [
        anglerId, anglerName, user.id, teamId, team.club_id, speciesId, weightKg, lengthCm, released,
        bool(b.tagged), caughtOn, country, str(b.location, 120), lineClass, str(b.notes, 2000),
        official ? null : file?.filename ?? null, official ? 'pending_review' : 'unofficial', station,
        weighed ? user.id : null, weighed ? new Date().toISOString() : null, official ? file?.filename ?? null : null,
        lat, lng, bool(b.spotPublic),
      ],
    };
  }

  const insertCatchRow = (values) => Number(db.prepare(`
    INSERT INTO catches (user_id, angler_name, logged_by, team_id, club_id, species_id, weight_kg, length_cm, released, tagged,
      caught_on, country, location, line_class, notes, photo, status, weigh_station, weighed_by, weighed_at, scale_photo,
      lat, lng, spot_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values).lastInsertRowid);

  function insertCatch(req, res, opts) {
    const checked = checkCatch(req.user, req.body, req.file, opts);
    if (checked.error) {
      removeUpload(req.file?.filename);
      return res.status(400).json({ error: checked.error });
    }
    const id = insertCatchRow(checked.values);
    if (opts.official) scoreRegistration(id);
    res.status(201).json({ catch: getCatch(id, req.user) });
  }

  // A registration gets its points as soon as the weighmaster records it;
  // they count once the secretary approves.
  function scoreRegistration(id) {
    const { points, note } = suggestPoints(id);
    db.prepare('UPDATE catches SET points = ?, points_note = ? WHERE id = ?').run(points, note, id);
  }

  // Only crews post: an angler has to be on a boat.
  api.post('/catches', (req, res, next) => {
    if (!req.user.teamId) return res.status(403).json({ error: 'Join or register a boat to post catches.' });
    next();
  }, upload.single('photo'), (req, res) => {
    insertCatch(req, res, { teamId: req.user.teamId, official: false });
  });

  // ---- official scoring: weigh-in, approval, calendar, standings ---------

  const eventsOn = (date) => db.prepare('SELECT id, kind, name FROM events WHERE date = ?').all(date);

  // The points the rules give a catch, as a suggestion for the secretary.
  function suggestPoints(catchId) {
    const row = db.prepare(`
      SELECT s.name AS species, s.points_per_kg AS pointsPerKg, k.weight_kg AS weightKg, k.released,
        k.caught_on AS caughtOn, COALESCE(t.division, 'ocean') AS division
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id WHERE k.id = ?
    `).get(catchId);
    return scoring.scoreCatch({ ...row, released: !!row.released });
  }

  // Weighmaster: register a fish at the dock for a JHMMC boat (the digital Fish Registration Form).
  api.post('/weigh', requireWeigh, upload.single('scalePhoto'), (req, res) => {
    const teamId = intId(req.body.teamId);
    if (!teamId) {
      removeUpload(req.file?.filename);
      return res.status(400).json({ error: 'Choose the boat.' });
    }
    insertCatch(req, res, { teamId, official: true });
  });

  // Weighmaster: a whole boat's fish in one submission, like one paper form.
  // Each fish's scale photo arrives as file field "scale_<n>". All or nothing:
  // if any fish is wrong, none are saved and the error names the fish.
  api.post('/weigh/sheet', requireWeigh, sheetUpload.any(), (req, res) => {
    const files = req.files ?? [];
    const fail = (error) => {
      for (const f of files) removeUpload(f.filename);
      res.status(400).json({ error });
    };
    const teamId = intId(req.body.teamId);
    if (!teamId) return fail('Choose the boat.');
    let fish;
    try {
      fish = JSON.parse(req.body.fish ?? '[]');
    } catch {
      return fail('The list of fish could not be read.');
    }
    if (!Array.isArray(fish) || !fish.length) return fail('Add at least one fish.');
    if (fish.length > MAX_FISH_PER_SHEET) return fail(`At most ${MAX_FISH_PER_SHEET} fish at a time.`);
    const rows = [];
    for (const [i, f] of fish.entries()) {
      const file = files.find((x) => x.fieldname === `scale_${i}`);
      const checked = checkCatch(req.user, { ...f, caughtOn: req.body.caughtOn, weighStation: req.body.weighStation }, file,
        { teamId, official: true });
      if (checked.error) return fail(`Fish ${i + 1}: ${checked.error}`);
      rows.push(checked.values);
    }
    db.exec('BEGIN');
    try {
      const ids = rows.map(insertCatchRow);
      ids.forEach(scoreRegistration);
      db.exec('COMMIT');
      res.status(201).json({ catches: ids.map((id) => getCatch(id, req.user)) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // Weighmaster and secretary work lists.
  api.get('/officials/queue', requireWeigh, (req, res) => {
    const toReview = db.prepare(`${CATCH_SELECT} WHERE k.status = 'pending_review' ORDER BY k.caught_on, t.name, k.id`)
      .all({ viewer: req.user.id })
      .map((r) => ({ ...present(r, req.user), suggested: suggestPoints(r.id), events: eventsOn(r.caughtOn) }));
    // Weighmasters see what they registered that the secretary hasn't decided yet.
    res.json({ toReview: canReview(req.user) ? toReview : toReview.filter((c) => c.loggedBy === req.user.id) });
  });

  // Secretary: approve (with the rules' points or a corrected figure) or reject.
  api.post('/catches/:id/review', requireReview, (req, res) => {
    const id = intId(req.params.id);
    const row = id && db.prepare('SELECT status FROM catches WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Catch not found.' });
    const note = str(req.body.note, 300);
    if (req.body.decision === 'reject') {
      if (!note) return res.status(400).json({ error: 'Give a reason so the crew knows why.' });
      db.prepare(`UPDATE catches SET status = 'rejected', points = NULL, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(note, req.user.id, new Date().toISOString(), id);
    } else if (req.body.decision === 'approve') {
      const suggested = suggestPoints(id);
      const given = req.body.points === undefined || req.body.points === '' ? suggested.points : Number(req.body.points);
      if (!Number.isFinite(given)) return res.status(400).json({ error: 'Points must be a number.' });
      if (given !== suggested.points && !note) return res.status(400).json({ error: 'Add a note explaining the changed points.' });
      db.prepare(`UPDATE catches SET status = 'approved', points = ?, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(given, note || suggested.note, req.user.id, new Date().toISOString(), id);
    } else {
      return res.status(400).json({ error: 'Approve or reject.' });
    }
    res.json({ catch: getCatch(id, req.user) });
  });

  // Season calendar: tournaments, each with its own results. (Holidays from
  // earlier versions are kept but no longer affect scoring.)
  api.get('/events', (_req, res) => {
    const start = setting('season_start');
    const end = setting('season_end');
    res.json({
      season: { start, end },
      events: db.prepare('SELECT id, date, kind, name FROM events WHERE date BETWEEN ? AND ? ORDER BY date').all(start, end),
    });
  });

  api.post('/events', requireReview, (req, res) => {
    const date = str(req.body.date, 10);
    const kind = req.body.kind === 'tournament' ? 'tournament' : 'holiday';
    const name = str(req.body.name, 80);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Choose the date.' });
    if (!name) return res.status(400).json({ error: kind === 'tournament' ? 'Name the tournament.' : 'Name the holiday.' });
    const { lastInsertRowid } = db.prepare('INSERT INTO events (date, kind, name) VALUES (?, ?, ?)').run(date, kind, name);
    res.status(201).json({ event: { id: Number(lastInsertRowid), date, kind, name } });
  });

  api.delete('/events/:id', requireReview, (req, res) => {
    db.prepare('DELETE FROM events WHERE id = ?').run(intId(req.params.id));
    res.json({ ok: true });
  });

  api.patch('/settings/season', requireReview, (req, res) => {
    const start = str(req.body.start, 10);
    const end = str(req.body.end, 10);
    if (![start, end].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) || start >= end) {
      return res.status(400).json({ error: 'Choose a start date before the end date.' });
    }
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    set.run('season_start', start);
    set.run('season_end', end);
    res.json({ season: { start, end } });
  });

  // Scoring table: points per kg for each species.
  api.patch('/species/:id', requireReview, (req, res) => {
    const points = Number(req.body.pointsPerKg);
    if (!Number.isFinite(points) || points < 0 || points > 100) return res.status(400).json({ error: 'Points per kg must be between 0 and 100.' });
    const r = db.prepare('UPDATE species SET points_per_kg = ? WHERE id = ?').run(points, intId(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Species not found.' });
    res.json({ ok: true, pointsPerKg: points });
  });

  // Season standings from approved catches, split by ocean and river boats.
  api.get('/points', (req, res) => {
    const division = req.query.division === 'river' ? 'river' : 'ocean';
    const start = setting('season_start');
    const end = setting('season_end');
    const base = `FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'approved' AND k.club_id = :home AND t.division = :division AND k.caught_on BETWEEN :start AND :end`;
    const params = { division, start, end, home: homeClubId() };
    const boats = db.prepare(`
      SELECT t.id AS teamId, t.name AS teamName, COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
      ${base} GROUP BY t.id ORDER BY points DESC, catches DESC
    `).all(params);
    const anglers = db.prepare(`
      SELECT u.id AS userId, COALESCE(u.name, k.angler_name) AS angler, t.name AS teamName, MIN(k.id) AS first,
        COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
      ${base.replace('JOIN teams t ON t.id = k.team_id', 'JOIN teams t ON t.id = k.team_id LEFT JOIN users u ON u.id = k.user_id')}
      GROUP BY COALESCE('u' || u.id, 'n' || lower(k.angler_name)) ORDER BY points DESC LIMIT 20
    `).all(params).map(({ first, ...a }) => a);
    const tournaments = db.prepare(`SELECT id, date, name FROM events WHERE kind = 'tournament' AND date BETWEEN ? AND ? ORDER BY date DESC`)
      .all(start, end)
      .map((e) => ({
        ...e,
        winner: db.prepare(`
          SELECT t.id AS teamId, t.name AS teamName, ROUND(SUM(k.points), 1) AS points
          FROM catches k JOIN teams t ON t.id = k.team_id
          WHERE k.status = 'approved' AND k.club_id = ? AND t.division = ? AND k.caught_on = ? GROUP BY t.id ORDER BY points DESC LIMIT 1
        `).get(params.home, division, e.date) ?? null,
      }));
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'pending_review' AND t.division = ?`).get(division).n;
    res.json({ division, season: { start, end }, boats, anglers, tournaments, pending });
  });

  // One tournament's results: boats ranked, with their approved catches.
  api.get('/tournaments/:id', (req, res) => {
    const event = db.prepare(`SELECT id, date, name FROM events WHERE id = ? AND kind = 'tournament'`).get(intId(req.params.id));
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const division = req.query.division === 'river' ? 'river' : 'ocean';
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.caught_on = :date AND t.division = :division AND k.status = 'approved'
      AND k.club_id = :home ORDER BY k.points DESC`).all({ date: event.date, division, home: homeClubId(), viewer: req.user?.id ?? 0 });
    const boats = new Map();
    for (const r of rows) {
      const b = boats.get(r.teamId) ?? { teamId: r.teamId, teamName: r.teamName, points: 0, catches: [] };
      b.points = Math.round((b.points + r.points) * 10) / 10;
      b.catches.push(present(r, req.user));
      boats.set(r.teamId, b);
    }
    res.json({ tournament: event, division, results: [...boats.values()].sort((a, b) => b.points - a.points) });
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
      return res.status(403).json({ error: item.status !== 'unofficial'
        ? 'This is a JHMMC registration; ask the secretary to remove it.'
        : 'Only the angler, whoever logged it, or the boat captain can delete this catch.' });
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
  api.get('/records', (req, res) => {
    const clubId = intId(req.query.club);
    const club = clubId && db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(clubId);
    if (clubId && !club) return res.status(404).json({ error: 'Club not found.' });
    const best = db.prepare(`
      SELECT * FROM (
        SELECT k.species_id AS speciesId, k.line_class AS lineClass, k.id AS catchId, k.weight_kg AS weightKg,
          k.caught_on AS caughtOn, u.id AS userId, COALESCE(u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS overall,
          ROW_NUMBER() OVER (PARTITION BY k.species_id, k.line_class ORDER BY k.weight_kg DESC, k.id) AS inClass
        FROM catches k LEFT JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.weight_kg IS NOT NULL AND k.status = :book ${club ? 'AND k.club_id = :club' : ''}
      ) WHERE overall = 1 OR (inClass = 1 AND lineClass IS NOT NULL)
    `).all(club ? { club: club.id, book: clubBook(club.id) } : { book: 'unofficial' });
    const species = db.prepare('SELECT id, name, category FROM species ORDER BY category, name').all();
    const names = Object.fromEntries(species.map((s) => [s.id, s.name]));
    const strip = ({ overall, inClass, ...r }) => r;
    const lineOrder = (c) => (c === 'Unlimited' ? 1e9 : parseFloat(c));

    res.json({
      club: club || null,
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
    const where = ["k.status = 'unofficial'"];
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
          u.id AS userId, COALESCE(u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS rn
        FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users u ON u.id = k.user_id
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
      SELECT u.id AS userId, COALESCE(u.name, k.angler_name) AS angler, t.name AS teamName, MIN(k.id) AS first, ${tally}
      FROM catches k LEFT JOIN users u ON u.id = k.user_id JOIN species s ON s.id = k.species_id
      LEFT JOIN teams t ON t.id = COALESCE(u.team_id, k.team_id)
      WHERE ${filter}
      GROUP BY COALESCE('u' || u.id, 'n' || lower(k.angler_name)) ORDER BY billfish DESC, catches DESC LIMIT 20
    `).all(params).map(({ first, ...a }) => a);

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
      FROM catches WHERE user_id = ? AND status = 'unofficial'
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
