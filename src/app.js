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
const { createBackups } = require('./backup');
const { createPusher } = require('./push');
const { zoneOf, dateIn, CLUB_ZONE } = require('./zones');

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
  // The address shown to members (privacy policy, password help); by default the one in MAIL_FROM.
  contactEmail,
  // Sends phone notifications; made from the database's keys unless given (tests).
  pusher,
  // The feed fills itself (weigh-ins, Log fish): posting by hand is closed.
  // Tests that still post open it.
  openPosts = false,
  // Only JHMMC (the admin) opens clubs; others ask. Tests that make clubs freely open it.
  openClubs = false,
  // Nightly copies of the database (next to it, in "backups"), emailed to the admin.
  backupDir,
  nightlyBackups = true,
  // A demo copy for showing the club: sample data (src/demo.js), shared sign-ins
  // listed on the sign-in page, and nothing a visitor can lock the others out with.
  demo = false,
} = {}) {
  adminEmail = adminEmail?.trim().toLowerCase() || null;
  // The address people are shown and can write to: the one the app sends from (MAIL_FROM,
  // e.g. info@africasportfishing.com), never the admin's own. The admin's email only says
  // which account is the admin and where the nightly backups go.
  contactEmail = (contactEmail ?? (/<([^>]+)>/.exec(process.env.MAIL_FROM || '')?.[1] || (process.env.MAIL_FROM || '').trim()))?.trim().toLowerCase() || null;
  const db = openDb(dbFile);
  pusher ??= createPusher(db, { contact: contactEmail || 'info@africasportfishing.com' });
  const backups = createBackups(db, { dir: backupDir || path.join(path.dirname(path.resolve(dbFile)), 'backups'), mailer, adminEmail });
  if (nightlyBackups) backups.start();
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
  // Each fish: its scale photo or video, and a photo for the feed.
  const sheetUpload = mediaUploads(MAX_FISH_PER_SHEET * 3);
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
  // Security headers on every answer. The content policy lets the page load only
  // its own files, Google's fonts and the satellite map pictures, and run only its
  // own scripts (the one inline script, which sets the theme, by its hash), so
  // text someone managed to slip into a page couldn't run as code.
  const inlineScripts = [...fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  const CSP = [
    "default-src 'self'",
    `script-src 'self' ${inlineScripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://server.arcgisonline.com",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(self)',
    });
    // Over https (production): browsers keep using https for a year.
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
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
  // The page itself, with a link preview (WhatsApp and the like want full addresses for the picture).
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sendIndex = (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const title = demo ? 'Africa Sportfishing (demo)' : 'Africa Sportfishing';
    const text = 'Log fish, weigh-ins, points, tournaments and catch maps for JHMMC and West Africa.';
    res.set('Cache-Control', 'no-cache').type('html').send(indexHtml.replace('<!--og-->', ogTags(origin, { title, text })));
  };
  const ogTags = (origin, { title, text, url = '/' }) => {
    const og = [['og:type', 'website'], ['og:title', title], ['og:description', text], ['og:url', `${origin}${url}`],
      // The preview picture is just the logo.
      ['og:image', `${origin}/og-logo.jpg`], ['og:image:type', 'image/jpeg'], ['og:image:width', '600'], ['og:image:height', '600']]
      .map(([k, v]) => `<meta property="${k}" content="${v.replace(/"/g, '&quot;')}">`).join('\n  ');
    return og;
  };
  app.get(['/', '/index.html'], sendIndex);
  // The privacy policy, at a plain address the app stores can link to.
  const privacyHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');
  app.get(['/privacy', '/privacy.html'], (_req, res) => {
    const contact = (contactEmail || 'info@africasportfishing.com').replace(/[<>"&]/g, '');
    res.set('Cache-Control', 'no-cache').type('html').send(privacyHtml.replaceAll('{{contact}}', contact));
  });
  // The help page (the app stores' "support" link).
  const supportHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'support.html'), 'utf8');
  // Testing the Android app (Google Play closed testing): a page with the logo card for
  // WhatsApp (Google's own test link shows none) and the two steps, join the testers'
  // group then become a tester. TESTERS_GROUP is the Google Group's address.
  const testHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'test.html'), 'utf8');
  app.get(['/test', '/testers', '/test.html'], (req, res) => {
    const pkg = (process.env.ANDROID_PACKAGE || 'com.africasportfishing.app').trim();
    const group = (process.env.TESTERS_GROUP || 'https://groups.google.com/g/jhmmc-app-testers').trim();
    const contact = (contactEmail || 'info@africasportfishing.com').replace(/[<>"&]/g, '');
    const fill = (v) => String(v).replace(/[<>"&]/g, '');
    res.set('Cache-Control', 'no-cache').type('html').send(testHtml
      .replace('<!--og-->', ogTags(`${req.protocol}://${req.get('host')}`, { title: 'Test the Africa Sportfishing app', text: 'Help JHMMC get the app on Google Play: join the testers and install it.', url: '/test' }))
      .replaceAll('{{group}}', fill(group)).replaceAll('{{play}}', fill(`https://play.google.com/apps/testing/${pkg}`)).replaceAll('{{contact}}', contact));
  });
  app.get(['/support', '/support.html', '/help'], (_req, res) => {
    const contact = (contactEmail || 'info@africasportfishing.com').replace(/[<>"&]/g, '');
    res.set('Cache-Control', 'no-cache').type('html').send(supportHtml.replaceAll('{{contact}}', contact));
  });
  // The Android app (Google Play) opens this site full screen once the site vouches for it,
  // by the fingerprints of the certificates it's signed with (public, not secrets).
  // ANDROID_SHA256 adds more (separated by commas), ANDROID_PACKAGE changes the package.
  const ANDROID_PRINTS = [
    // Google's app signing key: what phones see on the app installed from Google Play.
    '77:3D:1A:B2:FE:B0:2F:63:EA:EB:86:81:5A:3B:C3:2B:F8:FB:D5:F3:79:DE:74:4B:E0:86:9E:C5:90:8B:D7:DC',
    // Our upload key (PWABuilder package, 11 Nov 2026).
    '4E:04:0F:8C:11:FE:C2:04:09:1F:FC:F9:20:B1:A3:AF:6D:1C:5F:CB:F7:47:64:F5:B7:F4:3D:60:33:92:6A:FA',
  ];
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const pkg = (process.env.ANDROID_PACKAGE || 'com.africasportfishing.app').trim();
    const prints = [...new Set([...ANDROID_PRINTS, ...(process.env.ANDROID_SHA256 || '').split(',')]
      .map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x)))];
    res.json(prints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } }] : []);
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { ...fresh, index: false }));
  app.get('/scoring.js', (_req, res) => res.sendFile(path.join(__dirname, 'scoring.js'), { headers: { 'Cache-Control': 'no-cache' } }));

  const api = express.Router();
  if (demo) {
    const { DEMO_ACCOUNTS } = require('./demo');
    // The shared demo accounts keep their passwords and emails.
    const locked = [['POST', '/me/password'], ['POST', '/auth/forgot'], ['POST', '/auth/reset'], ['DELETE', /^\/admin\/users\//], ['DELETE', '/me']];
    api.use((req, res, next) => {
      const hit = locked.some(([m, p]) => req.method === m && (typeof p === 'string' ? req.path === p : p.test(req.path)));
      if (hit || (req.method === 'PATCH' && req.path === '/me' && 'email' in (req.body ?? {}))) {
        return res.status(403).json({ error: 'Not in the demo copy: the sign-ins are shared.' });
      }
      next();
    });
    api.get('/demo', (_req, res) => res.json({ accounts: DEMO_ACCOUNTS }));
  }

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
    if (setting('uploads_cleaned') === '45') return;
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
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('uploads_cleaned', '45');
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
  // For now JHMMC is Africa Sportfishing: every boat's fish are weighed in and
  // approved through JHMMC, unless its club runs its own weigh-ins (self_run).
  // Only JHMMC's own boats compete in the JHMMC Season and Tournaments.
  const THROUGH_JHMMC = 'NOT EXISTS (SELECT 1 FROM clubs sc WHERE sc.id = k.club_id AND sc.self_run = 1)';
  const throughJhmmc = (clubId) => !clubId || !db.prepare('SELECT 1 FROM clubs WHERE id = ? AND self_run = 1').get(clubId);
  const captainsJhmmcBoat = (u) => !!u && !!db.prepare(`SELECT 1 FROM teams t LEFT JOIN clubs c ON c.id = t.club_id
    WHERE t.captain_id = ? AND COALESCE(c.self_run, 0) = 0`).get(u.id);
  // The rules want every fish weighed by the station's weighmaster: club members the secretary
  // appoints (a captain, the treasurer...), one station each, who weigh the boats registered at
  // that station. A captain weighs only his own boat's fish, and picks from a list why there was
  // no weighmaster.
  const weighmasterAt = (u) => (u ? db.prepare('SELECT weigh_station AS s FROM users WHERE id = ?').get(u.id)?.s || null : null);
  const canWeigh = (u) => canApprove(u) || captainsJhmmcBoat(u) || !!weighmasterAt(u);
  const requireOfficial = (check, who) => (req, res, next) =>
    check(req.user) ? next() : res.status(403).json({ error: `Only ${who} can do that.` });
  const requireWeigh = requireOfficial(canWeigh, "a weighmaster, a boat's captain or the JHMMC secretary");
  const NO_WEIGHMASTER = { absent: 'No weighmaster at the station' };
  // Who is weighing this boat's fish, and as what. Weighing a boat you're on, unless you're the
  // weighmaster at its station, is that boat's own weigh-in, with the reason there was no weighmaster.
  function weighRole(user, teamId, b) {
    const team = db.prepare('SELECT captain_id, club_id, weigh_station FROM teams WHERE id = ?').get(teamId);
    const captain = team?.captain_id === user.id;
    // A weighmaster weighs every boat registered at his station, his own included.
    const wmAt = weighmasterAt(user);
    if (wmAt && team?.club_id === homeClubId() && team.weigh_station === wmAt) return { role: 'weighmaster' };
    const onBoat = captain || db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id = ?').get(user.id, teamId);
    if (!onBoat && weighmasterAt(user)) return { role: 'weighmaster' };
    if (!onBoat && canApprove(user)) return { role: 'officer' };
    if (!onBoat) return { role: null };
    // Boats outside JHMMC weigh at their home port, where there are no JHMMC weighmasters.
    if (team.club_id !== homeClubId()) return { role: 'captain' };
    const why = NO_WEIGHMASTER[b.noWeighmaster];
    if (!why) return { error: 'Under the club rules the weighmaster weighs. Tick that there was no weighmaster at the station.' };
    return { role: captain ? 'captain' : 'own', reason: why };
  }
  const markWeighed = (ids, { role, reason }) => {
    for (const id of ids) db.prepare('UPDATE catches SET weigh_role = ?, weigh_reason = ? WHERE id = ?').run(role ?? null, reason ?? null, id);
  };
  const requireReview = requireOfficial(canReview, 'the JHMMC secretary');
  const requireMoney = requireOfficial(canHandleMoney, 'the JHMMC treasurer or secretary');
  const requireApprove = requireOfficial(canApprove, 'the JHMMC secretary');

  // The routes, in parts (src/routes): each takes what it uses from the shared
  // context and adds the helpers it shares with the others.
  const ctx = {
    CLUB_ZONE,
    COUNTRIES,
    HOME_CLUB,
    LINE_CLASSES,
    MAX_EVENT_DAYS,
    MAX_FISH_PER_SHEET,
    ROLES,
    SHOWN,
    THROUGH_JHMMC,
    WEIGH_STATIONS,
    adminEmail,
    api,
    app,
    appUrl,
    auth,
    backups,
    bool,
    canApprove,
    canHandleMoney,
    canReview,
    canWeigh,
    captainsJhmmcBoat,
    clubBook,
    contactEmail,
    dateIn,
    db,
    demo,
    discardUploads,
    fs,
    homeClubId,
    igfa,
    intId,
    isAdminUser,
    jhmmcBook,
    lengthFt,
    mailer,
    markAdminMember,
    markWeighed,
    mediaUploads,
    multer,
    newCode,
    num,
    openClubs,
    openPosts,
    path,
    photoUrl,
    pusher,
    removeUpload,
    requireApprove,
    requireMoney,
    requireReview,
    requireWeigh,
    scoring,
    secureCookies,
    sendIndex,
    setting,
    sheetUpload,
    str,
    throughJhmmc,
    upload,
    weighRole,
    weighmasterAt,
    withVideo,
    zoneOf,
  };
  for (const part of ['account', 'activity', 'notifications', 'admin', 'boats', 'catches', 'registrations', 'scoring', 'tournaments', 'posts', 'outings', 'people']) {
    Object.assign(ctx, require(`./routes/${part}`)(ctx));
  }

  return app;
}

module.exports = { createApp };
