const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');

test('clear test data: keeps the ticked boats, accounts, boats and tournaments; backup first; admin only', async () => {
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
    const shams = await login('shams@example.com', 'demo-pass-1');
    assert.equal((await shams('GET', '/admin/clear-test-data')).status, 403, 'the admin only');
    const { hashPassword } = require('../src/auth');
    raw.prepare("UPDATE users SET password_hash = ? WHERE email = 'boss@example.com'").run(hashPassword('password1'));
    const boss = await login('boss@example.com', 'password1');
    const preview = await boss('GET', `/admin/clear-test-data?keep=${monkey}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.keep[0].name, 'Sea Monkey');
    assert.equal(preview.body.counts.keptWeighIns, monkeyFish);
    assert.equal((await boss('POST', '/admin/clear-test-data', { keep: [monkey] })).status, 400, 'needs CLEAR');
    const done = await boss('POST', '/admin/clear-test-data', { keep: [monkey], confirm: 'CLEAR' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
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
