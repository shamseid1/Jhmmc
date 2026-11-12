'use strict';

// The registration record: every weigh-in's history. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    api, canApprove, db, insertCatch, intId, isAdminUser, openPosts, photoUrl, pushToEveryone,
    requireReview, str, withVideo
  } = ctx;
  // From a later part, reached when it's called.
  const suggestPoints = (...args) => ctx.suggestPoints(...args);

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
  const declared = (user, b) => canApprove(user) || b.declared === 'yes';
  // Every registration takes the phone's location, officials' included.
  const LOCATION_NEEDED = "The phone's location is needed for the weigh-in. Turn on location for this site and send again.";
  const located = (user, b) => !!deviceSpot(b);
  // What stops an official registration before the fish are checked, if anything.
  const sheetProblem = (user, b) => (!declared(user, b) ? DECLARATION : !located(user, b) ? LOCATION_NEEDED : null);
  // When disputes close: 24 hours after the fish was registered.
  const disputeUntil = (createdAt) => new Date(Date.parse(`${createdAt.replace(' ', 'T')}Z`) + DISPUTE_HOURS * 3600e3).toISOString();
  const disputesFor = db.prepare(`
    SELECT d.id, d.reason, d.created_at AS createdAt, u.id AS userId, u.name AS author, t.name AS boat
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
      // On a boat's or angler's own page, one post per fish (a tuna and a marlin apart).
      parts.push(`SELECT 'weighin' AS kind, MAX(k.id) AS id, MAX(datetime(COALESCE(k.reviewed_at, k.created_at))) AS at, t.id AS teamId,
          t.name AS boat, t.photo AS boatPhoto, NULL AS species, NULL AS weightKg, NULL AS fate, NULL AS angler, NULL AS userId,
          k.caught_on AS title, NULL AS body
        FROM catches k LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.status = 'approved' AND (:team IS NULL OR k.team_id = :team) AND (:user IS NULL OR k.user_id = :user)
          AND (:club IS NULL OR t.club_id = :club)
        GROUP BY k.team_id, k.caught_on${team || user ? ', k.id' : ''}`);
    }
    if (!['weighins', 'announcements'].includes(type)) {
      parts.push(`SELECT 'log' AS kind, l.id, datetime(l.landed_at) AS at, t.id AS teamId, t.name AS boat, t.photo AS boatPhoto,
          s.name AS species, NULL AS weightKg, l.fate, NULL AS angler, l.user_id AS userId, NULL AS title, l.photo AS body
        FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id LEFT JOIN teams t ON t.id = o.team_id
        WHERE COALESCE(l.client_id, '') NOT LIKE 'reg-%'
          AND (l.user_id IS NULL OR l.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = :me))
          -- Two posts for a fish that was logged and then weighed: "boated" with the
          -- crew's photo, and the weigh-in with the weigh station's.
          AND (:team IS NULL OR o.team_id = :team) AND (:user IS NULL OR l.user_id = :user) AND (:club IS NULL OR t.club_id = :club)`);
    }
    // Announcements belong to the whole feed, not to one boat or angler.
    if ((type === 'all' || type === 'announcements') && !team && !user && !club) {
      parts.push(`SELECT 'announcement' AS kind, a.id, datetime(a.created_at) AS at, NULL AS teamId, NULL AS boat, NULL AS boatPhoto,
          NULL AS species, NULL AS weightKg, NULL AS fate, COALESCE(NULLIF(u.nickname, ''), u.name) AS angler, a.user_id AS userId, a.title, a.body
        FROM announcements a LEFT JOIN users u ON u.id = a.user_id WHERE :team IS NULL AND :user IS NULL AND :club IS NULL
          AND (a.user_id IS NULL OR a.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id = :me))`);
    }
    if (!parts.length) return res.json({ items: [], nextBefore: null });
    const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) WHERE (:before IS NULL OR at < :before)
      ORDER BY at DESC, id DESC LIMIT 31`;
    // Posts by people this person blocked are left out (only where the query has them).
    const rows = db.prepare(sql).all({ team, user, club, before, ...(sql.includes(':me') && { me: req.user?.id ?? 0 }) });
    // Each fish's own photo from the crew if they added one, then its weigh station photo,
    // and a released fish's release video. Videos of the scale are evidence.
    const fishOfDay = db.prepare(`SELECT k.id, s.name AS species, k.weight_kg AS weightKg, k.released, k.points, k.photo AS feedPhoto, k.scale_photo AS scalePhoto, k.scale_video AS scaleVideo,
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
        item.single = !!(team || user);
        item.fish = fishOfDay.all(x.teamId, x.title, user, user).filter((f) => !item.single || f.id === x.id).map(({ feedPhoto, scalePhoto, scaleVideo, ...f }) => ({ ...f, released: !!f.released,
          photos: [feedPhoto, scalePhoto].filter(Boolean).map(photoUrl), ownPhoto: !!feedPhoto, videoUrl: f.released ? photoUrl(scaleVideo) : null }));
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

  return { DISPUTE_HOURS, deviceSpot, disputeUntil, disputesFor, logRegistration, scoreRegistration, sheetProblem, snapshot };
};
