const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, COUNTRIES, LINE_CLASSES, HOME_CLUB, WEIGH_STATIONS } = require('./db');
const scoring = require('./scoring');
const auth = require('./auth');
const igfa = require('./igfa-records');
const jhmmcBook = require('./jhmmc-records');
const { createMailer } = require('./mail');
const { createPusher } = require('./push');

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/3gpp': '.3gp' };
// Photos are shrunk on the phone; videos can't be, so they get more room (about a minute).
const MAX_VIDEO_MB = 100;
// Upload fields that carry a video: "video", "scaleVideo", "scalevideo_<n>".
const isVideoField = (name) => /video/i.test(name);
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
  // Sends phone notifications; made from the database's keys unless given (tests).
  pusher,
} = {}) {
  adminEmail = adminEmail?.trim().toLowerCase() || null;
  const db = openDb(dbFile);
  pusher ??= createPusher(db, { contact: adminEmail });
  fs.mkdirSync(uploadDir, { recursive: true });

  const MAX_FISH_PER_SHEET = 30;
  const MAX_EVENT_DAYS = 14;
  // Photos and videos: a field named for a video takes a video, any other a photo.
  const mediaUploads = (files) => multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) =>
        cb(null, crypto.randomBytes(12).toString('hex') + (isVideoField(file.fieldname) ? VIDEO_TYPES : PHOTO_TYPES)[file.mimetype]),
    }),
    limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files },
    fileFilter: (_req, file, cb) => {
      if (isVideoField(file.fieldname)) {
        if (VIDEO_TYPES[file.mimetype]) return cb(null, true);
        return cb(Object.assign(new Error('Video must be MP4, MOV, WebM or 3GP.'), { status: 400 }));
      }
      if (PHOTO_TYPES[file.mimetype]) return cb(null, true);
      cb(Object.assign(new Error('Photo must be JPEG, PNG or WebP.'), { status: 400 }));
    },
  });
  const upload = mediaUploads(1);
  const sheetUpload = mediaUploads(MAX_FISH_PER_SHEET * 2);
  // A photo plus an optional video, under the given field names.
  const withVideo = (photo, video) => mediaUploads(2).fields([{ name: photo, maxCount: 1 }, { name: video, maxCount: 1 }]);
  const filesOf = (req) => Object.values(req.files ?? {}).flat();
  // Any photo or video in a failed request is thrown away.
  const discardUploads = (req) => {
    removeUpload(req.file?.filename);
    for (const f of Array.isArray(req.files) ? req.files : filesOf(req)) removeUpload(f.filename);
  };

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
  // Samsung Internet packages installed sites as an old-style Android app that
  // Google Play Protect now blocks. Told the site isn't a standalone app, it adds
  // a plain home-screen icon instead (which opens in Samsung Internet).
  const manifestFile = path.join(__dirname, '..', 'public', 'manifest.webmanifest');
  app.get('/manifest.webmanifest', (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', Vary: 'User-Agent', 'Content-Type': 'application/manifest+json' });
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (/SamsungBrowser/.test(req.get('user-agent') || '')) manifest.display = 'browser';
    res.send(JSON.stringify(manifest));
  });
  // The app's own files: browsers check for a newer version each time (a quick
  // "not modified" when nothing changed), so an update shows up straight away.
  const fresh = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use(express.static(path.join(__dirname, '..', 'public'), fresh));
  app.get('/scoring.js', (_req, res) => res.sendFile(path.join(__dirname, 'scoring.js'), { headers: { 'Cache-Control': 'no-cache' } }));

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
  // from captains' registrations the secretary approved.
  const clubBook = (clubId) => (clubId === homeClubId() ? 'approved' : 'unofficial');

  // Club officials: the admin (ADMIN_EMAIL) and secretaries, who approve
  // points. Captains of JHMMC boats register their own boat's fish at the
  // weigh station; the secretary and admin can register any boat's.
  const isAdminUser = (u) => !!adminEmail && u?.email?.toLowerCase() === adminEmail;
  // Club roles: the president, vice president and secretary run the club's
  // tournaments, members and calendar; only the secretary (and the admin)
  // reviews and approves fish; the treasurer handles membership money.
  const ROLES = ['president', 'vice_president', 'secretary', 'treasurer'];
  const OFFICERS = ['president', 'vice_president', 'secretary'];
  const canReview = (u) => isAdminUser(u) || OFFICERS.includes(u?.role);
  const canApprove = (u) => isAdminUser(u) || u?.role === 'secretary';
  const canHandleMoney = (u) => canReview(u) || u?.role === 'treasurer';
// The name others see: the nickname if there is one, else the full name.
const SHOWN = "COALESCE(NULLIF(u.nickname, ''), u.name)";
  // The admin always belongs to JHMMC.
  const markAdminMember = () => adminEmail && db.prepare('UPDATE users SET jhmmc = 1 WHERE lower(email) = ?').run(adminEmail);
  markAdminMember();
  const captainsJhmmcBoat = (u) => !!u && !!db.prepare('SELECT 1 FROM teams WHERE captain_id = ? AND club_id = ?').get(u.id, homeClubId());
  const canWeigh = (u) => canReview(u) || captainsJhmmcBoat(u);
  const requireOfficial = (check, who) => (req, res, next) =>
    check(req.user) ? next() : res.status(403).json({ error: `Only ${who} can do that.` });
  const requireWeigh = requireOfficial(canWeigh, 'the captain of a JHMMC boat or the secretary');
  const requireReview = requireOfficial(canReview, 'the JHMMC secretary');
  const requireMoney = requireOfficial(canHandleMoney, 'the JHMMC treasurer or secretary');
  const requireApprove = requireOfficial(canApprove, 'the JHMMC secretary');

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

  // Everyone gives a first and a last name; `name` (the full name) is the two together.
  // A single `name` is still taken and split at the first space.
  const NAMES_NEEDED = 'Write your first name and your last name.';
  function namesFrom(body) {
    if ('firstName' in body || 'lastName' in body) return { first: str(body.firstName, 40), last: str(body.lastName, 40) };
    const [first, ...rest] = (str(body.name, 80) || '').split(/\s+/);
    return { first: first || null, last: rest.join(' ') || null };
  }
  const namesGiven = (body) => ['firstName', 'lastName', 'name'].some((k) => k in body);

  api.post('/auth/register', registerLimit, (req, res) => {
    const { first, last } = namesFrom(req.body);
    const nickname = str(req.body.nickname, 40);
    const email = str(req.body.email, 120)?.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const country = str(req.body.country, 60);

    if (!first || !last) return res.status(400).json({ error: NAMES_NEEDED });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, first_name, last_name, nickname, email, password_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`${first} ${last}`, first, last, nickname, email, auth.hashPassword(password), country);
    markAdminMember();
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
      SELECT u.id, u.name, u.first_name AS firstName, u.last_name AS lastName, u.nickname, ${SHOWN} AS displayName, u.email, u.country, u.bio, u.photo,
        t.id AS teamId, t.name AS teamName, t.captain_id = u.id AS isCaptain, t.club_id AS clubId, u.role, u.jhmmc,
        t.weigh_station AS weighStation
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    const { photo, ...rest } = me;
    return {
      ...rest, photoUrl: photoUrl(photo), isCaptain: !!me.isCaptain, jhmmc: !!me.jhmmc || isAdminUser(me),
      isAdmin: isAdminUser(me), canWeigh: canWeigh(me), canReview: canReview(me), canApprove: canApprove(me), canHandleMoney: canHandleMoney(me),
    };
  }

  api.get('/me', (req, res) => {
    res.json({ user: req.user ? getMe(req.user.id) : null });
  });

  // Anyone can look around; doing anything (posting, liking, joining) needs an account.
  api.use((req, res, next) => (req.method === 'GET' ? next() : auth.requireUser(req, res, next)));

  // ---- notifications ------------------------------------------------------

  api.get('/push/key', (_req, res) => res.json({ publicKey: pusher.publicKey }));

  // A phone or browser that agreed to notifications; one person may have several.
  api.post('/push/subscribe', (req, res) => {
    const { endpoint, keys } = req.body ?? {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000
      || typeof keys?.p256dh !== 'string' || typeof keys?.auth !== 'string') {
      return res.status(400).json({ error: 'That notification subscription could not be read.' });
    }
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(req.user.id, endpoint, keys.p256dh, keys.auth);
    res.status(201).json({ ok: true });
  });

  api.delete('/push/subscribe', (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(req.body?.endpoint ?? ''), req.user.id);
    res.json({ ok: true });
  });

  // Phone notifications to the secretary (and the admin), except whoever acted.
  // Sent in the background: a slow push service never holds up the captain.
  function pushToReviewers(payload, by) {
    const reviewers = db.prepare(`SELECT s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE (u.role = 'secretary' OR lower(u.email) = ?) AND u.id != ?`).all(adminEmail ?? '', by.id);
    for (const r of reviewers) {
      pusher.send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload)
        .then((alive) => { if (!alive) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(r.endpoint); })
        .catch((err) => console.warn(`Notification failed: ${err.message}`));
    }
  }

  // New registrations are waiting.
  function notifyReviewers(teamId, count, by) {
    const boat = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId)?.name ?? 'A boat';
    const waiting = db.prepare("SELECT COUNT(*) AS n FROM catches WHERE status = 'pending_review'").get().n;
    pushToReviewers({
      title: 'Fish to review',
      body: `${boat}: ${count === 1 ? '1 fish' : `${count} fish`} registered by ${by.name}. ${waiting} waiting in total.`,
      url: '/#/review',
    }, by);
  }

  api.patch('/me', (req, res) => {
    const u = req.user;
    const { first, last } = namesGiven(req.body) ? namesFrom(req.body) : { first: u.firstName, last: u.lastName };
    const nickname = 'nickname' in req.body ? str(req.body.nickname, 40) : u.nickname;
    const country = 'country' in req.body ? str(req.body.country, 60) : u.country;
    const bio = 'bio' in req.body ? str(req.body.bio, 500) : u.bio;
    // Accounts from before last names were asked for keep theirs until they change their name.
    if (namesGiven(req.body) && (!first || !last)) return res.status(400).json({ error: NAMES_NEEDED });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    const name = namesGiven(req.body) ? `${first} ${last}` : u.name;
    db.prepare('UPDATE users SET name = ?, first_name = ?, last_name = ?, nickname = ?, country = ?, bio = ? WHERE id = ?')
      .run(name, first, last, nickname, country, bio, u.id);
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
      SELECT u.id, u.name, u.nickname, u.email, u.role, u.jhmmc, u.created_at AS joinedAt, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id ORDER BY u.name COLLATE NOCASE
    `).all().map((u) => ({ ...u, jhmmc: !!u.jhmmc || isAdminUser(u), isAdmin: isAdminUser(u) }));
    res.json({ users });
  });

  api.patch('/admin/users/:id', requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const cur = id && db.prepare('SELECT role, jhmmc, email FROM users WHERE id = ?').get(id);
    if (!cur) return res.status(404).json({ error: 'Member not found.' });
    // The admin decides who belongs to JHMMC; only JHMMC members hold a club role.
    const jhmmc = isAdminUser(cur) || ('jhmmc' in req.body ? !!req.body.jhmmc : !!cur.jhmmc);
    let role = 'role' in req.body ? req.body.role || null : cur.role;
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
    if (role && !jhmmc) {
      if ('role' in req.body) return res.status(400).json({ error: 'Only JHMMC members can have a club role. Add them to JHMMC first.' });
      role = null;
    }
    db.prepare('UPDATE users SET role = ?, jhmmc = ? WHERE id = ?').run(role, jhmmc ? 1 : 0, id);
    res.json({ ok: true, role, jhmmc });
  });

  // The admin's Boats page: a JHMMC boat's weigh station (its home port) and Ocean or River.
  api.patch('/admin/teams/:id', requireAdmin, (req, res) => {
    const team = db.prepare('SELECT id, club_id AS clubId, weigh_station AS station, division FROM teams WHERE id = ?')
      .get(intId(req.params.id) ?? 0);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    if (team.clubId !== homeClubId()) return res.status(400).json({ error: 'Only JHMMC boats have a weigh station and division.' });
    const station = 'weighStation' in req.body ? req.body.weighStation || null : team.station;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    const division = 'division' in req.body ? req.body.division : team.division;
    if (!['ocean', 'river'].includes(division)) return res.status(400).json({ error: 'Choose Ocean or River.' });
    db.prepare('UPDATE teams SET weigh_station = ?, home_port = ?, division = ? WHERE id = ?').run(station, station, division, team.id);
    res.json({ ok: true, weighStation: station, division });
  });

  // The admin deletes a member's account. Their catches stay, under their
  // name like a guest angler's, so standings and records don't change; their
  // comments and likes go. A boat they captained passes to its longest-serving crew.
  api.delete('/admin/users/:id', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT id, name, nickname, email, photo FROM users WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    if (user.id === req.user.id || isAdminUser(user)) return res.status(400).json({ error: "The admin's own account can't be deleted." });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE catches SET angler_name = ?, user_id = NULL WHERE user_id = ?').run(user.nickname || user.name, user.id);
      for (const { id } of db.prepare('SELECT id FROM teams WHERE captain_id = ?').all(user.id)) {
        const next = db.prepare('SELECT id FROM users WHERE team_id = ? AND id != ? ORDER BY id LIMIT 1').get(id, user.id);
        db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(next?.id ?? null, id);
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      db.exec('COMMIT');
    } catch (ex) {
      db.exec('ROLLBACK');
      throw ex;
    }
    removeUpload(user.photo);
    res.json({ ok: true, name: user.name });
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
        t.weigh_station AS weighStation, c.id AS clubId, c.name AS clubName,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, ${TALLY}
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id LEFT JOIN catches k ON k.team_id = t.id AND k.status = 'unofficial'
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE
    `).all();
    res.json({ teams: teams.map(({ photo, ...t }) => ({ ...t, photoUrl: photoUrl(photo) })) });
  });

  api.get('/anglers', (_req, res) => {
    const anglers = db.prepare(`
      SELECT u.id, ${SHOWN} AS name, u.country, u.photo, t.id AS teamId, t.name AS teamName, t.photo AS teamPhoto, ${TALLY}
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN catches k ON k.user_id = u.id AND k.status = 'unofficial'
      GROUP BY u.id ORDER BY 2 COLLATE NOCASE
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
    const jhmmc = clubId === homeClubId();
    const division = jhmmc && req.body.division === 'river' ? 'river' : 'ocean';
    // A JHMMC boat's home port is its weigh station.
    const station = jhmmc ? req.body.weighStation || null : null;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    const homePort = jhmmc ? station : str(req.body.homePort, 80);
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
      INSERT INTO teams (name, home_port, country, club_id, captain_id, join_code, length_ft, make, division, weigh_station)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, homePort, country, clubId, req.user.id, code, length, str(req.body.make, 60), division, station);
    const id = Number(lastInsertRowid);
    db.prepare('UPDATE users SET team_id = ? WHERE id = ?').run(id, req.user.id);
    res.status(201).json({ team: getTeam(id, req.user.id), user: getMe(req.user.id) });
  });

  function getTeam(id, viewerId) {
    const team = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.captain_id AS captainId, t.join_code AS joinCode,
        t.length_ft AS lengthFt, t.make, t.photo, t.division, t.weigh_station AS weighStation, t.created_at AS createdAt,
        c.id AS clubId, c.name AS clubName
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id WHERE t.id = ?
    `).get(id);
    if (!team) return null;
    const members = db.prepare(`
      SELECT u.id, ${SHOWN} AS name, (SELECT COUNT(*) FROM catches k WHERE k.user_id = u.id AND k.team_id = ?) AS catches
      FROM users u WHERE u.team_id = ? ORDER BY u.id = ? DESC, 2
    `).all(id, id, team.captainId ?? 0);
    const isMember = members.some((m) => m.id === viewerId);
    // The captain runs the boat; the club admin can do the same on any boat.
    const isCaptain = team.captainId === viewerId;
    const canManage = isCaptain || isAdminUser(viewerId && db.prepare('SELECT email FROM users WHERE id = ?').get(viewerId));
    // The invite code is the key to the boat: crew (and the admin) only.
    if (!isMember && !canManage) delete team.joinCode;
    // Names typed for anglers without an account, so the captain can move them to one.
    const guests = db.prepare(`
      SELECT angler_name AS name, MIN(id) AS first, COUNT(*) AS catches FROM catches
      WHERE team_id = ? AND user_id IS NULL GROUP BY lower(angler_name) ORDER BY name COLLATE NOCASE
    `).all(id).map(({ first, ...g }) => g);
    const { photo, ...rest } = team;
    return { ...rest, photoUrl: photoUrl(photo), members, guests, isMember, isCaptain, canManage };
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

  // Captain-only actions on their own boat; the club admin may act on any boat.
  function captainOf(req, res) {
    const id = intId(req.params.id);
    const team = id && db.prepare('SELECT id, captain_id FROM teams WHERE id = ?').get(id);
    if (!team) {
      res.status(404).json({ error: 'Boat not found.' });
      return null;
    }
    if (team.captain_id !== req.user.id && !isAdminUser(req.user)) {
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
    const country = 'country' in req.body ? str(req.body.country, 60) : cur.country;
    const clubId = 'clubId' in req.body ? intId(req.body.clubId) : cur.club_id;
    const length = 'lengthFt' in req.body ? lengthFt(req.body.lengthFt) : cur.length_ft;
    const make = 'make' in req.body ? str(req.body.make, 60) : cur.make;
    const jhmmc = clubId === homeClubId();
    const division = !jhmmc ? 'ocean'
      : 'division' in req.body ? (req.body.division === 'river' ? 'river' : 'ocean') : cur.division;
    // A JHMMC boat's home port is its weigh station; only JHMMC boats have one.
    const station = !jhmmc ? null : 'weighStation' in req.body ? req.body.weighStation || null : cur.weigh_station;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    const homePort = jhmmc ? station : 'homePort' in req.body ? str(req.body.homePort, 80) : cur.home_port;
    if (!name) return res.status(400).json({ error: 'Enter the boat name.' });
    if (Number.isNaN(length)) return res.status(400).json({ error: 'Boat length should be in feet, between 10 and 200.' });
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    if (!validClub(clubId)) return res.status(400).json({ error: 'Unknown club.' });
    if (db.prepare('SELECT 1 FROM teams WHERE name = ? AND id != ?').get(name, team.id)) {
      return res.status(409).json({ error: 'Another boat already has that name.' });
    }
    db.prepare(`UPDATE teams SET name = ?, home_port = ?, country = ?, club_id = ?, length_ft = ?, make = ?, division = ?,
      weigh_station = ? WHERE id = ?`)
      .run(name, homePort, country, clubId, length, make, division, station, team.id);
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
    if (userId === db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(team.id).captain_id) {
      return res.status(400).json({ error: 'Make someone else captain before removing the captain.' });
    }
    const r = db.prepare('UPDATE users SET team_id = NULL WHERE id = ? AND team_id = ?').run(userId, team.id);
    if (!r.changes) return res.status(404).json({ error: 'That angler is not on this boat.' });
    res.json({ team: getTeam(team.id, req.user.id) });
  });

  // ---- catches -----------------------------------------------------------

  const CATCH_SELECT = `
    SELECT k.id, k.weight_kg AS weightKg, k.length_cm AS lengthCm, k.released, k.tagged,
      k.caught_on AS caughtOn, k.country, k.location, k.line_class AS lineClass,
      k.notes, k.photo, k.video, k.scale_video AS scaleVideo, k.created_at AS createdAt, k.logged_by AS loggedBy,
      k.lat, k.lng, k.spot_public AS spotPublic,
      k.status, k.weigh_station AS weighStation, k.scale_photo AS scalePhoto, k.points, k.points_note AS pointsNote,
      t.division,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler,
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
    // The platform admin can remove anything; the JHMMC secretary only the club's registrations.
    if (isAdminUser(user)) return true;
    if (row.status !== 'unofficial' && canApprove(user)) return true;
    // JHMMC registrations belong to the officials: the captain who made one
    // can withdraw it until the secretary decides.
    if (row.status !== 'unofficial') return row.status === 'pending_review' && row.loggedBy === user.id;
    if (row.userId === user.id || row.loggedBy === user.id) return true;
    const team = row.teamId && db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(row.teamId);
    return !!team && team.captain_id === user.id;
  }

  // The exact GPS spot is shown to everyone only if the poster chose to;
  // otherwise just to the boat's crew, whoever posted it, and (for JHMMC
  // registrations only) the club's officers.
  function canSeeSpot(row, viewer) {
    if (row.spotPublic) return true;
    if (!viewer) return false;
    return viewer.teamId === row.teamId || row.loggedBy === viewer.id || row.userId === viewer.id
      || (row.status !== 'unofficial' && canReview(viewer));
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
      videoUrl: photoUrl(row.video),
      scalePhotoUrl: photoUrl(row.scalePhoto),
      scaleVideoUrl: photoUrl(row.scaleVideo),
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

  // Where an official registration is weighed: the boat's weigh station (its
  // home port). The secretary may name another; a boat without one chooses.
  function stationFor(user, chosen, boatStation) {
    const pick = WEIGH_STATIONS.includes(chosen) ? chosen : null;
    const station = canReview(user) ? pick || boatStation : boatStation || pick;
    return station ? { station } : { error: 'Choose the weigh station.' };
  }

  // Checks one catch for a boat and returns the values to save, or an error.
  // Crews post their own boat's catches; a JHMMC captain registers their own
  // boat's fish for points, and the secretary any JHMMC boat's.
  // media: { photo, video } (uploaded files, either may be missing).
  function checkCatch(user, b, { photo: file, video } = {}, { teamId, official }) {
    const team = db.prepare('SELECT club_id, country, captain_id, weigh_station FROM teams WHERE id = ?').get(teamId);
    if (!team) return { error: 'Choose the boat.' };
    const jhmmcBoat = team.club_id === homeClubId();
    if (official && !jhmmcBoat) return { error: 'Only JHMMC boats are registered for points.' };
    if (official && !canReview(user) && team.captain_id !== user.id) return { error: "Captains register their own boat's fish only." };
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
    // A post's date is optional: today unless said otherwise.
    const caughtOn = str(b.caughtOn, 10) || (official ? null : new Date().toISOString().slice(0, 10));
    if (!caughtOn || !/^\d{4}-\d{2}-\d{2}$/.test(caughtOn) || Number.isNaN(Date.parse(caughtOn))) {
      return { error: 'Enter the date of the catch.' };
    }
    if (Date.parse(caughtOn) > Date.now() + 864e5) return { error: 'Catch date cannot be in the future.' };
    // Captains register at the weigh station on the day: today only (Monrovia time is UTC).
    // The secretary may enter an earlier day's paper form.
    if (official && !canReview(user) && caughtOn !== new Date().toISOString().slice(0, 10)) {
      return { error: "Registrations are for today's fish only." };
    }
    const lineClass = str(b.lineClass, 20);
    if (lineClass && !LINE_CLASSES.includes(lineClass)) return { error: 'Choose a line class from the list.' };
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
      const s = stationFor(user, str(b.weighStation, 40), team.weigh_station);
      if (s.error) return s;
      station = s.station;
      if (!released && weightKg === null) return { error: 'Enter the official weight.' };
      // Rule 8: every fish weighed is photographed hanging on the scale;
      // a released fish is proved by a video of the release.
      if (!released && !file) return { error: 'Add the photo of the fish hanging on the scale.' };
      if (released && !video) return { error: 'Add the video of the release.' };
    }
    const weighed = official && !released;
    // Crew posts are for the feed only; registrations go to the secretary.
    return {
      values: [
        anglerId, anglerName, user.id, teamId, team.club_id, speciesId, weightKg, lengthCm, released,
        bool(b.tagged), caughtOn, country, str(b.location, 120), lineClass, str(b.notes, 2000),
        official ? null : file?.filename ?? null, official ? 'pending_review' : 'unofficial', station,
        weighed ? user.id : null, weighed ? new Date().toISOString() : null, official ? file?.filename ?? null : null,
        lat, lng, bool(b.spotPublic), official ? null : video?.filename ?? null, official ? video?.filename ?? null : null,
      ],
    };
  }

  const insertCatchRow = (values) => Number(db.prepare(`
    INSERT INTO catches (user_id, angler_name, logged_by, team_id, club_id, species_id, weight_kg, length_cm, released, tagged,
      caught_on, country, location, line_class, notes, photo, status, weigh_station, weighed_by, weighed_at, scale_photo,
      lat, lng, spot_public, video, scale_video)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values).lastInsertRowid);

  function insertCatch(req, res, opts) {
    const problem = opts.official && sheetProblem(req.user, req.body);
    const [photoField, videoField] = opts.official ? ['scalePhoto', 'scaleVideo'] : ['photo', 'video'];
    const media = { photo: req.files?.[photoField]?.[0], video: req.files?.[videoField]?.[0] };
    const checked = problem ? { error: problem } : checkCatch(req.user, req.body, media, opts);
    if (checked.error) {
      discardUploads(req);
      return res.status(400).json({ error: checked.error });
    }
    const id = insertCatchRow(checked.values);
    if (opts.official) {
      scoreRegistration(id);
      logRegistration(id, 'registered', req.user, { where: deviceSpot(req.body) });
      notifyReviewers(opts.teamId, 1, req.user);
    }
    res.status(201).json({ catch: getCatch(id, req.user) });
  }

  // ---- the registration record ------------------------------------------
  // Every registration, withdrawal, dispute and decision, with who did it,
  // when, the fish as it stood and (when the phone allowed it) where they
  // were. Names and figures are copied in so the record outlives deletions.
  const DISPUTE_HOURS = 24;
  function snapshot(id) {
    return db.prepare(`
      SELECT k.team_id AS teamId, t.name AS boat, s.name AS species, COALESCE(u.name, k.angler_name) AS angler,
        k.weight_kg AS weightKg, k.released, k.line_class AS lineClass, k.caught_on AS caughtOn,
        k.weigh_station AS station, k.points, k.status, k.scale_photo AS scalePhoto, k.scale_video AS scaleVideo
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id
      LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?
    `).get(id);
  }
  function logRegistration(catchId, action, user, { note = null, where = null, fish = snapshot(catchId) } = {}) {
    if (!fish) return;
    const { teamId, ...details } = fish;
    db.prepare(`INSERT INTO registration_log (catch_id, team_id, action, user_id, user_name, details, lat, lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(catchId, teamId, action, user.id, user.name, JSON.stringify({ ...details, released: !!details.released, ...(note && { note }) }),
        where?.lat ?? null, where?.lng ?? null);
  }
  // Where the phone was when the sheet was sent, if the captain allowed it.
  function deviceSpot(b) {
    const lat = Number(b.deviceLat);
    const lng = Number(b.deviceLng);
    return b.deviceLat != null && b.deviceLat !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  }
  // Captains declare their sheet is true; the secretary and admin don't need to.
  const DECLARATION = 'Tick the declaration that these fish are true before sending.';
  const declared = (user, b) => canReview(user) || b.declared === 'yes';
  // Every registration takes the phone's location, officials' included.
  const LOCATION_NEEDED = "The phone's location is needed to register fish. Turn on location for this site and send again.";
  const located = (user, b) => !!deviceSpot(b);
  // What stops an official registration before the fish are checked, if anything.
  const sheetProblem = (user, b) => (!declared(user, b) ? DECLARATION : !located(user, b) ? LOCATION_NEEDED : null);
  // When disputes close: 24 hours after the fish was registered.
  const disputeUntil = (createdAt) => new Date(Date.parse(`${createdAt.replace(' ', 'T')}Z`) + DISPUTE_HOURS * 3600e3).toISOString();
  const disputesFor = db.prepare(`
    SELECT d.id, d.reason, d.created_at AS createdAt, u.id AS userId, ${SHOWN} AS author, t.name AS boat
    FROM disputes d JOIN users u ON u.id = d.user_id LEFT JOIN teams t ON t.id = u.team_id
    WHERE d.catch_id = ? ORDER BY d.id`);

  // A registration gets its points as soon as it is recorded;
  // they count once the secretary approves.
  function scoreRegistration(id) {
    const { points, note } = suggestPoints(id);
    db.prepare('UPDATE catches SET points = ?, points_note = ? WHERE id = ?').run(points, note, id);
  }

  // Only crews post: an angler has to be on a boat.
  api.post('/catches', (req, res, next) => {
    if (!req.user.teamId) return res.status(403).json({ error: 'Join or register a boat to post catches.' });
    next();
  }, withVideo('photo', 'video'), (req, res) => {
    insertCatch(req, res, { teamId: req.user.teamId, official: false });
  });

  // ---- official scoring: weigh-in, approval, calendar, standings ---------

  // A tournament runs from date to endDate; one-day events have no end_date.
  const eventsOn = (day) => db.prepare('SELECT id, kind, name FROM events WHERE ? BETWEEN date AND COALESCE(end_date, date)').all(day);

  // The points the rules give a catch, as a suggestion for the secretary.
  function suggestPoints(catchId) {
    const row = db.prepare(`
      SELECT s.name AS species, s.points_per_kg AS pointsPerKg, k.weight_kg AS weightKg, k.released,
        k.caught_on AS caughtOn, COALESCE(t.division, 'ocean') AS division
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id WHERE k.id = ?
    `).get(catchId);
    return scoring.scoreCatch({ ...row, released: !!row.released });
  }

  // Fish registered while only Sundays and holidays scored were saved with
  // 0 points; every day scores now, so give them their points.
  for (const { id } of db.prepare("SELECT id FROM catches WHERE points_note LIKE 'Not a scoring day%' AND status IN ('pending_review', 'approved')").all()) {
    const { points, note } = suggestPoints(id);
    db.prepare('UPDATE catches SET points = ?, points_note = ? WHERE id = ?').run(points, note, id);
  }

  // Captain (or secretary): register a fish for a JHMMC boat (the digital Fish Registration Form).
  api.post('/weigh', requireWeigh, withVideo('scalePhoto', 'scaleVideo'), (req, res) => {
    const teamId = intId(req.body.teamId);
    if (!teamId) {
      discardUploads(req);
      return res.status(400).json({ error: 'Choose the boat.' });
    }
    insertCatch(req, res, { teamId, official: true });
  });

  // Captain (or secretary): a whole boat's fish in one submission, like one paper form.
  // Each fish's scale photo arrives as file field "scale_<n>", and an optional
  // video of it on the scale as "scalevideo_<n>". All or nothing:
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
    const problem = sheetProblem(req.user, req.body);
    if (problem) return fail(problem);
    if (fish.length > MAX_FISH_PER_SHEET) return fail(`At most ${MAX_FISH_PER_SHEET} fish at a time.`);
    const rows = [];
    for (const [i, f] of fish.entries()) {
      const media = { photo: files.find((x) => x.fieldname === `scale_${i}`), video: files.find((x) => x.fieldname === `scalevideo_${i}`) };
      const checked = checkCatch(req.user, { ...f, caughtOn: req.body.caughtOn, weighStation: req.body.weighStation }, media,
        { teamId, official: true });
      if (checked.error) return fail(`Fish ${i + 1}: ${checked.error}`);
      rows.push(checked.values);
    }
    db.exec('BEGIN');
    try {
      const ids = rows.map(insertCatchRow);
      const where = deviceSpot(req.body);
      for (const id of ids) {
        scoreRegistration(id);
        logRegistration(id, 'registered', req.user, { where });
      }
      db.exec('COMMIT');
      notifyReviewers(teamId, ids.length, req.user);
      res.status(201).json({ catches: ids.map((id) => getCatch(id, req.user)) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // The secretary's work list; captains see their own registrations waiting.
  api.get('/officials/queue', requireWeigh, (req, res) => {
    const toReview = db.prepare(`${CATCH_SELECT} WHERE k.status = 'pending_review' ORDER BY k.caught_on, t.name, k.id`)
      .all({ viewer: req.user.id })
      .map((r) => ({ ...present(r, req.user), suggested: suggestPoints(r.id), events: eventsOn(r.caughtOn),
        disputes: disputesFor.all(r.id), disputeUntil: disputeUntil(r.createdAt) }));
    // Captains see what they registered that the secretary hasn't decided yet.
    res.json({ toReview: canApprove(req.user) ? toReview : toReview.filter((c) => c.loggedBy === req.user.id) });
  });

  // Every boat's registrations waiting for the secretary, open to all JHMMC
  // captains so they can dispute one within 24 hours.
  api.get('/registrations/pending', requireWeigh, (req, res) => {
    const now = Date.now();
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.status = 'pending_review' ORDER BY k.created_at DESC, k.id DESC`).all({ viewer: req.user.id });
    res.json({
      registrations: rows.map((r) => {
        const disputes = disputesFor.all(r.id);
        const until = disputeUntil(r.createdAt);
        return {
          ...present(r, req.user), disputeUntil: until, disputes: disputes.length,
          disputedByMe: disputes.some((d) => d.userId === req.user.id),
          canDispute: r.teamId !== req.user.teamId && !canReview(req.user) && now < Date.parse(until)
            && !disputes.some((d) => d.userId === req.user.id),
        };
      }),
    });
  });

  // A JHMMC captain disputes another boat's registration, with a reason.
  api.post('/catches/:id/disputes', (req, res) => {
    const row = db.prepare('SELECT id, team_id AS teamId, status, created_at AS createdAt FROM catches WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!row || row.status === 'unofficial') return res.status(404).json({ error: 'Registration not found.' });
    if (!captainsJhmmcBoat(req.user)) return res.status(403).json({ error: 'Only captains of JHMMC boats can dispute a registration.' });
    if (row.teamId === req.user.teamId) return res.status(400).json({ error: "You can't dispute your own boat's fish; withdraw it instead." });
    if (row.status !== 'pending_review') return res.status(400).json({ error: 'The secretary has already decided on this fish.' });
    if (Date.now() >= Date.parse(disputeUntil(row.createdAt))) {
      return res.status(400).json({ error: `Disputes close ${DISPUTE_HOURS} hours after a fish is registered.` });
    }
    const reason = str(req.body.reason, 500);
    if (!reason) return res.status(400).json({ error: 'Say why you are disputing this fish.' });
    if (db.prepare('SELECT 1 FROM disputes WHERE catch_id = ? AND user_id = ?').get(row.id, req.user.id)) {
      return res.status(409).json({ error: 'You have already disputed this fish.' });
    }
    db.prepare('INSERT INTO disputes (catch_id, user_id, reason) VALUES (?, ?, ?)').run(row.id, req.user.id, reason);
    logRegistration(row.id, 'disputed', req.user, { note: reason });
    const fish = snapshot(row.id);
    pushToReviewers({
      title: 'Registration disputed',
      body: `${req.user.name} disputes ${fish.boat}'s ${fish.species}: ${reason}`,
      url: '/#/review',
    }, req.user);
    res.status(201).json({ ok: true });
  });

  // The record, newest first: for one fish, one boat, or everything.
  // One entry per fish, newest activity first, each with everything that
  // happened to it in order. Paged by fish (`before` = the last fish's latest event id).
  const LOG_PAGE = 40;
  api.get('/registrations/log', requireReview, (req, res) => {
    const filter = { catchId: intId(req.query.catch) ?? null, teamId: intId(req.query.team) ?? null, before: intId(req.query.before) ?? null };
    const fish = db.prepare(`SELECT catch_id AS catchId, MAX(id) AS latest FROM registration_log
      WHERE (:catchId IS NULL OR catch_id = :catchId) AND (:teamId IS NULL OR team_id = :teamId)
      GROUP BY catch_id HAVING (:before IS NULL OR MAX(id) < :before) ORDER BY latest DESC LIMIT ${LOG_PAGE}`).all(filter);
    const events = db.prepare(`SELECT id, action, user_id AS userId, user_name AS userName, details, lat, lng, created_at AS createdAt
      FROM registration_log WHERE catch_id = ? ORDER BY id`);
    res.json({
      fish: fish.map(({ catchId }) => {
        const steps = events.all(catchId).map(({ details, ...e }) => ({ ...e, ...JSON.parse(details) }));
        // The fish as it now stands comes from its latest event.
        const { scalePhoto, scaleVideo, note, ...now } = steps.at(-1);
        return {
          catchId, ...now, status: now.action, scalePhotoUrl: photoUrl(scalePhoto), scaleVideoUrl: photoUrl(scaleVideo ?? null),
          steps: steps.map((e) => ({ action: e.action, userName: e.userName, createdAt: e.createdAt, lat: e.lat, lng: e.lng, note: e.note ?? null })),
        };
      }),
      nextBefore: fish.length === LOG_PAGE ? fish.at(-1).latest : null,
    });
  });

  // How many registrations wait for the secretary: the badge in the menu.
  api.get('/officials/pending', requireApprove, (_req, res) => {
    res.json({ count: db.prepare("SELECT COUNT(*) AS n FROM catches WHERE status = 'pending_review'").get().n });
  });

  // Secretary: approve (with the rules' points or a corrected figure) or reject.
  api.post('/catches/:id/review', requireApprove, (req, res) => {
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
      if (!note && disputesFor.all(id).length) return res.status(400).json({ error: 'This fish was disputed: add a note on how the dispute was settled.' });
      db.prepare(`UPDATE catches SET status = 'approved', points = ?, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(given, note || suggested.note, req.user.id, new Date().toISOString(), id);
    } else {
      return res.status(400).json({ error: 'Approve or reject.' });
    }
    logRegistration(id, req.body.decision === 'reject' ? 'rejected' : 'approved', req.user, { note });
    res.json({ catch: getCatch(id, req.user) });
  });

  // Season calendar: tournaments, each with its own results. (Holidays from
  // earlier versions are kept but no longer affect scoring.)
  api.get('/events', (_req, res) => {
    const start = setting('season_start');
    const end = setting('season_end');
    res.json({
      season: { start, end },
      events: db.prepare(`SELECT id, date, COALESCE(end_date, date) AS endDate, kind, name,
          (SELECT json_group_array(team_id) FROM tournament_entries WHERE event_id = events.id) AS entries
        FROM events WHERE COALESCE(end_date, date) >= ? AND date <= ? ORDER BY date`).all(start, end)
        .map((e) => ({ ...e, entries: JSON.parse(e.entries) })),
    });
  });

  api.post('/events', requireReview, (req, res) => {
    const date = str(req.body.date, 10);
    const kind = req.body.kind === 'tournament' ? 'tournament' : 'holiday';
    const name = str(req.body.name, 80);
    const endDate = str(req.body.endDate, 10) || date;
    const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
    if (!isDay(date)) return res.status(400).json({ error: 'Choose the date.' });
    if (!isDay(endDate) || endDate < date) return res.status(400).json({ error: 'The last day must be on or after the first day.' });
    if ((Date.parse(endDate) - Date.parse(date)) / 86400000 >= MAX_EVENT_DAYS) {
      return res.status(400).json({ error: `A tournament can last up to ${MAX_EVENT_DAYS} days.` });
    }
    if (!name) return res.status(400).json({ error: kind === 'tournament' ? 'Name the tournament.' : 'Name the holiday.' });
    const { lastInsertRowid } = db.prepare('INSERT INTO events (date, end_date, kind, name) VALUES (?, ?, ?, ?)')
      .run(date, endDate === date ? null : endDate, kind, name);
    res.status(201).json({ event: { id: Number(lastInsertRowid), date, endDate, kind, name } });
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
  // Two end-of-season trophies: overall points (every day) and tournament
  // points (only fish caught during the season's tournaments, added up).
  api.get('/points', (req, res) => {
    const division = req.query.division === 'river' ? 'river' : 'ocean';
    const scope = req.query.scope === 'tournaments' ? 'tournaments' : 'overall';
    const start = setting('season_start');
    const end = setting('season_end');
    const base = `FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'approved' AND k.club_id = :home AND t.division = :division AND k.caught_on BETWEEN :start AND :end
      ${scope === 'tournaments' ? `AND EXISTS (SELECT 1 FROM events e JOIN tournament_entries te ON te.event_id = e.id
        WHERE e.kind = 'tournament' AND te.team_id = k.team_id AND k.caught_on BETWEEN e.date AND COALESCE(e.end_date, e.date))` : ''}`;
    const params = { division, start, end, home: homeClubId() };
    const boats = db.prepare(`
      SELECT t.id AS teamId, t.name AS teamName, COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
      ${base} GROUP BY t.id ORDER BY points DESC, catches DESC
    `).all(params);
    const anglers = db.prepare(`
      SELECT u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.name AS teamName, MIN(k.id) AS first,
        COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
      ${base.replace('JOIN teams t ON t.id = k.team_id', 'JOIN teams t ON t.id = k.team_id LEFT JOIN users u ON u.id = k.user_id')}
      GROUP BY COALESCE('u' || u.id, 'n' || lower(k.angler_name)) ORDER BY points DESC LIMIT 20
    `).all(params).map(({ first, ...a }) => a);
    const tournaments = db.prepare(`SELECT id, date, COALESCE(end_date, date) AS endDate, name FROM events
      WHERE kind = 'tournament' AND COALESCE(end_date, date) >= ? AND date <= ? ORDER BY date DESC`)
      .all(start, end)
      .map((e) => ({
        ...e,
        winner: db.prepare(`
          SELECT t.id AS teamId, t.name AS teamName, ROUND(SUM(k.points), 1) AS points
          FROM catches k JOIN teams t ON t.id = k.team_id JOIN tournament_entries te ON te.team_id = t.id AND te.event_id = ?
          WHERE k.status = 'approved' AND k.club_id = ? AND t.division = ? AND k.caught_on BETWEEN ? AND ?
          GROUP BY t.id ORDER BY points DESC LIMIT 1
        `).get(e.id, params.home, division, e.date, e.endDate) ?? null,
      }));
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'pending_review' AND t.division = ?`).get(division).n;
    res.json({ division, scope, season: { start, end }, boats, anglers, tournaments, pending });
  });

  // One tournament's results: boats ranked, with their approved catches.
  api.get('/tournaments/:id', (req, res) => {
    const event = db.prepare(`SELECT id, date, COALESCE(end_date, date) AS endDate, name FROM events WHERE id = ? AND kind = 'tournament'`).get(intId(req.params.id));
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const division = req.query.division === 'river' ? 'river' : 'ocean';
    // Only boats entered in the tournament compete in it; others fishing that day score for the season only.
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.caught_on BETWEEN :date AND :endDate AND t.division = :division AND k.status = 'approved'
      AND k.club_id = :home AND k.team_id IN (SELECT team_id FROM tournament_entries WHERE event_id = :event)
      ORDER BY k.points DESC`).all({ date: event.date, endDate: event.endDate, division, home: homeClubId(), event: event.id, viewer: req.user?.id ?? 0 });
    const boats = new Map();
    for (const r of rows) {
      const b = boats.get(r.teamId) ?? { teamId: r.teamId, teamName: r.teamName, points: 0, catches: [] };
      b.points = Math.round((b.points + r.points) * 10) / 10;
      b.catches.push(present(r, req.user));
      boats.set(r.teamId, b);
    }
    const entries = db.prepare(`SELECT t.id AS teamId, t.name AS teamName, t.division FROM tournament_entries te
      JOIN teams t ON t.id = te.team_id WHERE te.event_id = ? ORDER BY t.name COLLATE NOCASE`).all(event.id);
    res.json({ tournament: event, division, entries, results: [...boats.values()].sort((a, b) => b.points - a.points) });
  });

  // ---- club membership ------------------------------------------------------
  // The secretary keeps the list of paid JHMMC members for the current season.
  const memberSeason = () => setting('season_start');
  const isPaidMember = (userId) => !!db.prepare(`SELECT 1 FROM club_members m JOIN users u ON u.id = m.user_id
    WHERE m.user_id = ? AND m.season = ? AND u.jhmmc = 1`).get(userId, memberSeason());
  const crewWithMembership = (teamId) => db.prepare('SELECT id, name FROM users WHERE team_id = ? ORDER BY name COLLATE NOCASE')
    .all(teamId).map((u) => ({ ...u, member: isPaidMember(u.id) }));
  // Members without an account (children, for example), listed by name.
  const isPaidPerson = (personId) => !!db.prepare('SELECT 1 FROM club_people_paid WHERE person_id = ? AND season = ?').get(personId, memberSeason());
  const peopleOfBoat = (teamId) => db.prepare('SELECT id, name FROM club_people WHERE team_id = ? ORDER BY name COLLATE NOCASE')
    .all(teamId).map((p) => ({ ...p, member: isPaidPerson(p.id) }));

  api.get('/club-members', requireMoney, (_req, res) => {
    const season = { start: setting('season_start'), end: setting('season_end') };
    const people = db.prepare(`SELECT u.id, u.name, u.nickname, u.email, u.role, t.name AS teamName,
        EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = u.id AND m.season = ?) AS paid
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.jhmmc = 1 ORDER BY u.name COLLATE NOCASE`).all(season.start)
      .map((p) => ({ ...p, paid: !!p.paid, isAdmin: isAdminUser(p) }));
    const named = db.prepare(`SELECT p.id, p.name, p.team_id AS teamId, t.name AS teamName,
        EXISTS (SELECT 1 FROM club_people_paid c WHERE c.person_id = p.id AND c.season = ?) AS paid
      FROM club_people p LEFT JOIN teams t ON t.id = p.team_id ORDER BY p.name COLLATE NOCASE`).all(season.start)
      .map((p) => ({ ...p, paid: !!p.paid }));
    res.json({ season, people, named });
  });

  // Add a member who has no account (a child, say), optionally with their boat.
  api.post('/club-members/named', requireMoney, (req, res) => {
    const name = str(req.body.name, 80);
    if (!name) return res.status(400).json({ error: 'Type the name.' });
    const teamId = intId(req.body.teamId);
    if (teamId && !db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) return res.status(400).json({ error: 'Boat not found.' });
    if (db.prepare('SELECT 1 FROM club_people WHERE name = ? COLLATE NOCASE AND COALESCE(team_id, 0) = ?').get(name, teamId || 0)) {
      return res.status(409).json({ error: `${name} is already on the list.` });
    }
    const id = Number(db.prepare('INSERT INTO club_people (name, team_id) VALUES (?, ?)').run(name, teamId || null).lastInsertRowid);
    if (req.body.paid !== false) db.prepare('INSERT OR IGNORE INTO club_people_paid (person_id, season) VALUES (?, ?)').run(id, memberSeason());
    res.status(201).json({ ok: true, id });
  });

  api.put('/club-members/named/:id', requireMoney, (req, res) => {
    const person = db.prepare('SELECT id FROM club_people WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!person) return res.status(404).json({ error: 'Member not found.' });
    if (req.body.paid) db.prepare('INSERT OR IGNORE INTO club_people_paid (person_id, season) VALUES (?, ?)').run(person.id, memberSeason());
    else db.prepare('DELETE FROM club_people_paid WHERE person_id = ? AND season = ?').run(person.id, memberSeason());
    db.prepare('UPDATE tournament_anglers SET member = ?, paid = CASE WHEN ? THEN 0 ELSE paid END WHERE person_id = ?')
      .run(req.body.paid ? 1 : 0, req.body.paid ? 1 : 0, person.id);
    res.json({ ok: true, paid: !!req.body.paid });
  });

  api.delete('/club-members/named/:id', requireMoney, (req, res) => {
    db.prepare('DELETE FROM club_people WHERE id = ?').run(intId(req.params.id) ?? 0);
    res.json({ ok: true });
  });

  api.put('/club-members/:userId', requireMoney, (req, res) => {
    const user = db.prepare('SELECT id, name, jhmmc FROM users WHERE id = ?').get(intId(req.params.userId) ?? 0);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    if (req.body.paid && !user.jhmmc) return res.status(400).json({ error: `${user.name} isn't a JHMMC member: the admin adds people to JHMMC on the Members page.` });
    if (req.body.paid) {
      db.prepare('INSERT OR IGNORE INTO club_members (user_id, season, marked_by) VALUES (?, ?, ?)').run(user.id, memberSeason(), req.user.id);
    } else {
      db.prepare('DELETE FROM club_members WHERE user_id = ? AND season = ?').run(user.id, memberSeason());
    }
    // A paid member doesn't owe a temporary membership: refresh their tournament rows.
    db.prepare('UPDATE tournament_anglers SET member = ?, paid = CASE WHEN ? THEN 0 ELSE paid END WHERE user_id = ?')
      .run(req.body.paid ? 1 : 0, req.body.paid ? 1 : 0, user.id);
    res.json({ ok: true, paid: !!req.body.paid });
  });

  // ---- tournament registration ------------------------------------------
  // Captains enter their boat with the anglers fishing on it; the secretary
  // sees every boat on one sheet, puts boats in or out and ticks off the
  // temporary memberships non-members pay (rule 1: USD 50 per tournament).
  const TEMP_MEMBERSHIP_USD = 50;
  const MAX_TOURNAMENT_ANGLERS = 12;
  const tournamentById = (id) => db.prepare(`SELECT id, name, date, COALESCE(end_date, date) AS endDate FROM events
    WHERE id = ? AND kind = 'tournament'`).get(intId(id) ?? 0);
  const anglersOf = db.prepare(`SELECT id, user_id AS userId, person_id AS personId, name, member, paid FROM tournament_anglers
    WHERE event_id = ? AND team_id = ? ORDER BY position, id`);
  const isEntered = (eventId, teamId) => !!db.prepare('SELECT 1 FROM tournament_entries WHERE event_id = ? AND team_id = ?').get(eventId, teamId);
  // Anglers with an account are members if the secretary has them as paid
  // this season; guests are as the captain marked them.
  const listAnglers = (eventId, teamId) => anglersOf.all(eventId, teamId)
    .map((a) => ({ ...a, member: memberNow(a), paid: !!a.paid }));
  const memberNow = (a) => (a.userId ? isPaidMember(a.userId) : a.personId ? isPaidPerson(a.personId) : !!a.member);
  const todayUtc = () => new Date().toISOString().slice(0, 10);

  // The season's tournaments, open to everyone; officials also get the
  // anglers and money owed, captains whether their boat is in.
  api.get('/tournaments', (req, res) => {
    const myTeam = req.user && canWeigh(req.user) ? req.user.teamId : null;
    const official = canHandleMoney(req.user);
    const rows = db.prepare(`SELECT e.id, e.name, e.date, COALESCE(e.end_date, e.date) AS endDate,
        (SELECT COUNT(*) FROM tournament_entries te WHERE te.event_id = e.id) AS boats,
        (SELECT COUNT(*) FROM tournament_anglers ta JOIN tournament_entries te ON te.event_id = ta.event_id AND te.team_id = ta.team_id
          WHERE ta.event_id = e.id) AS anglers,
        (SELECT COUNT(*) FROM tournament_anglers ta JOIN tournament_entries te ON te.event_id = ta.event_id AND te.team_id = ta.team_id
          WHERE ta.event_id = e.id AND (CASE WHEN ta.user_id IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = ta.user_id AND m.season = :season) WHEN ta.person_id IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM club_people_paid c WHERE c.person_id = ta.person_id AND c.season = :season) ELSE ta.member = 0 END)) AS guests,
        (SELECT COUNT(*) FROM tournament_anglers ta JOIN tournament_entries te ON te.event_id = ta.event_id AND te.team_id = ta.team_id
          WHERE ta.event_id = e.id AND (CASE WHEN ta.user_id IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = ta.user_id AND m.season = :season) WHEN ta.person_id IS NOT NULL THEN NOT EXISTS (SELECT 1 FROM club_people_paid c WHERE c.person_id = ta.person_id AND c.season = :season) ELSE ta.member = 0 END) AND ta.paid = 0) AS unpaid
      FROM events e WHERE e.kind = 'tournament' AND COALESCE(e.end_date, e.date) >= :start AND e.date <= :end ORDER BY e.date`)
      .all({ start: setting('season_start'), end: setting('season_end'), season: memberSeason() });
    res.json({
      fee: TEMP_MEMBERSHIP_USD,
      tournaments: rows.map(({ anglers, guests, unpaid, ...t }) => ({
        ...t, open: t.endDate >= todayUtc(), mine: myTeam ? isEntered(t.id, myTeam) : false,
        ...(official && { anglers, guests, unpaid }),
      })),
    });
  });

  // The secretary's registration sheet: every JHMMC boat, entered ones first.
  api.get('/tournaments/:id/sheet', requireMoney, (req, res) => {
    const event = tournamentById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const boats = db.prepare(`SELECT id AS teamId, name AS teamName, division, weigh_station AS station FROM teams
      WHERE club_id = ? ORDER BY name COLLATE NOCASE`).all(homeClubId())
      .map((t) => ({ ...t, entered: isEntered(event.id, t.teamId), anglers: listAnglers(event.id, t.teamId),
        crew: crewWithMembership(t.teamId), named: peopleOfBoat(t.teamId) }));
    res.json({ tournament: event, fee: TEMP_MEMBERSHIP_USD, boats });
  });

  // A captain's own entry for a tournament, with the crew to choose from.
  api.get('/tournaments/:id/my-entry', requireWeigh, (req, res) => {
    const event = tournamentById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const team = db.prepare(`SELECT id, name, division, weigh_station AS station FROM teams
      WHERE captain_id = ? AND club_id = ?`).get(req.user.id, homeClubId());
    if (!team) return res.status(403).json({ error: 'Only captains of JHMMC boats enter tournaments.' });
    const crew = crewWithMembership(team.id);
    const named = peopleOfBoat(team.id);
    res.json({ tournament: event, named, fee: TEMP_MEMBERSHIP_USD, team, crew, entered: isEntered(event.id, team.id),
      anglers: listAnglers(event.id, team.id), open: event.endDate >= todayUtc() });
  });

  // Enter a boat (with its anglers) or take it out: its captain, until the
  // tournament is over, or the secretary at any time.
  api.put('/tournaments/:id/entries/:teamId', (req, res) => {
    const event = tournamentById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const team = db.prepare('SELECT id, club_id AS clubId, captain_id AS captainId FROM teams WHERE id = ?').get(intId(req.params.teamId) ?? 0);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    if (team.clubId !== homeClubId()) return res.status(400).json({ error: 'Only JHMMC boats can enter club tournaments.' });
    const official = canReview(req.user);
    if (!official && team.captainId !== req.user.id) return res.status(403).json({ error: "Only the boat's captain or the secretary can do that." });
    if (!official && event.endDate < todayUtc()) return res.status(400).json({ error: 'This tournament is over; ask the secretary for changes.' });
    if (!req.body.entered) {
      db.prepare('DELETE FROM tournament_entries WHERE event_id = ? AND team_id = ?').run(event.id, team.id);
      db.prepare('DELETE FROM tournament_anglers WHERE event_id = ? AND team_id = ?').run(event.id, team.id);
      return res.json({ ok: true, entered: false, anglers: [] });
    }
    // The anglers: crew members by account, anyone else by name.
    let anglers = null;
    if (Array.isArray(req.body.anglers)) {
      if (req.body.anglers.length > MAX_TOURNAMENT_ANGLERS) return res.status(400).json({ error: `At most ${MAX_TOURNAMENT_ANGLERS} anglers on a boat.` });
      anglers = [];
      for (const a of req.body.anglers) {
        const userId = intId(a?.userId);
        const personId = !userId && intId(a?.personId);
        let name = str(a?.name, 80);
        if (userId) {
          const u = db.prepare('SELECT name FROM users WHERE id = ? AND team_id = ?').get(userId, team.id);
          if (!u) return res.status(400).json({ error: 'Anglers with an account must be on the boat\'s crew; add anyone else as a guest.' });
          name = u.name;
        } else if (personId) {
          const p = db.prepare('SELECT name FROM club_people WHERE id = ?').get(personId);
          if (!p) return res.status(400).json({ error: 'That member is no longer on the club list.' });
          name = p.name;
        }
        if (!name) return res.status(400).json({ error: "Type each guest angler's name." });
        if (anglers.some((x) => (userId && x.userId === userId) || (personId && x.personId === personId) || x.name.toLowerCase() === name.toLowerCase())) {
          return res.status(400).json({ error: `${name} is on the list twice.` });
        }
        // Membership is the secretary's to say: crew from the paid list, guests only if the secretary marks them.
        anglers.push({ userId: userId || null, personId: personId || null, name,
          member: userId ? isPaidMember(userId) : personId ? isPaidPerson(personId) : official && !!a.member });
      }
    }
    if (!official && !anglers?.length) return res.status(400).json({ error: 'List the anglers fishing on your boat.' });
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO tournament_entries (event_id, team_id) VALUES (?, ?)').run(event.id, team.id);
      if (anglers) {
        // Keep the "paid" tick for anglers who stay on the list.
        const before = listAnglers(event.id, team.id);
        db.prepare('DELETE FROM tournament_anglers WHERE event_id = ? AND team_id = ?').run(event.id, team.id);
        const add = db.prepare(`INSERT INTO tournament_anglers (event_id, team_id, user_id, person_id, name, member, paid, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        anglers.forEach((a, i) => {
          const was = before.find((b) => (a.userId && b.userId === a.userId) || b.name.toLowerCase() === a.name.toLowerCase());
          // A captain's edit keeps a guest the secretary marked as a member.
          const member = a.member || (!official && !a.userId && !a.personId && !!was?.member);
          add.run(event.id, team.id, a.userId, a.personId, a.name, member ? 1 : 0, !member && was?.paid ? 1 : 0, i);
        });
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json({ ok: true, entered: true, anglers: listAnglers(event.id, team.id) });
  });

  // The secretary ticks off a temporary membership as paid, or corrects member status.
  api.patch('/tournaments/:id/anglers/:anglerId', requireMoney, (req, res) => {
    const row = db.prepare('SELECT id, user_id AS userId, person_id AS personId, member, paid FROM tournament_anglers WHERE id = ? AND event_id = ?')
      .get(intId(req.params.anglerId) ?? 0, intId(req.params.id) ?? 0);
    if (!row) return res.status(404).json({ error: 'Angler not found.' });
    // Members with an account come from the club membership list, not this sheet.
    const member = row.userId || row.personId ? memberNow(row)
      : 'member' in req.body && canReview(req.user) ? !!req.body.member : !!row.member;
    const paid = !member && ('paid' in req.body ? !!req.body.paid : !!row.paid);
    db.prepare('UPDATE tournament_anglers SET member = ?, paid = ? WHERE id = ?').run(member ? 1 : 0, paid ? 1 : 0, row.id);
    res.json({ ok: true, member, paid });
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
      SELECT m.id, m.body, m.created_at AS createdAt, u.id AS userId, ${SHOWN} AS author
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
    if (item.status !== 'unofficial') {
      logRegistration(id, item.loggedBy === req.user.id && !canReview(req.user) ? 'withdrawn' : 'deleted', req.user);
    }
    db.prepare('DELETE FROM catches WHERE id = ?').run(id);
    // A registration's scale photo and video stay as evidence in the record.
    removeUpload(item.photo);
    removeUpload(item.video);
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
      comment: { id: Number(lastInsertRowid), body, userId: req.user.id, author: req.user.nickname || req.user.name },
    });
  });

  // Whoever wrote a comment can remove it; the club admin can remove any.
  api.delete('/catches/:id/comments/:commentId', (req, res) => {
    const comment = db.prepare('SELECT id, user_id AS userId FROM comments WHERE id = ? AND catch_id = ?')
      .get(intId(req.params.commentId) ?? 0, intId(req.params.id) ?? 0);
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    if (comment.userId !== req.user.id && !isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Only whoever wrote it or the club admin can remove a comment.' });
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id);
    res.json({ ok: true });
  });

  // ---- the JHMMC feed (members only) -------------------------------------

  // Members post through the day: messages, photos and fish. Fish the
  // secretary approves join the feed by themselves, marked verified.
  const isClubMember = (u) => !!u && (!!u.jhmmc || isAdminUser(u));
  const requireMember = (req, res, next) => (isClubMember(req.user) ? next()
    : res.status(req.user ? 403 : 401).json({ error: 'The JHMMC feed is for JHMMC members.' }));
  const clubPostById = (id) => db.prepare('SELECT id, user_id AS userId, photo, video FROM club_posts WHERE id = ?').get(id ?? 0);
  const canRemoveClubPost = (u, authorId) => authorId === u.id || isAdminUser(u);

  api.get('/club-feed', requireMember, (req, res) => {
    const PAGE = 20;
    // Posts and verified fish in one timeline; the cursor is "time|key".
    const [bt, bk] = typeof req.query.before === 'string' ? req.query.before.split('|') : [];
    // Filters: what to show (verified fish, any fish, photos, members' posts) and one boat.
    const show = ['verified', 'fish', 'photos', 'posts'].includes(req.query.show) ? req.query.show : '';
    const team = intId(req.query.team);
    const postsWhere = [show === 'fish' && 'p.species_id IS NOT NULL', show === 'photos' && 'p.photo IS NOT NULL',
      team && '(SELECT team_id FROM users WHERE id = p.user_id) = :team'].filter(Boolean);
    const parts = [
      show !== 'verified' && `SELECT 'post' AS kind, p.id, p.created_at AS ts, printf('p%010d', p.id) AS key FROM club_posts p
        ${postsWhere.length ? `WHERE ${postsWhere.join(' AND ')}` : ''}`,
      ['', 'verified', 'fish'].includes(show) && `SELECT 'verified' AS kind, k.id, datetime(k.reviewed_at) AS ts, printf('v%010d', k.id) AS key FROM catches k
        WHERE k.status = 'approved' AND k.reviewed_at IS NOT NULL${team ? ' AND k.team_id = :team' : ''}`,
    ].filter(Boolean);
    const rows = db.prepare(`
      SELECT * FROM (${parts.join(' UNION ALL ')})
      WHERE :bt IS NULL OR ts < :bt OR (ts = :bt AND key < :bk)
      ORDER BY ts DESC, key DESC LIMIT ${PAGE + 1}`).all({ bt: bt || null, bk: bk || '', ...(team && { team }) });
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    const post = db.prepare(`
      SELECT p.id, p.body, p.photo, p.video, p.weight_kg AS weightKg, p.released, p.created_at AS createdAt,
        s.name AS species, u.id AS userId, ${SHOWN} AS author, u.photo AS authorPhoto, t.name AS teamName,
        (SELECT COUNT(*) FROM club_post_likes l WHERE l.post_id = p.id) AS likes,
        EXISTS (SELECT 1 FROM club_post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
      FROM club_posts p JOIN users u ON u.id = p.user_id LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN species s ON s.id = p.species_id WHERE p.id = ?`);
    const comments = db.prepare(`SELECT c.id, c.body, c.created_at AS createdAt, u.id AS userId, ${SHOWN} AS author
      FROM club_post_comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`);
    const fish = db.prepare(`
      SELECT k.id, s.name AS species, k.weight_kg AS weightKg, k.released, k.points, k.caught_on AS caughtOn,
        datetime(k.reviewed_at) AS createdAt, COALESCE(k.photo, k.scale_photo) AS photo, COALESCE(k.video, k.scale_video) AS video,
        u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
        (SELECT COUNT(*) FROM likes l WHERE l.catch_id = k.id) AS likes,
        (SELECT COUNT(*) FROM comments c WHERE c.catch_id = k.id) AS comments
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users u ON u.id = k.user_id
      LEFT JOIN teams t ON t.id = k.team_id WHERE k.id = ?`);
    const items = page.map((r) => {
      if (r.kind === 'verified') {
        const { photo, video, ...f } = fish.get(r.id);
        return { kind: 'verified', ...f, released: !!f.released, photoUrl: photoUrl(photo), videoUrl: photoUrl(video) };
      }
      const { photo, video, authorPhoto, ...p } = post.get(req.user.id, r.id);
      return {
        kind: 'post', ...p, released: !!p.released, liked: !!p.liked, photoUrl: photoUrl(photo), videoUrl: photoUrl(video),
        authorPhotoUrl: photoUrl(authorPhoto),
        canDelete: canRemoveClubPost(req.user, p.userId),
        comments: comments.all(r.id).map((c) => ({ ...c, canDelete: canRemoveClubPost(req.user, c.userId) })),
      };
    });
    const last = page.at(-1);
    res.json({ items, nextBefore: more ? `${last.ts}|${last.key}` : null });
  });

  api.post('/club-feed', requireMember, withVideo('photo', 'video'), (req, res) => {
    const photo = req.files?.photo?.[0];
    const video = req.files?.video?.[0];
    const fail = (status, error) => {
      discardUploads(req);
      res.status(status).json({ error });
    };
    const body = str(req.body.body, 2000);
    const speciesId = intId(req.body.speciesId);
    if (speciesId && !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) return fail(400, 'Unknown species.');
    const released = req.body.released === 'true' || req.body.released === 'on';
    const weight = req.body.weightKg ? Number(req.body.weightKg) : null;
    if (weight != null && !(weight > 0 && weight < 2000)) return fail(400, 'Weight must be a number of kg.');
    if (!body && !photo && !video && !speciesId) return fail(400, 'Write something, add a photo, a video or a fish.');
    const { lastInsertRowid } = db.prepare(`INSERT INTO club_posts (user_id, body, photo, video, species_id, weight_kg, released)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, body, photo?.filename ?? null, video?.filename ?? null,
      speciesId || null, speciesId ? weight : null, speciesId && released ? 1 : 0);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  api.delete('/club-feed/:id', requireMember, (req, res) => {
    const p = clubPostById(intId(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found.' });
    if (!canRemoveClubPost(req.user, p.userId)) return res.status(403).json({ error: 'Only whoever posted it or the club admin can remove a post.' });
    db.prepare('DELETE FROM club_posts WHERE id = ?').run(p.id);
    removeUpload(p.photo);
    removeUpload(p.video);
    res.json({ ok: true });
  });

  api.post('/club-feed/:id/like', requireMember, (req, res) => {
    const p = clubPostById(intId(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found.' });
    const removed = db.prepare('DELETE FROM club_post_likes WHERE user_id = ? AND post_id = ?').run(req.user.id, p.id);
    if (!removed.changes) db.prepare('INSERT INTO club_post_likes (user_id, post_id) VALUES (?, ?)').run(req.user.id, p.id);
    const { likes } = db.prepare('SELECT COUNT(*) AS likes FROM club_post_likes WHERE post_id = ?').get(p.id);
    res.json({ liked: !removed.changes, likes });
  });

  api.post('/club-feed/:id/comments', requireMember, (req, res) => {
    const p = clubPostById(intId(req.params.id));
    if (!p) return res.status(404).json({ error: 'Post not found.' });
    const body = str(req.body.body, 1000);
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty.' });
    const { lastInsertRowid } = db.prepare('INSERT INTO club_post_comments (post_id, user_id, body) VALUES (?, ?, ?)').run(p.id, req.user.id, body);
    res.status(201).json({ comment: { id: Number(lastInsertRowid), body, userId: req.user.id, author: req.user.nickname || req.user.name, canDelete: true } });
  });

  api.delete('/club-feed/:id/comments/:commentId', requireMember, (req, res) => {
    const c = db.prepare('SELECT id, user_id AS userId FROM club_post_comments WHERE id = ? AND post_id = ?')
      .get(intId(req.params.commentId) ?? 0, intId(req.params.id) ?? 0);
    if (!c) return res.status(404).json({ error: 'Comment not found.' });
    if (!canRemoveClubPost(req.user, c.userId)) return res.status(403).json({ error: 'Only whoever wrote it or the club admin can remove a comment.' });
    db.prepare('DELETE FROM club_post_comments WHERE id = ?').run(c.id);
    res.json({ ok: true });
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
          k.caught_on AS caughtOn, u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
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
      book: club && club.id === homeClubId() ? recordBook() : null,
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

  // JHMMC's record book: the club's records from before the app (as printed
  // in its PDF) with approved registrations ranked in among them, heaviest
  // first, ten deep (or as deep as the book). Species the book doesn't list
  // get a list of their own.
  const BOOK_LENGTH = 10;
  function recordBook() {
    const approved = db.prepare(`
      SELECT k.id AS catchId, s.name AS species, k.weight_kg AS weightKg, k.line_class AS lineClass, k.caught_on AS caughtOn,
        u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS boat
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'approved' AND k.club_id = ? AND k.weight_kg IS NOT NULL ORDER BY k.weight_kg DESC
    `).all(homeClubId());
    const fromApp = (species) => approved.filter((a) => a.species === species).map((a) => ({ ...a, fromApp: true }));
    const heaviestFirst = (rows) => rows.sort((a, b) => b.weightKg - a.weightKg);
    const listed = new Set(jhmmcBook.GROUPS.map((g) => g.species).filter(Boolean));
    const all = jhmmcBook.GROUPS.map((g) => ({ title: g.title, species: g.species, length: Math.max(BOOK_LENGTH, g.records.length),
      records: heaviestFirst([...g.records, ...(g.species ? fromApp(g.species) : [])]) }));
    for (const species of new Set(approved.map((a) => a.species))) {
      if (!listed.has(species)) all.push({ title: species, species, length: BOOK_LENGTH, records: fromApp(species) });
    }
    // The heaviest fish for each species and line class, across the book and the app.
    const lineRecords = [];
    for (const g of all) {
      const best = new Map();
      for (const r of g.records) if (r.lineClass && !best.has(r.lineClass)) best.set(r.lineClass, r);
      const order = (c) => (c === 'Unlimited' ? 1e9 : parseFloat(c));
      for (const r of [...best.values()].sort((a, b) => order(a.lineClass) - order(b.lineClass))) lineRecords.push({ group: g.title, ...r });
    }
    // Each list is at least as long as the book's own, so no book record drops off.
    const groups = all.map(({ length, ...g }) => ({ ...g, records: g.records.slice(0, length) }));
    return { asAt: jhmmcBook.AS_AT, pdf: jhmmcBook.PDF, groups, lineRecords };
  }

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
          u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
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
      SELECT u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.name AS teamName, MIN(k.id) AS first, ${tally}
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
      SELECT u.id, ${SHOWN} AS name, u.name AS fullName, u.country, u.bio, u.photo, u.created_at AS joinedAt, t.id AS teamId, t.name AS teamName
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
    discardUploads(req);
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
