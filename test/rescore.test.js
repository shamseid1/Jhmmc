const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

test('fish saved as "not a scoring day" get their points when the app starts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-'));
  const dbFile = path.join(tmp, 'fishing.db');
  try {
    const db = openDb(dbFile);
    const wahoo = db.prepare("SELECT id FROM species WHERE name = 'Wahoo'").get().id;
    // The fish were caught during a tournament, so they score.
    db.prepare("INSERT INTO events (date, kind, name) VALUES ('2026-10-27', 'tournament', 'October Cup')").run();
    const add = db.prepare(`INSERT INTO catches (species_id, angler_name, caught_on, weight_kg, status, points, points_note)
      VALUES (?, 'Guest', '2026-10-27', ?, ?, ?, ?)`);
    const old = 'Not a scoring day: only Sundays, holidays and tournaments count.';
    const pending = add.run(wahoo, 20, 'pending_review', 0, old).lastInsertRowid;
    const rejected = add.run(wahoo, 20, 'rejected', null, old).lastInsertRowid;
    const changed = add.run(wahoo, 20, 'approved', 42, 'Given by the secretary').lastInsertRowid;
    db.close();

    createApp({ dbFile, uploadDir: path.join(tmp, 'uploads') });
    const check = openDb(dbFile);
    const row = (id) => check.prepare('SELECT points, points_note AS note FROM catches WHERE id = ?').get(id);
    assert.deepEqual({ ...row(pending) }, { points: 100, note: '20 kg × 5 points per kg.' });
    assert.equal(row(rejected).points, null, 'rejected fish stay rejected');
    assert.equal(row(changed).points, 42, "the secretary's own points are kept");
    check.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the season table only adds up fish caught on tournament days', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-'));
  const dbFile = path.join(tmp, 'fishing.db');
  try {
    const db = openDb(dbFile);
    const wahoo = db.prepare("SELECT id FROM species WHERE name = 'Wahoo'").get().id;
    const club = db.prepare("SELECT id FROM clubs WHERE name = 'JHMMC'").get().id;
    const team = db.prepare("INSERT INTO teams (name, club_id, join_code) VALUES ('Sea Hunter', ?, 'SH1')").run(club).lastInsertRowid;
    db.prepare("UPDATE settings SET value = '2026-09-01' WHERE key = 'season_start'").run();
    db.prepare("UPDATE settings SET value = '2027-08-31' WHERE key = 'season_end'").run();
    db.prepare("INSERT INTO events (date, end_date, kind, name) VALUES ('2026-10-24', '2026-10-25', 'tournament', 'October Cup')").run();
    // Approved before tournaments-only scoring: one in the tournament, one on an ordinary day.
    const add = db.prepare(`INSERT INTO catches (species_id, angler_name, team_id, club_id, caught_on, weight_kg, status, points)
      VALUES (?, 'Guest', ?, ?, ?, 20, 'approved', 100)`);
    add.run(wahoo, team, club, '2026-10-25');
    add.run(wahoo, team, club, '2026-10-27');
    db.close();

    const app = createApp({ dbFile, uploadDir: path.join(tmp, 'uploads') });
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    try {
      const table = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/points?division=ocean`)).json();
      assert.deepEqual(table.boats.map((b) => [b.teamName, b.catches, b.points]), [['Sea Hunter', 1, 100]]);
    } finally {
      srv.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
