const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo, DEMO_ACCOUNTS } = require('../src/demo');

test('demo copy: a made-up season, shared sign-ins that cannot be locked', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-demo-'));
  const app = createApp({ dbFile: path.join(tmp, 'fishing.db'), uploadDir: path.join(tmp, 'up'), adminEmail: 'admin@example.com', demo: true, nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal(await seedDemo(base), true);
    assert.equal(await seedDemo(base), false, 'a second start leaves the season as it is');
    assert.equal((await (await fetch(`${base}/api/meta`)).json()).demo, true);
    assert.deepEqual((await (await fetch(`${base}/api/demo`)).json()).accounts, DEMO_ACCOUNTS);
    // Each listed account signs in.
    let cookie = '';
    for (const a of DEMO_ACCOUNTS) {
      const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
      assert.equal(r.status, 200, a.email);
      cookie = r.headers.get('set-cookie').split(';')[0];
    }
    const call = (method, url, body) => fetch(`${base}/api${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // ...and nobody can lock the others out.
    assert.equal((await call('POST', '/me/password', { currentPassword: 'demo-pass-1', newPassword: 'mine-now-1' })).status, 403);
    assert.equal((await call('PATCH', '/me', { email: 'me@example.com' })).status, 403);
    assert.equal((await call('POST', '/auth/forgot', { email: 'shams@example.com' })).status, 403);
    // The season: approved fish in the board, one waiting for the secretary.
    const points = await (await fetch(`${base}/api/points`)).json();
    assert.ok(JSON.stringify(points).includes('Liberian Girl'));
    assert.equal((await (await call('GET', '/officials/pending')).json()).count, 1);
  } finally {
    srv.close();
  }
});

test('not a demo: no demo accounts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-demo-'));
  const app = createApp({ dbFile: path.join(tmp, 'fishing.db'), uploadDir: path.join(tmp, 'up'), nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    assert.equal((await fetch(`${base}/api/demo`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/meta`)).json()).demo, false);
  } finally {
    srv.close();
  }
});
