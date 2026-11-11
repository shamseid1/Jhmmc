'use strict';

// Catches: the feed, a catch, posting and deleting. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    COUNTRIES, LINE_CLASSES, WEIGH_STATIONS, api, bool, canApprove, canHandleMoney, canReview, canWeigh,
    dateIn, db, discardUploads, homeClubId, igfa, intId, isAdminUser, markWeighed, notifyReviewers, num,
    photoUrl, str, throughJhmmc, weighRole, weighmasterAt, zoneOf
  } = ctx;
  // From a later part, reached when it's called.
  const bump = (...args) => ctx.bump(...args);
  // From a later part, reached when it's called.
  const deviceSpot = (...args) => ctx.deviceSpot(...args);
  // From a later part, reached when it's called.
  const getCatch = (...args) => ctx.getCatch(...args);
  // From a later part, reached when it's called.
  const logRegistration = (...args) => ctx.logRegistration(...args);
  // From a later part, reached when it's called.
  const postPhotos = (...args) => ctx.postPhotos(...args);
  // From a later part, reached when it's called.
  const scoreRegistration = (...args) => ctx.scoreRegistration(...args);
  // From a later part, reached when it's called.
  const sheetProblem = (...args) => ctx.sheetProblem(...args);

  // ---- catches -----------------------------------------------------------

  const CATCH_SELECT = `
    SELECT k.id, k.weight_kg AS weightKg, k.length_cm AS lengthCm, k.released, k.tagged,
      k.caught_on AS caughtOn, k.country, k.location, k.line_class AS lineClass,
      k.notes, k.photo, k.video, k.scale_video AS scaleVideo, k.created_at AS createdAt, k.logged_by AS loggedBy,
      k.lat, k.lng, k.spot_public AS spotPublic, k.no_angler AS noAngler,
      k.status, k.weigh_station AS weighStation, k.scale_photo AS scalePhoto, k.points, k.points_note AS pointsNote,
      k.weigh_role AS weighRole, k.weigh_reason AS weighReason, (SELECT u.name FROM users u WHERE u.id = k.weighed_by) AS weighedByName, u.name AS anglerFullName,
      t.division,
      s.id AS speciesId, s.name AS species, s.category,
      u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler,
      t.id AS teamId, t.name AS teamName,
      c.id AS clubId, c.name AS clubName
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

  // A weighed fish's pictures: the weigh station photo, and the crew's own if
  // they add one later, which then comes first (the weigh station's second). A video of
  // a fish on the scale is evidence: the secretary, JHMMC captains (to dispute),
  // the boat's crew and whoever registered it. A release video shows to everyone
  // once the secretary has approved the fish. The log photo stays on the "boated" line.
  const seesEvidence = (row, viewer) => !!viewer && (canWeigh(viewer) || canReview(viewer) || viewer.teamId === row.teamId || row.loggedBy === viewer.id);
  const seesVideo = seesEvidence;
  const canAddFeedPhoto = (row, viewer) => !!viewer && row.status !== 'unofficial' && row.status !== 'rejected'
    && (viewer.teamId === row.teamId || row.userId === viewer.id || row.loggedBy === viewer.id || isAdminUser(viewer));

  function present(row, viewer) {
    const showSpot = row.lat != null && canSeeSpot(row, viewer);
    const official = row.status !== 'unofficial';
    const photos = official ? [row.photo, row.scalePhoto].filter(Boolean).map((f) => ({ url: photoUrl(f) })) : postPhotos('catch', row.id, row.photo);
    const releaseVideo = !!row.released && row.status === 'approved';
    const video = releaseVideo || seesVideo(row, viewer);
    return {
      ...row,
      lat: showSpot ? row.lat : null,
      lng: showSpot ? row.lng : null,
      spotPublic: !!row.spotPublic,
      hasSpot: row.lat != null,
      released: !!row.released,
      tagged: !!row.tagged,
      noAngler: !!row.noAngler,
      photoUrl: photos[0]?.url ?? null,
      photos,
      // Shown with the photos: a post's own video, or the release video.
      videoUrl: photoUrl(row.video || (row.released && video ? row.scaleVideo : null)),
      canEdit: row.status === 'unofficial' && canDelete(row, viewer),
      scalePhotoUrl: photoUrl(row.scalePhoto),
      ownPhoto: official && !!row.photo,
      canAddPhoto: canAddFeedPhoto(row, viewer),
      scaleVideoUrl: video ? photoUrl(row.scaleVideo) : null,
      weighReason: seesEvidence(row, viewer) ? row.weighReason : null,
      // The angler's real name, for the club officers' screens (everyone else sees the nickname).
      anglerFullName: viewer && (canReview(viewer) || canHandleMoney(viewer)) ? row.anglerFullName : null,
      canDelete: canDelete(row, viewer),
      worldRecordKg: igfa.igfaRecord(row.species)?.kg ?? null,
    };
  }

  api.get('/catches', (req, res) => {
    const where = [];
    const params = {};
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
    const station = canApprove(user) ? pick || boatStation : boatStation || pick;
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
  function checkCatch(user, b, { photo: file, video, feed } = {}, { teamId, official }) {
    const team = db.prepare('SELECT club_id, country, captain_id, weigh_station, home_port FROM teams WHERE id = ?').get(teamId);
    if (!team) return { error: 'Choose the boat.' };
    const jhmmcBoat = team.club_id === homeClubId();
    if (official && !throughJhmmc(team.club_id)) return { error: "This boat's club weighs its own fish." };
    const wmStation = official && !canApprove(user) && team.captain_id !== user.id && jhmmcBoat ? weighmasterAt(user) : null;
    if (wmStation && team.weigh_station !== wmStation) {
      return { error: `As weighmaster at ${wmStation} you weigh the boats registered at ${wmStation}.` };
    }
    const asWeighmaster = wmStation;
    if (official && !canApprove(user) && team.captain_id !== user.id && !asWeighmaster) {
      return { error: "Captains register their own boat's fish only; the station's weighmaster weighs the others." };
    }
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
    // A post's date is optional: today unless said otherwise (the boat's own day).
    const boatToday = dateIn(zoneOf(team.country));
    const caughtOn = str(b.caughtOn, 10) || (official ? null : boatToday);
    if (!caughtOn || !/^\d{4}-\d{2}-\d{2}$/.test(caughtOn) || Number.isNaN(Date.parse(caughtOn))) {
      return { error: 'Enter the date of the catch.' };
    }
    if (Date.parse(caughtOn) > Date.now() + 864e5) return { error: 'Catch date cannot be in the future.' };
    // Weigh-ins are on the day, on the boat's clock: today only.
    // The secretary may enter an earlier day's paper form.
    if (official && !canApprove(user) && caughtOn !== boatToday) {
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
        // A weighmaster weighs at his own station.
        const s = asWeighmaster ? { station: asWeighmaster } : stationFor(user, str(b.weighStation, 40), team.weigh_station);
        if (s.error) return s;
        station = s.station;
      } else {
        station = team.home_port || (team.country ? `${team.country} weigh station` : 'Weigh station');
      }
      if (!released && weightKg === null) return { error: 'Enter the official weight.' };
      // A photo for every fish (the picture on the feed and the profiles); a video is optional.
      if (!file) return { error: released ? 'Add a photo of the release.' : 'Add a photo of the fish hanging on the scale, with the weight readable.' };
    }
    const weighed = official && !released;
    // Crew posts are for the feed only; registrations go to the secretary.
    return {
      noAngler,
      values: [
        anglerId, anglerName, user.id, teamId, team.club_id, speciesId, weightKg, lengthCm, released,
        bool(b.tagged), caughtOn, country, str(b.location, 120), lineClass, str(b.notes, 2000),
        official ? feed?.filename ?? null : file?.filename ?? null, official ? 'pending_review' : 'unofficial', station,
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
    const weigher = opts.official ? weighRole(req.user, opts.teamId, req.body) : null;
    if (weigher?.error) {
      discardUploads(req);
      return res.status(400).json({ error: weigher.error });
    }
    const id = insertCatchRow(checked.values);
    if (checked.noAngler) db.prepare('UPDATE catches SET no_angler = 1 WHERE id = ?').run(id);
    if (opts.official) {
      markWeighed([id], weigher);
      linkRegistrationToLog(id);
      scoreRegistration(id);
      logRegistration(id, 'registered', req.user, { where: deviceSpot(req.body) });
      notifyReviewers(opts.teamId, 1, req.user);
    }
    res.status(201).json({ catch: getCatch(id, req.user) });
  }

  return { CATCH_SELECT, checkCatch, insertCatch, insertCatchRow, linkLogToRegistration, linkRegistrationToLog, present, readSpot, unlogRegistration };
};
