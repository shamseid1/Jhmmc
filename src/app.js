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
  // The feed fills itself (weigh-ins, Log fish): posting by hand is closed.
  // Tests that still post open it.
  openPosts = false,
  // Only JHMMC (the admin) opens clubs; others ask. Tests that make clubs freely open it.
  openClubs = false,
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

  // After the clear of all fish (schema 39), their photo and video files are
  // left on the disk: remove, once, every upload nothing in the database
  // mentions any more. A file named anywhere (a post, a boat or profile photo,
  // a scale photo, the registration record) stays, and so does anything less
  // than an hour old.
  function removeUnusedUploads() {
    if (setting('uploads_cleaned') === '39') return;
    const text = [];
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all().filter((c) => !c.type || /TEXT/i.test(c.type)).map((c) => `"${c.name}"`);
      for (const row of cols.length ? db.prepare(`SELECT ${cols.join(', ')} FROM "${name}"`).all() : []) {
        for (const v of Object.values(row)) if (typeof v === 'string') text.push(v);
      }
    }
    const used = text.join('\n');
    let removed = 0;
    for (const file of fs.readdirSync(uploadDir)) {
      const full = path.join(uploadDir, file);
      const st = fs.statSync(full);
      if (!st.isFile() || Date.now() - st.mtimeMs < 3600e3 || used.includes(file)) continue;
      fs.rmSync(full, { force: true });
      removed++;
    }
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('uploads_cleaned', '39');
    if (removed) console.log(`Removed ${removed} unused upload${removed === 1 ? '' : 's'} left from the clear.`);
  }
  try {
    removeUnusedUploads();
  } catch (err) {
    console.error('Clearing unused uploads failed:', err.message);
  }
  // JHMMC's own scoring (weigh-in, approval, points) applies to its boats only.
  const homeClubId = () => db.prepare('SELECT id FROM clubs WHERE name = ? COLLATE NOCASE').get(HOME_CLUB.name)?.id ?? null;
  // Every book is approved fish now: posts never set records or points.
  const clubBook = () => 'approved';

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
  // For now JHMMC is West Africa Big Game: every boat's fish are weighed in and
  // approved through JHMMC, unless its club runs its own weigh-ins (self_run).
  // Only JHMMC's own boats compete in the JHMMC Season and Tournaments.
  const THROUGH_JHMMC = 'NOT EXISTS (SELECT 1 FROM clubs sc WHERE sc.id = k.club_id AND sc.self_run = 1)';
  const throughJhmmc = (clubId) => !clubId || !db.prepare('SELECT 1 FROM clubs WHERE id = ? AND self_run = 1').get(clubId);
  const captainsJhmmcBoat = (u) => !!u && !!db.prepare(`SELECT 1 FROM teams t LEFT JOIN clubs c ON c.id = t.club_id
    WHERE t.captain_id = ? AND COALESCE(c.self_run, 0) = 0`).get(u.id);
  const canWeigh = (u) => canReview(u) || captainsJhmmcBoat(u);
  const requireOfficial = (check, who) => (req, res, next) =>
    check(req.user) ? next() : res.status(403).json({ error: `Only ${who} can do that.` });
  const requireWeigh = requireOfficial(canWeigh, "a boat's captain or the JHMMC secretary");
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

  // Units someone sees and types in; stored metric either way. Unknown values are left out.
  const UNIT_CHOICES = { weight: ['kg', 'lb'], depth: ['m', 'ft'], temp: ['°C', '°F'] };
  const readUnits = (v) => {
    const picked = Object.fromEntries(Object.entries(UNIT_CHOICES).filter(([k, ok]) => ok.includes(v?.[k])).map(([k]) => [k, v[k]]));
    return Object.keys(picked).length ? JSON.stringify(picked) : null;
  };

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
      .prepare('INSERT INTO users (name, first_name, last_name, nickname, email, password_hash, country, units) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`${first} ${last}`, first, last, nickname, email, auth.hashPassword(password), country, readUnits(req.body.units));
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
        t.weigh_station AS weighStation, t.division AS division, u.units, u.notify
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    const { photo, units, notify, ...rest } = me;
    return {
      ...rest, photoUrl: photoUrl(photo), units: units ? JSON.parse(units) : null, notify: notifyPrefs(notify), isCaptain: !!me.isCaptain, jhmmc: !!me.jhmmc || isAdminUser(me),
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

  // What each person wants to be told about (More → Notifications).
  const NOTIFY_DEFAULTS = { announcements: true, myFish: true, weighins: true, logged: true };
  const notifyPrefs = (json) => {
    let saved = {};
    try { saved = JSON.parse(json || '{}'); } catch {}
    return Object.fromEntries(Object.entries(NOTIFY_DEFAULTS).map(([k, v]) => [k, typeof saved[k] === 'boolean' ? saved[k] : v]));
  };
  // Phones of the people who want this kind of notification (and pass the filter), except whoever acted.
  // always: sent whatever the person's choices (fish to review, club requests).
  function pushWhere(kind, payload, by, keep = () => true, always = false) {
    const phones = db.prepare(`SELECT s.endpoint, s.p256dh, s.auth, u.id, u.email, u.role, u.notify FROM push_subscriptions s
      JOIN users u ON u.id = s.user_id WHERE u.id != ?`).all(by?.id ?? 0);
    for (const r of phones.filter((p) => (always || notifyPrefs(p.notify)[kind]) && keep(p))) {
      pusher.send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload)
        .then((alive) => { if (!alive) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(r.endpoint); })
        .catch((err) => console.warn(`Notification failed: ${err.message}`));
    }
  }

  // Phone notifications to the secretary (and the admin), except whoever acted.
  // Sent in the background: a slow push service never holds up the captain.
  function pushToReviewers(payload, by) {
    // Always on: reviewing fish is the secretary's job, not a choice.
    pushWhere('review', payload, by, (p) => p.role === 'secretary' || (!!adminEmail && p.email.toLowerCase() === adminEmail), true);
  }

  // An announcement goes to every phone with notifications on, except the author's.
  function pushToEveryone(payload, by) {
    pushWhere('announcements', payload, by);
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
    if ('units' in req.body) db.prepare('UPDATE users SET units = ? WHERE id = ?').run(readUnits(req.body.units), u.id);
    if (req.body.notify && typeof req.body.notify === 'object') {
      const cur = notifyPrefs(db.prepare('SELECT notify FROM users WHERE id = ?').get(u.id).notify);
      for (const k of Object.keys(NOTIFY_DEFAULTS)) if (typeof req.body.notify[k] === 'boolean') cur[k] = req.body.notify[k];
      db.prepare('UPDATE users SET notify = ? WHERE id = ?').run(JSON.stringify(cur), u.id);
    }
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

  // When a country's club is ready to run its own weigh-ins, the admin switches
  // it over: its boats' fish then go to its own secretary, not JHMMC's.
  api.patch('/admin/clubs/:id', requireAdmin, (req, res) => {
    const club = db.prepare('SELECT id FROM clubs WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!club) return res.status(404).json({ error: 'Club not found.' });
    if (club.id === homeClubId()) return res.status(400).json({ error: 'JHMMC always runs its own weigh-ins.' });
    db.prepare('UPDATE clubs SET self_run = ? WHERE id = ?').run(bool(req.body.selfRun) ? 1 : 0, club.id);
    res.json({ ok: true, selfRun: bool(req.body.selfRun) });
  });

  // The admin's Boats page: a JHMMC boat's weigh station (its home port) and Ocean or River.
  api.patch('/admin/teams/:id', requireAdmin, (req, res) => {
    const team = db.prepare('SELECT id, club_id AS clubId, weigh_station AS station, division FROM teams WHERE id = ?')
      .get(intId(req.params.id) ?? 0);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    if ('weighStation' in req.body && team.clubId !== homeClubId()) return res.status(400).json({ error: 'Only JHMMC boats choose a JHMMC weigh station; other boats have their own.' });
    const station = 'weighStation' in req.body ? req.body.weighStation || null : team.station;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    const division = 'division' in req.body ? req.body.division : team.division;
    if (!['ocean', 'river'].includes(division)) return res.status(400).json({ error: 'Choose Ocean or River.' });
    if (team.clubId === homeClubId()) db.prepare('UPDATE teams SET weigh_station = ?, home_port = ?, division = ? WHERE id = ?').run(station, station, division, team.id);
    else db.prepare('UPDATE teams SET division = ? WHERE id = ?').run(division, team.id);
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
      FROM clubs c WHERE c.pending = 0 ORDER BY c.country, c.name
    `).all();
    res.json({ clubs });
  });

  // Requests to open a club, for JHMMC (the admin) to approve or decline.
  api.get('/admin/club-requests', requireAdmin, (_req, res) => {
    res.json({ requests: db.prepare(`SELECT c.id, c.name, c.country, c.city, c.description, c.created_at AS createdAt,
        COALESCE(NULLIF(u.nickname, ''), u.name) AS requestedBy, u.email
      FROM clubs c LEFT JOIN users u ON u.id = c.created_by WHERE c.pending = 1 ORDER BY c.id`).all() });
  });
  api.post('/admin/club-requests/:id', requireAdmin, (req, res) => {
    const club = db.prepare('SELECT id, name, created_by FROM clubs WHERE id = ? AND pending = 1').get(intId(req.params.id) ?? 0);
    if (!club) return res.status(404).json({ error: 'Request not found.' });
    const approve = req.body.decision === 'approve';
    if (approve) db.prepare('UPDATE clubs SET pending = 0 WHERE id = ?').run(club.id);
    else db.prepare('DELETE FROM clubs WHERE id = ?').run(club.id);
    pushWhere('review', {
      title: approve ? 'Club approved' : 'Club request declined',
      body: approve ? `${club.name} is open: boats can join it now.` : `JHMMC didn't open ${club.name}.`,
      url: approve ? `/#/club/${club.id}` : '/#/clubs',
    }, req.user, (p) => p.id === club.created_by, true);
    res.json({ ok: true });
  });

  api.post('/clubs', (req, res) => {
    const name = str(req.body.name, 100);
    const country = str(req.body.country, 60);
    if (!name || !COUNTRIES.includes(country)) {
      return res.status(400).json({ error: 'Club name and a West African country are required.' });
    }
    if (db.prepare('SELECT 1 FROM clubs WHERE name = ?').get(name)) {
      return res.status(409).json({ error: 'A club with that name already exists (or has been asked for).' });
    }
    // JHMMC (the admin) opens clubs; anyone else's goes to the admin as a request.
    const pending = openClubs || isAdminUser(req.user) ? 0 : 1;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO clubs (name, country, city, description, created_by, pending) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, country, str(req.body.city, 80), str(req.body.description, 1000), req.user.id, pending);
    if (pending) {
      pushWhere('review', { title: 'Club request', body: `${req.user.name} asks to open ${name} (${country}).`, url: '/#/clubs' },
        req.user, (p) => !!adminEmail && p.email.toLowerCase() === adminEmail, true);
    }
    res.status(201).json({ club: db.prepare('SELECT * FROM clubs WHERE id = ?').get(Number(lastInsertRowid)), requested: !!pending });
  });

  api.get('/clubs/:id', (req, res) => {
    const id = intId(req.params.id);
    const club = id && db.prepare('SELECT id, name, country, city, description, created_at AS createdAt FROM clubs WHERE id = ? AND pending = 0').get(id);
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
    return !clubId || !!db.prepare('SELECT 1 FROM clubs WHERE id = ? AND pending = 0').get(clubId);
  }

  // Released and weighed counts drive the bars on the participant cards: fish
  // weighed in and approved only (posts never count).
  const TALLY = `COUNT(k.id) AS catches, COALESCE(SUM(k.released), 0) AS released,
    COUNT(k.weight_kg) AS weighed`;

  api.get('/teams', (_req, res) => {
    const teams = db.prepare(`
      SELECT t.id, t.name, t.home_port AS homePort, t.country, t.length_ft AS lengthFt, t.make, t.photo, t.division,
        t.weigh_station AS weighStation, c.id AS clubId, c.name AS clubName, COALESCE(c.self_run, 0) = 0 AS throughJhmmc,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS members, ${TALLY}
      FROM teams t LEFT JOIN clubs c ON c.id = t.club_id LEFT JOIN catches k ON k.team_id = t.id AND k.status = 'approved'
      GROUP BY t.id ORDER BY t.name COLLATE NOCASE
    `).all();
    res.json({ teams: teams.map(({ photo, ...t }) => ({ ...t, photoUrl: photoUrl(photo) })) });
  });

  api.get('/anglers', (_req, res) => {
    const anglers = db.prepare(`
      SELECT u.id, ${SHOWN} AS name, u.country, u.photo, t.id AS teamId, t.name AS teamName, t.photo AS teamPhoto, ${TALLY}
      FROM users u LEFT JOIN teams t ON t.id = u.team_id LEFT JOIN catches k ON k.user_id = u.id AND k.status = 'approved'
      GROUP BY u.id ORDER BY 2 COLLATE NOCASE
    `).all();
    // Anglers without an account, known only by the name typed on their catches.
    const guests = db.prepare(`
      SELECT NULL AS id, k.angler_name AS name, t.id AS teamId, t.name AS teamName,
        t.photo AS teamPhoto, MIN(k.id) AS first, ${TALLY}
      FROM catches k LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.user_id IS NULL AND k.status = 'approved' GROUP BY lower(k.angler_name)
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
    // Every boat is Ocean or River (most are Ocean).
    const division = req.body.division === 'river' ? 'river' : 'ocean';
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
      FROM catches WHERE team_id = ? AND status = 'approved'
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
    const division = 'division' in req.body ? (req.body.division === 'river' ? 'river' : 'ocean') : cur.division;
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
      k.lat, k.lng, k.spot_public AS spotPublic, k.no_angler AS noAngler,
      k.status, k.weigh_station AS weighStation, k.scale_photo AS scalePhoto, k.points, k.points_note AS pointsNote,
      (SELECT x.photo FROM outing_landings x WHERE x.catch_id = k.id AND x.photo IS NOT NULL LIMIT 1) AS crewPhoto,
      t.division,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler,
      t.id AS teamId, t.name AS teamName,
      c.id AS clubId, c.name AS clubName,
      (SELECT COUNT(*) FROM likes l WHERE l.catch_id = k.id) AS likes,
      (SELECT COUNT(*) FROM comments m WHERE m.catch_id = k.id) AS comments,
      EXISTS (SELECT 1 FROM likes l WHERE l.catch_id = k.id AND l.user_id = :viewer) AS liked
    FROM catches k
    LEFT JOIN species s ON s.id = k.species_id
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

  // A fish's pictures, at most two: the weigh station photo (the main one) and
  // the crew's own from Log fish, swiped between. A release video shows to
  // everyone once the secretary has approved the fish; until then, and always
  // for a video of a fish on the scale, only officers and the boat's own crew see it.
  const fishPhotos = (scalePhoto, crewPhoto) => [...new Set([scalePhoto, crewPhoto].filter(Boolean))].map((f) => ({ url: photoUrl(f) }));
  const seesVideo = (row, viewer) => !!viewer && (canReview(viewer) || viewer.teamId === row.teamId || row.loggedBy === viewer.id);

  function present(row, viewer) {
    const showSpot = row.lat != null && canSeeSpot(row, viewer);
    const fish = fishPhotos(row.scalePhoto, row.crewPhoto);
    const photos = fish.length ? fish : postPhotos('catch', row.id, row.photo);
    const releaseVideo = !!row.released && row.status === 'approved';
    const video = releaseVideo || seesVideo(row, viewer);
    const { crewPhoto, ...rest } = row;
    return {
      ...rest,
      lat: showSpot ? row.lat : null,
      lng: showSpot ? row.lng : null,
      spotPublic: !!row.spotPublic,
      hasSpot: row.lat != null,
      released: !!row.released,
      tagged: !!row.tagged,
      liked: !!row.liked,
      noAngler: !!row.noAngler,
      photoUrl: photos[0]?.url ?? null,
      photos,
      // Shown with the photos: a post's own video, or the release video.
      videoUrl: photoUrl(row.video || (row.released && video ? row.scaleVideo : null)),
      canEdit: row.status === 'unofficial' && canDelete(row, viewer),
      scalePhotoUrl: photoUrl(row.scalePhoto),
      scaleVideoUrl: video ? photoUrl(row.scaleVideo) : null,
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
  // Where a fish was caught, from "lat"/"lng" (both or neither).
  function readSpot(b) {
    const coord = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const lat = coord(b.lat);
    const lng = coord(b.lng);
    if ((lat === null) !== (lng === null) || (lat !== null && !(Math.abs(lat) <= 90 && Math.abs(lng) <= 180))) {
      return { error: 'The GPS location is not valid. Try "Use my location" again.' };
    }
    return { lat, lng };
  }

  // media: { photo, video } (uploaded files, either may be missing).
  function checkCatch(user, b, { photo: file, video } = {}, { teamId, official }) {
    const team = db.prepare('SELECT club_id, country, captain_id, weigh_station, home_port FROM teams WHERE id = ?').get(teamId);
    if (!team) return { error: 'Choose the boat.' };
    const jhmmcBoat = team.club_id === homeClubId();
    if (official && !throughJhmmc(team.club_id)) return { error: "This boat's club weighs its own fish." };
    if (official && !canReview(user) && team.captain_id !== user.id) return { error: "Captains register their own boat's fish only." };
    // A feed post can be any photo; a registration is always a fish.
    const speciesId = intId(b.speciesId);
    if (speciesId ? !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId) : official) {
      return { error: 'Choose a species.' };
    }
    // The angler is a crew member of that boat, or anyone else by name
    // (guests don't need an account).
    // A post may name no angler (chosen as blank): it's simply the poster's.
    const noAngler = !official && b.anglerId === '';
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
    const spot = readSpot(b);
    if (spot.error) return spot;
    const { lat, lng } = spot;
    const released = bool(b.released);
    let station = null;
    if (official) {
      // JHMMC boats weigh at a JHMMC weigh station; boats elsewhere at their own (their home port).
      if (jhmmcBoat) {
        const s = stationFor(user, str(b.weighStation, 40), team.weigh_station);
        if (s.error) return s;
        station = s.station;
      } else {
        station = team.home_port || (team.country ? `${team.country} weigh station` : 'Weigh station');
      }
      if (!released && weightKg === null) return { error: 'Enter the official weight.' };
      // Rule 8: every fish weighed is shown hanging on the scale with the weight
      // readable, in a photo or a video; a released fish by a video of the release.
      if (!released && !file && !video) return { error: 'Add a photo or video of the fish hanging on the scale, with the weight readable.' };
      if (released && !video) return { error: 'Add the video of the release.' };
    }
    const weighed = official && !released;
    // Crew posts are for the feed only; registrations go to the secretary.
    return {
      noAngler,
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

  // A fish registered at the weigh station is the same fish its boat logged at
  // sea: link them (same boat, day and species; a released one to a released
  // one first), so the log shows the scale weight. Works whichever comes first.
  // Five tunas: linked in the order logged, which only keeps the counts right:
  // nobody knows which weight was which, so no single tuna shows a weight (see ALONE).
  function linkRegistrationToLog(catchId) {
    const k = db.prepare("SELECT id, team_id, caught_on, species_id, released, weight_kg, logged_by FROM catches WHERE id = ? AND status <> 'unofficial'").get(catchId);
    if (!k?.team_id || !k.species_id || db.prepare('SELECT 1 FROM outing_landings WHERE catch_id = ?').get(k.id)) return;
    const l = db.prepare(`SELECT l.id FROM outing_landings l JOIN outings o ON o.id = l.outing_id
      WHERE o.team_id = ? AND o.date = ? AND l.species_id = ? AND l.catch_id IS NULL AND l.fate <> 'lost'
      ORDER BY (l.fate = ?) DESC, (l.weight_kg IS NULL OR ? IS NULL), ABS(l.weight_kg - ?), l.id LIMIT 1`)
      .get(k.team_id, k.caught_on, k.species_id, k.released ? 'released' : 'kept', k.weight_kg, k.weight_kg);
    if (l) {
      db.prepare('UPDATE outing_landings SET catch_id = ? WHERE id = ?').run(k.id, l.id);
      return;
    }
    // Logged 3, brought 5 to the scale: the other 2 go in the log too, from
    // the weigh station (no spot), so the log counts every fish.
    const team = db.prepare('SELECT id, name, country FROM teams WHERE id = ?').get(k.team_id);
    let outing = db.prepare('SELECT id FROM outings WHERE team_id = ? AND date = ? ORDER BY id LIMIT 1').get(team.id, k.caught_on);
    if (!outing) {
      const { lastInsertRowid } = db.prepare('INSERT INTO outings (user_id, team_id, boat, country, date) VALUES (?, ?, ?, ?, ?)')
        .run(k.logged_by, team.id, team.name, team.country || null, k.caught_on);
      outing = { id: Number(lastInsertRowid) };
    }
    const fate = k.released ? 'released' : 'kept';
    db.prepare('UPDATE outings SET no_catch = 0 WHERE id = ?').run(outing.id);
    bump(outing.id, k.species_id, fate, 1);
    db.prepare(`INSERT INTO outing_landings (outing_id, user_id, species_id, fate, landed_at, client_id, catch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(outing.id, k.logged_by, k.species_id, fate, new Date().toISOString(), `reg-${k.id}`, k.id);
  }
  // A registration withdrawn or deleted: a fish the log only had from the
  // weigh station goes with it.
  function unlogRegistration(catchId) {
    const l = db.prepare('SELECT id, outing_id, species_id, fate FROM outing_landings WHERE client_id = ?').get(`reg-${catchId}`);
    if (!l) return;
    db.prepare('DELETE FROM outing_landings WHERE id = ?').run(l.id);
    bump(l.outing_id, l.species_id, l.fate, -1);
  }
  function linkLogToRegistration(landingId) {
    const l = db.prepare(`SELECT l.id, l.species_id, l.fate, l.weight_kg, o.team_id, o.date FROM outing_landings l JOIN outings o ON o.id = l.outing_id
      WHERE l.id = ? AND l.catch_id IS NULL AND l.fate <> 'lost'`).get(landingId);
    if (!l) return;
    const k = db.prepare(`SELECT k.id FROM catches k WHERE k.team_id = ? AND k.caught_on = ? AND k.species_id = ?
      AND k.status NOT IN ('unofficial', 'rejected') AND NOT EXISTS (SELECT 1 FROM outing_landings x WHERE x.catch_id = k.id)
      ORDER BY (k.released = ?) DESC, (k.weight_kg IS NULL OR ? IS NULL), ABS(k.weight_kg - ?), k.id LIMIT 1`)
      .get(l.team_id, l.date, l.species_id, l.fate === 'released' ? 1 : 0, l.weight_kg, l.weight_kg);
    if (k) {
      db.prepare('UPDATE outing_landings SET catch_id = ? WHERE id = ?').run(k.id, l.id);
      return;
    }
    // Already in the log from the weigh station: this is that fish, now with its spot.
    const stand = db.prepare(`SELECT x.id, x.outing_id, x.species_id, x.fate, x.catch_id FROM outing_landings x JOIN outings o ON o.id = x.outing_id
      WHERE o.team_id = ? AND o.date = ? AND x.species_id = ? AND x.client_id LIKE 'reg-%' ORDER BY x.id LIMIT 1`).get(l.team_id, l.date, l.species_id);
    if (!stand) return;
    db.prepare('DELETE FROM outing_landings WHERE id = ?').run(stand.id);
    bump(stand.outing_id, stand.species_id, stand.fate, -1);
    db.prepare('UPDATE outing_landings SET catch_id = ? WHERE id = ?').run(stand.catch_id, l.id);
  }

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
    if (checked.noAngler) db.prepare('UPDATE catches SET no_angler = 1 WHERE id = ?').run(id);
    if (opts.official) {
      linkRegistrationToLog(id);
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
  const LOCATION_NEEDED = "The phone's location is needed for the weigh-in. Turn on location for this site and send again.";
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

  // The feed: it fills itself. Fish approved at the weigh-in ("Rayan Eid
  // weighed a 41 kg yellowfin tuna") and fish logged at sea ("Released a blue
  // marlin"), newest first, under the boat's name and photo. Never a spot.
  // ?type=weighins|logged|announcements, ?team=, ?user=, ?before= (older page).
  api.get('/feed', (req, res) => {
    const type = ['weighins', 'logged', 'announcements'].includes(req.query.type) ? req.query.type : 'all';
    const team = intId(req.query.team);
    const user = intId(req.query.user);
    const club = intId(req.query.club);
    const before = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(req.query.before ?? '') ? req.query.before : null;
    const parts = [];
    if (type === 'all' || type === 'weighins') {
      // One post per boat per day: all its fish approved for that day together.
      parts.push(`SELECT 'weighin' AS kind, MAX(k.id) AS id, MAX(datetime(COALESCE(k.reviewed_at, k.created_at))) AS at, t.id AS teamId,
          t.name AS boat, t.photo AS boatPhoto, NULL AS species, NULL AS weightKg, NULL AS fate, NULL AS angler, NULL AS userId,
          k.caught_on AS title, NULL AS body
        FROM catches k LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.status = 'approved' AND (:team IS NULL OR k.team_id = :team) AND (:user IS NULL OR k.user_id = :user)
          AND (:club IS NULL OR t.club_id = :club)
        GROUP BY k.team_id, k.caught_on`);
    }
    if (!['weighins', 'announcements'].includes(type)) {
      parts.push(`SELECT 'log' AS kind, l.id, datetime(l.landed_at) AS at, t.id AS teamId, t.name AS boat, t.photo AS boatPhoto,
          s.name AS species, NULL AS weightKg, l.fate, NULL AS angler, l.user_id AS userId, NULL AS title, l.photo AS body
        FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id LEFT JOIN teams t ON t.id = o.team_id
        WHERE COALESCE(l.client_id, '') NOT LIKE 'reg-%'
          -- Weighed in and approved: the fish is in its boat's weigh-in post instead (one fish, one place).
          AND NOT EXISTS (SELECT 1 FROM catches w WHERE w.id = l.catch_id AND w.status = 'approved')
          AND (:team IS NULL OR o.team_id = :team) AND (:user IS NULL OR l.user_id = :user) AND (:club IS NULL OR t.club_id = :club)`);
    }
    // Announcements belong to the whole feed, not to one boat or angler.
    if ((type === 'all' || type === 'announcements') && !team && !user && !club) {
      parts.push(`SELECT 'announcement' AS kind, a.id, datetime(a.created_at) AS at, NULL AS teamId, NULL AS boat, NULL AS boatPhoto,
          NULL AS species, NULL AS weightKg, NULL AS fate, COALESCE(NULLIF(u.nickname, ''), u.name) AS angler, a.user_id AS userId, a.title, a.body
        FROM announcements a LEFT JOIN users u ON u.id = a.user_id WHERE :team IS NULL AND :user IS NULL AND :club IS NULL`);
    }
    if (!parts.length) return res.json({ items: [], nextBefore: null });
    const rows = db.prepare(`SELECT * FROM (${parts.join(' UNION ALL ')}) WHERE (:before IS NULL OR at < :before)
      ORDER BY at DESC, id DESC LIMIT 31`).all({ team, user, club, before });
    // Each fish's pictures: the weigh station photo first, then the crew's own
    // from Log fish, and a released fish's release video. Videos of the scale
    // are for the secretary.
    const fishOfDay = db.prepare(`SELECT k.id, s.name AS species, k.weight_kg AS weightKg, k.released, k.points, k.scale_photo AS scalePhoto, k.scale_video AS scaleVideo,
        (SELECT x.photo FROM outing_landings x WHERE x.catch_id = k.id AND x.photo IS NOT NULL LIMIT 1) AS crewPhoto,
        COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users u ON u.id = k.user_id
      WHERE k.status = 'approved' AND k.team_id IS ? AND k.caught_on = ? AND (? IS NULL OR k.user_id = ?)
      ORDER BY k.weight_kg IS NULL, k.weight_kg DESC, k.id`);
    const items = rows.slice(0, 30).map(({ boatPhoto, ...x }) => {
      const item = { ...x, boatPhotoUrl: photoUrl(boatPhoto) };
      if (x.kind === 'log') {
        item.photoUrl = photoUrl(x.body);
        item.body = null;
      }
      if (x.kind === 'announcement') item.canDelete = !!req.user && (x.userId === req.user.id || isAdminUser(req.user));
      if (x.kind === 'weighin') {
        // The day's fish for that boat, heaviest first.
        item.day = x.title;
        item.title = null;
        item.fish = fishOfDay.all(x.teamId, x.title, user, user).map(({ scalePhoto, scaleVideo, crewPhoto, ...f }) => ({ ...f, released: !!f.released,
          photos: fishPhotos(scalePhoto, crewPhoto).map((x) => x.url), videoUrl: f.released ? photoUrl(scaleVideo) : null }));
        item.points = Math.round(item.fish.reduce((n, f) => n + (f.points || 0), 0) * 10) / 10;
      }
      return item;
    });
    res.json({ items, nextBefore: rows.length > 30 ? items.at(-1).at : null });
  });

  // JHMMC's officers (the secretary, president, vice president) and the admin
  // post announcements: a tournament coming up, membership to pay…
  api.post('/announcements', requireReview, (req, res) => {
    const title = str(req.body.title, 120);
    if (!title) return res.status(400).json({ error: 'Give the announcement a title.' });
    const body = str(req.body.body, 2000);
    const { lastInsertRowid } = db.prepare('INSERT INTO announcements (user_id, title, body) VALUES (?, ?, ?)')
      .run(req.user.id, title, body);
    pushToEveryone({ title: `JHMMC: ${title}`, body: body ? (body.length > 160 ? `${body.slice(0, 157)}…` : body) : '', url: '/#/?type=announcements' }, req.user);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });
  api.delete('/announcements/:id', requireReview, (req, res) => {
    const a = db.prepare('SELECT id, user_id FROM announcements WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!a) return res.status(404).json({ error: 'Announcement not found.' });
    if (a.user_id !== req.user.id && !isAdminUser(req.user)) return res.status(403).json({ error: 'Only whoever posted it can remove it.' });
    db.prepare('DELETE FROM announcements WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });

  // Only crews post: an angler has to be on a boat.
  api.post('/catches', (req, res, next) => {
    if (!openPosts) return res.status(403).json({ error: 'The feed fills itself now: add fish with Log fish.' });
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
        linkRegistrationToLog(id);
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
    // Tell whoever registered it, and (if they want it) everyone about a new weigh-in.
    const k = db.prepare(`SELECT k.logged_by, k.weight_kg, k.released, k.points, k.points_note, s.name AS species, t.name AS boat,
        COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?`).get(id);
    const fish = `${k.species}${k.weight_kg ? ` (${Math.round(k.weight_kg * 10) / 10} kg)` : k.released ? ' (released)' : ''}`;
    const approved = req.body.decision !== 'reject';
    pushWhere('myFish', {
      title: approved ? 'Fish approved' : 'Fish not counted',
      body: approved ? `Your ${fish} was approved: ${k.points} points.` : `Your ${fish} wasn't counted: ${k.points_note}`,
      url: `/#/catch/${id}`,
    }, req.user, (p) => p.id === k.logged_by);
    if (approved) {
      // One notification per boat per day, updated quietly as more of its fish are approved.
      const day = db.prepare(`SELECT COUNT(*) AS n, MAX(k.weight_kg) AS top,
          (SELECT s.name FROM catches x JOIN species s ON s.id = x.species_id WHERE x.team_id IS c.team_id AND x.caught_on = c.caught_on
            AND x.status = 'approved' ORDER BY x.weight_kg DESC LIMIT 1) AS topSpecies, c.team_id AS teamId, c.caught_on AS caughtOn
        FROM catches c JOIN catches k ON k.team_id IS c.team_id AND k.caught_on = c.caught_on AND k.status = 'approved' WHERE c.id = ?`).get(id);
      const first = day.n === 1;
      pushWhere('weighins', {
        title: `Weigh-in · ${k.boat || 'A boat'}`,
        body: first
          ? (k.weight_kg ? `${k.angler} weighed a ${Math.round(k.weight_kg * 10) / 10} kg ${k.species.toLowerCase()}.` : `${k.angler} released a ${k.species.toLowerCase()}.`)
          : `${day.n} fish weighed in${day.top ? `, heaviest a ${Math.round(day.top * 10) / 10} kg ${day.topSpecies.toLowerCase()}` : ''}.`,
        url: '/#/?type=weighins',
        tag: `weighin-${day.teamId}-${day.caughtOn}`,
        quiet: !first,
      }, req.user, (p) => p.id !== k.logged_by);
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
  // The fish that count for a points table: approved, JHMMC, this division and
  // season, and for the Tournaments trophy only those caught in a tournament the
  // boat entered.
  function pointsFilter(query) {
    const division = query.division === 'river' ? 'river' : 'ocean';
    const scope = query.scope === 'tournaments' ? 'tournaments' : 'overall';
    // Every boat weighed through JHMMC, or the JHMMC Season (JHMMC boats only;
    // tournaments are JHMMC's, so their trophy is too).
    const board = query.board === 'jhmmc' || scope === 'tournaments' ? 'jhmmc' : 'all';
    const start = setting('season_start');
    const end = setting('season_end');
    const base = `FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'approved' AND ${board === 'jhmmc' ? 'k.club_id = :home' : THROUGH_JHMMC} AND t.division = :division AND k.caught_on BETWEEN :start AND :end
      ${scope === 'tournaments' ? `AND EXISTS (SELECT 1 FROM events e JOIN tournament_entries te ON te.event_id = e.id
        WHERE e.kind = 'tournament' AND te.team_id = k.team_id AND k.caught_on BETWEEN e.date AND COALESCE(e.end_date, e.date))` : ''}`;
    // All of West Africa uses the same season dates as JHMMC.
    return { division, scope, board, start, end, base, params: { division, start, end, ...(board === 'jhmmc' ? { home: homeClubId() } : {}) } };
  }
  // Behind a number on the points tables: one boat's or one angler's fish.
  api.get('/points/fish', (req, res) => {
    const { division, scope, board, base, params } = pointsFilter(req.query);
    const team = intId(req.query.team);
    const angler = str(req.query.angler, 90);
    if (!team && !angler) return res.status(400).json({ error: 'Choose a boat or an angler.' });
    const who = team ? 'AND k.team_id = :team' : "AND COALESCE('u' || k.user_id, 'n' || lower(k.angler_name)) = :angler";
    const rows = db.prepare(`${CATCH_SELECT} ${base.replace(/^FROM catches k JOIN teams t ON t.id = k.team_id\s+WHERE/, 'WHERE')} ${who}
      ORDER BY k.caught_on DESC, k.id DESC`).all({ ...params, ...(team ? { team } : { angler }), viewer: req.user?.id ?? 0 });
    const fish = rows.map((r) => present(r, req.user));
    res.json({
      division, scope, board, fish,
      total: Math.round(fish.reduce((n, f) => n + (f.points || 0), 0) * 10) / 10,
      title: team ? fish[0]?.teamName ?? db.prepare('SELECT name FROM teams WHERE id = ?').get(team)?.name : fish[0]?.angler ?? angler.slice(1),
    });
  });

  api.get('/points', (req, res) => {
    const { division, scope, board, start, end, base, params } = pointsFilter(req.query);
    const boats = db.prepare(`
      SELECT t.id AS teamId, t.name AS teamName, COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
      ${base} GROUP BY t.id ORDER BY points DESC, catches DESC
    `).all(params);
    const anglers = db.prepare(`
      SELECT u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.name AS teamName, MIN(k.id) AS first,
        COALESCE('u' || u.id, 'n' || lower(k.angler_name)) AS anglerKey, COUNT(*) AS catches, ROUND(SUM(k.points), 1) AS points
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
        `).get(e.id, homeClubId(), division, e.date, e.endDate) ?? null,
      }));
    const pending = db.prepare(`SELECT COUNT(*) AS n FROM catches k JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'pending_review' AND t.division = ?`).get(division).n;
    res.json({ division, scope, board, season: { start, end }, boats, anglers, tournaments, pending });
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

  // ---- more photos on a post, and editing posts --------------------------

  const extraPhotos = db.prepare('SELECT id, file FROM post_photos WHERE kind = ? AND post_id = ? ORDER BY id');
  // A post's photos, the first one (its own photo column) as "cover".
  const postPhotos = (kind, id, cover) => [
    ...(cover ? [{ id: 'cover', url: photoUrl(cover) }] : []),
    ...extraPhotos.all(kind, id).map((x) => ({ id: x.id, url: photoUrl(x.file) })),
  ];
  function dropPostPhotos(kind, id) {
    for (const x of extraPhotos.all(kind, id)) removeUpload(x.file);
    db.prepare('DELETE FROM post_photos WHERE kind = ? AND post_id = ?').run(kind, id);
  }
  const MAX_PHOTOS = 10;
  const editUpload = mediaUploads(MAX_PHOTOS + 1).fields([{ name: 'photos', maxCount: MAX_PHOTOS }, { name: 'video', maxCount: 1 }]);
  // New photos, removed photos ("removePhotos": ids, "cover" for the first) and a
  // new or removed video ("removeVideo"), applied to a post whose photo and video
  // live in `table`. Returns an error, or null once done.
  function editMedia(req, kind, table, row) {
    const added = req.files?.photos ?? [];
    const video = req.files?.video?.[0];
    let remove = [];
    try {
      remove = JSON.parse(req.body.removePhotos || '[]');
    } catch {
      return 'The photos to remove could not be read.';
    }
    const extras = extraPhotos.all(kind, row.id);
    const gone = extras.filter((x) => remove.includes(x.id));
    const kept = extras.length - gone.length + (row.photo && !remove.includes('cover') ? 1 : 0);
    if (kept + added.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} photos on a post.`;
    let cover = row.photo;
    if (cover && remove.includes('cover')) {
      removeUpload(cover);
      cover = null;
    }
    for (const x of gone) {
      removeUpload(x.file);
      db.prepare('DELETE FROM post_photos WHERE id = ?').run(x.id);
    }
    const addExtra = db.prepare('INSERT INTO post_photos (kind, post_id, file) VALUES (?, ?, ?)');
    for (const f of added) {
      if (!cover) cover = f.filename;
      else addExtra.run(kind, row.id, f.filename);
    }
    // No cover left: the next photo moves up.
    if (!cover) {
      const next = extraPhotos.get(kind, row.id);
      if (next) {
        cover = next.file;
        db.prepare('DELETE FROM post_photos WHERE id = ?').run(next.id);
      }
    }
    let newVideo = row.video;
    if (video || bool(req.body.removeVideo)) {
      removeUpload(row.video);
      newVideo = video?.filename ?? null;
    }
    db.prepare(`UPDATE ${table} SET photo = ?, video = ? WHERE id = ?`).run(cover, newVideo, row.id);
    return null;
  }

  // Edit a West Africa post: add the weight, more photos, the spot... once back
  // on land. JHMMC registrations can't be edited (they're withdrawn instead).
  api.patch('/catches/:id', editUpload, (req, res) => {
    const id = intId(req.params.id);
    const item = id && getCatch(id, req.user);
    if (!item) {
      discardUploads(req);
      return res.status(404).json({ error: 'Catch not found.' });
    }
    if (!item.canEdit) {
      discardUploads(req);
      return res.status(403).json({ error: item.status !== 'unofficial'
        ? "A JHMMC registration can't be edited; ask the secretary."
        : 'Only the angler, whoever logged it, or the boat captain can edit this catch.' });
    }
    const b = req.body;
    const has = (k) => k in b;
    // The stored spot, whether or not this person may see it.
    const row = db.prepare('SELECT id, photo, video, lat, lng FROM catches WHERE id = ?').get(id);
    // Checked like a new post, from what's sent and what the post already has.
    const merged = {
      speciesId: has('speciesId') ? b.speciesId : item.speciesId,
      anglerId: 'other', anglerName: item.angler, // the angler isn't changed here
      weightKg: has('weightKg') ? b.weightKg : item.weightKg ?? '',
      lengthCm: has('lengthCm') ? b.lengthCm : item.lengthCm ?? '',
      caughtOn: has('caughtOn') ? b.caughtOn : item.caughtOn,
      lineClass: has('lineClass') ? b.lineClass : item.lineClass ?? '',
      country: has('country') ? b.country : item.country ?? '',
      location: has('location') ? b.location : item.location ?? '',
      notes: has('notes') ? b.notes : item.notes ?? '',
      released: has('released') ? b.released : item.released ? 'on' : '',
      tagged: has('tagged') ? b.tagged : item.tagged ? 'on' : '',
      spotPublic: has('spotPublic') ? b.spotPublic : item.spotPublic ? 'on' : '',
      lat: has('lat') ? b.lat : row.lat ?? '',
      lng: has('lng') ? b.lng : row.lng ?? '',
    };
    const checked = checkCatch(req.user, merged, {}, { teamId: item.teamId, official: false });
    if (checked.error) {
      discardUploads(req);
      return res.status(400).json({ error: checked.error });
    }
    const v = checked.values;
    db.exec('BEGIN');
    try {
      const mediaError = editMedia(req, 'catch', 'catches', row);
      if (mediaError) throw Object.assign(new Error(mediaError), { status: 400 });
      db.prepare(`UPDATE catches SET species_id = ?, weight_kg = ?, length_cm = ?, released = ?, tagged = ?, caught_on = ?,
        country = ?, location = ?, line_class = ?, notes = ?, lat = ?, lng = ?, spot_public = ? WHERE id = ?`)
        .run(v[5], v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13], v[14], v[21], v[22], v[23], id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      discardUploads(req);
      if (err.status === 400) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json({ catch: getCatch(id, req.user) });
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
      unlogRegistration(id);
    }
    db.prepare('DELETE FROM catches WHERE id = ?').run(id);
    // A registration's scale photo and video stay as evidence in the record.
    removeUpload(item.photo);
    dropPostPhotos('catch', id);
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

  // ---- the regional log: one line per outing ---------------------------------

  const TECHNIQUES = ['Trolling', 'Bottom fishing', 'Jigging', 'Casting'];
  const outingFish = db.prepare(`SELECT f.species_id AS speciesId, s.name AS species, s.category, f.released, f.kept, f.lost
    FROM outing_fish f JOIN species s ON s.id = f.species_id WHERE f.outing_id = ? ORDER BY f.id`);
  const ALONE = `NOT EXISTS (SELECT 1 FROM outing_landings y WHERE y.outing_id = l.outing_id AND y.species_id = l.species_id AND y.fate = l.fate AND y.id <> l.id)`;
  // The day's scale weights for each species, heaviest first.
  const weighedOf = db.prepare(`SELECT k.weight_kg AS kg FROM outing_landings l JOIN catches k ON k.id = l.catch_id
    WHERE l.outing_id = ? AND l.species_id = ? AND k.status <> 'rejected' AND k.weight_kg IS NOT NULL ORDER BY k.weight_kg DESC`);
  const fishOfOuting = (id) => outingFish.all(id).map((f) => ({ ...f, weighedKg: weighedOf.all(id, f.speciesId).map((x) => x.kg) }));
  const OUTING_SELECT = `SELECT o.id, o.user_id AS userId, o.team_id AS teamId, COALESCE(t.name, o.boat) AS boat, o.country, o.date,
      o.no_catch AS noCatch, o.technique, o.area, o.depth_m AS depthM, o.water_c AS waterC, o.created_at AS createdAt,
      COALESCE(NULLIF(u.nickname, ''), u.name) AS loggedBy
    FROM outings o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN teams t ON t.id = o.team_id`;
  // Each fish logged at sea, for everyone: no spots here.
  // scaleKg: the weight on the weigh-station scale, once the same fish is registered (not if rejected),
  // only when it was the boat's only fish of that species that day (kept, or released): with ten
  // tunas nobody knows which weight was which, so the weights go on the species for the day instead.
  const SCALE = `(SELECT k.weight_kg FROM catches k WHERE k.id = l.catch_id AND k.status <> 'rejected' AND ${ALONE}) AS scaleKg,
      (l.catch_id IS NOT NULL AND NOT ${ALONE}) AS scaleShared,
      (SELECT k.status FROM catches k WHERE k.id = l.catch_id AND k.status <> 'rejected') AS scaleStatus`;
  const fishLanded = db.prepare(`SELECT l.id, s.name AS species, COALESCE(l.client_id LIKE 'reg-%', 0) AS fromScale, l.fate, l.weight_kg AS weightKg, l.landed_at AS landedAt, ${SCALE}
    FROM outing_landings l JOIN species s ON s.id = l.species_id WHERE l.outing_id = ? ORDER BY l.id`);
  const presentOuting = (o, viewer) => ({
    ...o, noCatch: !!o.noCatch, technique: o.technique ? o.technique.split('|') : [],
    fish: fishOfOuting(o.id), landings: fishLanded.all(o.id).map((x) => ({ ...x, scaleShared: !!x.scaleShared })),
    canDelete: !!viewer && (o.userId === viewer.id || isAdminUser(viewer)),
  });
  // The outing as one line, in the agreed format.
  const outingLine = (o) => [
    o.date, o.boat, o.country || '',
    o.noCatch ? 'No catch' : o.fish.map((f) => {
      const parts = [['released', f.released], ['kept', f.kept], ['lost', f.lost]].filter(([, n]) => n).map(([w, n]) => `${n} ${w}`);
      return `${f.species}: ${f.released + f.kept + f.lost} (${parts.join(', ')})`;
    }).join('; '),
    o.technique.join(', '), [o.area, o.depthM != null ? `${o.depthM} m` : ''].filter(Boolean).join(', '),
    o.waterC != null ? `${o.waterC}°C` : '',
  ].join(' | ');

  // Depth and water temperature: optional, but sensible when given.
  function outingDetails(b) {
    const number = (v, lo, hi) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN;
    };
    const depth = number(b.depthM, 0, 11000);
    const water = number(b.waterC, 10, 40);
    if (Number.isNaN(depth)) return { error: 'Depth must be in metres.' };
    if (Number.isNaN(water)) return { error: 'Water temperature must be in °C (10 to 40).' };
    return { depth, water, techniques: (Array.isArray(b.technique) ? b.technique : []).filter((t) => TECHNIQUES.includes(t)) };
  }

  api.post('/outings', (req, res) => {
    const b = req.body;
    const u = req.user;
    // Boats have to be on the app: yours unless another is chosen.
    const team = db.prepare('SELECT id, name, country FROM teams WHERE id = ?').get(intId(b.teamId) || u.teamId || 0);
    if (!team) return res.status(400).json({ error: 'Choose the boat (boats have to be on the app).' });
    const boat = team.name;
    const date = str(b.date, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return res.status(400).json({ error: 'Enter the date.' });
    if (Date.parse(date) > Date.now() + 864e5) return res.status(400).json({ error: "The date can't be in the future." });
    const country = str(b.country, 60) || team.country || null;
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    const details = outingDetails(b);
    if (details.error) return res.status(400).json({ error: details.error });
    const { depth, water, techniques } = details;
    const noCatch = bool(b.noCatch);
    const fish = [];
    if (!noCatch) {
      for (const f of Array.isArray(b.fish) ? b.fish : []) {
        const speciesId = intId(f?.speciesId);
        const counts = ['released', 'kept', 'lost'].map((k) => Math.max(0, Math.min(500, Math.floor(Number(f?.[k]) || 0))));
        if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) return res.status(400).json({ error: 'Choose each species.' });
        if (!counts.some((n) => n > 0)) return res.status(400).json({ error: 'Give at least one released, kept or lost for each species.' });
        fish.push([speciesId, ...counts]);
      }
      if (!fish.length) return res.status(400).json({ error: 'Add the fish, or choose No catch.' });
    }
    // One line per boat per day: fish logged at sea already started it.
    if (db.prepare('SELECT 1 FROM outings WHERE team_id = ? AND date = ?').get(team.id, date)) {
      return res.status(409).json({ error: `${boat} already has a line for that day in the log. Open it from the log to add to it.` });
    }
    db.exec('BEGIN');
    const { lastInsertRowid } = db.prepare(`INSERT INTO outings (user_id, team_id, boat, country, date, no_catch, technique, area, depth_m, water_c)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u.id, team.id, boat, country, date, noCatch ? 1 : 0,
      techniques.join('|') || null, str(b.area, 80), depth, water);
    const id = Number(lastInsertRowid);
    const addFish = db.prepare('INSERT INTO outing_fish (outing_id, species_id, released, kept, lost) VALUES (?, ?, ?, ?, ?)');
    for (const f of fish) addFish.run(id, ...f);
    db.exec('COMMIT');
    const o = presentOuting(db.prepare(`${OUTING_SELECT} WHERE o.id = ?`).get(id), u);
    res.status(201).json({ outing: { ...o, line: outingLine(o) } });
  });

  // Everyone's outings, newest first; ?country= to narrow, ?before=id to page.
  // Open to anyone, like the rest of the app (rough areas only).
  api.get('/outings', (req, res) => {
    const country = str(req.query.country, 60);
    const before = intId(req.query.before);
    // ?team=: one boat's own log (My boat). ?month=YYYY-MM and ?species= narrow it.
    const team = intId(req.query.team);
    const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month : null;
    const species = intId(req.query.species);
    // Newest first, 30 at a time: ?before= the last trip's date and id ("2026-10-20:12").
    const [beforeDate, beforeId] = /^\d{4}-\d{2}-\d{2}:\d+$/.test(req.query.before ?? '') ? req.query.before.split(':') : [null, null];
    const rows = db.prepare(`${OUTING_SELECT}
      WHERE (:country IS NULL OR o.country = :country) AND (:team IS NULL OR o.team_id = :team)
        AND (:month IS NULL OR substr(o.date, 1, 7) = :month)
        AND (:species IS NULL OR EXISTS (SELECT 1 FROM outing_fish f WHERE f.outing_id = o.id AND f.species_id = :species))
        AND (:bd IS NULL OR o.date < :bd OR (o.date = :bd AND o.id < :bi))
      ORDER BY o.date DESC, o.id DESC LIMIT 31`).all({ country, team, month, species, bd: beforeDate, bi: Number(beforeId) || 0 });
    const list = rows.slice(0, 30).map((o) => presentOuting(o, req.user)).map((o) => ({ ...o, line: outingLine(o) }));
    const countries = db.prepare('SELECT DISTINCT country FROM outings WHERE country IS NOT NULL ORDER BY country').all().map((r) => r.country);
    // What the filters can offer.
    const months = db.prepare('SELECT DISTINCT substr(date, 1, 7) AS m FROM outings WHERE (:team IS NULL OR team_id = :team) ORDER BY m DESC').all({ team }).map((r) => r.m);
    const speciesHere = db.prepare(`SELECT DISTINCT s.id, s.name FROM outing_fish f JOIN outings o ON o.id = f.outing_id JOIN species s ON s.id = f.species_id
      WHERE (:team IS NULL OR o.team_id = :team) ORDER BY s.name`).all({ team });
    const boats = team ? [] : db.prepare('SELECT DISTINCT t.id, t.name FROM outings o JOIN teams t ON t.id = o.team_id ORDER BY t.name COLLATE NOCASE').all();
    const last = rows.length > 30 ? list.at(-1) : null;
    res.json({ outings: list, countries, months, species: speciesHere, boats, techniques: TECHNIQUES, nextBefore: last ? `${last.date}:${last.id}` : null });
  });

  // The whole log as a spreadsheet (one line per outing), for keeping or merging.
  api.get('/outings.csv', (req, res) => {
    const team = intId(req.query.team);
    const all = db.prepare(`${OUTING_SELECT} WHERE (:team IS NULL OR o.team_id = :team) ORDER BY o.date, o.id`).all({ team }).map((o) => presentOuting(o, req.user));
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Date', 'Boat', 'Country', 'Catch', 'Technique', 'Rough area', 'Water depth (m)', 'Water temp (°C)'];
    const rows = all.map((o) => [o.date, o.boat, o.country,
      o.noCatch ? 'No catch' : outingLine(o).split(' | ')[3], o.technique.join(', '), o.area, o.depthM, o.waterC].map(cell).join(','));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="regional-log.csv"' });
    res.send('\ufeff' + [head.map(cell).join(','), ...rows].join('\r\n'));
  });

  // ---- "Fish on": each fish logged as it's landed, spot taken there and then.
  // The fish join that boat's line for the day, created on the first one.
  const FATES = ['released', 'kept', 'lost'];
  const landingsOf = (outingId) => db.prepare(`SELECT l.id, l.user_id AS userId, l.species_id AS speciesId, l.catch_id AS catchId, l.photo, COALESCE(l.client_id LIKE 'reg-%', 0) AS fromScale, s.name AS species, l.fate, l.weight_kg AS weightKg, ${SCALE}, l.lat, l.lng, l.landed_at AS landedAt,
      COALESCE(NULLIF(u.nickname, ''), u.name) AS loggedBy
    FROM outing_landings l JOIN species s ON s.id = l.species_id LEFT JOIN users u ON u.id = l.user_id
    WHERE l.outing_id = ? ORDER BY l.id`).all(outingId);
  const tripFor = (outingId, viewer) => {
    const o = db.prepare(`${OUTING_SELECT} WHERE o.id = ?`).get(outingId);
    if (!o) return null;
    const out = presentOuting(o, viewer);
    return { ...out, line: outingLine(out), landings: landingsOf(outingId).map(({ photo, ...l }) => ({ ...l, scaleShared: !!l.scaleShared, photoUrl: photoUrl(photo) })) };
  };
  // The crew of the boat (and whoever logged the line, and the admin) work on the trip.
  const onTrip = (user, o) => isAdminUser(user) || o.user_id === user.id || (o.team_id != null && o.team_id === user.teamId);
  const bump = (outingId, speciesId, fate, by) => {
    const row = db.prepare('SELECT id FROM outing_fish WHERE outing_id = ? AND species_id = ?').get(outingId, speciesId);
    if (row) db.prepare(`UPDATE outing_fish SET ${fate} = MAX(0, ${fate} + ?) WHERE id = ?`).run(by, row.id);
    else if (by > 0) db.prepare(`INSERT INTO outing_fish (outing_id, species_id, ${fate}) VALUES (?, ?, 1)`).run(outingId, speciesId);
    db.prepare('DELETE FROM outing_fish WHERE outing_id = ? AND released + kept + lost = 0').run(outingId);
  };

  // An estimated weight: optional, in kilograms; NaN if it makes no sense.
  const estimate = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 1500 ? Math.round(n * 10) / 10 : NaN;
  };

  api.post('/outings/fish', auth.requireUser, (req, res) => {
    const b = req.body;
    const u = req.user;
    const clientId = str(b.clientId, 64);
    // Sent again after a lost connection: already in.
    const again = clientId && db.prepare('SELECT outing_id FROM outing_landings WHERE client_id = ?').get(clientId);
    if (again) return res.json({ trip: tripFor(again.outing_id, u) });
    const team = db.prepare('SELECT id, name, country FROM teams WHERE id = ?').get(u.teamId || 0);
    if (!team) return res.status(400).json({ error: 'Join or register your boat to log fish.' });
    const speciesId = intId(b.speciesId);
    if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) return res.status(400).json({ error: 'Choose the species.' });
    if (!FATES.includes(b.fate)) return res.status(400).json({ error: 'Released, kept or lost?' });
    const spot = readSpot(b);
    if (spot.error) return res.status(400).json({ error: spot.error });
    const weightKg = estimate(b.weightKg);
    if (Number.isNaN(weightKg)) return res.status(400).json({ error: 'The estimated weight must be in kilograms.' });
    // When it was landed, by the phone's clock (it may arrive hours later, once there's signal).
    const at = Date.parse(b.landedAt);
    if (b.landedAt && (Number.isNaN(at) || at > Date.now() + 864e5)) return res.status(400).json({ error: "The time it was landed isn't valid." });
    const landedAt = b.landedAt ? new Date(at).toISOString() : new Date().toISOString();
    // The day is the phone's own day, so a fish at 23:30 doesn't land on tomorrow's line.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') ? b.date : landedAt.slice(0, 10);
    if (Date.parse(date) > Date.now() + 864e5) return res.status(400).json({ error: "The day can't be in the future." });
    db.exec('BEGIN');
    try {
      let outing = db.prepare('SELECT id FROM outings WHERE team_id = ? AND date = ? ORDER BY id LIMIT 1').get(team.id, date);
      if (!outing) {
        const { lastInsertRowid } = db.prepare('INSERT INTO outings (user_id, team_id, boat, country, date) VALUES (?, ?, ?, ?, ?)')
          .run(u.id, team.id, team.name, team.country || null, date);
        outing = { id: Number(lastInsertRowid) };
      }
      db.prepare('UPDATE outings SET no_catch = 0 WHERE id = ?').run(outing.id);
      bump(outing.id, speciesId, b.fate, 1);
      db.prepare(`INSERT INTO outing_landings (outing_id, user_id, species_id, fate, weight_kg, lat, lng, landed_at, client_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(outing.id, u.id, speciesId, b.fate, weightKg, spot.lat, spot.lng, landedAt, clientId || null);
      linkLogToRegistration(Number(db.prepare('SELECT last_insert_rowid() AS id').get().id));
      db.exec('COMMIT');
      // Fish on! For those who asked: boat, species and what happened, never the spot.
      // Only for today's fish, not ones added afterwards for an earlier trip.
      if (date === new Date().toISOString().slice(0, 10)) {
        const sp = db.prepare('SELECT name FROM species WHERE id = ?').get(speciesId).name.toLowerCase();
        const article = /^[aeiou]/.test(sp) ? 'an' : 'a';
        pushWhere('logged', {
          title: 'Fish on',
          body: `${team.name} ${{ released: 'released', kept: 'boated', lost: 'lost' }[b.fate]} ${article} ${sp}.`,
          url: '/#/',
        }, u, (p) => p.id !== u.id);
      }
      res.status(201).json({ trip: tripFor(outing.id, u) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  // Your boat's trip for a day (the phone's today by default), with each fish and its spot.
  api.get('/outings/trip', auth.requireUser, (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date : new Date().toISOString().slice(0, 10);
    const o = req.user.teamId && db.prepare('SELECT id FROM outings WHERE team_id = ? AND date = ? ORDER BY id LIMIT 1').get(req.user.teamId, date);
    res.json({ trip: o ? tripFor(o.id, req.user) : null });
  });

  // A released fish's estimated weight (it never sees a scale), given whenever there's a moment.
  api.patch('/outings/fish/:id', auth.requireUser, (req, res) => {
    const l = db.prepare(`SELECT l.id, l.outing_id, l.fate, o.user_id, o.team_id
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id WHERE l.id = ?`).get(intId(req.params.id) ?? 0);
    if (!l) return res.status(404).json({ error: 'Fish not found.' });
    if (!onTrip(req.user, l)) return res.status(403).json({ error: "Only the boat's crew can change its trip." });
    // A wrong tap: change the species or the result, keeping the fish's time and spot.
    if ('speciesId' in req.body || 'fate' in req.body) {
      const cur = db.prepare('SELECT species_id, fate, catch_id, client_id FROM outing_landings WHERE id = ?').get(l.id);
      if (cur.client_id?.startsWith('reg-')) return res.status(400).json({ error: 'This fish comes from the weigh-in; ask the secretary to change it.' });
      const speciesId = 'speciesId' in req.body ? intId(req.body.speciesId) : cur.species_id;
      if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) return res.status(400).json({ error: 'Choose the species.' });
      const fate = 'fate' in req.body ? req.body.fate : cur.fate;
      if (!FATES.includes(fate)) return res.status(400).json({ error: 'Kept, released or lost?' });
      db.exec('BEGIN');
      bump(l.outing_id, cur.species_id, cur.fate, -1);
      bump(l.outing_id, speciesId, fate, 1);
      // A different fish now: let go of a weigh-in it no longer matches, and look for one it does.
      const keep = cur.catch_id && speciesId === cur.species_id && fate !== 'lost';
      db.prepare(`UPDATE outing_landings SET species_id = ?, fate = ?, catch_id = ?, weight_kg = CASE WHEN ? = 'released' THEN weight_kg END WHERE id = ?`)
        .run(speciesId, fate, keep ? cur.catch_id : null, fate, l.id);
      db.exec('COMMIT');
      if (!keep) linkLogToRegistration(l.id);
      return res.json({ trip: tripFor(l.outing_id, req.user) });
    }
    if (l.fate !== 'released') return res.status(400).json({ error: 'Kept fish get their weight on the scale.' });
    const weightKg = estimate(req.body.weightKg);
    if (Number.isNaN(weightKg)) return res.status(400).json({ error: 'The estimated weight must be in kilograms.' });
    db.prepare('UPDATE outing_landings SET weight_kg = ? WHERE id = ?').run(weightKg, l.id);
    res.json({ trip: tripFor(l.outing_id, req.user) });
  });

  // A photo of a logged fish, whenever the crew has a moment; it shows on the feed.
  api.post('/outings/fish/:id/photo', auth.requireUser, upload.single('photo'), (req, res) => {
    const l = db.prepare(`SELECT l.id, l.outing_id, o.user_id, o.team_id
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id WHERE l.id = ?`).get(intId(req.params.id) ?? 0);
    if (!l || !onTrip(req.user, l)) {
      removeUpload(req.file?.filename);
      return res.status(l ? 403 : 404).json({ error: l ? "Only the boat's crew can add its photos." : 'Fish not found.' });
    }
    if (savePhoto(req, res, 'outing_landings', l.id)) res.json({ trip: tripFor(l.outing_id, req.user) });
  });

  // Logged by mistake: take the fish back off the line.
  api.delete('/outings/fish/:id', auth.requireUser, (req, res) => {
    const l = db.prepare(`SELECT l.id, l.outing_id, l.species_id, l.fate, o.user_id, o.team_id
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id WHERE l.id = ?`).get(intId(req.params.id) ?? 0);
    if (!l) return res.status(404).json({ error: 'Fish not found.' });
    if (!onTrip(req.user, l)) return res.status(403).json({ error: "Only the boat's crew can change its trip." });
    const photo = db.prepare('SELECT photo FROM outing_landings WHERE id = ?').get(l.id).photo;
    db.exec('BEGIN');
    db.prepare('DELETE FROM outing_landings WHERE id = ?').run(l.id);
    bump(l.outing_id, l.species_id, l.fate, -1);
    db.exec('COMMIT');
    removeUpload(photo);
    res.json({ trip: tripFor(l.outing_id, req.user) });
  });

  // Finish the trip: technique, rough area, depth and water temperature.
  api.patch('/outings/:id', auth.requireUser, (req, res) => {
    const o = db.prepare('SELECT id, user_id, team_id, country FROM outings WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!o) return res.status(404).json({ error: 'Outing not found.' });
    if (!onTrip(req.user, o)) return res.status(403).json({ error: "Only the boat's crew can change its trip." });
    const b = req.body;
    const details = outingDetails(b);
    if (details.error) return res.status(400).json({ error: details.error });
    const country = 'country' in b ? str(b.country, 60) : o.country;
    if (country && !COUNTRIES.includes(country)) return res.status(400).json({ error: 'Unknown country.' });
    db.prepare('UPDATE outings SET technique = ?, area = ?, depth_m = ?, water_c = ?, country = ? WHERE id = ?')
      .run(details.techniques.join('|') || null, str(b.area, 80), details.depth, details.water, country, o.id);
    res.json({ trip: tripFor(o.id, req.user) });
  });

  // One row per fish, for working on trends in a spreadsheet. A boat's own crew
  // (and the admin) also get each fish's GPS spot; nobody else ever does.
  api.get('/outings/fish.csv', (req, res) => {
    const team = intId(req.query.team);
    const withSpots = !!team && !!req.user && (req.user.teamId === team || isAdminUser(req.user));
    const rows = db.prepare(`SELECT o.date, l.landed_at AS at, l.lat, l.lng, COALESCE(t.name, o.boat) AS boat, o.country, s.name AS species, l.fate,
        (SELECT k.weight_kg FROM catches k WHERE k.id = l.catch_id AND k.status <> 'rejected' AND ${ALONE}) AS scaleKg, l.weight_kg AS estimateKg,
        o.area, o.depth_m AS depthM, o.water_c AS waterC, o.technique, COALESCE(l.client_id, '') LIKE 'reg-%' AS fromScale
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id LEFT JOIN teams t ON t.id = o.team_id
      WHERE (:team IS NULL OR o.team_id = :team) ORDER BY o.date, l.id`).all({ team });
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Date', 'Time (local)', 'Boat', 'Country', 'Species', 'Result', 'Scale weight (kg)', 'Estimated weight (kg)',
      'Rough area', 'Water depth (m)', 'Water temp (°C)', 'Technique', ...(withSpots ? ['Latitude', 'Longitude'] : [])];
    const lines = rows.map((r) => {
      const time = r.lat != null && !r.fromScale ? `${String(localHour(r.at, r.country)).padStart(2, '0')}:${r.at.slice(14, 16)}` : '';
      return [r.date, time, r.boat, r.country, r.species, { kept: 'Boated', released: 'Released', lost: 'Lost' }[r.fate], r.scaleKg, r.estimateKg,
        r.area, r.depthM, r.waterC, (r.technique || '').split('|').join(', '), ...(withSpots ? [r.lat, r.lng] : [])].map(cell).join(',');
    });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${team ? 'boat' : 'regional'}-fish.csv"` });
    res.send('\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n'));
  });

  api.delete('/outings/:id', (req, res) => {
    const o = db.prepare('SELECT id, user_id AS userId FROM outings WHERE id = ?').get(intId(req.params.id) ?? 0);
    if (!o) return res.status(404).json({ error: 'Outing not found.' });
    if (o.userId !== req.user.id && !isAdminUser(req.user)) return res.status(403).json({ error: 'Only whoever logged it can remove an outing.' });
    db.prepare('DELETE FROM outings WHERE id = ?').run(o.id);
    res.json({ ok: true });
  });

  // A year at a glance: outings, blank days, billfish per day fished, a chosen
  // species per day fished each month, and the conditions on billfish days.
  // Local time for the time-of-day charts: GMT for most of the coast, an hour
  // ahead from Benin and Niger down to Gabon, an hour behind on Cabo Verde.
  const UTC_OFFSET = { Benin: 1, Cameroon: 1, 'Equatorial Guinea': 1, Gabon: 1, Niger: 1, Nigeria: 1, 'Cabo Verde': -1 };
  const localHour = (iso, country) => (new Date(iso).getUTCHours() + (UTC_OFFSET[country] ?? 0) + 24) % 24;

  api.get('/outings/season', (req, res) => {
    const team = intId(req.query.team);
    const years = db.prepare("SELECT DISTINCT substr(date, 1, 4) AS y FROM outings WHERE (:team IS NULL OR team_id = :team) ORDER BY y DESC")
      .all({ team }).map((r) => r.y);
    const year = years.includes(req.query.year) ? req.query.year : years[0] ?? String(new Date().getUTCFullYear());
    const country = str(req.query.country, 60);
    const outings = db.prepare(`${OUTING_SELECT} WHERE substr(o.date, 1, 4) = :year AND (:country IS NULL OR o.country = :country)
        AND (:team IS NULL OR o.team_id = :team)`)
      .all({ year, country, team }).map((o) => presentOuting(o, req.user));
    const caught = (o, pick) => o.fish.filter(pick).reduce((n, f) => n + f.released + f.kept, 0);
    const billfish = (f) => f.category === 'Billfish';
    const speciesList = [...new Set(outings.flatMap((o) => o.fish.map((f) => f.species)))].sort();
    const species = speciesList.includes(req.query.species) ? req.query.species : speciesList.includes('Sailfish') ? 'Sailfish' : speciesList[0] ?? null;
    const months = Array.from({ length: 12 }, (_, m) => {
      const inMonth = outings.filter((o) => Number(o.date.slice(5, 7)) === m + 1);
      const n = caught({ fish: inMonth.flatMap((o) => o.fish) }, (f) => f.species === species);
      return { month: m + 1, outings: inMonth.length, count: n, perDay: inMonth.length ? n / inMonth.length : null };
    });
    // Counts only: lost fish and blank days are often not logged, so rates per
    // trip would flatter the season. What was caught stays true.
    const add = (map, key, n) => { if (key && n) map[key] = (map[key] || 0) + n; };
    const bySpecies = {};
    for (const o of outings) for (const f of o.fish) {
      const row = (bySpecies[f.species] ||= { species: f.species, kept: 0, released: 0, lost: 0, heaviestKg: null });
      row.kept += f.kept; row.released += f.released; row.lost += f.lost;
    }
    // The heaviest of each, from the weigh-in scales (approved fish).
    const heaviest = db.prepare(`SELECT s.name AS species, MAX(k.weight_kg) AS kg FROM catches k JOIN species s ON s.id = k.species_id
      WHERE k.status = 'approved' AND substr(k.caught_on, 1, 4) = :year AND (:team IS NULL OR k.team_id = :team) GROUP BY s.name`).all({ year, team });
    for (const h of heaviest) if (bySpecies[h.species]) bySpecies[h.species].heaviestKg = h.kg;
    // When: the hour each fish was logged at sea (GMT), fish caught only.
    const hours = Array(24).fill(0);
    const ids = outings.map((o) => o.id);
    if (ids.length) {
      for (const r of db.prepare(`SELECT l.landed_at AS at, o.country FROM outing_landings l JOIN outings o ON o.id = l.outing_id
        WHERE l.outing_id IN (${ids.map(() => '?').join(',')}) AND l.lat IS NOT NULL AND l.fate <> 'lost'`).all(...ids)) hours[localHour(r.at, r.country)] += 1;
    }
    const areas = {};
    const techniques = {};
    for (const o of outings) {
      const n = caught(o, () => true);
      add(areas, o.area?.trim(), n);
      for (const t of o.technique) add(techniques, t, n);
    }
    const top = (map) => Object.entries(map).sort((a, b2) => b2[1] - a[1]).slice(0, 6).map(([name, fish]) => ({ name, fish }));
    const report = {
      boated: outings.reduce((n, o) => n + o.fish.reduce((m, f) => m + f.kept, 0), 0),
      released: outings.reduce((n, o) => n + o.fish.reduce((m, f) => m + f.released, 0), 0),
      lost: outings.reduce((n, o) => n + o.fish.reduce((m, f) => m + f.lost, 0), 0),
      daysWithFish: outings.filter((o) => caught(o, () => true) > 0).length,
      species: Object.values(bySpecies).sort((a, b2) => (b2.kept + b2.released) - (a.kept + a.released)),
      hours, areas: top(areas), techniques: top(techniques),
    };
    const range = (vals) => (vals.length ? [Math.min(...vals), Math.max(...vals)] : null);
    const good = outings.filter((o) => caught(o, billfish) > 0);
    const techniqueCount = {};
    for (const o of good) for (const t of o.technique) techniqueCount[t] = (techniqueCount[t] || 0) + 1;
    res.json({
      years: years.length ? years : [year], year, species, speciesList,
      outings: outings.length, blank: outings.filter((o) => o.noCatch || !caught(o, () => true)).length,
      billfishPerDay: outings.length ? outings.reduce((n, o) => n + caught(o, billfish), 0) / outings.length : 0,
      months, report,
      best: good.length ? {
        days: good.length,
        water: range(good.map((o) => o.waterC).filter((v) => v != null)),
        depth: range(good.map((o) => o.depthM).filter((v) => v != null)),
        techniques: Object.entries(techniqueCount).sort((a, b2) => b2[1] - a[1]).slice(0, 2).map(([t]) => t),
      } : null,
    });
  });

  // Trends: the same species month by month, year against year; what's biting
  // now (the last 14 days against the 14 before); water temperature and
  // billfish week by week. Counts of fish caught, with the number of boats
  // that logged fish, so more boats on the app isn't mistaken for more fish.
  api.get('/outings/trends', (req, res) => {
    const team = intId(req.query.team);
    const country = str(req.query.country, 60);
    const outings = db.prepare(`${OUTING_SELECT} WHERE (:country IS NULL OR o.country = :country) AND (:team IS NULL OR o.team_id = :team)`)
      .all({ country, team }).map((o) => presentOuting(o, req.user));
    const caughtOf = (o, pick = () => true) => o.fish.filter(pick).reduce((n, f) => n + f.released + f.kept, 0);
    const billfish = (f) => f.category === 'Billfish';
    const speciesList = [...new Set(outings.flatMap((o) => o.fish.filter((f) => f.released + f.kept).map((f) => f.species)))].sort();
    const species = speciesList.includes(req.query.species) ? req.query.species : speciesList.includes('Sailfish') ? 'Sailfish' : speciesList[0] ?? null;
    const isIt = (f) => f.species === species;

    // 1. Year against year, by month (the last three years with fish).
    const yearsAll = [...new Set(outings.map((o) => o.date.slice(0, 4)))].sort().reverse().slice(0, 3);
    const years = yearsAll.map((y) => {
      const inYear = outings.filter((o) => o.date.startsWith(y));
      const months = Array.from({ length: 12 }, (_, m) => {
        const inMonth = inYear.filter((o) => Number(o.date.slice(5, 7)) === m + 1);
        return { count: inMonth.reduce((n, o) => n + caughtOf(o, isIt), 0),
          boats: new Set(inMonth.filter((o) => caughtOf(o) > 0).map((o) => o.teamId)).size };
      });
      const first = inYear.filter((o) => caughtOf(o, isIt) > 0).map((o) => o.date).sort()[0] ?? null;
      return { year: y, months, first };
    });

    // 2. What's biting now.
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const inWindow = (from, to) => outings.filter((o) => o.date >= from && o.date <= to);
    const now = inWindow(day(13), day(0));
    const before = inWindow(day(27), day(14));
    const tally = (list) => {
      const t = {};
      for (const o of list) for (const f of o.fish) {
        const n = f.released + f.kept;
        if (!n) continue;
        const row = (t[f.species] ||= { count: 0, areas: {} });
        row.count += n;
        if (o.area?.trim()) row.areas[o.area.trim()] = (row.areas[o.area.trim()] || 0) + n;
      }
      return t;
    };
    const tNow = tally(now);
    const tBefore = tally(before);
    const biting = [...new Set([...Object.keys(tNow), ...Object.keys(tBefore)])].map((sp) => ({
      species: sp, now: tNow[sp]?.count ?? 0, before: tBefore[sp]?.count ?? 0,
      area: Object.entries(tNow[sp]?.areas ?? {}).sort((a, b2) => b2[1] - a[1])[0]?.[0] ?? null,
    })).sort((a, b2) => b2.now - a.now || b2.before - a.before);
    const boatsWith = (list) => new Set(list.filter((o) => caughtOf(o) > 0).map((o) => o.teamId)).size;

    // 3. Water temperature and billfish, week by week (the last 26 weeks, weeks from Monday).
    const monday = (d) => {
      const x = new Date(`${d}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    };
    const thisWeek = monday(day(0));
    const weeks = Array.from({ length: 26 }, (_, i) => {
      const start = new Date(Date.parse(`${thisWeek}T12:00:00Z`) - (25 - i) * 7 * 864e5).toISOString().slice(0, 10);
      const list = outings.filter((o) => monday(o.date) === start);
      const temps = list.map((o) => o.waterC).filter((v) => v != null);
      return { start, billfish: list.reduce((n, o) => n + caughtOf(o, billfish), 0),
        water: temps.length ? Math.round((temps.reduce((a, b2) => a + b2, 0) / temps.length) * 10) / 10 : null };
    });

    res.json({ species, speciesList, years, now: { biting, boats: boatsWith(now), boatsBefore: boatsWith(before) }, weeks });
  });

  // Where fish are being caught, region-wide, without anyone's exact spot: the
  // sea in squares of a tenth of a degree (about 10 km), each with how many fish
  // were caught in it and by how many boats, for a month and a species. No pins,
  // no boat names. Signed-in members only.
  const GRID = 0.1;
  api.get('/outings/grid', auth.requireUser, (req, res) => {
    const rows = db.prepare(`SELECT l.lat, l.lng, s.name AS species, o.date, o.team_id AS teamId
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id
      WHERE l.lat IS NOT NULL AND l.fate <> 'lost'`).all();
    const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort().reverse();
    const year = years.includes(req.query.year) ? req.query.year : years[0] ?? null;
    const inYear = rows.filter((r) => r.date.startsWith(year ?? ''));
    const speciesList = [...new Set(inYear.map((r) => r.species))].sort();
    const species = speciesList.includes(req.query.species) ? req.query.species : null;
    const ofSpecies = inYear.filter((r) => !species || r.species === species);
    const months = [...new Set(ofSpecies.map((r) => Number(r.date.slice(5, 7))))].sort((a, b2) => a - b2);
    const month = months.includes(Number(req.query.month)) ? Number(req.query.month) : months.at(-1) ?? null;
    const cells = {};
    for (const r of ofSpecies.filter((x) => Number(x.date.slice(5, 7)) === month)) {
      const la = Math.floor(r.lat / GRID); const ln = Math.floor(r.lng / GRID);
      const c = (cells[`${la}:${ln}`] ||= { south: +(la * GRID).toFixed(1), west: +(ln * GRID).toFixed(1), fish: 0, boats: new Set() });
      c.fish += 1;
      c.boats.add(r.teamId);
    }
    res.json({ year, years, species, speciesList, month, months, size: GRID,
      cells: Object.values(cells).map((c) => ({ south: c.south, west: c.west, north: +(c.south + GRID).toFixed(1), east: +(c.west + GRID).toFixed(1), fish: c.fish, boats: c.boats.size })) });
  });

  // ---- my catch map ---------------------------------------------------------

  // Every fish you caught or logged with its spot (and, for a captain, the
  // boat's), from your posts and your JHMMC feed posts, by year. Only yours.
  // Depth charts for My catch map: chart images placed by their corner
  // coordinates (charts/charts.json). For crews only, never public.
  const CHART_DIR = path.join(__dirname, '..', 'charts');
  const chartList = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(CHART_DIR, 'charts.json'), 'utf8'));
    } catch {
      return [];
    }
  };
  const forCrews = (req, res, next) => (req.user.teamId || isAdminUser(req.user) ? next()
    : res.status(403).json({ error: 'Depth charts are for boat crews.' }));
  api.get('/charts', auth.requireUser, forCrews, (_req, res) => {
    res.json({ charts: chartList().map(({ id, name, bounds }) => ({ id, name, bounds, url: `/api/charts/${id}` })) });
  });
  api.get('/charts/:id', auth.requireUser, forCrews, (req, res) => {
    const chart = chartList().find((c) => c.id === req.params.id);
    if (!chart) return res.status(404).json({ error: 'Chart not found.' });
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(path.join(CHART_DIR, path.basename(chart.file)));
  });

  api.get('/me/spots', auth.requireUser, (req, res) => {
    const u = req.user;
    const captainOf = db.prepare('SELECT id FROM teams WHERE captain_id = ?').get(u.id)?.id ?? null;
    const posts = db.prepare(`
      SELECT 'catch' AS kind, k.id, s.name AS species, k.weight_kg AS weightKg, k.released, k.caught_on AS date,
        k.lat, k.lng, k.location, COALESCE(NULLIF(au.nickname, ''), au.name, k.angler_name) AS angler, t.name AS boat,
        COALESCE(k.photo, k.scale_photo) AS photo, 0 AS estimate
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users au ON au.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.lat IS NOT NULL AND k.status <> 'rejected' AND NOT EXISTS (SELECT 1 FROM outing_landings x WHERE x.catch_id = k.id)
        AND (k.user_id = :me OR k.logged_by = :me OR (:boat IS NOT NULL AND k.team_id = :boat))
      UNION ALL
      SELECT 'club', p.id, s.name, p.weight_kg, p.released, date(p.created_at), p.lat, p.lng, NULL,
        COALESCE(NULLIF(au.nickname, ''), au.name), t.name, p.photo, 0
      FROM club_posts p JOIN species s ON s.id = p.species_id JOIN users au ON au.id = p.user_id LEFT JOIN teams t ON t.id = au.team_id
      WHERE p.lat IS NOT NULL AND p.user_id = :me
      UNION ALL
      SELECT 'log', l.id, s.name, CASE WHEN EXISTS (SELECT 1 FROM catches k WHERE k.id = l.catch_id AND k.status <> 'rejected')
          THEN (SELECT k.weight_kg FROM catches k WHERE k.id = l.catch_id AND ${ALONE}) ELSE l.weight_kg END,
        l.fate = 'released', o.date, l.lat, l.lng, NULL,
        COALESCE(NULLIF(au.nickname, ''), au.name), t.name, NULL,
        NOT EXISTS (SELECT 1 FROM catches k WHERE k.id = l.catch_id AND k.status <> 'rejected')
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id
        LEFT JOIN users au ON au.id = l.user_id LEFT JOIN teams t ON t.id = o.team_id
      WHERE l.lat IS NOT NULL AND l.fate <> 'lost' AND (l.user_id = :me OR (:crew IS NOT NULL AND o.team_id = :crew))
      ORDER BY date DESC, kind`).all({ me: u.id, boat: captainOf, crew: u.teamId ?? null });
    // A fish shared from the JHMMC feed to West Africa is one fish: keep the public post.
    const seen = new Set();
    const spots = posts.filter((x) => {
      const key = x.kind === 'log' ? `log${x.id}` : `${x.species}|${x.date}|${x.lat}|${x.lng}|${x.weightKg}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(({ photo, ...x }) => ({ ...x, released: !!x.released, estimate: !!x.estimate && x.weightKg != null, photoUrl: photoUrl(photo) }));
    const years = [...new Set(spots.map((x) => x.date.slice(0, 4)))].sort().reverse();
    const year = years.includes(req.query.year) ? req.query.year : null;
    res.json({ years, year, spots: year ? spots.filter((x) => x.date.startsWith(year)) : spots });
  });

  // ---- records -----------------------------------------------------------

  // IGFA all-tackle world records beside the heaviest fish logged here, plus
  // the app's own records for each species and line class.
  api.get('/records', (req, res) => {
    const clubId = intId(req.query.club);
    const club = clubId && db.prepare('SELECT id, name FROM clubs WHERE id = ? AND pending = 0').get(clubId);
    if (clubId && !club) return res.status(404).json({ error: 'Club not found.' });
    const best = db.prepare(`
      SELECT * FROM (
        SELECT k.species_id AS speciesId, k.line_class AS lineClass, k.id AS catchId, k.weight_kg AS weightKg,
          k.caught_on AS caughtOn, u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS overall,
          ROW_NUMBER() OVER (PARTITION BY k.species_id, k.line_class ORDER BY k.weight_kg DESC, k.id) AS inClass
        FROM catches k LEFT JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.weight_kg IS NOT NULL AND k.species_id IS NOT NULL AND k.status = :book ${club ? 'AND k.club_id = :club' : `AND ${THROUGH_JHMMC}`}
      ) WHERE overall = 1 OR (inClass = 1 AND lineClass IS NOT NULL)
    `).all(club ? { club: club.id, book: clubBook(club.id) } : { book: 'approved' });
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
      FROM catches WHERE user_id = ? AND status = 'approved'
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
