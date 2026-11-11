'use strict';

// The admin: members, roles, accounts, backups. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    ROLES, WEIGH_STATIONS, adminEmail, api, auth, backups, baseUrl, bool, db, discardUploads, getMe,
    homeClubId, intId, isAdminUser, mailer, pushWhere, removeUpload, requireApprove, str, upload, withVideo
  } = ctx;
  // From a later part, reached when it's called.
  const getCatch = (...args) => ctx.getCatch(...args);
  // From a later part, reached when it's called.
  const linkRegistrationToLog = (...args) => ctx.linkRegistrationToLog(...args);
  // From a later part, reached when it's called.
  const logRegistration = (...args) => ctx.logRegistration(...args);
  // From a later part, reached when it's called.
  const savePhoto = (...args) => ctx.savePhoto(...args);
  // From a later part, reached when it's called.
  const snapshot = (...args) => ctx.snapshot(...args);
  // From a later part, reached when it's called.
  const suggestPoints = (...args) => ctx.suggestPoints(...args);
  // From a later part, reached when it's called.
  const unlogRegistration = (...args) => ctx.unlogRegistration(...args);

  // ---- admin -------------------------------------------------------------

  const ADMIN_LINK_HOURS = 24;

  function requireAdmin(req, res, next) {
    if (!adminEmail || req.user?.email?.toLowerCase() !== adminEmail) {
      return res.status(403).json({ error: 'Only the club admin can do that.' });
    }
    next();
  }

  // The secretary fixes a registration's species, angler or weigh-station photo,
  // waiting or approved, with a note. The points follow from the rules; the
  // captain is told; the record keeps what it was.
  api.post('/catches/:id/correct', requireApprove, withVideo('scalePhoto', 'scaleVideo'), (req, res) => {
    const id = intId(req.params.id);
    const k = id && db.prepare('SELECT id, status, team_id, species_id, user_id, angler_name, logged_by FROM catches WHERE id = ?').get(id);
    const fail = (code, error) => { discardUploads(req); return res.status(code).json({ error }); };
    if (!k) return fail(404, 'Catch not found.');
    if (!['pending_review', 'approved'].includes(k.status)) return fail(400, 'Only a fish waiting or approved can be corrected.');
    const note = str(req.body.note, 300);
    if (!note) return fail(400, 'Add a note: what was wrong.');
    const speciesId = req.body.speciesId ? intId(req.body.speciesId) : k.species_id;
    if (!speciesId || !db.prepare('SELECT 1 FROM species WHERE id = ?').get(speciesId)) return fail(400, 'Choose the species.');
    let userId = k.user_id; let anglerName = k.angler_name;
    if (req.body.anglerId === 'other') {
      anglerName = str(req.body.anglerName, 80);
      if (!anglerName) return fail(400, "Type the angler's name.");
      userId = null;
    } else if (req.body.anglerId) {
      userId = intId(req.body.anglerId);
      if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ? AND team_id IS ?').get(userId, k.team_id)) return fail(400, "Choose one of the boat's crew.");
      anglerName = null;
    }
    const photo = req.files?.scalePhoto?.[0]?.filename ?? null;
    const before = snapshot(id);
    const changed = [speciesId !== k.species_id && 'species', (userId !== k.user_id || anglerName !== k.angler_name) && 'angler', photo && 'photo'].filter(Boolean);
    if (!changed.length) return fail(400, 'Nothing changed.');
    db.exec('BEGIN');
    try {
      // The old photo stays on file: the registration record keeps it as evidence.
      db.prepare('UPDATE catches SET species_id = ?, user_id = ?, angler_name = ?, scale_photo = COALESCE(?, scale_photo) WHERE id = ?')
        .run(speciesId, userId, anglerName, photo, id);
      if (speciesId !== k.species_id) {
        // A different fish for the log: let go of the old link and find the right one.
        unlogRegistration(id);
        db.prepare('UPDATE outing_landings SET catch_id = NULL WHERE catch_id = ?').run(id);
        linkRegistrationToLog(id);
      }
      const s = suggestPoints(id);
      db.prepare('UPDATE catches SET points = ?, points_note = ? WHERE id = ?').run(s.points, s.note, id);
      const after = snapshot(id);
      const what = [changed.includes('species') && `species ${before.species} to ${after.species}`,
        changed.includes('angler') && `angler ${before.angler} to ${after.angler}`, changed.includes('photo') && 'new weigh-station photo'].filter(Boolean).join(', ');
      logRegistration(id, 'repointed', req.user, { note: `Corrected ${what}: ${note}` });
      db.exec('COMMIT');
      pushWhere('myFish', {
        title: 'Fish corrected',
        body: `The secretary corrected your ${before.species}: ${what}. ${note}`,
        url: `/#/catch/${id}`,
      }, req.user, (p) => p.id === k.logged_by);
    } catch (err) {
      db.exec('ROLLBACK');
      discardUploads(req);
      throw err;
    }
    res.json({ catch: getCatch(id, req.user) });
  });

  // Weighmasters: JHMMC members the secretary appoints (a captain, the treasurer...), one weigh station each,
  // who weigh the boats registered at that station.
  api.get('/weighmasters', requireApprove, (_req, res) => {
    // Officers' pages use real names; the nickname comes alongside.
    const members = db.prepare(`SELECT u.id, u.name, NULLIF(u.nickname, '') AS nickname, u.role, t.name AS boat, t.captain_id = u.id AS captain, u.weigh_station AS station
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.jhmmc = 1 OR u.weigh_station IS NOT NULL
      ORDER BY u.weigh_station IS NULL, u.name COLLATE NOCASE`).all().map((m) => ({ ...m, captain: !!m.captain }));
    res.json({ members, stations: WEIGH_STATIONS });
  });
  api.put('/weighmasters/:userId', requireApprove, (req, res) => {
    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(intId(req.params.userId) ?? 0);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    const station = req.body?.station || null;
    if (station && !WEIGH_STATIONS.includes(station)) return res.status(400).json({ error: 'Unknown weigh station.' });
    if (station && !db.prepare('SELECT jhmmc FROM users WHERE id = ?').get(user.id).jhmmc) {
      return res.status(400).json({ error: `${user.name} isn't a JHMMC member. Add them to JHMMC first.` });
    }
    db.prepare('UPDATE users SET weigh_station = ? WHERE id = ?').run(station, user.id);
    res.json({ ok: true, station });
  });

  // Backups of the database (the admin only): the list, one now, and downloads.
  api.get('/admin/backups', requireAdmin, (_req, res) => {
    res.json({ backups: backups.list(), emailOn: backups.emailOn });
  });
  api.post('/admin/backups', requireAdmin, async (req, res) => {
    const b = backups.make();
    let emailed = false;
    if (req.body?.email) {
      try {
        emailed = await backups.email(b);
      } catch (err) {
        console.error('Backup email failed:', err.message);
        // 424, not 502: the app reads 502 as 'the server is restarting' and would hide this message.
        return res.status(424).json({ error: `Backup made, but the email failed: ${err.message}`, backup: b });
      }
    }
    res.status(201).json({ backup: b, emailed });
  });
  api.get('/admin/backups/:name', requireAdmin, (req, res) => {
    const file = backups.file(req.params.name);
    if (!file) return res.status(404).json({ error: 'Backup not found.' });
    res.download(file);
  });

  // Everyone with an account: the admin, and the secretary (he says who is in JHMMC).
  api.get('/admin/users', requireApprove, (_req, res) => {
    const users = db.prepare(`
      SELECT u.id, u.name, u.first_name AS firstName, u.last_name AS lastName, u.nickname, u.email, u.role, u.jhmmc,
        u.created_at AS joinedAt, u.team_id AS teamId, t.name AS teamName
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

  // The admin fixes a member's account: first and last name, email, boat. Only these:
  // a password is never the admin's to know or set (that's the reset link), and the
  // nickname, bio, photo and choices are the member's own. The change is in the
  // activity log; the member is told on their phone, and at the old address if the
  // email changed, so nothing happens behind their back.
  api.patch('/admin/users/:id/account', requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const cur = id && db.prepare(`SELECT u.id, u.name, u.first_name AS first, u.last_name AS last, u.email, u.team_id AS teamId, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?`).get(id);
    if (!cur) return res.status(404).json({ error: 'Member not found.' });
    const b = req.body;
    const first = 'firstName' in b ? str(b.firstName, 40) : cur.first;
    const last = 'lastName' in b ? str(b.lastName, 40) : cur.last;
    const email = 'email' in b ? str(b.email, 120)?.toLowerCase() : cur.email;
    const teamId = 'teamId' in b ? (b.teamId === '' || b.teamId === null ? null : intId(b.teamId)) : cur.teamId;
    if (!first || !last) return res.status(400).json({ error: 'Write their first name and their last name.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Write a valid email.' });
    if (email !== cur.email && isAdminUser(cur)) return res.status(400).json({ error: "The admin's email is set on the server (ADMIN_EMAIL); it can't be changed here." });
    if (email !== cur.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, id)) {
      return res.status(409).json({ error: 'Another account already uses that email.' });
    }
    if ('teamId' in b && b.teamId !== '' && b.teamId !== null && !teamId) return res.status(400).json({ error: 'Choose a boat from the list.' });
    const team = teamId && db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId);
    if (teamId && !team) return res.status(400).json({ error: 'Choose a boat from the list.' });

    const changes = [];
    const name = `${first} ${last}`;
    if (name !== cur.name || first !== cur.first || last !== cur.last) changes.push(`name from ${cur.name} to ${name}`);
    if (email !== cur.email) changes.push(`email from ${cur.email} to ${email}`);
    if ((teamId ?? null) !== (cur.teamId ?? null)) changes.push(`boat from ${cur.teamName || 'none'} to ${team?.name || 'none'}`);
    if (!changes.length) return res.json({ ok: true, changes });
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE users SET name = ?, first_name = ?, last_name = ?, email = ?, team_id = ? WHERE id = ?').run(name, first, last, email, teamId ?? null, id);
      // Moved off a boat they captained: the longest-serving crew member takes over (or nobody, if none is left).
      if (cur.teamId && cur.teamId !== teamId) {
        const old = db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(cur.teamId);
        if (old?.captain_id === id) {
          const next = db.prepare('SELECT id FROM users WHERE team_id = ? ORDER BY id LIMIT 1').get(cur.teamId);
          db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(next?.id ?? null, cur.teamId);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const said = changes.map((c) => c[0].toUpperCase() + c.slice(1)).join('. ');
    pushWhere('review', { title: 'Your account was updated', body: `The club admin changed your ${changes.map((c) => c.split(' from ')[0]).join(', ')}.`, url: '/#/profile' },
      req.user, (p) => p.id === id, true);
    if (email !== cur.email) {
      mailer.send({
        to: cur.email,
        subject: 'Your Africa Sportfishing email was changed',
        text: `Hello ${cur.name},\n\nThe club admin changed the email of your Africa Sportfishing account to ${email}. ` +
          `From now on, sign in and reset your password with that address.\n\nIf you didn't ask for this, reply to this email or tell your club.\n`,
      }).catch((err) => console.error('Email-changed email failed:', err.message));
    }
    res.json({ ok: true, changes: said });
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
  // The admin and the secretary (he runs everything JHMMC): a boat's weigh station and Ocean/River.
  api.patch('/admin/teams/:id', requireApprove, (req, res) => {
    const team = db.prepare('SELECT id, club_id AS clubId, weigh_station AS station, division FROM teams WHERE id = ?')
      .get(intId(req.params.id) ?? 0);
    if (!team) return res.status(404).json({ error: 'Boat not found.' });
    if ('weighStation' in req.body && team.clubId !== homeClubId()) return res.status(400).json({ error: 'Only JHMMC boats choose a JHMMC weigh station; other boats have their own.' });
    if (!isAdminUser(req.user) && team.clubId !== homeClubId()) return res.status(403).json({ error: "The secretary sets JHMMC boats; ask the admin for this one." });
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
  // Deleting an account. Goes: the account, its sessions and phones, profile photo, comments
  // and likes, and (when members delete their own) their posts. Stays: fish already weighed
  // in for a boat (the season's points can't change), as "Former member" when members delete
  // their own and under their name when the admin does, and the boat's logged trips.
  function deleteAccount(user, { anglerName, removePosts }) {
    const files = [user.photo, ...(!removePosts ? [] : db.prepare(`SELECT photo AS f FROM catches WHERE user_id = :u AND status = 'unofficial'
      UNION ALL SELECT video FROM catches WHERE user_id = :u AND status = 'unofficial'
      UNION ALL SELECT file FROM post_photos WHERE kind = 'catch' AND post_id IN (SELECT id FROM catches WHERE user_id = :u AND status = 'unofficial')
      UNION ALL SELECT photo FROM club_posts WHERE user_id = :u UNION ALL SELECT video FROM club_posts WHERE user_id = :u
      UNION ALL SELECT file FROM post_photos WHERE kind = 'club' AND post_id IN (SELECT id FROM club_posts WHERE user_id = :u)`).all({ u: user.id }).map((r) => r.f))];
    db.exec('BEGIN');
    try {
      if (removePosts) {
        db.prepare("DELETE FROM post_photos WHERE kind = 'catch' AND post_id IN (SELECT id FROM catches WHERE user_id = ? AND status = 'unofficial')").run(user.id);
        db.prepare("DELETE FROM post_photos WHERE kind = 'club' AND post_id IN (SELECT id FROM club_posts WHERE user_id = ?)").run(user.id);
        db.prepare("DELETE FROM catches WHERE user_id = ? AND status = 'unofficial'").run(user.id);
      }
      db.prepare('UPDATE catches SET angler_name = ?, user_id = NULL WHERE user_id = ?').run(anglerName, user.id);
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
    for (const f of files) removeUpload(f);
  }
  const ACCOUNT = 'SELECT id, name, nickname, email, photo, password_hash FROM users WHERE id = ?';

  api.delete('/admin/users/:id', requireAdmin, (req, res) => {
    const user = db.prepare(ACCOUNT).get(intId(req.params.id) ?? 0);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    if (user.id === req.user.id || isAdminUser(user)) return res.status(400).json({ error: "The admin's own account can't be deleted." });
    deleteAccount(user, { anglerName: user.nickname || user.name, removePosts: false });
    res.json({ ok: true, name: user.name });
  });

  // A member deletes their own account (the app stores require it), with their password.
  api.delete('/me', (req, res) => {
    const user = db.prepare(ACCOUNT).get(req.user.id);
    if (isAdminUser(user)) return res.status(400).json({ error: "The admin's account can't be deleted here. Hand the admin role over first." });
    if (!auth.verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      return res.status(400).json({ error: 'Your password is not right.' });
    }
    auth.destroySession(db, req, res);
    deleteAccount(user, { anglerName: 'Former member', removePosts: true });
    res.json({ ok: true });
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

  return { requireAdmin };
};
