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
  fd.set('lineClass', '80 lb');
  fd.set('photo', new Blob([PNG], { type: 'image/png' }), 'fish.png');
  r = await kofi('POST', '/catches', fd);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.catch;
  assert.equal(c.angler, 'Awa Diop');
  assert.equal(c.teamName, 'Sea Hunter');
  assert.equal(c.clubId, clubId, 'club comes from the boat');
  assert.equal(c.country, 'Senegal', 'country defaults to the boat');
  assert.equal(c.canDelete, true, 'logger can delete');
  assert.equal(c.lineClass, '80 lb');
  const kgLine = new FormData();
  kgLine.set('speciesId', marlin.id);
  kgLine.set('caughtOn', '2026-06-14');
  kgLine.set('lineClass', '37 kg');
  assert.equal((await kofi('POST', '/catches', kgLine)).status, 400, 'only listed pound classes');
  assert.ok((await kofi('GET', '/meta')).body.lineClasses.includes('100 lb'));

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
  assert.equal((await fetch(base + c.photoUrl)).status, 200, 'photos are public');

  // Logging for someone outside the boat is refused.
  const other = new FormData();
  other.set('speciesId', marlin.id);
  other.set('caughtOn', '2026-06-14');
  other.set('anglerId', (await ibra('GET', '/me')).body.user.id);
  assert.equal((await awa('POST', '/catches', other)).status, 400);

  r = await ibra('GET', '/records');
  const blue = r.body.species.find((x) => x.name === 'Atlantic blue marlin');
  assert.equal(blue.igfa.display, '1,402 lb 2 oz');
  assert.equal(blue.igfa.kg, 636);
  assert.equal(blue.best.weightKg, 212.5);
  assert.equal(r.body.species.find((x) => x.name === 'Atlantic tarpon').igfa.african, true);
  assert.equal(r.body.species.find((x) => x.name === 'Little tunny').igfa, null, 'unconfirmed records are left out');
  assert.deepEqual(r.body.lineRecords.map((x) => [x.species, x.lineClass, x.weightKg]), [['Atlantic blue marlin', '80 lb', 212.5]]);
  assert.equal(c.worldRecordKg, 636);
  r = await ibra('GET', `/records?club=${clubId}`);
  assert.equal(r.body.club.name, 'Dakar Offshore Club');
  assert.equal(r.body.species.find((x) => x.name === 'Atlantic blue marlin').best.weightKg, 212.5);
  assert.equal((await ibra('GET', '/records?club=9999')).status, 404);
  assert.equal((await kofi('GET', '/me')).body.user.clubId, clubId);

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

test('participants: boats and anglers with photos and tallies', async () => {
  const cap = client();
  await cap('POST', '/auth/register', { name: 'Musa Kamara', email: 'musa@example.com', password: 'password1' });
  let r = await cap('POST', '/teams', { name: 'Freetown Flyer', lengthFt: '9', make: 'Bertram' });
  assert.equal(r.status, 400, 'length is checked');
  r = await cap('POST', '/teams', { name: 'Freetown Flyer', lengthFt: '42', make: 'Bertram', country: 'Sierra Leone' });
  const team = r.body.team;
  assert.equal(team.lengthFt, 42);
  assert.equal(team.make, 'Bertram');

  const boatPic = new FormData();
  boatPic.set('photo', new Blob([PNG], { type: 'image/png' }), 'boat.png');
  r = await cap('POST', `/teams/${team.id}/photo`, boatPic);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.team.photoUrl, /^\/uploads\//);

  const meta = (await cap('GET', '/meta')).body;
  const tarpon = meta.species.find((s) => s.name === 'Atlantic tarpon');
  for (const [w, rel] of [['40', ''], ['', 'on']]) {
    const fd = new FormData();
    fd.set('speciesId', tarpon.id);
    fd.set('caughtOn', '2026-03-01');
    if (w) fd.set('weightKg', w);
    if (rel) fd.set('released', rel);
    assert.equal((await cap('POST', '/catches', fd)).status, 201);
  }

  const anon = client();
  const otherClub = (await cap('POST', '/clubs', { name: 'Freetown Game Fishing Club', country: 'Sierra Leone' })).body.club;
  r = await anon('GET', `/records?club=${otherClub.id}`);
  assert.ok(r.body.species.every((x) => x.best === null), 'a club only sees its own catches');
  const boat = (await anon('GET', '/teams')).body.teams.find((t) => t.id === team.id);
  assert.deepEqual([boat.catches, boat.released, boat.weighed, boat.members], [2, 1, 1, 1]);
  let musa = (await anon('GET', '/anglers')).body.anglers.find((a) => a.name === 'Musa Kamara');
  assert.equal(musa.teamName, 'Freetown Flyer');
  assert.equal(musa.photoUrl, r.body?.team?.photoUrl ?? boat.photoUrl, 'falls back to the boat photo');
  assert.deepEqual([musa.released, musa.weighed], [1, 1]);

  const me = new FormData();
  me.set('photo', new Blob([PNG], { type: 'image/png' }), 'me.png');
  r = await cap('POST', '/me/photo', me);
  assert.equal(r.status, 200);
  musa = (await anon('GET', '/anglers')).body.anglers.find((a) => a.name === 'Musa Kamara');
  assert.equal(musa.photoUrl, r.body.user.photoUrl);
  assert.notEqual(musa.photoUrl, boat.photoUrl);

  const crew = client();
  await crew('POST', '/auth/register', { name: 'Fatu', email: 'fatu@example.com', password: 'password1' });
  await crew('POST', '/teams/join', { code: team.joinCode });
  const pic = new FormData();
  pic.set('photo', new Blob([PNG], { type: 'image/png' }), 'boat.png');
  assert.equal((await crew('POST', `/teams/${team.id}/photo`, pic)).status, 403, 'captain only');
});

test('visitors without an account can look but not act', async () => {
  const anon = client();
  const r = await anon('GET', '/catches');
  assert.equal(r.status, 200);
  assert.ok(r.body.catches.length > 0);
  assert.equal(r.body.catches[0].canDelete, false);
  assert.equal(r.body.catches[0].liked, false);
  assert.equal((await anon('GET', `/catches/${r.body.catches[0].id}`)).status, 200);
  assert.equal((await anon('GET', '/leaderboard')).status, 200);
  assert.equal((await anon('GET', '/anglers')).status, 200);
  const teams = (await anon('GET', '/teams')).body.teams;
  const t = (await anon('GET', `/teams/${teams[0].id}`)).body.team;
  assert.equal(t.joinCode, undefined, 'invite code stays with the crew');
  assert.equal((await anon('POST', `/catches/${r.body.catches[0].id}/like`)).status, 401);
  assert.equal((await anon('POST', `/catches/${r.body.catches[0].id}/comments`, { body: 'hi' })).status, 401);
  assert.equal((await anon('POST', '/teams/join', { code: 'ABCDEF' })).status, 401);
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

test('repeated failed sign-ins are slowed down', async () => {
  const c = client();
  const tries = [];
  for (let i = 0; i < 11; i++) tries.push((await c('POST', '/auth/login', { email: 'victim@example.com', password: 'guess' + i })).status);
  assert.deepEqual(tries.slice(0, 10), Array(10).fill(401));
  assert.equal(tries[10], 429);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});
