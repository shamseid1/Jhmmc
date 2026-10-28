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

test('boat crews: register, invite code, crew logging, captain controls', async () => {
  const awa = client();
  const kofi = client();
  const ibra = client();

  let r = await awa('POST', '/auth/register', { name: 'Awa Diop', email: 'awa@example.com', password: 'marlin123', country: 'Senegal' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.teamId, null);

  r = await awa('POST', '/clubs', { name: 'Dakar Offshore Club', country: 'Senegal', city: 'Dakar' });
  const clubId = r.body.club.id;

  r = await awa('POST', '/teams', { name: 'Sea Hunter', homePort: 'Dakar', country: 'Senegal', clubId });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const team = r.body.team;
  assert.equal(r.body.user.isCaptain, true);
  assert.match(team.joinCode, /^[A-Z2-9]{6}$/);

  r = await awa('POST', '/teams', { name: 'Second Boat' });
  assert.equal(r.status, 409, 'one boat at a time');

  await kofi('POST', '/auth/register', { name: 'Kofi Mensah', email: 'kofi@example.com', password: 'tuna12345' });
  r = await kofi('GET', `/teams/${team.id}`);
  assert.equal(r.body.team.joinCode, undefined, 'code hidden from non-crew');
  assert.equal((await kofi('POST', '/teams', { name: 'sea hunter' })).status, 409, 'boat names are unique');
  assert.equal((await kofi('POST', '/teams/join', { code: 'WRONG1' })).status, 404);
  r = await kofi('POST', '/teams/join', { code: team.joinCode.toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.teamName, 'Sea Hunter');

  const meta = (await awa('GET', '/meta')).body;
  const marlin = meta.species.find((s) => s.name === 'Atlantic blue marlin');

  // Kofi logs a fish that Awa caught, with a photo.
  const fd = new FormData();
  fd.set('speciesId', marlin.id);
  fd.set('anglerId', r.body.team.members.find((m) => m.name === 'Awa Diop').id);
  fd.set('weightKg', '212.5');
  fd.set('caughtOn', '2026-06-14');
  fd.set('released', 'on');
  fd.set('photo', new Blob([PNG], { type: 'image/png' }), 'fish.png');
  r = await kofi('POST', '/catches', fd);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.catch;
  assert.equal(c.angler, 'Awa Diop');
  assert.equal(c.teamName, 'Sea Hunter');
  assert.equal(c.clubId, clubId, 'club comes from the boat');
  assert.equal(c.country, 'Senegal', 'country defaults to the boat');
  assert.equal(c.canDelete, true, 'logger can delete');

  // Individual angler: can browse, like and comment but not log.
  await ibra('POST', '/auth/register', { name: 'Ibrahima Fall', email: 'ibra@example.com', password: 'sailfish1' });
  const solo = new FormData();
  solo.set('speciesId', marlin.id);
  solo.set('caughtOn', '2026-06-14');
  r = await ibra('POST', '/catches', solo);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /boat/);
  r = await ibra('GET', '/catches');
  assert.equal(r.body.catches.length, 1);
  assert.equal(r.body.catches[0].canDelete, false);
  assert.deepEqual((await ibra('POST', `/catches/${c.id}/like`)).body, { liked: true, likes: 1 });
  assert.equal((await ibra('POST', `/catches/${c.id}/comments`, { body: 'Bravo!' })).status, 201);
  assert.equal((await ibra('DELETE', `/catches/${c.id}`)).status, 403);
  assert.equal((await fetch(base + c.photoUrl)).status, 401, 'photos need a sign-in');

  // Logging for someone outside the boat is refused.
  const other = new FormData();
  other.set('speciesId', marlin.id);
  other.set('caughtOn', '2026-06-14');
  other.set('anglerId', (await ibra('GET', '/me')).body.user.id);
  assert.equal((await awa('POST', '/catches', other)).status, 400);

  r = await ibra('GET', '/leaderboard');
  assert.equal(r.body.teams[0].teamName, 'Sea Hunter');
  assert.equal(r.body.anglers[0].angler, 'Awa Diop');
  assert.equal(r.body.clubs[0].clubName, 'Dakar Offshore Club');

  // Captain controls.
  const kofiId = (await kofi('GET', '/me')).body.user.id;
  assert.equal((await kofi('POST', `/teams/${team.id}/code`)).status, 403);
  assert.equal((await awa('POST', '/teams/leave')).status, 409, 'captain must hand over first');
  r = await awa('POST', `/teams/${team.id}/code`);
  assert.notEqual(r.body.team.joinCode, team.joinCode);
  r = await awa('POST', `/teams/${team.id}/captain`, { userId: kofiId });
  assert.equal(r.body.team.captainId, kofiId);
  assert.equal((await awa('POST', '/teams/leave')).status, 200);
  assert.equal((await kofi('GET', '/me')).body.user.isCaptain, true);
  assert.equal((await kofi('DELETE', `/catches/${c.id}`)).status, 200, 'captain can delete crew catches');
});

test('sign-in is required to see anything', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/catches')).status, 401);
  assert.equal((await anon('GET', '/teams')).status, 401);
  assert.equal((await anon('GET', '/leaderboard')).status, 401);
  assert.equal((await anon('GET', '/meta')).status, 200);
  assert.equal((await anon('GET', '/me')).body.user, null);
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
  await u('POST', '/teams', { name: 'Lagos Lady', country: 'Nigeria' });

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
