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
