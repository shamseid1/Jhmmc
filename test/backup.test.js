const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createBackups } = require('../src/backup');

test('backups: a complete copy of the database, emailed to the admin, kept 14 days, admin only', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-backup-'));
  const sent = [];
  const mailer = { configured: true, send: async (m) => { sent.push(m); } };
  const app = createApp({ dbFile: path.join(tmp, 'fishing.db'), uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com', mailer, nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body, raw) => {
      const res = await fetch(at + url, { method, headers: { ...(cookie && { cookie }), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return raw ? res : { status: res.status, body: await res.json() };
    };
  };
  try {
    const boss = as(); const crew = as();
    const reg = await boss('POST', '/auth/register', { acceptRules: true, name: 'Boss Admin', email: 'boss@example.com', password: 'password1' }); assert.equal(reg.status, 201, JSON.stringify(reg.body));
    await crew('POST', '/auth/register', { acceptRules: true, name: 'Deck Hand', email: 'crew@example.com', password: 'password1' });
    await boss('POST', '/teams', { name: 'Liberian Girl', country: 'Liberia' });
    assert.equal((await crew('GET', '/admin/backups')).status, 403);
    const r = await boss('POST', '/admin/backups', { email: true });
    assert.equal(r.status, 201);
    assert.equal(r.body.emailed, true);
    assert.equal(sent[0].to, 'boss@example.com');
    assert.equal(sent[0].attachments[0].filename, r.body.backup.name);
    // The download is the whole database: it opens and has the accounts and the boat.
    const dl = await boss('GET', `/admin/backups/${r.body.backup.name}`, null, true);
    assert.equal(dl.status, 200);
    const restored = path.join(tmp, 'restored.db');
    fs.writeFileSync(restored, zlib.gunzipSync(Buffer.from(await dl.arrayBuffer())));
    const db = new DatabaseSync(restored);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
    assert.equal(db.prepare("SELECT name FROM teams").get().name, 'Liberian Girl');
    db.close();
    assert.equal((await crew('GET', `/admin/backups/${r.body.backup.name}`, null, true)).status, 403);
    assert.equal((await boss('GET', '/admin/backups/..%2Ffishing.db', null, true)).status, 404, 'only backup files');
  } finally {
    srv.close();
  }
  // Once a day; the newest copy of each of the last 14 days is kept.
  const db = openDb(path.join(tmp, 'two.db'));
  let day = Date.parse('2026-11-01T02:00:00Z');
  const b = createBackups(db, { dir: path.join(tmp, 'bk'), mailer, adminEmail: 'boss@example.com', now: () => new Date(day) });
  assert.ok(await b.daily());
  assert.equal(await b.daily(), null, 'already done today');
  for (let i = 0; i < 20; i++) { day += 86400000; await b.daily(); }
  assert.equal(b.list().length, 14);
  assert.match(b.list()[0].name, /2026-11-21/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
