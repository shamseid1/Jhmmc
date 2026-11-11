'use strict';

// The activity log of what the officers and the admin change. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    api, canHandleMoney, canReview, db, intId, isAdminUser, setting
  } = ctx;

  // ---- activity log: everything the officers and the admin change -----------
  // Each rule names an officers' route and says, in words, what was done
  // (with what it was before, where that matters). Recorded once the change
  // has gone through; nothing in the app edits or deletes the log.
  const fishName = (id) => db.prepare(`SELECT s.name AS species, k.weight_kg AS kg, k.released, COALESCE(t.name, 'no boat') AS boat,
      COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler
    FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN teams t ON t.id = k.team_id LEFT JOIN users u ON u.id = k.user_id WHERE k.id = ?`).get(intId(id) ?? 0);
  const fishText = (f) => (f ? `${f.boat}'s ${f.species}${f.kg ? ` (${f.kg} kg)` : f.released ? ' (released)' : ''}, angler ${f.angler}` : 'a fish');
  const nameOf = (table, id, col = 'name') => db.prepare(`SELECT ${col} AS n FROM ${table} WHERE id = ?`).get(intId(id) ?? 0)?.n ?? `#${id}`;
  const note = (b) => (b?.note ? `. Note: ${String(b.note).slice(0, 300)}` : '');
  const AUDIT = [
    ['POST', /^\/catches\/(\d+)\/review$/, (m, b, before) => `${{ approve: 'Approved', reject: 'Not counted / rejected', weight: 'Corrected the weight of' }[b.decision] || b.decision} ${fishText(before)}${b.weightKg ? `, weight ${before?.kg} to ${b.weightKg} kg` : ''}${note(b)}`, (m) => fishName(m[1])],
    ['POST', /^\/catches\/(\d+)\/correct$/, (m, b, before) => `Corrected ${fishText(before)}: ${[b.speciesId && `species to ${nameOf('species', b.speciesId)}`, b.anglerId && `angler to ${b.anglerId === 'other' ? b.anglerName : nameOf('users', b.anglerId)}`, 'photo'].filter(Boolean).join(', ')}${note(b)}`, (m) => fishName(m[1])],
    ['DELETE', /^\/catches\/(\d+)$/, (m, b, before) => `Deleted ${fishText(before)}${b?.reason ? `. Reason: ${b.reason}` : ''}`, (m) => fishName(m[1])],
    ['POST', /^\/weigh(\/sheet)?$/, (m, b) => `Sent a weigh-in for ${nameOf('teams', b.teamId)} (${b.caughtOn || 'today'})`],
    ['PATCH', /^\/species\/(\d+)$/, (m, b, before) => `Scoring table: ${before.name} from ${before.p} to ${b.pointsPerKg} points per kg`, (m) => db.prepare('SELECT name, points_per_kg AS p FROM species WHERE id = ?').get(intId(m[1]) ?? 0)],
    ['PATCH', /^\/settings\/season$/, (m, b, before) => `Season dates from ${before.start} – ${before.end} to ${b.start} – ${b.end}`, () => ({ start: setting('season_start'), end: setting('season_end') })],
    ['POST', /^\/events$/, (m, b) => `Added ${b.kind === 'holiday' ? 'a holiday' : 'the tournament'} "${b.name}" (${b.date}${b.endDate && b.endDate !== b.date ? ` to ${b.endDate}` : ''})`],
    ['DELETE', /^\/events\/(\d+)$/, (m, b, before) => `Removed the ${before?.kind || 'event'} "${before?.name}" (${before?.date})`, (m) => db.prepare('SELECT name, kind, date FROM events WHERE id = ?').get(intId(m[1]) ?? 0)],
    ['PUT', /^\/tournaments\/(\d+)\/entries\/(\d+)$/, (m, b) => `${b.entered ? (Array.isArray(b.anglers) ? 'Set the anglers of' : 'Entered') : 'Took'} ${nameOf('teams', m[2])} ${b.entered ? 'in' : 'out of'} "${nameOf('events', m[1])}"${Array.isArray(b.anglers) ? `: ${b.anglers.map((a) => a.name || nameOf(a.userId ? 'users' : 'club_people', a.userId || a.personId)).join(', ') || 'none'}` : ''}`],
    ['PATCH', /^\/tournaments\/(\d+)\/anglers\/(\d+)$/, (m, b) => `Tournament "${nameOf('events', m[1])}": angler entry ${m[2]}${'member' in b ? `, member ${b.member ? 'yes' : 'no'}` : ''}${'paid' in b ? `, paid ${b.paid ? 'yes' : 'no'}` : ''}`],
    ['POST', /^\/announcements$/, (m, b) => `Posted the announcement "${b.title}"`],
    ['DELETE', /^\/announcements\/(\d+)$/, (m, b, before) => `Removed the announcement "${before}"`, (m) => nameOf('announcements', m[1], 'title')],
    ['PUT', /^\/club-members\/(\d+)$/, (m, b) => `Membership: ${nameOf('users', m[1])}${'member' in b ? (b.member ? ' added to JHMMC' : ' removed from JHMMC') : ''}${'paid' in b ? `${'member' in b ? ',' : ''} marked ${b.paid ? 'paid' : 'not paid'}` : ''}`],
    ['POST', /^\/club-members\/named$/, (m, b) => `Membership: added ${b.name}`],
    ['PUT', /^\/club-members\/named\/(\d+)$/, (m, b) => `Membership: changed ${nameOf('club_people', m[1])}${'paid' in b ? `, ${b.paid ? 'paid' : 'not paid'}` : ''}`],
    ['DELETE', /^\/club-members\/named\/(\d+)$/, (m, b, before) => `Membership: removed ${before}`, (m) => nameOf('club_people', m[1])],
    ['PATCH', /^\/admin\/users\/(\d+)$/, (m, b, before) => `Member ${before}: ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join(', ')}`, (m) => nameOf('users', m[1])],
    ['PUT', /^\/weighmasters\/(\d+)$/, (m, b) => (b.station ? `Made ${nameOf('users', m[1])} weighmaster at ${b.station}` : `Took ${nameOf('users', m[1])} off as weighmaster`)],
    ['DELETE', /^\/admin\/users\/(\d+)$/, (m, b, before) => `Deleted the account of ${before}`, (m) => nameOf('users', m[1])],
    ['POST', /^\/admin\/users\/(\d+)\/reset-link$/, (m, b, before) => `Made a password reset link for ${before}`, (m) => nameOf('users', m[1])],
    ['PATCH', /^\/admin\/teams\/(\d+)$/, (m, b, before) => `Boat ${before}: ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join(', ')}`, (m) => nameOf('teams', m[1])],
    ['PATCH', /^\/admin\/clubs\/(\d+)$/, (m, b, before) => `Club ${before}: ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join(', ')}`, (m) => nameOf('clubs', m[1])],
    ['POST', /^\/admin\/club-requests\/(\d+)$/, (m, b, before) => `Club request "${before}": ${b.decision === 'approve' ? 'approved' : 'declined'}`, (m) => nameOf('clubs', m[1])],
  ];
  const officerOrAdmin = (u) => !!u && (canHandleMoney(u) || isAdminUser(u));
  const logActivity = (user, action, details = null) => db.prepare('INSERT INTO activity_log (user_id, user_name, role, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.name, isAdminUser(user) ? 'admin' : user.role || null, action, details);
  api.use((req, res, next) => {
    if (req.method === 'GET' || !officerOrAdmin(req.user)) return next();
    const rule = AUDIT.find(([method, re]) => method === req.method && re.test(req.path));
    if (!rule) return next();
    const m = req.path.match(rule[1]);
    let before = null;
    try {
      before = rule[3] ? rule[3](m) : null;
    } catch {
      before = null;
    }
    const user = req.user;
    res.on('finish', () => {
      if (res.statusCode >= 300) return;
      try {
        logActivity(user, rule[2](m, req.body || {}, before));
      } catch (err) {
        logActivity(user, `${req.method} ${req.path}`, err.message);
      }
    });
    next();
  });
  // The log, newest first: for the admin and the JHMMC officers. Nobody can change it.
  api.get('/activity', (req, res) => {
    if (!req.user || !(canReview(req.user) || isAdminUser(req.user))) return res.status(403).json({ error: 'Only the admin and the JHMMC officers can see the activity log.' });
    const before = intId(req.query.before);
    const who = intId(req.query.user);
    const rows = db.prepare(`SELECT id, user_id AS userId, user_name AS userName, role, action, created_at AS at FROM activity_log
      WHERE (:before IS NULL OR id < :before) AND (:who IS NULL OR user_id = :who) ORDER BY id DESC LIMIT 50`).all({ before, who });
    const people = db.prepare('SELECT DISTINCT user_id AS id, user_name AS name FROM activity_log ORDER BY user_name').all();
    res.json({ items: rows, people, nextBefore: rows.length === 50 ? rows.at(-1).id : null });
  });

  return {  };
};
