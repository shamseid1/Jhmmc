'use strict';

// Records, the leaderboard and profiles. Part of createApp (src/app.js): it takes what it uses from the
// shared context and returns the helpers other parts use.
module.exports = (ctx) => {
  const {
    SHOWN, THROUGH_JHMMC, api, app, clubBook, db, discardUploads, homeClubId, igfa, intId, jhmmcBook,
    multer, photoUrl, sendIndex
  } = ctx;

  // ---- records -----------------------------------------------------------

  // IGFA all-tackle world records beside the heaviest fish logged here, plus
  // the app's own records for each species and line class.
  api.get('/records', (req, res) => {
    const clubId = intId(req.query.club);
    const club = clubId && db.prepare('SELECT id, name FROM clubs WHERE id = ? AND pending = 0').get(clubId);
    if (clubId && !club) return res.status(404).json({ error: 'Club not found.' });
    const best = db.prepare(`
      SELECT * FROM (
        SELECT k.species_id AS speciesId, k.line_class AS lineClass, k.id AS catchId, k.weight_kg AS weightKg,
          k.caught_on AS caughtOn, u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS teamName,
          ROW_NUMBER() OVER (PARTITION BY k.species_id ORDER BY k.weight_kg DESC, k.id) AS overall,
          ROW_NUMBER() OVER (PARTITION BY k.species_id, k.line_class ORDER BY k.weight_kg DESC, k.id) AS inClass
        FROM catches k LEFT JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
        WHERE k.weight_kg IS NOT NULL AND k.species_id IS NOT NULL AND k.status = :book ${club ? 'AND k.club_id = :club' : `AND ${THROUGH_JHMMC}`}
      ) WHERE overall = 1 OR (inClass = 1 AND lineClass IS NOT NULL)
    `).all(club ? { club: club.id, book: clubBook(club.id) } : { book: 'approved' });
    const species = db.prepare('SELECT id, name, category FROM species ORDER BY category, name').all();
    const names = Object.fromEntries(species.map((s) => [s.id, s.name]));
    const strip = ({ overall, inClass, ...r }) => r;
    const lineOrder = (c) => (c === 'Unlimited' ? 1e9 : parseFloat(c));

    res.json({
      club: club || null,
      book: club && club.id === homeClubId() ? recordBook() : null,
      checked: igfa.CHECKED,
      igfaUrl: igfa.IGFA_SEARCH_URL,
      species: species.filter((s) => s.name !== 'Other').map((s) => {
        const top = best.find((b) => b.speciesId === s.id && b.overall === 1);
        return { ...s, igfa: igfa.igfaRecord(s.name), best: top ? strip(top) : null };
      }),
      lineRecords: best
        .filter((b) => b.inClass === 1 && b.lineClass)
        .map((b) => ({ species: names[b.speciesId], ...strip(b) }))
        .sort((a, b) => a.species.localeCompare(b.species) || lineOrder(a.lineClass) - lineOrder(b.lineClass)),
    });
  });

  // JHMMC's record book: the club's records from before the app (as printed
  // in its PDF) with approved registrations ranked in among them, heaviest
  // first, ten deep (or as deep as the book). Species the book doesn't list
  // get a list of their own.
  const BOOK_LENGTH = 10;
  function recordBook() {
    const approved = db.prepare(`
      SELECT k.id AS catchId, s.name AS species, k.weight_kg AS weightKg, k.line_class AS lineClass, k.caught_on AS caughtOn,
        u.id AS userId, COALESCE(NULLIF(u.nickname, ''), u.name, k.angler_name) AS angler, t.id AS teamId, t.name AS boat
      FROM catches k JOIN species s ON s.id = k.species_id LEFT JOIN users u ON u.id = k.user_id LEFT JOIN teams t ON t.id = k.team_id
      WHERE k.status = 'approved' AND k.club_id = ? AND k.weight_kg IS NOT NULL ORDER BY k.weight_kg DESC
    `).all(homeClubId());
    const fromApp = (species) => approved.filter((a) => a.species === species).map((a) => ({ ...a, fromApp: true }));
    const heaviestFirst = (rows) => rows.sort((a, b) => b.weightKg - a.weightKg);
    const listed = new Set(jhmmcBook.GROUPS.map((g) => g.species).filter(Boolean));
    // A fish from the app goes into the book only if it beats a fish already there (heavier than
    // the book's lightest for its species): a short list isn't topped up with small fish.
    const all = jhmmcBook.GROUPS.map((g) => {
      const lightest = g.records.length ? Math.min(...g.records.map((r) => r.weightKg)) : Infinity;
      const beats = g.species ? fromApp(g.species).filter((a) => a.weightKg > lightest) : [];
      return { title: g.title, species: g.species, length: Math.max(g.records.length, 1) + beats.length, records: heaviestFirst([...g.records, ...beats]) };
    });
    for (const species of new Set(approved.map((a) => a.species))) {
      if (!listed.has(species)) all.push({ title: species, species, length: BOOK_LENGTH, records: fromApp(species) });
    }
    // The heaviest fish for each species and line class, across the book and the app.
    const lineRecords = [];
    for (const g of all) {
      const best = new Map();
      for (const r of g.records) if (r.lineClass && !best.has(r.lineClass)) best.set(r.lineClass, r);
      const order = (c) => (c === 'Unlimited' ? 1e9 : parseFloat(c));
      for (const r of [...best.values()].sort((a, b) => order(a.lineClass) - order(b.lineClass))) lineRecords.push({ group: g.title, ...r });
    }
    // Each list is at least as long as the book's own, so no book record drops off.
    const groups = all.map(({ length, ...g }) => ({ ...g, records: g.records.slice(0, length) }));
    return { asAt: jhmmcBook.AS_AT, pdf: jhmmcBook.PDF, groups, lineRecords };
  }

  // ---- leaderboard -------------------------------------------------------


  // ---- profiles ----------------------------------------------------------

  api.get('/users/:id', (req, res) => {
    const id = intId(req.params.id);
    const user = id && db.prepare(`
      SELECT u.id, ${SHOWN} AS name, u.name AS fullName, u.country, u.bio, u.photo, u.created_at AS joinedAt, t.id AS teamId, t.name AS teamName
      FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.id = ?
    `).get(id);
    if (!user) return res.status(404).json({ error: 'Angler not found.' });
    user.photoUrl = photoUrl(user.photo);
    delete user.photo;
    const stats = db.prepare(`
      SELECT COUNT(*) AS catches, COALESCE(SUM(released), 0) AS released, MAX(weight_kg) AS heaviestKg
      FROM catches WHERE user_id = ? AND status = 'approved'
    `).get(id);
    res.json({ user, stats });
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Single-page app: let the client router handle everything else.
  app.get('/{*path}', sendIndex);

  app.use((err, req, res, _next) => {
    discardUploads(req);
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be under 8 MB.' : status === 500 ? 'Something went wrong.' : err.message,
    });
  });

  app.locals.db = db;

  return {  };
};
