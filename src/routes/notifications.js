'use strict';

// Phone notifications: who's told about what. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    COUNTRIES, NAMES_NEEDED, adminEmail, api, auth, db, getMe, namesFrom, namesGiven,
    passwordChangedEmail, pusher, readUnits, secureCookies, str
  } = ctx;

  // ---- notifications ------------------------------------------------------

  api.get('/push/key', (_req, res) => res.json({ publicKey: pusher.publicKey }));

  // A phone or browser that agreed to notifications; one person may have several.
  api.post('/push/subscribe', (req, res) => {
    // The Android app: a Firebase token, kept as an "fcm:" endpoint.
    const apns = req.body?.apns;
    if (apns !== undefined) {
      // The iPhone app: an Apple device token (hex), kept as an "apns:" endpoint.
      if (typeof apns !== 'string' || !/^[0-9a-fA-F]{64,200}$/.test(apns)) return res.status(400).json({ error: 'That notification token could not be read.' });
      db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, '', '')
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id`).run(req.user.id, `apns:${apns.toLowerCase()}`);
      return res.status(201).json({ ok: true });
    }
    const fcm = req.body?.fcm;
    if (fcm !== undefined) {
      if (typeof fcm !== 'string' || !/^[\w:.-]{20,4096}$/.test(fcm)) return res.status(400).json({ error: 'That notification token could not be read.' });
      db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, '', '')
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id`).run(req.user.id, `fcm:${fcm}`);
      return res.status(201).json({ ok: true });
    }
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

  // "Send a test": a notification to this person's own phones, now, with what went wrong if one fails.
  api.post('/push/test', async (req, res) => {
    const phones = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(req.user.id);
    if (!phones.length) return res.status(404).json({ error: 'No phone is set up for notifications on this account. Turn them on first.' });
    const payload = { title: 'Africa Sportfishing', body: 'Test notification: notifications work on this phone.', url: '/#/notifications' };
    const results = await Promise.all(phones.map(async (p) => {
      const kind = p.endpoint.startsWith('fcm:') ? 'Android app' : p.endpoint.startsWith('apns:') ? 'iPhone app' : 'browser';
      try {
        const alive = await pusher.send({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, payload);
        if (!alive) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(p.endpoint);
        return { kind, ok: alive, error: alive ? null : 'This phone is no longer registered: turn notifications on again.' };
      } catch (err) {
        console.warn(`Test notification failed (${kind}): ${err.message}`);
        return { kind, ok: false, error: err.message };
      }
    }));
    res.json({ results });
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

  return { notifyPrefs, notifyReviewers, pushToEveryone, pushToReviewers, pushWhere };
};
