const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');

test('one grouper and one grunter: duplicates are merged, their fish moved', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-sp-')), 'fishing.db');
  let db = openDb(file);
  // An older copy: a second grouper and grunter, each with a fish logged at sea.
  const add = (name) => Number(db.prepare("INSERT INTO species (name, category, points_per_kg) VALUES (?, 'Bottom', 5)").run(name).lastInsertRowid);
  const dusky = add('Dusky grouper');
  const spotted = add('Spotted grunter');
  const outing = Number(db.prepare("INSERT INTO outings (boat, date) VALUES ('Test boat', '2026-11-01')").run().lastInsertRowid);
  for (const sp of [dusky, spotted]) {
    db.prepare("INSERT INTO outing_landings (outing_id, species_id, fate, landed_at) VALUES (?, ?, 'kept', '2026-11-01T10:00:00Z')").run(outing, sp);
  }
  db.close();

  db = openDb(file);
  const names = db.prepare('SELECT name FROM species').all().map((x) => x.name);
  assert.equal(names.filter((n) => /grouper/i.test(n)).join(), 'Grouper');
  assert.equal(names.filter((n) => /grunter/i.test(n)).join(), 'Grunter');
  const fish = db.prepare('SELECT s.name FROM outing_landings l JOIN species s ON s.id = l.species_id ORDER BY s.name').all().map((x) => x.name);
  assert.deepEqual(fish, ['Grouper', 'Grunter']);
  assert.ok(names.includes('Hammerhead') && names.includes('Mako shark'));
  for (const gone of ['Cubera snapper', 'Almaco jack', 'Bigeye trevally', 'Little tunny']) assert.ok(!names.includes(gone), gone);
  assert.equal(names.length, 32);
  db.close();
});
