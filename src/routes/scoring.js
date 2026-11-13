'use strict';

// Official scoring: weigh-ins, approval, the calendar and standings. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    CATCH_SELECT, DISPUTE_HOURS, MAX_EVENT_DAYS, MAX_FISH_PER_SHEET, THROUGH_JHMMC, api, canApprove,
    canReview, captainsJhmmcBoat, checkCatch, db, deviceSpot, discardUploads, disputeUntil, disputesFor,
    homeClubId, insertCatch, insertCatchRow, intId, linkRegistrationToLog, logRegistration, markWeighed,
    notifyReviewers, photoUrl, present, pushToEveryone, pushToReviewers, pushWhere, removeUpload,
    requireApprove, requireReview, requireWeigh, scoreRegistration, scoring, setting, sheetProblem,
    sheetUpload, snapshot, str, weighRole, withVideo
  } = ctx;
  // From a later part, reached when it's called.
  const getCatch = (...args) => ctx.getCatch(...args);

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
      const media = { photo: files.find((x) => x.fieldname === `scale_${i}`), video: files.find((x) => x.fieldname === `scalevideo_${i}`),
        feed: files.find((x) => x.fieldname === `feed_${i}`) };
      const checked = checkCatch(req.user, { ...f, caughtOn: req.body.caughtOn, weighStation: req.body.weighStation }, media,
        { teamId, official: true });
      if (checked.error) return fail(`Fish ${i + 1}: ${checked.error}`);
      rows.push(checked.values);
    }
    const weigher = weighRole(req.user, teamId, req.body);
    if (weigher.error) return fail(weigher.error);
    db.exec('BEGIN');
    try {
      const ids = rows.map(insertCatchRow);
      markWeighed(ids, weigher);
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
      .all()
      .map((r) => ({ ...present(r, req.user), suggested: suggestPoints(r.id), events: eventsOn(r.caughtOn),
        disputes: disputesFor.all(r.id), disputeUntil: disputeUntil(r.createdAt) }));
    // Captains see what they registered that the secretary hasn't decided yet.
    res.json({ toReview: canApprove(req.user) ? toReview : toReview.filter((c) => c.loggedBy === req.user.id) });
  });

  // Every boat's registrations waiting for the secretary, open to all JHMMC
  // captains so they can dispute one within 24 hours.
  api.get('/registrations/pending', requireWeigh, (req, res) => {
    const now = Date.now();
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.status = 'pending_review' ORDER BY k.created_at DESC, k.id DESC`).all();
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
        const { scalePhoto, scaleVideo, note: _note, ...now } = steps.at(-1);
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
    const row = id && db.prepare('SELECT status, weight_kg AS weightKg, released FROM catches WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Catch not found.' });
    const note = str(req.body.note, 300);
    // Points always come from the rules: the secretary corrects the weight (a
    // missed 0), never the points, so there's no sum to get wrong.
    const typed = req.body.weightKg === undefined || req.body.weightKg === '' ? null : Number(req.body.weightKg);
    if (typed !== null && !(typed > 0 && typed < 2000)) return res.status(400).json({ error: 'Enter the weight in kg.' });
    const newWeight = typed !== null && !row.released && Math.abs(typed - (row.weightKg ?? 0)) > 0.001 ? Math.round(typed * 10) / 10 : null;
    if (newWeight !== null && !note) return res.status(400).json({ error: 'Add a note explaining the corrected weight.' });
    const fixWeight = () => {
      if (newWeight === null) return null;
      db.prepare('UPDATE catches SET weight_kg = ? WHERE id = ?').run(newWeight, id);
      return `Weight corrected from ${row.weightKg} to ${newWeight} kg: ${note}`;
    };
    let said = null; // what goes in the registration record
    if (req.body.decision === 'reject') {
      if (!note) return res.status(400).json({ error: 'Give a reason so the crew knows why.' });
      db.prepare(`UPDATE catches SET status = 'rejected', points = NULL, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(note, req.user.id, new Date().toISOString(), id);
    } else if (req.body.decision === 'weight') {
      // An approved fish's weight corrected afterwards; the points follow.
      if (row.status !== 'approved') return res.status(400).json({ error: 'Only an approved fish can have its weight corrected here.' });
      if (row.released) return res.status(400).json({ error: 'A released fish has no weight to correct.' });
      if (newWeight === null) return res.status(400).json({ error: typed === null ? 'Enter the corrected weight.' : 'That is already its weight.' });
      said = fixWeight();
      const s = suggestPoints(id);
      db.prepare('UPDATE catches SET points = ?, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
        .run(s.points, s.note, req.user.id, new Date().toISOString(), id);
    } else if (req.body.decision === 'approve') {
      // A fish taken off the points (or rejected) can be approved again, saying why.
      if (row.status === 'rejected' && !note) return res.status(400).json({ error: 'Say why it now counts.' });
      if (!note && disputesFor.all(id).length) return res.status(400).json({ error: 'This fish was disputed: add a note on how the dispute was settled.' });
      said = fixWeight();
      const s = suggestPoints(id);
      db.prepare(`UPDATE catches SET status = 'approved', points = ?, points_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`)
        .run(s.points, note && !said ? `${note}. ${s.note}` : s.note, req.user.id, new Date().toISOString(), id);
    } else {
      return res.status(400).json({ error: 'Approve or reject.' });
    }
    const action = { reject: row.status === 'approved' ? 'uncounted' : 'rejected', weight: 'repointed' }[req.body.decision] ?? 'approved';
    logRegistration(id, action, req.user, { note: said || note });
    // Tell whoever registered it, and (if they want it) everyone about a new weigh-in.
    const k = db.prepare(`SELECT k.logged_by, k.weight_kg, k.released, k.points, k.points_note, k.photo, s.name AS species, t.name AS boat,
        COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?`).get(id);
    const fish = `${k.species}${k.weight_kg ? ` (${Math.round(k.weight_kg * 10) / 10} kg)` : k.released ? ' (released)' : ''}`;
    const approved = req.body.decision === 'approve';
    pushWhere('myFish', action === 'repointed' ? {
      title: 'Weight corrected',
      body: `Your ${fish} weight was corrected: now ${k.points} points. ${note}`,
    } : {
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
  // The season calendar: tournaments (they score, with their entries) and the club's dinners and
  // events (they don't), dated or to be announced (those last, in the order added).
  const EVENT_COLS = `id, date, COALESCE(end_date, date) AS endDate, kind, name, place, note, tbc, when_text AS whenText,
    (SELECT json_group_array(team_id) FROM tournament_entries WHERE event_id = events.id) AS entries`;
  const eventOut = (e) => ({ ...e, tbc: !!e.tbc, entries: JSON.parse(e.entries) });
  api.get('/events', (_req, res) => {
    const start = setting('season_start');
    const end = setting('season_end');
    res.json({
      season: { start, end },
      events: db.prepare(`SELECT ${EVENT_COLS} FROM events
        WHERE (date IS NULL AND kind <> 'holiday') OR (COALESCE(end_date, date) >= ? AND date <= ?)
        ORDER BY date IS NULL, date, id`).all(start, end).map(eventOut),
    });
  });

  // What's sent in to add or change one: checked the same way for both.
  const KINDS = ['tournament', 'dinner', 'event'];
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
  function eventFields(body) {
    const kind = KINDS.includes(body.kind) ? body.kind : 'tournament';
    const name = str(body.name, 80);
    const tba = body.tba === true || body.tba === 'on' || body.tba === '1' || !str(body.date, 10);
    const date = tba ? null : str(body.date, 10);
    const endDate = tba ? null : (str(body.endDate, 10) || date);
    if (!name) return { error: kind === 'tournament' ? 'Name the tournament.' : 'Give it a name.' };
    if (!tba) {
      if (!isDay(date)) return { error: 'Choose the date, or tick "Date to be announced".' };
      if (!isDay(endDate) || endDate < date) return { error: 'The last day must be on or after the first day.' };
      if ((Date.parse(endDate) - Date.parse(date)) / 86400000 >= MAX_EVENT_DAYS) return { error: `It can last up to ${MAX_EVENT_DAYS} days.` };
    }
    return { kind, name, date, endDate: endDate === date ? null : endDate, place: str(body.place, 60) || null, note: str(body.note, 120) || null,
      tbc: !tba && (body.tbc === true || body.tbc === 'on' || body.tbc === '1') ? 1 : 0, whenText: tba ? (str(body.whenText, 40) || null) : null };
  }
  const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const whenOf = (e) => (!e.date ? (e.whenText ? `${e.whenText} (date to be announced)` : 'date to be announced')
    : `${(e.endDate || e.end_date) && (e.endDate || e.end_date) !== e.date ? `${fmtDay(e.date)} to ${fmtDay(e.endDate || e.end_date)}` : fmtDay(e.date)}${e.tbc ? ' (to be confirmed)' : ''}`);

  api.post('/events', requireReview, (req, res) => {
    const f = eventFields(req.body);
    if (f.error) return res.status(400).json({ error: f.error });
    const { lastInsertRowid } = db.prepare('INSERT INTO events (date, end_date, kind, name, place, note, tbc, when_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.date, f.endDate, f.kind, f.name, f.place, f.note, f.tbc, f.whenText);
    // A new tournament is news for everyone: an announcement in the feed, and on phones.
    if (f.kind === 'tournament') {
      const when = whenOf(f);
      const title = `New tournament: ${f.name}`;
      const body = `${when}. JHMMC captains: enter your boat and list your anglers in the app (Leaderboard → Tournaments).`;
      db.prepare('INSERT INTO announcements (user_id, title, body) VALUES (?, ?, ?)').run(req.user.id, title, body);
      pushToEveryone({ title: `JHMMC: ${title}`, body: when, url: '/#/calendar' }, req.user);
    }
    res.status(201).json({ event: { id: Number(lastInsertRowid), ...f } });
  });

  // Change one (the dates move a lot). A change of date or place to something in the next two
  // weeks (before or after) is told to everyone: in the feed and on phones.
  api.patch('/events/:id', requireReview, (req, res) => {
    const id = intId(req.params.id);
    const was = db.prepare('SELECT * FROM events WHERE id = ?').get(id ?? 0);
    if (!was) return res.status(404).json({ error: 'Not on the calendar.' });
    const f = eventFields({ kind: was.kind === 'holiday' ? 'event' : was.kind, ...req.body });
    if (f.error) return res.status(400).json({ error: f.error });
    db.prepare('UPDATE events SET date = ?, end_date = ?, kind = ?, name = ?, place = ?, note = ?, tbc = ?, when_text = ? WHERE id = ?')
      .run(f.date, f.endDate, f.kind, f.name, f.place, f.note, f.tbc, f.whenText, id);
    const moved = was.date !== f.date || (was.end_date || null) !== f.endDate || (was.place || null) !== f.place || !!was.tbc !== !!f.tbc;
    const soon = (d) => d && Date.parse(`${d}T23:59:59Z`) >= Date.now() - 864e5 && Date.parse(`${d}T00:00:00Z`) <= Date.now() + 14 * 864e5;
    if (moved && (soon(was.date) || soon(f.date))) {
      const where = f.place ? ` · ${f.place}` : '';
      const title = `${f.name}: ${f.date ? 'new date' : 'date to be announced'}`;
      const body = `Now ${whenOf(f)}${where}${was.date ? ` (was ${whenOf(was)})` : ''}.`;
      db.prepare('INSERT INTO announcements (user_id, title, body) VALUES (?, ?, ?)').run(req.user.id, title, body);
      pushToEveryone({ title: `JHMMC: ${title}`, body, url: '/#/calendar' }, req.user);
    }
    res.json({ event: eventOut(db.prepare(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`).get(id)) });
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
    const wasStart = setting('season_start'); const wasEnd = setting('season_end');
    if (wasStart !== start || wasEnd !== end) {
      db.prepare('INSERT INTO announcements (user_id, title, body) VALUES (?, ?, ?)').run(req.user.id, 'Season dates changed',
        `${req.user.name} changed the season from ${wasStart} – ${wasEnd} to ${start} – ${end}.`);
    }
    set.run('season_start', start);
    set.run('season_end', end);
    res.json({ season: { start, end } });
  });

  // Scoring table: points per kg for each species.
  api.patch('/species/:id', requireReview, (req, res) => {
    const points = Number(req.body.pointsPerKg);
    if (!Number.isFinite(points) || points < 0 || points > 100) return res.status(400).json({ error: 'Points per kg must be between 0 and 100.' });
    const was = db.prepare('SELECT name, points_per_kg AS p FROM species WHERE id = ?').get(intId(req.params.id) ?? 0);
    const r = db.prepare('UPDATE species SET points_per_kg = ? WHERE id = ?').run(points, intId(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Species not found.' });
    // Points concern everyone: said in the feed, by name.
    if (was.p !== points) {
      db.prepare('INSERT INTO announcements (user_id, title, body) VALUES (?, ?, ?)').run(req.user.id, 'Scoring table changed',
        `${req.user.name} changed ${was.name} from ${was.p} to ${points} points per kg.`);
    }
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
      ORDER BY k.caught_on DESC, k.id DESC`).all({ ...params, ...(team ? { team } : { angler }) });
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
    // The biggest fish weighed in, heaviest first (released fish have no weight).
    const biggest = db.prepare(`
      SELECT k.id, sp.name AS species, k.weight_kg AS weightKg, k.points, t.id AS teamId, t.name AS teamName,
        u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler
      ${base.replace('JOIN teams t ON t.id = k.team_id', 'JOIN teams t ON t.id = k.team_id JOIN species sp ON sp.id = k.species_id LEFT JOIN users u ON u.id = k.user_id')}
        AND k.weight_kg > 0
      ORDER BY k.weight_kg DESC, k.id LIMIT 20
    `).all(params);
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
    res.json({ division, scope, board, season: { start, end }, boats, biggest, tournaments, pending });
  });

  // A boat's, an angler's or a guest angler's page (a name typed at the weigh-in,
  // no account): their approved fish (to show off), with the highlights: fish
  // weighed, releases, the biggest, and the season points and place: the JHMMC
  // Season table for a JHMMC boat, else All of West Africa (the boat's division).
  api.get('/trophies', (req, res) => {
    const team = intId(req.query.team);
    const user = intId(req.query.user);
    const guest = !team && !user ? str(req.query.angler, 80) : null;
    if (!team && !user && !guest) return res.status(400).json({ error: 'Choose a boat or an angler.' });
    const whose = team ? 'k.team_id = :who' : user ? 'k.user_id = :who' : 'k.user_id IS NULL AND lower(k.angler_name) = lower(:who)';
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.status = 'approved' AND ${whose}
      ORDER BY k.caught_on DESC, k.id DESC`).all({ who: team || user || guest });
    const fish = rows.map((r) => {
      const c = present(r, req.user);
      return { id: c.id, species: c.species, speciesId: c.speciesId, weightKg: c.weightKg, released: c.released, points: c.points,
        caughtOn: c.caughtOn, angler: c.angler, userId: c.userId, teamName: c.teamName, photoUrl: c.photoUrl, ownPhoto: c.ownPhoto, canAddPhoto: c.canAddPhoto };
    });
    // The boat that decides the table: the boat itself, the angler's boat, or the guest's latest.
    const boat = team
      ? db.prepare('SELECT division, club_id FROM teams WHERE id = ?').get(team)
      : user ? db.prepare('SELECT t.division, t.club_id FROM users u JOIN teams t ON t.id = u.team_id WHERE u.id = ?').get(user)
        : db.prepare('SELECT t.division, t.club_id FROM teams t WHERE t.id = ?').get(rows[0]?.teamId ?? 0);
    // On a boat's page only: fish logged at sea with a photo (boated or released), unless the crew hid them,
    // and not already here as a weighed fish. Never the spot; never any points.
    const logged = !team ? [] : db.prepare(`SELECT l.id, s.name AS species, s.id AS speciesId, l.fate, l.weight_kg AS estimateKg, o.date AS caughtOn,
        l.photo, COALESCE(NULLIF(u.nickname, ''), u.name) AS angler, l.user_id AS userId, COALESCE(t.name, o.boat) AS teamName
      FROM outing_landings l JOIN outings o ON o.id = l.outing_id JOIN species s ON s.id = l.species_id
        LEFT JOIN users u ON u.id = l.user_id LEFT JOIN teams t ON t.id = o.team_id
      WHERE l.photo IS NOT NULL AND l.on_profile = 1 AND l.fate IN ('kept', 'released') AND COALESCE(l.client_id, '') NOT LIKE 'reg-%'
        AND NOT EXISTS (SELECT 1 FROM catches k WHERE k.id = l.catch_id AND k.status = 'approved')
        AND o.team_id = :who
      ORDER BY o.date DESC, l.id DESC`).all({ who: team }).map((l) => ({
      id: l.id, logged: true, species: l.species, speciesId: l.speciesId, released: l.fate === 'released', fate: l.fate,
      estimateKg: l.fate === 'released' ? l.estimateKg : null, caughtOn: l.caughtOn, angler: l.angler, userId: l.userId,
      teamName: l.teamName, photoUrl: photoUrl(l.photo), points: null,
    }));
    const division = boat?.division;
    const jhmmc = !!boat && boat.club_id === homeClubId();
    const { base, params } = pointsFilter({ division, board: jhmmc ? 'jhmmc' : 'all' });
    const key = "COALESCE('u' || k.user_id, 'n' || lower(k.angler_name))";
    const table = team
      ? db.prepare(`SELECT t.id AS who, ROUND(SUM(k.points), 1) AS points ${base} GROUP BY t.id ORDER BY points DESC`).all(params)
      : db.prepare(`SELECT ${key} AS who, ROUND(SUM(k.points), 1) AS points ${base} GROUP BY ${key} ORDER BY points DESC`).all(params);
    const me = team || (user ? `u${user}` : `n${guest.toLowerCase()}`);
    const at = table.findIndex((x) => x.who === me);
    const biggest = fish.filter((f) => f.weightKg).sort((a, b) => b.weightKg - a.weightKg)[0] ?? null;
    const all = [...fish, ...logged].sort((x, y) => (y.caughtOn > x.caughtOn ? 1 : y.caughtOn < x.caughtOn ? -1 : 0));
    res.json({
      fish: all,
      stats: {
        weighed: fish.filter((f) => !f.released).length,
        logged: logged.length,
        releases: all.filter((f) => f.released).length,
        points: at >= 0 ? table[at].points : 0,
        place: at >= 0 ? at + 1 : null,
        division: division === 'river' ? 'river' : 'ocean',
        board: jhmmc ? 'jhmmc' : 'all',
      },
      biggest,
    });
  });

  // One tournament's results: boats ranked, with their approved catches.
  api.get('/tournaments/:id', (req, res) => {
    const event = db.prepare(`SELECT id, date, COALESCE(end_date, date) AS endDate, name FROM events WHERE id = ? AND kind = 'tournament'`).get(intId(req.params.id));
    if (!event) return res.status(404).json({ error: 'Tournament not found.' });
    const division = req.query.division === 'river' ? 'river' : 'ocean';
    // Only boats entered in the tournament compete in it; others fishing that day score for the season only.
    const rows = db.prepare(`${CATCH_SELECT} WHERE k.caught_on BETWEEN :date AND :endDate AND t.division = :division AND k.status = 'approved'
      AND k.club_id = :home AND k.team_id IN (SELECT team_id FROM tournament_entries WHERE event_id = :event)
      ORDER BY k.points DESC`).all({ date: event.date, endDate: event.endDate, division, home: homeClubId(), event: event.id });
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

  return { suggestPoints };
};
