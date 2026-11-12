'use strict';

// The log: trips, fish logged at sea, the catch maps. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    COUNTRIES, api, auth, bool, dateIn, db, fs, intId, isAdminUser, linkLogToRegistration, path,
    photoUrl, pushWhere, readSpot, removeUpload, savePhoto, str, upload, zoneOf
  } = ctx;

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
  const landingsOf = (outingId) => db.prepare(`SELECT l.id, l.user_id AS userId, l.species_id AS speciesId, l.catch_id AS catchId, l.photo, COALESCE(l.client_id LIKE 'reg-%', 0) AS fromScale, s.name AS species, l.fate, l.weight_kg AS weightKg, ${SCALE}, l.lat, l.lng, l.landed_at AS landedAt, l.on_profile AS onProfile,
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
    // The day is the boat's own day (its country's clock), so a fish at 23:30 doesn't land on tomorrow's line.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? '') ? b.date : dateIn(zoneOf(team.country), landedAt);
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
      const landingId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
      linkLogToRegistration(landingId);
      db.exec('COMMIT');
      // The sea when it came aboard, saved with it (in the background; never holds up the log).
      if (ctx.sea && spot.lat != null) {
        ctx.sea.at(spot.lat, spot.lng, landedAt)
          .then((c) => { if (c) db.prepare('UPDATE outing_landings SET conditions = ? WHERE id = ?').run(JSON.stringify(c), landingId); })
          .catch(() => {});
      }
      // Fish on! For those who asked: boat, species and what happened, never the spot.
      // Only for this trip's fish (today's, or last night's carrying on), not ones added afterwards.
      if (Date.now() - Date.parse(landedAt) < 12 * 36e5) {
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
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date ?? '') ? req.query.date : dateIn(zoneOf(db.prepare('SELECT country FROM teams WHERE id = ?').get(req.user.teamId ?? 0)?.country || req.user.country));
    const o = req.user.teamId && db.prepare('SELECT id FROM outings WHERE team_id = ? AND date = ? ORDER BY id LIMIT 1').get(req.user.teamId, date);
    res.json({ trip: o ? tripFor(o.id, req.user) : null });
  });

  // A released fish's estimated weight (it never sees a scale), given whenever there's a moment.
  api.patch('/outings/fish/:id', auth.requireUser, (req, res) => {
    const l = db.prepare(`SELECT l.id, l.outing_id, l.fate, o.user_id, o.team_id
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id WHERE l.id = ?`).get(intId(req.params.id) ?? 0);
    if (!l) return res.status(404).json({ error: 'Fish not found.' });
    if (!onTrip(req.user, l)) return res.status(403).json({ error: "Only the boat's crew can change its trip." });
    // Shown on the profiles or not (a logged fish with its photo).
    if ('onProfile' in req.body && Object.keys(req.body).length === 1) {
      db.prepare('UPDATE outing_landings SET on_profile = ? WHERE id = ?').run(req.body.onProfile ? 1 : 0, l.id);
      return res.json({ trip: tripFor(l.outing_id, req.user) });
    }
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
    // The sea when each fish came aboard (saved with it): for the most caught species, the
    // water temperature, tide and wind they were caught in.
    const seaBy = {};
    if (ids.length) {
      for (const r of db.prepare(`SELECT s.name AS species, l.conditions FROM outing_landings l JOIN species s ON s.id = l.species_id
        WHERE l.outing_id IN (${ids.map(() => '?').join(',')}) AND l.conditions IS NOT NULL AND l.fate <> 'lost'`).all(...ids)) {
        let c;
        try { c = JSON.parse(r.conditions); } catch { continue; }
        const x = (seaBy[r.species] ??= { species: r.species, fish: 0, water: {}, tide: {}, wind: {} });
        x.fish += 1;
        if (c.waterC != null) { const lo = Math.floor(c.waterC * 2) / 2; add(x.water, `${lo.toFixed(1)} – ${(lo + 0.5).toFixed(1)}°C`, 1); }
        if (c.tide) add(x.tide, c.tide === 'rising' ? 'Rising' : 'Falling', 1);
        if (c.windKn != null) add(x.wind, c.windKn < 10 ? 'Under 10 kn' : c.windKn <= 15 ? '10 – 15 kn' : 'Over 15 kn', 1);
      }
    }
    const list = (map, order) => Object.entries(map).sort((a, b2) => (order ? order.indexOf(a[0]) - order.indexOf(b2[0]) : a[0].localeCompare(b2[0])))
      .map(([label, fish]) => ({ label, fish }));
    const seaConditions = Object.values(seaBy).filter((x) => x.fish >= 3).sort((a, b2) => b2.fish - a.fish).slice(0, 3)
      .map((x) => ({ species: x.species, fish: x.fish, water: list(x.water), tide: list(x.tide, ['Rising', 'Falling']), wind: list(x.wind, ['Under 10 kn', '10 – 15 kn', 'Over 15 kn']) }));
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
      hours, areas: top(areas), techniques: top(techniques), seaConditions,
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
  const CHART_DIR = path.join(__dirname, '..', '..', 'charts');
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
    res.json({ charts: chartList().map(({ id, name, bounds, tiles }) => (tiles
      // The version (the pack's size and date) changes with the chart, so phones fetch the new tiles instead of saved ones.
      ? { id, name, bounds, tiles: `/api/charts/${id}/{z}/{x}/{y}.png?v=${chartVersion(tiles)}`, minZoom: tiles.minZoom, maxZoom: tiles.maxZoom }
      : { id, name, bounds, url: `/api/charts/${id}` })) });
  });
  const chartVersion = (tiles) => {
    try {
      const st = fs.statSync(path.join(CHART_DIR, path.basename(tiles.pack)));
      return `${st.size.toString(36)}${Math.floor(st.mtimeMs / 1000).toString(36)}`;
    } catch {
      return '0';
    }
  };
  // A tiled chart is one packed file of map tiles and an index ("z/x/y": [offset, length]).
  const packs = new Map();
  const packFor = (chart) => {
    if (!packs.has(chart.id)) {
      const index = JSON.parse(fs.readFileSync(path.join(CHART_DIR, path.basename(chart.tiles.index)), 'utf8'));
      packs.set(chart.id, { index, file: path.join(CHART_DIR, path.basename(chart.tiles.pack)) });
    }
    return packs.get(chart.id);
  };
  const EMPTY_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==', 'base64') // fully see-through;
  api.get('/charts/:id/:z/:x/:y.png', auth.requireUser, forCrews, (req, res) => {
    const chart = chartList().find((c) => c.id === req.params.id && c.tiles);
    if (!chart) return res.status(404).json({ error: 'Chart not found.' });
    const { index, file } = packFor(chart);
    const { z, x, y } = req.params;
    const at = [z, x, y].every((v) => /^\d{1,7}$/.test(v)) ? index[`${+z}/${+x}/${+y}`] : null;
    res.set('Cache-Control', 'private, max-age=604800');
    res.type('png');
    if (!at) return res.set('Cache-Control', 'private, max-age=3600').send(EMPTY_TILE); // outside the chart: nothing to draw
    const buf = Buffer.alloc(at[1]);
    const fd = fs.openSync(file, 'r');
    try {
      fs.readSync(fd, buf, 0, at[1], at[0]);
    } finally {
      fs.closeSync(fd);
    }
    res.send(buf);
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

  return { bump };
};
