const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const MP4 = () => new Blob([Buffer.from('00000018667479706d703432', 'hex')], { type: 'video/mp4' });

test('posts and registrations: videos, editing back on land, spots on the catch map, the numbers behind the points', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-posts-'));
  const app = createApp({ openPosts: true, dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher: { publicKey: 'k', send: async () => true } });
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
  const person = async (firstName, lastName, email) => {
    const c = as();
    await c('POST', '/auth/register', { firstName, lastName, email, password: 'password1' });
    return c;
  };
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const boss = await person('Boss', 'Admin', 'boss@example.com');
    const sec = await person('Robert', 'Khoueiry', 'sec@example.com');
    const cap = await person('Rayan', 'Eid', 'rayan@example.com');
    const users = (await boss('GET', '/admin/users')).body.users;
    await boss('PATCH', `/admin/users/${users.find((u) => u.email === 'sec@example.com').id}`, { jhmmc: true, role: 'secretary' });
    const jhmmc = (await cap('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const boat = (await cap('POST', '/teams', { name: 'Liberian Girl', clubId: jhmmc, weighStation: 'Extreme' })).body.team;
    const sp = Object.fromEntries((await cap('GET', '/meta')).body.species.map((s) => [s.name, s.id]));
    const registration = (fields) => form({ teamId: boat.id, anglerId: 'other', anglerName: 'Guest', declared: 'yes', noWeighmaster: 'absent', deviceLat: '6.3', deviceLng: '-10.8', caughtOn: today, ...fields });

    // Videos: on a post, and of a fish on the scale (the photo stays required).
    const post = form({ speciesId: sp.Wahoo, weightKg: '15' });
    post.set('video', MP4(), 'post.mp4');
    const shown = (await cap('POST', '/catches', post)).body.catch;
    assert.match(shown.videoUrl, /^\/uploads\/.+\.mp4$/);
    assert.equal((await fetch(at.replace('/api', '') + shown.videoUrl)).status, 200);
    const notVideo = form({ speciesId: sp.Wahoo });
    notVideo.set('video', new Blob([PNG], { type: 'image/png' }), 'a.png');
    assert.match((await cap('POST', '/catches', notVideo)).body.error, /Video must be/);
    const reg = registration({ speciesId: sp.Wahoo, weightKg: '18' });
    reg.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    reg.set('scaleVideo', MP4(), 'scale.mp4');
    const withVideo = (await cap('POST', '/weigh', reg)).body.catch;
    assert.deepEqual([withVideo.videoUrl, /\.mp4$/.test(withVideo.scaleVideoUrl), /\.png$/.test(withVideo.scalePhotoUrl)], [null, true, true]);
    const onlyVideo = registration({ speciesId: sp.Wahoo, weightKg: '18' });
    onlyVideo.set('scaleVideo', MP4(), 'scale.mp4');
    assert.match((await cap('POST', '/weigh', onlyVideo)).body.error, /photo/, 'a video alone is not enough: the photo is needed');
    await cap('DELETE', `/catches/${withVideo.id}`);
    await cap('DELETE', `/catches/${shown.id}`);
    // A post's date is optional: today.
    const undated = (await cap('POST', '/catches', form({ speciesId: sp.Wahoo }))).body.catch;
    assert.equal(undated.caughtOn, today);
    await cap('DELETE', `/catches/${undated.id}`);
    // Any photo can be a post: no species needed (registrations still need one).
    const crewShot = (await cap('POST', '/catches', form({ notes: 'Sunset run home' }))).body.catch;
    assert.deepEqual([crewShot.species, crewShot.notes], [null, 'Sunset run home']);
    assert.equal((await cap('GET', '/records')).status, 200, 'records skip posts without a species');
    await cap('DELETE', `/catches/${crewShot.id}`);
    // Nor an angler: it's the poster's post, and nobody's catch.
    const before = (await cap('GET', `/users/${crewShot.userId}`)).body.stats.catches;
    const untagged = (await cap('POST', '/catches', form({ speciesId: sp.Wahoo, anglerId: '' }))).body.catch;
    assert.equal(untagged.noAngler, true);
    assert.equal((await cap('GET', `/users/${crewShot.userId}`)).body.stats.catches, before);
    await cap('DELETE', `/catches/${untagged.id}`);

    // Editing, back on land: the weight, the spot and more photos...
    const quick = (await cap('POST', '/catches', form({ speciesId: sp.Wahoo }))).body.catch;
    const more = form({ weightKg: '27.5', notes: 'Weighed at the dock', lat: '6.2', lng: '-11.1' });
    more.append('photos', new Blob([PNG], { type: 'image/png' }), 'a.png');
    more.append('photos', new Blob([PNG], { type: 'image/png' }), 'b.png');
    let edited = (await cap('PATCH', `/catches/${quick.id}`, more)).body.catch;
    assert.deepEqual([edited.weightKg, edited.notes, edited.photos.length, edited.lat, edited.species], [27.5, 'Weighed at the dock', 2, 6.2, 'Wahoo']);
    assert.equal(edited.photos[0].id, 'cover');
    assert.equal((await sec('PATCH', `/catches/${quick.id}`, form({ weightKg: '1' }))).status, 403, "not someone else's post");
    assert.match((await cap('PATCH', `/catches/${quick.id}`, form({ weightKg: '-3' }))).body.error, /positive/);
    // ...remove the first photo: the next moves up.
    edited = (await cap('PATCH', `/catches/${quick.id}`, form({ removePhotos: JSON.stringify(['cover']) }))).body.catch;
    assert.deepEqual([edited.photos.length, edited.photos[0].id], [1, 'cover']);

    // My catch map: your spots by year, only yours.
    await cap('POST', '/catches', form({ speciesId: sp['Sailfish'], released: 'on', lat: '6.5', lng: '-11.0' }));
    const map = (await cap('GET', '/me/spots')).body;
    assert.deepEqual(map.years, [today.slice(0, 4)]);
    assert.deepEqual(map.spots.map((x) => [x.species, x.lat]).sort(), [['Sailfish', 6.5], ['Wahoo', 6.2]]);
    assert.equal((await cap('GET', '/me/spots?year=1999')).body.spots.length, 2, 'an unknown year shows all');
    assert.equal((await sec('GET', '/me/spots')).body.spots.length, 0, "nobody else's spots");
    assert.equal((await as()('GET', '/me/spots')).status, 401);

    // An approved registration can't be edited, and the numbers on the points
    // tables open the fish behind them.
    const scaled = registration({ speciesId: sp.Wahoo, weightKg: '20' });
    scaled.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    const fish = (await cap('POST', '/weigh', scaled)).body.catch;
    assert.equal((await sec('POST', `/catches/${fish.id}/review`, { decision: 'approve' })).status, 200);
    assert.equal((await cap('PATCH', `/catches/${fish.id}`, form({ weightKg: '1' }))).status, 403, "registrations can't be edited");
    const board = (await as()('GET', '/points?division=ocean')).body;
    const row = board.boats.find((b) => b.teamId === boat.id);
    const drill = (await as()('GET', `/points/fish?division=ocean&team=${boat.id}`)).body;
    assert.deepEqual([drill.title, drill.fish.length, drill.total, drill.fish[0].species], ['Liberian Girl', row.catches, row.points, 'Wahoo']);
    const guestRow = board.anglers.find((a) => a.angler === 'Guest');
    const byAngler = (await as()('GET', `/points/fish?division=ocean&angler=${encodeURIComponent(guestRow.anglerKey)}`)).body;
    assert.deepEqual([byAngler.fish.length, byAngler.total], [guestRow.catches, guestRow.points]);
    assert.equal((await as()('GET', `/points/fish?division=ocean&scope=tournaments&team=${boat.id}`)).body.fish.length, 0, 'no tournament entered');
    assert.equal((await as()('GET', '/points/fish')).status, 400);

    // The secretary's announcements go on the feed too; captains can't post them.
    assert.equal((await cap('POST', '/announcements', { title: 'Hi' })).status, 403);
    assert.match((await sec('POST', '/announcements', { title: ' ' })).body.error, /title/);
    const ann = (await sec('POST', '/announcements', { title: 'Tournament on Saturday', body: 'Pay your membership by Friday.' })).body;
    const top = (await as()('GET', '/feed')).body.items.find((x) => x.kind === 'announcement');
    assert.deepEqual([top.kind, top.title, top.body, top.angler], ['announcement', 'Tournament on Saturday', 'Pay your membership by Friday.', 'Robert Khoueiry']);
    assert.ok((await as()('GET', '/feed?type=announcements')).body.items.every((x) => x.kind === 'announcement'));
    assert.equal((await as()('GET', `/feed?team=${boat.id}`)).body.items.some((x) => x.kind === 'announcement'), false, "not on a boat's page");
    assert.equal((await sec('DELETE', `/announcements/${ann.id}`)).status, 200);

    // Approved weigh-ins go on the feed by themselves.
    const weighins = (await as()('GET', `/feed?type=weighins&team=${boat.id}`)).body.items;
    assert.ok(weighins.length > 0 && weighins.every((x) => x.kind === 'weighin' && x.boat === 'Liberian Girl'));
    // One post per boat and day, with all its fish listed, heaviest first.
    assert.equal(weighins.filter((x) => x.day === today).length, 1);
    const daily = weighins.find((x) => x.day === today);
    assert.ok(daily.fish.length >= 1 && daily.fish.some((f) => f.angler === 'Guest' && f.species === 'Wahoo' && f.weightKg));
    assert.deepEqual(daily.fish.map((f) => f.weightKg ?? -1), [...daily.fish.map((f) => f.weightKg ?? -1)].sort((a, b) => b - a));
    assert.equal(daily.points, Math.round(daily.fish.reduce((n, f) => n + f.points, 0) * 10) / 10, 'the sheet\'s total points');

    // The log and the scale: three tunas logged at sea, then registered.
    // Nobody knows which tuna weighed what, so no single tuna shows a weight:
    // the day's tuna weights go on the species instead.
    const tuna = sp['Yellowfin tuna'];
    for (const n of [1, 2, 3]) await cap('POST', '/outings/fish', { speciesId: tuna, fate: 'kept', lat: 6 + n / 10, lng: -10.5, date: today });
    for (const kg of ['41', '28', '35']) {
      const t = registration({ speciesId: tuna, weightKg: kg });
      t.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 's.png');
      assert.equal((await cap('POST', '/weigh', t)).status, 201);
    }
    let trip = (await cap('GET', `/outings/trip?date=${today}`)).body.trip;
    const tunas = trip.landings.filter((l) => l.speciesId === tuna);
    assert.deepEqual(tunas.map((l) => [l.scaleKg, l.scaleShared]), [[null, true], [null, true], [null, true]], 'weighed, but not one weight each');
    assert.deepEqual(trip.fish.find((f) => f.speciesId === tuna).weighedKg, [41, 35, 28], 'the weights together, heaviest first');
    // Logged 3 tunas, brought 5 to the scale: the log counts 5.
    const extra = [];
    for (const kg of ['22', '19']) {
      const t = registration({ speciesId: tuna, weightKg: kg });
      t.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 's.png');
      extra.push((await cap('POST', '/weigh', t)).body.catch.id);
    }
    trip = (await cap('GET', `/outings/trip?date=${today}`)).body.trip;
    const five = trip.landings.filter((l) => l.speciesId === tuna);
    assert.deepEqual(five.map((l) => [l.scaleKg, !!l.fromScale]), [[null, false], [null, false], [null, false], [null, true], [null, true]]);
    assert.deepEqual(trip.fish.find((f) => f.speciesId === tuna).weighedKg, [41, 35, 28, 22, 19]);
    assert.equal(trip.fish.find((f) => f.speciesId === tuna).kept, 5);
    // One withdrawn: it leaves the log with it.
    await cap('DELETE', `/catches/${extra[1]}`);
    trip = (await cap('GET', `/outings/trip?date=${today}`)).body.trip;
    assert.equal(trip.fish.find((f) => f.speciesId === tuna).kept, 4);
    // The crew logs the fourth tuna afterwards, with its spot: it takes the
    // weigh-station one's place instead of counting twice.
    await cap('POST', '/outings/fish', { speciesId: tuna, fate: 'kept', lat: 6.5, lng: -10.5, date: today });
    trip = (await cap('GET', `/outings/trip?date=${today}`)).body.trip;
    assert.equal(trip.fish.find((f) => f.speciesId === tuna).kept, 4);
    assert.deepEqual(trip.landings.filter((l) => l.speciesId === tuna).at(-1), { ...trip.landings.filter((l) => l.speciesId === tuna).at(-1), scaleKg: null, scaleShared: true, fromScale: 0, lat: 6.5 });
    // A photo on a logged fish shows on the feed; the weigh-in post carries the scale photos.
    const someTuna = trip.landings.find((l) => l.speciesId === tuna);
    const pic = new FormData();
    pic.set('photo', new Blob([PNG], { type: 'image/png' }), 'tuna.png');
    assert.equal((await sec('POST', `/outings/fish/${someTuna.id}/photo`, pic)).status, 403, "not the secretary's boat");
    const withPic = (await cap('POST', `/outings/fish/${someTuna.id}/photo`, pic)).body.trip.landings.find((l) => l.id === someTuna.id);
    assert.match(withPic.photoUrl, /^\/uploads\//);
    const feedNow = (await as()('GET', `/feed?team=${boat.id}`)).body.items;
    assert.equal(feedNow.find((x) => x.kind === 'log' && x.id === someTuna.id).photoUrl, withPic.photoUrl);
    const wPost = feedNow.find((x) => x.kind === 'weighin' && x.day === today);
    assert.ok(wPost.fish.filter((f) => f.weightKg).every((f) => f.photos.length === 1), 'each weighed fish: its weigh station photo');
    assert.ok(wPost.fish.every((f) => !f.videoUrl || f.released), 'only release videos in the feed; scale videos are for the secretary');
    // Once that tuna is approved there are two posts: boated (crew photo) and the weigh-in (its weigh station photo).
    assert.equal((await sec('POST', `/catches/${someTuna.catchId}/review`, { decision: 'approve' })).status, 200);
    const after = (await as()('GET', `/feed?team=${boat.id}`)).body.items;
    assert.equal(after.find((x) => x.kind === 'log' && x.id === someTuna.id)?.photoUrl, withPic.photoUrl, 'the boated line stays, with the crew photo');
    const tunaPics = after.find((x) => x.kind === 'weighin' && x.day === today).fish.find((f) => f.id === someTuna.catchId).photos;
    assert.equal(tunaPics.length, 1, 'the weigh station photo, never the log photo');
    assert.notEqual(tunaPics[0], withPic.photoUrl);
    // The catch map shows the tunas once each, without weights (which was which isn't known).
    const tunaMap = (await cap('GET', '/me/spots')).body.spots.filter((x) => x.species === 'Yellowfin tuna');
    assert.deepEqual(tunaMap.map((x) => [x.kind, x.weightKg, x.estimate]).sort(), [['log', null, false], ['log', null, false], ['log', null, false], ['log', null, false]]);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
