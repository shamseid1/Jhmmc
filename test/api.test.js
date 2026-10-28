const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-'));
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads') });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Minimal client that keeps its own session cookie.
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = cookie ? { cookie } : {};
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + '/api' + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test('full flow: register, club, catch with photo, feed, like, comment, leaderboard', async () => {
  const awa = client();
  const kofi = client();

  let r = await awa('POST', '/auth/register', { name: 'Awa Diop', email: 'awa@example.com', password: 'marlin123', country: 'Senegal' });
  assert.equal(r.status, 201);

  r = await awa('POST', '/clubs', { name: 'Dakar Offshore Club', country: 'Senegal', city: 'Dakar' });
  assert.equal(r.status, 201);
  const clubId = r.body.club.id;

  r = await awa('GET', '/me');
  assert.equal(r.body.user.clubId, clubId, 'founder joins their club');

  const meta = (await awa('GET', '/meta')).body;
  const marlin = meta.species.find((s) => s.name === 'Atlantic blue marlin');
  const tuna = meta.species.find((s) => s.name === 'Yellowfin tuna');

  const fd = new FormData();
  fd.set('speciesId', marlin.id);
  fd.set('weightKg', '212.5');
  fd.set('caughtOn', '2026-06-14');
  fd.set('location', 'Ngor');
  fd.set('released', 'on');
  fd.set('photo', new Blob([PNG], { type: 'image/png' }), 'fish.png');
  r = await awa('POST', '/catches', fd);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.catch;
  assert.equal(c.clubId, clubId);
  assert.equal(c.country, 'Senegal');
  assert.equal(c.released, true);
  assert.match(c.photoUrl, /^\/uploads\/[0-9a-f]+\.png$/);

  const img = await fetch(base + c.photoUrl);
  assert.equal(img.status, 200);

  r = await kofi('POST', '/auth/register', { name: 'Kofi Mensah', email: 'kofi@example.com', password: 'tuna12345', country: 'Ghana' });
  assert.equal(r.status, 201);

  const tunaForm = new FormData();
  tunaForm.set('speciesId', tuna.id);
  tunaForm.set('weightKg', '64');
  tunaForm.set('caughtOn', '2026-05-02');
  r = await kofi('POST', '/catches', tunaForm);
  assert.equal(r.status, 201);
  assert.equal(r.body.catch.country, 'Ghana', 'defaults to angler country');

  r = await kofi('POST', `/catches/${c.id}/like`);
  assert.deepEqual(r.body, { liked: true, likes: 1 });
  r = await kofi('POST', `/catches/${c.id}/comments`, { body: 'Ayekoo! Massive fish.' });
  assert.equal(r.status, 201);

  r = await kofi('GET', `/catches/${c.id}`);
  assert.equal(r.body.catch.liked, true);
  assert.equal(r.body.comments[0].author, 'Kofi Mensah');

  r = await kofi('GET', `/catches?club=${clubId}`);
  assert.deepEqual(r.body.catches.map((x) => x.id), [c.id]);
  r = await kofi('GET', '/catches?country=Ghana');
  assert.equal(r.body.catches.length, 1);

  r = await kofi('GET', '/leaderboard');
  assert.equal(r.body.records[0].species, 'Atlantic blue marlin');
  assert.equal(r.body.anglers[0].angler, 'Awa Diop', 'billfish rank first');
  assert.equal(r.body.clubs[0].clubName, 'Dakar Offshore Club');

  r = await kofi('DELETE', `/catches/${c.id}`);
  assert.equal(r.status, 403);
  r = await awa('DELETE', `/catches/${c.id}`);
  assert.equal(r.status, 200);
  assert.equal((await awa('GET', `/catches/${c.id}`)).status, 404);
});

test('validation and auth errors', async () => {
  const anon = client();
  assert.equal((await anon('POST', '/catches', new FormData())).status, 401);
  assert.equal((await anon('POST', '/auth/register', {})).status, 400);
  assert.equal((await anon('POST', '/auth/login', { email: 'nobody@example.com', password: 'x' })).status, 401);

  const u = client();
  await u('POST', '/auth/register', { name: 'Ade', email: 'ade@example.com', password: 'password1' });
  assert.equal((await u('POST', '/auth/register', { name: 'Ade', email: 'ADE@example.com', password: 'password1' })).status, 409);
  assert.equal((await u('POST', '/clubs', { name: 'Atlantis', country: 'France' })).status, 400);

  const bad = new FormData();
  bad.set('speciesId', '1');
  bad.set('caughtOn', '2099-01-01');
  assert.equal((await u('POST', '/catches', bad)).status, 400);

  const txt = new FormData();
  txt.set('speciesId', '1');
  txt.set('caughtOn', '2026-01-01');
  txt.set('photo', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  const r = await u('POST', '/catches', txt);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /JPEG, PNG or WebP/);

  await u('POST', '/auth/logout');
  assert.equal((await u('GET', '/me')).body.user, null);
});
