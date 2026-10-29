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

    // Paging: a few at a time, nothing missed or repeated.
    for (let i = 0; i < 25; i++) await cap('POST', '/club-feed', form({ body: `Update ${i}` }));
    const one = (await cap('GET', '/club-feed')).body;
    const two = (await cap('GET', `/club-feed?before=${encodeURIComponent(one.nextBefore)}`)).body;
    assert.equal(one.items.length + two.items.length, 30);
    assert.equal(two.nextBefore, null);
    assert.equal(new Set([...one.items, ...two.items].map((i) => i.kind + i.id)).size, 30);

    // Whoever posted it, or the admin, removes a post; the club feed never reaches the public feed.
    assert.equal((await sec('DELETE', `/club-feed/${first.id}`)).status, 403);
    assert.equal((await boss('DELETE', `/club-feed/${first.id}`)).status, 200);
    assert.equal((await as()('GET', '/catches')).body.catches.length, 0);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
