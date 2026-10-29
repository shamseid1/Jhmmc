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

test('the JHMMC feed: members post through the day, approved fish join it verified', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-clubfeed-'));
  const pusher = { publicKey: 'k', send: async () => true };
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher });
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
  const person = async (firstName, lastName, email, nickname) => {
    const c = as();
    await c('POST', '/auth/register', { firstName, lastName, nickname, email, password: 'password1' });
    return c;
  };
  const form = (fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  try {
    const boss = await person('Boss', 'Admin', 'boss@example.com');
    const sec = await person('Robert', 'Khoueiry', 'sec@example.com');
    const cap = await person('Rayan', 'Eid', 'rayan@example.com', 'Ray');
    const outsider = await person('Kofi', 'Mensah', 'kofi@example.com');
    const users = (await boss('GET', '/admin/users')).body.users;
    const idOf = (email) => users.find((u) => u.email === email).id;
    await boss('PATCH', `/admin/users/${idOf('sec@example.com')}`, { jhmmc: true, role: 'secretary' });
    await boss('PATCH', `/admin/users/${idOf('rayan@example.com')}`, { jhmmc: true });

    // Members only, to read and to post.
    assert.equal((await as()('GET', '/club-feed')).status, 401);
    assert.equal((await outsider('GET', '/club-feed')).status, 403);
    assert.equal((await outsider('POST', '/club-feed', form({ body: 'Hi' }))).status, 403);
    assert.deepEqual((await cap('GET', '/club-feed')).body.items, []);

    // A message, a photo, a fish; an empty post is refused.
    assert.equal((await cap('POST', '/club-feed', form({}))).status, 400);
    assert.equal((await cap('POST', '/club-feed', form({ body: 'Lines in at 7' }))).status, 201);
    const pic = form({ body: 'Flat calm out here' });
    pic.set('photo', new Blob([PNG], { type: 'image/png' }), 'sea.png');
    assert.equal((await sec('POST', '/club-feed', pic)).status, 201);
    const sail = (await cap('GET', '/meta')).body.species.find((s) => s.name === 'Atlantic sailfish').id;
    assert.equal((await cap('POST', '/club-feed', form({ body: 'Sail released!', speciesId: sail, released: 'true' }))).status, 201);

    let items = (await cap('GET', '/club-feed')).body.items;
    assert.deepEqual(items.map((i) => [i.author, i.body, i.species ?? null, i.released]),
      [['Ray', 'Sail released!', 'Atlantic sailfish', true], ['Robert Khoueiry', 'Flat calm out here', null, false], ['Ray', 'Lines in at 7', null, false]]);
    assert.match(items[1].photoUrl, /^\/uploads\//);
    assert.deepEqual(items.map((i) => i.canDelete), [true, false, true], 'your own posts');

    // Likes and comments.
    const [first] = items;
    assert.deepEqual((await sec('POST', `/club-feed/${first.id}/like`)).body, { liked: true, likes: 1 });
    const said = (await sec('POST', `/club-feed/${first.id}/comments`, { body: 'Nice one Ray' })).body.comment;
    assert.equal((await cap('DELETE', `/club-feed/${first.id}/comments/${said.id}`)).status, 403);
    items = (await cap('GET', '/club-feed')).body.items;
    assert.deepEqual([items[0].likes, items[0].liked, items[0].comments.map((c) => [c.author, c.body])], [1, false, [['Robert Khoueiry', 'Nice one Ray']]]);
    assert.equal((await outsider('POST', `/club-feed/${first.id}/like`)).status, 403);

    // A registration joins the feed once the secretary approves it.
    const jhmmc = (await cap('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const boat = (await cap('POST', '/teams', { name: 'Liberian Girl', clubId: jhmmc, weighStation: 'Extreme' })).body.team;
    const wahoo = (await cap('GET', '/meta')).body.species.find((s) => s.name === 'Wahoo').id;
    const reg = form({ teamId: boat.id, anglerId: 'other', anglerName: 'Guest', speciesId: wahoo, weightKg: '20', declared: 'yes',
      deviceLat: '6.3', deviceLng: '-10.8', caughtOn: new Date().toISOString().slice(0, 10) });
    reg.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    const fish = (await cap('POST', '/weigh', reg)).body.catch;
    assert.ok(!(await cap('GET', '/club-feed')).body.items.some((i) => i.kind === 'verified'), 'not before approval');
    assert.equal((await sec('POST', `/catches/${fish.id}/review`, { decision: 'approve' })).status, 200);
    items = (await cap('GET', '/club-feed')).body.items;
    assert.deepEqual([items[0].kind, items[0].species, items[0].teamName, items[0].points, items[0].angler], ['verified', 'Wahoo', 'Liberian Girl', 100, 'Guest']);
    assert.match(items[0].photoUrl, /^\/uploads\//, 'with the scale photo');

    // Filters: verified fish only, any fish, photos, members' posts, one boat.
    const kinds = async (q) => (await cap('GET', `/club-feed?${q}`)).body.items.map((i) => i.kind === 'verified' ? 'verified' : i.body);
    assert.deepEqual(await kinds('show=verified'), ['verified']);
    assert.deepEqual(await kinds('show=fish'), ['verified', 'Sail released!']);
    assert.deepEqual(await kinds('show=photos'), ['Flat calm out here']);
    assert.deepEqual(await kinds('show=posts'), ['Sail released!', 'Flat calm out here', 'Lines in at 7']);
    assert.deepEqual(await kinds(`team=${boat.id}`), ['verified', 'Sail released!', 'Lines in at 7'], "the boat's fish and its crew's posts");
    assert.deepEqual(await kinds(`show=photos&team=${boat.id}`), []);

    // Videos: on a JHMMC feed post, on a West Africa post, and of a fish on the scale.
    const MP4 = new Blob([Buffer.from('00000018667479706d703432', 'hex')], { type: 'video/mp4' });
    const clip = form({ body: 'Hook-up!' });
    clip.set('video', MP4, 'clip.mp4');
    assert.equal((await cap('POST', '/club-feed', clip)).status, 201);
    const withClip = (await cap('GET', '/club-feed')).body.items.find((i) => i.body === 'Hook-up!');
    assert.match(withClip.videoUrl, /^\/uploads\/.+\.mp4$/);
    assert.equal((await fetch(at.replace('/api', '') + withClip.videoUrl)).status, 200);
    const notVideo = form({ body: 'x' });
    notVideo.set('video', new Blob([PNG], { type: 'image/png' }), 'a.png');
    assert.match((await cap('POST', '/club-feed', notVideo)).body.error, /Video must be/);
    const post = form({ speciesId: wahoo, caughtOn: new Date().toISOString().slice(0, 10), weightKg: '15' });
    post.set('video', MP4, 'post.mp4');
    const shown = (await cap('POST', '/catches', post)).body.catch;
    assert.match(shown.videoUrl, /\.mp4$/);
    const undated = (await cap('POST', '/catches', form({ speciesId: wahoo }))).body.catch;
    assert.equal(undated.caughtOn, new Date().toISOString().slice(0, 10), "a post's date is optional: today");
    await cap('DELETE', `/catches/${undated.id}`);
    const reg2 = form({ teamId: boat.id, anglerId: 'other', anglerName: 'Guest', speciesId: wahoo, weightKg: '18', declared: 'yes',
      deviceLat: '6.3', deviceLng: '-10.8', caughtOn: new Date().toISOString().slice(0, 10) });
    reg2.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    reg2.set('scaleVideo', MP4, 'scale.mp4');
    const fish2 = (await cap('POST', '/weigh', reg2)).body.catch;
    assert.deepEqual([fish2.videoUrl, /\.mp4$/.test(fish2.scaleVideoUrl), /\.png$/.test(fish2.scalePhotoUrl)], [null, true, true]);
    const onlyVideo = form({ teamId: boat.id, anglerId: 'other', anglerName: 'Guest', speciesId: wahoo, weightKg: '18', declared: 'yes',
      deviceLat: '6.3', deviceLng: '-10.8', caughtOn: new Date().toISOString().slice(0, 10) });
    onlyVideo.set('scaleVideo', MP4, 'scale.mp4');
    assert.match((await cap('POST', '/weigh', onlyVideo)).body.error, /photo/, 'the scale photo is still required');
    await cap('DELETE', `/catches/${fish2.id}`);
    await cap('DELETE', `/catches/${shown.id}`);

    // Ticked: the fish also goes on the West Africa feed, with its own copy of the photo.
    assert.match((await cap('POST', '/club-feed', form({ body: 'Just words', shareWa: 'true' }))).body.error, /species/);
    const both = form({ body: 'Sail on the fly!', speciesId: sail, released: 'true', weightKg: '', shareWa: 'true' });
    both.set('photo', new Blob([PNG], { type: 'image/png' }), 'sail.png');
    const made = (await cap('POST', '/club-feed', both)).body;
    assert.ok(made.catchId, 'a West Africa catch was made');
    const wa = (await as()('GET', `/catches/${made.catchId}`)).body.catch;
    assert.deepEqual([wa.species, wa.released, wa.notes, wa.status], ['Atlantic sailfish', true, 'Sail on the fly!', 'unofficial']);
    const clubCopy = (await cap('GET', '/club-feed')).body.items.find((i) => i.id === made.id && i.kind === 'post');
    assert.notEqual(wa.photoUrl, clubCopy.photoUrl, 'separate copies');
    assert.equal((await cap('DELETE', `/club-feed/${made.id}`)).status, 200);
    assert.equal((await fetch(at.replace('/api', '') + wa.photoUrl)).status, 200, "removing the club post leaves the West Africa one's photo");
    await cap('DELETE', `/catches/${made.catchId}`);
    const noBoat = await person('Ama', 'Owusu', 'ama@example.com');
    await boss('PATCH', `/admin/users/${(await boss('GET', '/admin/users')).body.users.find((u) => u.email === 'ama@example.com').id}`, { jhmmc: true });
    assert.match((await noBoat('POST', '/club-feed', form({ speciesId: sail, shareWa: 'true' }))).body.error, /boat/);

    // The spot: on a JHMMC post with a fish, private to the poster, carried to the
    // West Africa copy (private there too), and all of them on My catch map.
    const spotted = form({ body: 'Wahoo off the canyon', speciesId: wahoo, weightKg: '24', lat: '6.1234', lng: '-11.2345', shareWa: 'true' });
    const sp1 = (await cap('POST', '/club-feed', spotted)).body;
    assert.equal((await cap('POST', '/club-feed', form({ speciesId: wahoo, lat: '95', lng: '1' }))).status, 400);
    await cap('POST', '/club-feed', form({ speciesId: sail, released: 'true', lat: '6.5', lng: '-11.0' }));
    const asRay = (await cap('GET', '/club-feed')).body.items.find((i) => i.id === sp1.id && i.kind === 'post');
    const asSec = (await sec('GET', '/club-feed')).body.items.find((i) => i.id === sp1.id && i.kind === 'post');
    assert.deepEqual([asRay.lat, asRay.lng, asSec.lat, asSec.hasSpot], [6.1234, -11.2345, null, true], 'only the poster sees the spot');
    const waCopy = (await as()('GET', `/catches/${sp1.catchId}`)).body.catch;
    assert.deepEqual([waCopy.lat, waCopy.hasSpot, waCopy.spotPublic], [null, true, false], 'private on the public feed too');
    const map = (await cap('GET', '/me/spots')).body;
    const year = new Date().toISOString().slice(0, 4);
    assert.deepEqual(map.years, [year]);
    assert.deepEqual(map.spots.map((x) => [x.kind, x.species, x.lat]).sort(), [['catch', 'Wahoo', 6.1234], ['club', 'Atlantic sailfish', 6.5]],
      'the shared fish counts once');
    assert.equal((await cap('GET', '/me/spots?year=1999')).body.spots.length, 2, 'an unknown year shows all');
    assert.equal((await sec('GET', '/me/spots')).body.spots.length, 0, "nobody else's spots");
    assert.equal((await as()('GET', '/me/spots')).status, 401);
    await cap('DELETE', `/catches/${sp1.catchId}`);

    // Editing, back on land: the weight and more photos on a West Africa post...
    const quick = (await cap('POST', '/catches', form({ speciesId: wahoo }))).body.catch;
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
    assert.equal(edited.photos.length, 1);
    assert.equal(edited.photos[0].id, 'cover');
    assert.equal((await cap('PATCH', `/catches/${fish.id}`, form({ weightKg: '1' }))).status, 403, "registrations can't be edited");
    await cap('DELETE', `/catches/${quick.id}`);
    // ...and a JHMMC feed post: add the weight, the spot and photos to what was posted at sea.
    const atSea = (await cap('POST', '/club-feed', form({ body: 'Fish on!' }))).body;
    const update = form({ body: 'Fish on! 32 kg wahoo', speciesId: wahoo, weightKg: '32', lat: '6.3', lng: '-11.2' });
    update.append('photos', new Blob([PNG], { type: 'image/png' }), 'c.png');
    update.append('photos', new Blob([PNG], { type: 'image/png' }), 'd.png');
    assert.equal((await cap('PATCH', `/club-feed/${atSea.id}`, update)).status, 200);
    const after = (await cap('GET', '/club-feed')).body.items.find((i) => i.kind === 'post' && i.id === atSea.id);
    assert.deepEqual([after.body, after.species, after.weightKg, after.lat, after.photos.length, after.canEdit], ['Fish on! 32 kg wahoo', 'Wahoo', 32, 6.3, 2, true]);
    assert.equal((await sec('PATCH', `/club-feed/${atSea.id}`, form({ body: 'x' }))).status, 403);
    assert.match((await cap('PATCH', `/club-feed/${atSea.id}`, form({ body: '', speciesId: '', removePhotos: JSON.stringify(after.photos.map((x) => x.id)) }))).body.error, /Write something/);

    // From the Post tab: tick to also post the fish on the JHMMC feed (members only).
    const both2 = form({ speciesId: wahoo, weightKg: '22', notes: 'Wahoo from the Post tab', shareClub: 'true', lat: '6.1', lng: '-10.9' });
    both2.set('photo', new Blob([PNG], { type: 'image/png' }), 'w.png');
    const posted = (await cap('POST', '/catches', both2)).body;
    assert.equal(posted.sharedClub, true);
    const clubSide = (await cap('GET', '/club-feed')).body.items.find((i) => i.kind === 'post' && i.body === 'Wahoo from the Post tab');
    assert.deepEqual([clubSide.species, clubSide.weightKg, clubSide.lat], ['Wahoo', 22, 6.1]);
    assert.notEqual(clubSide.photoUrl, posted.catch.photoUrl, 'separate copies');
    await cap('DELETE', `/catches/${posted.catch.id}`);
    assert.equal((await fetch(at.replace('/api', '') + clubSide.photoUrl)).status, 200, 'the JHMMC post keeps its photo');
    await cap('DELETE', `/club-feed/${clubSide.id}`);

    // Paging: a few at a time, nothing missed or repeated.
    for (let i = 0; i < 25; i++) await cap('POST', '/club-feed', form({ body: `Update ${i}` }));
    const one = (await cap('GET', '/club-feed')).body;
    const two = (await cap('GET', `/club-feed?before=${encodeURIComponent(one.nextBefore)}`)).body;
    assert.equal(one.items.length + two.items.length, 33);
    assert.equal(two.nextBefore, null);
    assert.equal(new Set([...one.items, ...two.items].map((i) => i.kind + i.id)).size, 33);

    // Whoever posted it, or the admin, removes a post; the club feed never reaches the public feed.
    assert.equal((await sec('DELETE', `/club-feed/${first.id}`)).status, 403);
    assert.equal((await boss('DELETE', `/club-feed/${first.id}`)).status, 200);
    assert.equal((await as()('GET', '/catches')).body.catches.length, 0);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
