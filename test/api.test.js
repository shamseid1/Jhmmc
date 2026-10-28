const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

// Captures emails instead of sending them.
const outbox = [];
const mailer = { configured: true, send: async (msg) => { outbox.push(msg); } };

let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-'));
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), mailer, appUrl: 'https://club.example' });
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

test('anglers without an account: catches logged under a typed name', async () => {
  const cap = client();
  await cap('POST', '/auth/register', { name: 'Joseph Kollie', email: 'joseph@example.com', password: 'password1' });
  await cap('POST', '/teams', { name: 'Mesurado Queen', country: 'Liberia' });
  const meta = (await cap('GET', '/meta')).body;
  const wahoo = meta.species.find((s) => s.name === 'Wahoo');
  const log = (fields) => {
    const fd = new FormData();
    fd.set('speciesId', wahoo.id);
    fd.set('caughtOn', '2026-10-20');
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return cap('POST', '/catches', fd);
  };
  assert.equal((await log({ anglerId: 'other', anglerName: '  ' })).status, 400, 'a name is needed');
  let r = await log({ anglerId: 'other', anglerName: 'Guest Varney', weightKg: '33' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.catch.angler, 'Guest Varney');
  assert.equal(r.body.catch.userId, null);
  assert.equal(r.body.catch.canDelete, true, 'whoever logged it can delete it');
  await log({ anglerId: 'other', anglerName: 'guest varney', released: 'on' });

  const anon = client();
  const guest = (await anon('GET', '/anglers')).body.anglers.filter((a) => a.name.toLowerCase() === 'guest varney');
  assert.equal(guest.length, 1, 'one card per name, whatever the capitals');
  assert.deepEqual([guest[0].hasAccount, guest[0].teamName, guest[0].catches, guest[0].released, guest[0].weighed], [false, 'Mesurado Queen', 2, 1, 1]);
  r = await anon('GET', '/catches?angler=GUEST%20VARNEY');
  assert.equal(r.body.catches.length, 2);
  const lb = (await anon('GET', '/leaderboard')).body;
  assert.ok(lb.anglers.some((a) => a.angler.toLowerCase() === 'guest varney' && a.catches === 2 && a.userId === null));
  assert.equal(lb.records.find((x) => x.species === 'Wahoo').angler, 'Guest Varney');
  const rec = (await anon('GET', '/records')).body.species.find((x) => x.name === 'Wahoo');
  assert.equal(rec.best.angler, 'Guest Varney');
  assert.equal(guest[0].name, 'Guest Varney', 'shown as first typed');

  // Varney joins the crew and the captain moves the typed-name catches to the account.
  const teamId = (await cap('GET', '/me')).body.user.teamId;
  const team = (await cap('GET', `/teams/${teamId}`)).body.team;
  assert.deepEqual(team.guests, [{ name: 'Guest Varney', catches: 2 }]);
  const varney = client();
  await varney('POST', '/auth/register', { name: 'Varney Doe', email: 'varney@example.com', password: 'password1' });
  const varneyId = (await varney('GET', '/me')).body.user.id;
  assert.equal((await cap('POST', `/teams/${teamId}/guests/link`, { name: 'guest varney', userId: varneyId })).status, 400, 'must be crew');
  await varney('POST', '/teams/join', { code: team.joinCode });
  assert.equal((await varney('POST', `/teams/${teamId}/guests/link`, { name: 'Guest Varney', userId: varneyId })).status, 403, 'captain only');
  r = await cap('POST', `/teams/${teamId}/guests/link`, { name: 'guest varney', userId: varneyId });
  assert.equal(r.body.moved, 2);
  assert.deepEqual(r.body.team.guests, []);
  const stats = (await anon('GET', `/users/${varneyId}`)).body.stats;
  assert.deepEqual([stats.catches, stats.released], [2, 1]);
  assert.ok(!(await anon('GET', '/anglers')).body.anglers.some((a) => a.name === 'Guest Varney'));
  assert.equal((await cap('POST', `/teams/${teamId}/guests/link`, { name: 'Guest Varney', userId: varneyId })).status, 404);
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
  const clubs = (await anon('GET', '/clubs')).body.clubs;
  assert.deepEqual(clubs.filter((c) => c.name === 'JHMMC').map((c) => c.country), ['Liberia'], 'home club exists once');
  assert.equal((await anon('GET', '/meta')).body.homeClub, 'JHMMC');
  const species = (await anon('GET', '/meta')).body.species.map((x) => x.name);
  assert.ok(species.includes('Barracuda') && !species.includes('Guinean barracuda'));
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

test('forgotten and changed passwords', async () => {
  const ama = client();
  await ama('POST', '/auth/register', { name: 'Ama Owusu', email: 'ama@example.com', password: 'oldpassword' });
  const otherDevice = client();
  await otherDevice('POST', '/auth/login', { email: 'ama@example.com', password: 'oldpassword' });

  outbox.length = 0;
  let r = await client()('POST', '/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(r.status, 200, 'same answer for unknown emails');
  assert.equal(outbox.length, 0);

  r = await client()('POST', '/auth/forgot', { email: 'AMA@example.com' });
  assert.equal(r.status, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'ama@example.com');
  const token = outbox[0].text.match(/https:\/\/club\.example\/#\/reset\?token=([\w-]+)/)[1];

  const stranger = client();
  assert.equal((await stranger('POST', '/auth/reset', { token: 'made-up', password: 'newpassword' })).status, 400);
  assert.equal((await stranger('POST', '/auth/reset', { token, password: 'short' })).status, 400);
  r = await stranger('POST', '/auth/reset', { token, password: 'newpassword' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, 'ama@example.com', 'signed in after resetting');
  assert.equal((await stranger('POST', '/auth/reset', { token, password: 'another1' })).status, 400, 'links work once');
  assert.match(outbox.at(-1).subject, /password was changed/);
  assert.equal((await otherDevice('GET', '/me')).body.user, null, 'other devices are signed out');
  assert.equal((await client()('POST', '/auth/login', { email: 'ama@example.com', password: 'oldpassword' })).status, 401);
  assert.equal((await client()('POST', '/auth/login', { email: 'ama@example.com', password: 'newpassword' })).status, 200);

  // Changing the password while signed in.
  assert.equal((await stranger('POST', '/me/password', { current: 'wrongpass', password: 'brandnew1' })).status, 400);
  r = await stranger('POST', '/me/password', { current: 'newpassword', password: 'brandnew1' });
  assert.equal(r.status, 200);
  assert.ok((await stranger('GET', '/me')).body.user, 'this device stays signed in');
  assert.equal((await client()('POST', '/auth/login', { email: 'ama@example.com', password: 'brandnew1' })).status, 200);
  assert.equal((await client()('POST', '/me/password', { current: 'x', password: 'y' })).status, 401);
});

test('without email: members contact the admin, who makes reset links', async () => {
  const quiet = { configured: false, send: async () => { throw new Error('should not send'); } };
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads2'), mailer: quiet, adminEmail: 'Admin@Example.com' });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(at + url, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  try {
    const meta = (await as()('GET', '/meta')).body;
    assert.deepEqual([meta.emailEnabled, meta.adminEmail], [false, 'admin@example.com']);

    const kojo = as();
    await kojo('POST', '/auth/register', { name: 'Kojo Asante', email: 'kojo@example.com', password: 'forgotten1' });
    let r = await as()('POST', '/auth/forgot', { email: 'kojo@example.com' });
    assert.equal(r.status, 503);
    assert.match(r.body.error, /admin@example\.com/);

    assert.equal((await kojo('GET', '/admin/users')).status, 403, 'members are not admins');
    assert.equal((await kojo('GET', '/me')).body.user.isAdmin, false);

    const admin = as();
    r = await admin('POST', '/auth/register', { name: 'Club Admin', email: 'admin@example.com', password: 'adminpass1' });
    assert.equal(r.body.user.isAdmin, true);
    const kojoRow = (await admin('GET', '/admin/users')).body.users.find((u) => u.email === 'kojo@example.com');
    r = await admin('POST', `/admin/users/${kojoRow.id}/reset-link`);
    assert.equal(r.body.hours, 24);
    const token = new URL(r.body.link.replace('/#/', '/')).searchParams.get('token');
    assert.equal((await as()('POST', '/auth/reset', { token, password: 'remembered1' })).status, 200);
    assert.equal((await as()('POST', '/auth/login', { email: 'kojo@example.com', password: 'remembered1' })).status, 200);
  } finally {
    srv.close();
  }
});

test('JHMMC points: weigh-in, secretary approval, calendar and standings', async () => {
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads3'), mailer, adminEmail: 'boss@example.com' });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body) => {
      const headers = cookie ? { cookie } : {};
      let payload = body;
      if (body && !(body instanceof FormData)) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(at + url, { method, headers, body: payload });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  };
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  // Weighmasters attach the photo of the fish on the scale.
  const weighed = (fields) => {
    const fd = form(fields);
    fd.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    return fd;
  };
  try {
    const boss = as();
    await boss('POST', '/auth/register', { name: 'Boss', email: 'boss@example.com', password: 'password1' });
    const sec = as();
    await sec('POST', '/auth/register', { name: 'Robert Secretary', email: 'sec@example.com', password: 'password1' });
    const wm = as();
    await wm('POST', '/auth/register', { name: 'Weigh Master', email: 'wm@example.com', password: 'password1' });
    const users = (await boss('GET', '/admin/users')).body.users;
    const idOf = (email) => users.find((u) => u.email === email).id;
    assert.equal((await sec('PATCH', `/admin/users/${idOf('wm@example.com')}`, { role: 'weighmaster' })).status, 403, 'only the admin sets roles');
    await boss('PATCH', `/admin/users/${idOf('sec@example.com')}`, { role: 'secretary' });
    await boss('PATCH', `/admin/users/${idOf('wm@example.com')}`, { role: 'weighmaster' });
    assert.deepEqual([(await wm('GET', '/me')).body.user.canWeigh, (await wm('GET', '/me')).body.user.canReview], [true, false]);
    assert.equal((await sec('GET', '/me')).body.user.canReview, true);

    const cap = as();
    await cap('POST', '/auth/register', { name: 'Ocean Captain', email: 'oc@example.com', password: 'password1' });
    const jhmmc = (await cap('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const ocean = (await cap('POST', '/teams', { name: 'Sea Hunter', clubId: jhmmc })).body.team;
    assert.equal(ocean.division, 'ocean');
    const rcap = as();
    await rcap('POST', '/auth/register', { name: 'River Captain', email: 'rc@example.com', password: 'password1' });
    const river = (await rcap('POST', '/teams', { name: 'Lofa Runner', division: 'river', clubId: jhmmc })).body.team;
    assert.equal(river.division, 'river');
    // A boat from another club: no division, no JHMMC weigh-in or points.
    const other = as();
    await other('POST', '/auth/register', { name: 'Tema Captain', email: 'tc@example.com', password: 'password1' });
    const tema = (await other('POST', '/clubs', { name: 'Tema Game Fishing', country: 'Ghana' })).body.club;
    const visitor = (await other('POST', '/teams', { name: 'Black Star', division: 'river', clubId: tema.id })).body.team;
    assert.equal(visitor.division, 'ocean', 'division only applies to JHMMC boats');

    const species = (await cap('GET', '/meta')).body.species;
    const sp = (n) => species.find((x) => x.name === n);
    assert.equal(sp('Wahoo').pointsPerKg, 5);
    assert.equal(sp('Butter nose').pointsPerKg, 5);

    // Crew posts are for the feed only, whatever the date: they never enter JHMMC scoring.
    let r = await cap('POST', '/catches', form({ speciesId: sp('Wahoo').id, caughtOn: '2026-10-25', weightKg: '19' }));
    const post = r.body.catch;
    assert.equal(post.status, 'unofficial');
    r = await other('POST', '/catches', form({ speciesId: sp('Wahoo').id, caughtOn: '2026-10-25', weightKg: '30' }));
    assert.equal(r.body.catch.status, 'unofficial');
    assert.equal((await wm('POST', '/weigh', weighed({ teamId: visitor.id, anglerId: 'other', anglerName: 'X', speciesId: sp('Wahoo').id,
      caughtOn: '2026-10-25', weightKg: '30', weighStation: 'Extreme' }))).status, 400, 'only JHMMC boats are registered');

    // Sunday 25 Oct 2026: the weighmaster registers a wahoo and a released marlin for Sea Hunter.
    const capId = (await cap('GET', '/me')).body.user.id;
    const reg = { teamId: ocean.id, anglerId: capId, caughtOn: '2026-10-25' };
    assert.equal((await cap('POST', '/weigh', weighed({ ...reg, speciesId: sp('Wahoo').id, weightKg: '21', weighStation: 'Extreme' }))).status, 403);
    assert.equal((await wm('POST', '/weigh', weighed({ ...reg, speciesId: sp('Wahoo').id, weightKg: '21', weighStation: 'Nowhere' }))).status, 400);
    assert.equal((await wm('POST', '/weigh', form({ ...reg, speciesId: sp('Wahoo').id, weightKg: '21', weighStation: 'Extreme' }))).status, 400, 'scale photo needed');
    r = await wm('POST', '/weigh', weighed({ ...reg, speciesId: sp('Wahoo').id, weightKg: '21', weighStation: 'Extreme', lineClass: '50 lb' }));
    const wahoo = r.body.catch;
    assert.match(wahoo.scalePhotoUrl, /^\/uploads\//);
    assert.deepEqual([wahoo.status, wahoo.weightKg, wahoo.weighStation, wahoo.angler], ['pending_review', 21, 'Extreme', 'Ocean Captain']);
    r = await wm('POST', '/weigh', form({ ...reg, speciesId: sp('Atlantic blue marlin').id, released: 'on' }));
    assert.equal(r.status, 201, 'released fish need no weight or scale photo');
    const marlin = r.body.catch;

    // The feed only shows posts; a boat's registrations are listed separately.
    const feed = (await as()('GET', `/catches?team=${ocean.id}`)).body.catches.map((c) => c.id);
    assert.deepEqual(feed, [post.id]);
    const regs = (await as()('GET', `/catches?team=${ocean.id}&official=1`)).body.catches.map((c) => c.id);
    assert.deepEqual(regs.sort(), [wahoo.id, marlin.id].sort());
    assert.equal((await cap('DELETE', `/catches/${wahoo.id}`)).status, 403, 'crews cannot remove registrations');

    // Weighmaster records a river fish brought to Lofa River for a guest.
    r = await wm('POST', '/weigh', weighed({ teamId: river.id, anglerId: 'other', anglerName: 'Guest Kollie', speciesId: sp('Snapper').id,
      caughtOn: '2026-10-25', weightKg: '1.5', weighStation: 'Lofa River' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const snapper = r.body.catch;
    // Saturday catch: logged but not a scoring day.
    r = await wm('POST', '/weigh', weighed({ teamId: ocean.id, anglerId: 'other', anglerName: 'Guest', speciesId: sp('Barracuda').id,
      caughtOn: '2026-10-24', weightKg: '8', weighStation: 'Beerville' }));
    const saturday = r.body.catch;

    const queue = (await sec('GET', '/officials/queue')).body;
    const sug = (id) => queue.toReview.find((c) => c.id === id).suggested.points;
    assert.equal(sug(wahoo.id), 105);
    assert.equal(sug(marlin.id), 500);
    assert.equal(sug(snapper.id), 7.5, 'river minimum is 1 kg');
    assert.equal(sug(saturday.id), 0, 'Saturday is not a scoring day');
    const wmQueue = (await wm('GET', '/officials/queue')).body.toReview;
    assert.ok(wmQueue.length > 0 && wmQueue.every((c) => c.loggedBy === idOf('wm@example.com')), 'weighmasters see only their own registrations');

    assert.equal((await wm('POST', `/catches/${wahoo.id}/review`, { decision: 'approve' })).status, 403);
    assert.equal((await sec('POST', `/catches/${wahoo.id}/review`, { decision: 'approve', points: 90 })).status, 400, 'changed points need a note');
    r = await sec('POST', `/catches/${wahoo.id}/review`, { decision: 'approve' });
    assert.deepEqual([r.body.catch.status, r.body.catch.points], ['approved', 105]);
    await sec('POST', `/catches/${marlin.id}/review`, { decision: 'approve' });
    await sec('POST', `/catches/${snapper.id}/review`, { decision: 'approve' });
    assert.equal((await sec('POST', `/catches/${saturday.id}/review`, { decision: 'reject' })).status, 400, 'rejections need a reason');
    await sec('POST', `/catches/${saturday.id}/review`, { decision: 'reject', note: 'Not a scoring day' });
    assert.equal((await cap('DELETE', `/catches/${wahoo.id}`)).status, 403, 'approved catches are locked for crews');

    // Tournament on Saturday 17 Oct: secretary adds it, then a catch that day scores.
    assert.equal((await cap('POST', '/events', { date: '2026-10-17', kind: 'tournament', name: 'October Cup' })).status, 403);
    const cup = (await sec('POST', '/events', { date: '2026-10-17', kind: 'tournament', name: 'October Cup' })).body.event;
    r = await wm('POST', '/weigh', weighed({ teamId: ocean.id, anglerId: 'other', anglerName: 'Guest', speciesId: sp('Yellowfin tuna').id,
      caughtOn: '2026-10-17', weightKg: '40', weighStation: 'Barracuda Club' }));
    await sec('POST', `/catches/${r.body.catch.id}/review`, { decision: 'approve' });

    const oceanTable = (await as()('GET', '/points?division=ocean')).body;
    assert.deepEqual(oceanTable.boats.map((b) => [b.teamName, b.points]), [['Sea Hunter', 725]]);
    assert.equal(oceanTable.tournaments[0].name, 'October Cup');
    assert.deepEqual([oceanTable.tournaments[0].winner.teamName, oceanTable.tournaments[0].winner.points], ['Sea Hunter', 120]);
    const riverTable = (await as()('GET', '/points?division=river')).body;
    assert.deepEqual(riverTable.boats.map((b) => [b.teamName, b.points]), [['Lofa Runner', 7.5]]);
    const results = (await as()('GET', `/tournaments/${cup.id}`)).body.results;
    assert.deepEqual(results.map((b) => [b.teamName, b.points, b.catches.length]), [['Sea Hunter', 120, 1]]);

    // JHMMC's records come from approved registrations; the West Africa leaderboard from posts.
    const jhRecords = (await as()('GET', `/records?club=${jhmmc}`)).body.species;
    assert.equal(jhRecords.find((x) => x.name === 'Wahoo').best.weightKg, 21, 'registration, not the 19 kg post');
    const lb = (await as()('GET', '/leaderboard')).body;
    assert.deepEqual(lb.records.filter((x) => x.species === 'Wahoo').map((x) => x.weightKg), [30], 'posts only');

    // Scoring table and season dates.
    assert.equal((await sec('PATCH', `/species/${sp('Atlantic sailfish').id}`, { pointsPerKg: 4 })).status, 200);
    assert.equal((await as()('GET', '/meta')).body.species.find((x) => x.name === 'Atlantic sailfish').pointsPerKg, 4);
    assert.equal((await sec('PATCH', '/settings/season', { start: '2027-01-01', end: '2026-01-01' })).status, 400);
    r = await sec('PATCH', '/settings/season', { start: '2026-12-01', end: '2027-11-30' });
    assert.equal((await as()('GET', '/points?division=ocean')).body.boats.length, 0, 'October is outside the new season');
  } finally {
    srv.close();
  }
});
