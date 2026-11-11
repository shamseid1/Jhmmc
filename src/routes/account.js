'use strict';

// Sign-up data, signing in and out, passwords. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    COUNTRIES, HOME_CLUB, LINE_CLASSES, SHOWN, WEIGH_STATIONS, adminEmail, api, appUrl, auth, canApprove,
    canHandleMoney, canReview, canWeigh, contactEmail, db, demo, homeClubId, isAdminUser, mailer,
    markAdminMember, photoUrl, secureCookies, setting, str, weighmasterAt, zoneOf
  } = ctx;
  // From a later part, reached when it's called.
  const notifyPrefs = (...args) => ctx.notifyPrefs(...args);

  // ---- reference data (public, needed by the sign-up form) ---------------

  api.get('/meta', (_req, res) => {
    const species = db.prepare(`
      SELECT id, name, scientific_name AS scientificName, category, points_per_kg AS pointsPerKg FROM species ORDER BY category, name
    `).all();
    res.json({
      countries: COUNTRIES, species, lineClasses: LINE_CLASSES, homeClub: HOME_CLUB.name,
      emailEnabled: mailer.configured, contactEmail, weighStations: WEIGH_STATIONS, homeClubId: homeClubId(),
      season: { start: setting('season_start'), end: setting('season_end') }, demo,
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
  // Requests waiting for the admin (opening a club...) also arrive by email, when email is set up.
  const emailAdmin = (subject, text) => {
    if (!mailer.configured || !adminEmail) return;
    mailer.send({ to: adminEmail, subject, text }).catch((err) => console.error('Admin email failed:', err.message));
  };
  const baseUrl = (req) => (appUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  function passwordChangedEmail(user, req) {
    return mailer.send({
      to: user.email,
      subject: 'Your Africa Sportfishing password was changed',
      text: `Hello ${user.name},\n\nThe password for your Africa Sportfishing account was just changed. ` +
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
        error: contactEmail
          ? `Password reset by email isn't available yet. Email ${contactEmail} from the address you signed up with and the admin will send you a reset link.`
          : "Password reset by email isn't available yet. Ask your club for help.",
      });
    }
    const user = email && db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email);
    if (!user) return res.json(reply);
    const link = `${baseUrl(req)}/#/reset?token=${auth.createResetToken(db, user.id)}`;
    try {
      await mailer.send({
        to: user.email,
        subject: 'Reset your Africa Sportfishing password',
        text: `Hello ${user.name},\n\nSomeone asked to reset the password for your Africa Sportfishing account. ` +
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
        t.id AS teamId, t.name AS teamName, t.country AS teamCountry, t.captain_id = u.id AS isCaptain, t.club_id AS clubId, u.role, u.jhmmc,
        t.weigh_station AS weighStation, t.division AS division, u.units, u.notify
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    const { photo, units, notify, teamCountry, ...rest } = me;
    return {
      // "Today" for this member: the boat's clock (its country), else their own country's.
      ...rest, timeZone: zoneOf(teamCountry || me.country), photoUrl: photoUrl(photo), units: units ? JSON.parse(units) : null, notify: notifyPrefs(notify), isCaptain: !!me.isCaptain, jhmmc: !!me.jhmmc || isAdminUser(me),
      isAdmin: isAdminUser(me), canWeigh: canWeigh(me), weighmasterAt: weighmasterAt(me), canReview: canReview(me), canApprove: canApprove(me), canHandleMoney: canHandleMoney(me),
    };
  }

  api.get('/me', (req, res) => {
    res.json({ user: req.user ? getMe(req.user.id) : null });
  });

  // Anyone can look around; doing anything (posting, liking, joining) needs an account.
  api.use((req, res, next) => (req.method === 'GET' ? next() : auth.requireUser(req, res, next)));

  return { NAMES_NEEDED, baseUrl, emailAdmin, getMe, namesFrom, namesGiven, passwordChangedEmail, readUnits };
};
