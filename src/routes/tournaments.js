'use strict';

// Club membership and tournament registration. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    CLUB_ZONE, api, canHandleMoney, canReview, canWeigh, dateIn, db, homeClubId, intId, isAdminUser,
    pushWhere, requireMoney, requireReview, requireWeigh, setting, str
  } = ctx;

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

  api.get('/club-members', requireMoney, (req, res) => {
    const season = { start: setting('season_start'), end: setting('season_end') };
    const people = db.prepare(`SELECT u.id, u.name, u.nickname, u.email, u.role, t.name AS teamName,
        EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = u.id AND m.season = ?) AS paid
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.jhmmc = 1 ORDER BY u.name COLLATE NOCASE`).all(season.start)
      .map((p) => ({ ...p, paid: !!p.paid, isAdmin: isAdminUser(p) }));
    const named = db.prepare(`SELECT p.id, p.name, p.team_id AS teamId, t.name AS teamName,
        EXISTS (SELECT 1 FROM club_people_paid c WHERE c.person_id = p.id AND c.season = ?) AS paid
      FROM club_people p LEFT JOIN teams t ON t.id = p.team_id ORDER BY p.name COLLATE NOCASE`).all(season.start)
      .map((p) => ({ ...p, paid: !!p.paid }));
    // Everyone else with an account, for the secretary to add to JHMMC: he knows who's a member.
    const others = canReview(req.user) ? db.prepare(`SELECT u.id, u.name, u.nickname, u.email, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.jhmmc = 0 ORDER BY u.name COLLATE NOCASE`).all() : [];
    res.json({ season, people, named, others, canSetMembers: canReview(req.user) });
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
    // Everyone on this list is in JHMMC (people without an account are added by the club).
    res.json({ ok: true, paid: !!req.body.paid, member: true });
  });

  api.delete('/club-members/named/:id', requireMoney, (req, res) => {
    db.prepare('DELETE FROM club_people WHERE id = ?').run(intId(req.params.id) ?? 0);
    res.json({ ok: true });
  });

  api.put('/club-members/:userId', requireMoney, (req, res) => {
    const user = db.prepare('SELECT id, name, email, jhmmc FROM users WHERE id = ?').get(intId(req.params.userId) ?? 0);
    if (!user) return res.status(404).json({ error: 'Member not found.' });
    // The secretary (and the officers) say who is a JHMMC member: he knows them.
    if ('member' in req.body) {
      if (!canReview(req.user)) return res.status(403).json({ error: 'Only the secretary says who is a JHMMC member.' });
      if (!req.body.member && isAdminUser(user)) return res.status(400).json({ error: 'The admin stays a JHMMC member.' });
      if (!req.body.member && !isAdminUser(req.user) && db.prepare('SELECT role FROM users WHERE id = ?').get(user.id).role) {
        return res.status(403).json({ error: `${user.name} is a club officer: only the admin can take them out of JHMMC.` });
      }
      db.prepare('UPDATE users SET jhmmc = ? WHERE id = ?').run(req.body.member ? 1 : 0, user.id);
      user.jhmmc = req.body.member ? 1 : 0;
      if (!req.body.member) req.body.paid = false;
      else if (!('paid' in req.body)) return res.json({ ok: true, member: true });
    }
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
  const clubToday = () => dateIn(CLUB_ZONE);

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
        ...t, open: t.endDate >= clubToday(), mine: myTeam ? isEntered(t.id, myTeam) : false,
        ...(official && { anglers, guests, unpaid }),
      })),
    });
  });

  // The secretary's desk: what waits for him, what needs attention, today's
  // weigh-ins, the next tournament and his own last changes.
  api.get('/desk', requireReview, (req, res) => {
    const waiting = db.prepare(`SELECT k.id, s.name AS species, k.weight_kg AS weightKg, k.released, k.weigh_station AS station,
        k.created_at AS createdAt, t.name AS boat, (SELECT COUNT(*) FROM disputes d WHERE d.catch_id = k.id) AS disputes
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'pending_review' ORDER BY k.created_at`).all();
    const stations = {};
    for (const w of waiting) stations[w.station || 'No station'] = (stations[w.station || 'No station'] || 0) + 1;
    // created_at is SQLite's "YYYY-MM-DD HH:MM:SS" (UTC); compare like for like.
    const dayAgo = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const disputed = waiting.filter((w) => w.disputes).map((w) => ({
      ...w, last: db.prepare(`SELECT d.reason, d.created_at AS at, COALESCE(t.name, u.name) AS by FROM disputes d JOIN users u ON u.id = d.user_id
        LEFT JOIN teams t ON t.id = u.team_id WHERE d.catch_id = ? ORDER BY d.id DESC LIMIT 1`).get(w.id),
    }));
    const old = waiting.filter((w) => !w.disputes && w.createdAt < dayAgo);
    const today = clubToday();
    const weighedToday = db.prepare("SELECT COUNT(*) AS n FROM catches WHERE status <> 'unofficial' AND date(created_at) = ?").get(today).n;
    const next = db.prepare(`SELECT e.id, e.name, e.date, (SELECT COUNT(*) FROM tournament_entries te WHERE te.event_id = e.id) AS boats
      FROM events e WHERE e.kind = 'tournament' AND COALESCE(e.end_date, e.date) >= ? ORDER BY e.date LIMIT 1`).get(today) ?? null;
    const mine = db.prepare('SELECT action, created_at AS at FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(req.user.id);
    res.json({ toReview: waiting.length, stations, disputed, old, weighedToday, next, mine });
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
      anglers: listAnglers(event.id, team.id), open: event.endDate >= clubToday() });
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
    if (!official && event.endDate < clubToday()) return res.status(400).json({ error: 'This tournament is over; ask the secretary for changes.' });
    if (!req.body.entered) {
      db.prepare('DELETE FROM tournament_entries WHERE event_id = ? AND team_id = ?').run(event.id, team.id);
      db.prepare('DELETE FROM tournament_anglers WHERE event_id = ? AND team_id = ?').run(event.id, team.id);
      if (official && team.captainId && team.captainId !== req.user.id) {
        pushWhere('myFish', { title: event.name, body: `${req.user.name} took your boat out of the tournament.`, url: `/#/tournament/${event.id}` },
          req.user, (p) => p.id === team.captainId);
      }
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
    // The secretary entered the boat or set its anglers: the captain hears about it.
    if (official && team.captainId && team.captainId !== req.user.id) {
      const list = listAnglers(event.id, team.id).map((a) => a.name);
      pushWhere('myFish', {
        title: event.name,
        body: anglers ? `${req.user.name} set your boat's anglers: ${list.join(', ') || 'none'}.` : `${req.user.name} entered your boat.`,
        url: `/#/tournament/${event.id}`,
      }, req.user, (p) => p.id === team.captainId);
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

  return {  };
};
