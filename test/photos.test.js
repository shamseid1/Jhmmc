const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test('weigh station photo first, the crew\'s own second; log photo on the boated line; scale video is evidence', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-disputes-'));
  const dbFile = path.join(tmp, 'fishing.db');
  const pusher = { publicKey: 'k', send: async () => true };
  const app = createApp({ openClubs: true, dbFile, uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher });
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
  const person = async (name, nickname, email) => {
    if (!email) [nickname, email] = [undefined, nickname];
    const c = as();
    await c('POST', '/auth/register', { name, nickname, email, password: 'password1' });
    return c;
  };
  try {
    const boss = await person('Boss Admin', 'Boss', 'boss@example.com');
    const sec = await person('Robert Khoueiry', 'Robert', 'sec@example.com');
    const capA = await person('Captain A', 'a@example.com');
    const capB = await person('Captain B', 'b@example.com');
    const crewB = await person('Deck Hand', 'crew@example.com');
    const outsider = await person('Tema Captain', 't@example.com');
    const users = (await boss('GET', '/admin/users')).body.users;
    await boss('PATCH', `/admin/users/${users.find((u) => u.email === 'sec@example.com').id}`, { jhmmc: true, role: 'secretary' });
    const jhmmc = (await capA('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const seaHunter = (await capA('POST', '/teams', { name: 'Sea Hunter', clubId: jhmmc, weighStation: 'Extreme' })).body.team;
    const reelDeal = (await capB('POST', '/teams', { name: 'Reel Deal', clubId: jhmmc, weighStation: 'Beerville' })).body.team;
    await crewB('POST', '/teams/join', { code: reelDeal.joinCode });
    const tema = (await outsider('POST', '/clubs', { name: 'Tema Game Fishing', country: 'Ghana' })).body.club;
    await outsider('POST', '/teams', { name: 'Black Star', clubId: tema.id });
    const species = (await capA('GET', '/meta')).body.species;
    const sp = (n) => species.find((x) => x.name === n).id;

    const today = new Date().toISOString().slice(0, 10);
    // Logged at sea with the crew's photo...
    const trip = (await capA('POST', '/outings/fish', { speciesId: sp('Blue marlin'), fate: 'kept', lat: 6.2, lng: -11, landedAt: new Date().toISOString(), date: today })).body.trip;
    const pf = new FormData();
    pf.set('photo', new Blob([PNG], { type: 'image/png' }), 'crew.png');
    assert.equal((await capA('POST', `/outings/fish/${trip.landings[0].id}/photo`, pf)).status, 200);
    // ...then weighed with a scale photo and a video.
    const fd = new FormData();
    for (const [k, v] of Object.entries({ teamId: seaHunter.id, caughtOn: today, declared: 'yes', deviceLat: '6.3', deviceLng: '-10.8' })) fd.set(k, v);
    fd.set('fish', JSON.stringify([{ speciesId: sp('Blue marlin'), anglerId: 'other', anglerName: 'Guest', weightKg: '210' },
      { speciesId: sp('Sailfish'), anglerId: 'other', anglerName: 'Guest', released: true }]));
    fd.set('scalevideo_1', new Blob([Buffer.from('fake')], { type: 'video/mp4' }), 'release.mp4');
    fd.set('scale_0', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    fd.set('scalevideo_0', new Blob([Buffer.from('fake')], { type: 'video/mp4' }), 'scale.mp4');
    const r = await capA('POST', '/weigh/sheet', fd);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const [marlin, sailfish] = r.body.catches;
    assert.equal((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'approve' })).status, 200);
    // The crew adds their own photo after the weigh-in: a second one for that fish.
    const dock = new FormData();
    dock.set('photo', new Blob([PNG], { type: 'image/png' }), 'dock.png');
    assert.equal((await capA('POST', `/catches/${marlin.id}/photo`, dock)).status, 200);
    assert.equal((await as()('GET', `/catches/${sailfish.id}`)).body.catch.videoUrl, null, 'a release video waits for the secretary');
    assert.ok((await capB('GET', `/catches/${sailfish.id}`)).body.catch.scaleVideoUrl, 'JHMMC captains see the evidence, to dispute');
    assert.equal((await crewB('GET', `/catches/${sailfish.id}`)).body.catch.scaleVideoUrl, null, 'but not another boat\'s crew');
    assert.ok((await capA('GET', `/catches/${sailfish.id}`)).body.catch.videoUrl, 'the crew sees it');
    assert.equal((await sec('POST', `/catches/${sailfish.id}/review`, { decision: 'approve' })).status, 200);

    // The only marlin that day: its weight goes on the logged fish.
    const day = (await capA('GET', `/outings/trip?date=${today}`)).body.trip;
    assert.deepEqual(day.landings.filter((l) => l.species === 'Blue marlin').map((l) => [l.scaleKg, l.scaleShared]), [[210, false]]);
    const asSeenBy = async (who) => (await who('GET', `/catches/${marlin.id}`)).body.catch;
    const pub = await asSeenBy(as());
    assert.equal(pub.photos.length, 2, 'the weigh station photo and the crew\'s own');
    assert.notEqual(pub.photoUrl, pub.scalePhotoUrl, 'the crew\'s own photo comes first');
    assert.equal(pub.photos[1].url, pub.scalePhotoUrl, 'the weigh station photo second');
    assert.equal(pub.ownPhoto, true);
    assert.equal(pub.scaleVideoUrl, null, 'no video for the public');
    assert.equal((await asSeenBy(crewB)).scaleVideoUrl, null, 'the scale video isn\'t for another boat\'s crew');
    const secView = await asSeenBy(sec);
    assert.ok((await asSeenBy(capB)).scaleVideoUrl, 'JHMMC captains see the scale video');
    assert.ok((await asSeenBy(sec)).scaleVideoUrl, 'the secretary sees it');
    assert.ok((await asSeenBy(capA)).scaleVideoUrl, 'and the crew');
    assert.equal(pub.videoUrl, null, 'the scale video stays out of the gallery');
    // A release video is for everyone.
    const rel = (await as()('GET', `/catches/${sailfish.id}`)).body.catch;
    assert.match(rel.videoUrl, /\.mp4$/);
    const post = (await as()('GET', '/feed?type=weighins')).body.items[0];
    const [m, s2] = ['Blue marlin', 'Sailfish'].map((n) => post.fish.find((f) => f.species === n));
    assert.deepEqual(m.photos, pub.photos.map((x) => x.url), 'the weigh-in post: the crew\'s photo, then the weigh station\'s');
    assert.deepEqual(s2.photos, [], 'a released fish: no weigh station photo, no crew photo yet');
    // Added later by the crew; not by another boat or the public.
    const later = new FormData();
    later.set('photo', new Blob([PNG], { type: 'image/png' }), 'later.png');
    assert.equal((await crewB('POST', `/catches/${sailfish.id}/photo`, later)).status, 403);
    assert.equal((await as()('POST', `/catches/${sailfish.id}/photo`, later)).status, 401);
    const added = (await capA('POST', `/catches/${sailfish.id}/photo`, later)).body.catch;
    assert.match(added.photoUrl, /^\/uploads\//);
    assert.equal((await as()('GET', '/feed?type=weighins')).body.items[0].fish.find((f) => f.species === 'Sailfish').photos[0], added.photoUrl);
    // On the boat's own page, each fish is its own post.
    const onBoat = (await as()('GET', `/feed?team=${seaHunter.id}&type=weighins`)).body.items;
    assert.deepEqual(onBoat.map((x) => [x.single, x.fish.map((f) => f.species)]).sort(), [[true, ['Blue marlin']], [true, ['Sailfish']]]);
    assert.equal((await as()('GET', '/feed?type=weighins')).body.items.filter((x) => x.teamId === seaHunter.id).length, 1, 'the main feed keeps the day together');
    // The boat's page: its fish to show off, with the highlights.
    const wall = (await as()('GET', `/trophies?team=${seaHunter.id}`)).body;
    assert.deepEqual(wall.fish.map((f) => f.species).sort(), ['Blue marlin', 'Sailfish']);
    assert.deepEqual([wall.stats.weighed, wall.stats.releases, wall.stats.place], [1, 1, 1]);
    assert.equal(wall.biggest.species, 'Blue marlin');
    assert.equal(wall.fish.find((f) => f.species === 'Blue marlin').photoUrl, pub.photoUrl, 'the crew\'s photo on the tile');
    assert.equal((await as()('GET', '/trophies')).status, 400);
    assert.equal(wall.stats.board, 'jhmmc', 'a JHMMC boat shows the JHMMC Season table');
    // A guest angler (a typed name) has a page too.
    const guestWall = (await as()('GET', '/trophies?angler=guest')).body;
    assert.deepEqual(guestWall.fish.map((f) => f.species).sort(), ['Blue marlin', 'Sailfish'], 'by name, any case');
    assert.equal(guestWall.stats.place, 1);
    // The "boated" line keeps the crew's photo from the log, as its own post.
    const all = (await as()('GET', '/feed')).body.items;
    const boated = all.find((x) => x.kind === 'log' && x.species === 'Blue marlin');
    assert.ok(boated?.photoUrl && !pub.photos.some((x) => x.url === boated.photoUrl), 'the log photo stays on the boated line only');
    assert.equal(m.videoUrl, null, 'no scale video in the feed');
    assert.equal(s2.videoUrl, rel.videoUrl, 'the release video is');

    // The secretary changes their mind after approving: points, not counted, deleted.
    assert.match((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 2100 })).body.error, /kg/);
    assert.match((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 21 })).body.error, /note/);
    assert.equal((await capB('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 21, note: 'x' })).status, 403);
    // Typed wrong: the scale said 250. The points follow from the rules.
    let k = (await sec('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 250, note: 'Scale photo says 250' })).body.catch;
    assert.deepEqual([k.status, k.weightKg, k.points], ['approved', 250, 1250]);
    assert.equal((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 250, note: 'x' })).status, 400, 'already its weight');
    assert.equal((await sec('POST', `/catches/${sailfish.id}/review`, { decision: 'weight', weightKg: 30, note: 'x' })).status, 400, 'a released fish has no weight');
    assert.match((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'reject' })).body.error, /reason/);
    const rj = await sec('POST', `/catches/${marlin.id}/review`, { decision: 'reject', note: 'Late dispute upheld' }); k = rj.body.catch; assert.ok(k, JSON.stringify(rj));
    assert.deepEqual([k.status, k.points], ['rejected', null]);
    assert.equal((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'weight', weightKg: 50, note: 'x' })).status, 400, 'no weight to correct once not counted');
    assert.ok(!(await as()('GET', '/feed?type=weighins')).body.items[0].fish.some((f) => f.id === marlin.id), 'off the weigh-in post');
    assert.match((await sec('DELETE', `/catches/${sailfish.id}`)).body.error, /reason/);
    assert.equal((await sec('DELETE', `/catches/${sailfish.id}`, { reason: 'Registered twice' })).status, 200);
    const record = (await sec('GET', `/registrations/log?catch=${marlin.id}`)).body.fish[0].steps.map((e) => [e.action, e.note]);
    assert.deepEqual(record.slice(-3), [['approved', null], ['repointed', 'Weight corrected from 210 to 250 kg: Scale photo says 250'], ['uncounted', 'Late dispute upheld']]);
    const gone = (await sec('GET', `/registrations/log?catch=${sailfish.id}`)).body.fish[0].steps.at(-1);
    assert.deepEqual([gone.action, gone.note], ['deleted', 'Registered twice']);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
