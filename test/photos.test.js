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

test('a fish shows two photos at most, the weigh station one first; videos only for officers and the crew', async () => {
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
    assert.equal((await as()('GET', `/catches/${sailfish.id}`)).body.catch.videoUrl, null, 'a release video waits for the secretary');
    assert.equal((await capB('GET', `/catches/${sailfish.id}`)).body.catch.scaleVideoUrl, null);
    assert.ok((await capA('GET', `/catches/${sailfish.id}`)).body.catch.videoUrl, 'the crew sees it');
    assert.equal((await sec('POST', `/catches/${sailfish.id}/review`, { decision: 'approve' })).status, 200);

    const asSeenBy = async (who) => (await who('GET', `/catches/${marlin.id}`)).body.catch;
    const pub = await asSeenBy(as());
    assert.equal(pub.photos.length, 2, 'the weigh station photo and the crew photo');
    assert.equal(pub.photoUrl, pub.scalePhotoUrl, 'the weigh station photo is the main one');
    assert.notEqual(pub.photos[1].url, pub.scalePhotoUrl);
    assert.equal(pub.scaleVideoUrl, null, 'no video for the public');
    assert.equal((await asSeenBy(capB)).scaleVideoUrl, null, 'nor for another boat');
    assert.ok((await asSeenBy(sec)).scaleVideoUrl, 'the secretary sees it');
    assert.ok((await asSeenBy(capA)).scaleVideoUrl, 'and the crew');
    assert.equal(pub.videoUrl, null, 'the scale video stays out of the gallery');
    // A release video is for everyone.
    const rel = (await as()('GET', `/catches/${sailfish.id}`)).body.catch;
    assert.match(rel.videoUrl, /\.mp4$/);
    const post = (await as()('GET', '/feed?type=weighins')).body.items[0];
    const [m, s2] = ['Blue marlin', 'Sailfish'].map((n) => post.fish.find((f) => f.species === n));
    assert.equal(m.photos.length, 2);
    assert.equal(m.photos[0], pub.scalePhotoUrl);
    assert.equal(m.videoUrl, null, 'no scale video in the feed');
    assert.equal(s2.videoUrl, rel.videoUrl, 'the release video is');
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
