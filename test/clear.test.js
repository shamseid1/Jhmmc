const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');
const { clearTestData } = require('../scripts/clear-test-data');

test('clear test data (a one-time server command): keeps the named boats, accounts, boats and tournaments; backup first', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-clear-'));
  const dbFile = path.join(tmp, 'fishing.db');
  const app = createApp({ dbFile, uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com', nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = async (email, password) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (method, url, body) => {
      const res = await fetch(`${base}/api${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
  };
  try {
    await seedDemo(base, { adminEmail: 'boss@example.com' });
    // The demo admin's password is random: give the admin a known one for the test.
    const raw = new DatabaseSync(dbFile);
    const before = (q) => raw.prepare(q).get().n;
    const users = before('SELECT COUNT(*) AS n FROM users'); const teams = before('SELECT COUNT(*) AS n FROM teams');
    const monkey = raw.prepare("SELECT id FROM teams WHERE name = 'Sea Monkey'").get().id;
    const monkeyFish = before(`SELECT COUNT(*) AS n FROM catches WHERE team_id = ${monkey}`);
    const monkeyTrips = before(`SELECT COUNT(*) AS n FROM outings WHERE team_id = ${monkey}`);
    assert.ok(monkeyFish > 0 && monkeyTrips > 0);
    // Not in the app: nobody, the admin included, can clear data from it.
    const shams = await login('shams@example.com', 'demo-pass-1');
    assert.equal((await shams('POST', '/admin/clear-test-data', { confirm: 'CLEAR' })).status, 404);
    const quiet = () => {};
    assert.throws(() => clearTestData({ dbFile, uploadDir: path.join(tmp, 'up'), keep: ['No Such Boat'], log: quiet }), /No boat called/);
    const look = clearTestData({ dbFile, uploadDir: path.join(tmp, 'up'), keep: ['sea monkey'], log: quiet });
    assert.equal(look.cleared, false, 'without --yes it only shows');
    assert.equal(look.counts.keptWeighIns, monkeyFish);
    assert.equal(before('SELECT COUNT(*) AS n FROM announcements') > 0, true);
    const done = { body: clearTestData({ dbFile, uploadDir: path.join(tmp, 'up'), keep: ['Sea Monkey'], yes: true, log: quiet }) };
    assert.ok(fs.existsSync(path.join(tmp, 'backups', done.body.backup)), 'backup made first');
    // What stays.
    assert.equal(before('SELECT COUNT(*) AS n FROM users'), users);
    assert.equal(before('SELECT COUNT(*) AS n FROM teams'), teams);
    assert.equal(before('SELECT COUNT(*) AS n FROM events'), 1);
    assert.equal(before('SELECT COUNT(*) AS n FROM catches'), monkeyFish);
    assert.equal(before(`SELECT COUNT(*) AS n FROM catches WHERE team_id = ${monkey}`), monkeyFish);
    assert.equal(before('SELECT COUNT(*) AS n FROM outings'), monkeyTrips);
    // What goes.
    assert.equal(before('SELECT COUNT(*) AS n FROM announcements'), 0);
    assert.equal(before(`SELECT COUNT(*) AS n FROM registration_log WHERE COALESCE(team_id, 0) <> ${monkey}`), 0);
    assert.equal(before('SELECT COUNT(*) AS n FROM disputes'), 0);
    assert.match(raw.prepare("SELECT details FROM activity_log WHERE action = 'Cleared the test data'").get().details, /Kept Sea Monkey/);
    raw.close();
  } finally {
    srv.close();
  }
});
