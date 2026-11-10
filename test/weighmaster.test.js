const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('weighmasters: appointed captains weigh any JHMMC boat at their station; a captain weighing his own says why', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-wm-'));
  const app = createApp({ dbFile: path.join(tmp, 'fishing.db'), uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com', nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = async (email) => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demo-pass-1' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (method, url, body) => {
      const form = body instanceof FormData;
      const res = await fetch(`${base}/api${url}`, { method, headers: { cookie, ...(form || !body ? {} : { 'content-type': 'application/json' }) }, body: form ? body : body && JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
  };
  try {
    await seedDemo(base, { adminEmail: 'boss@example.com' });
    const [steve, jack, shams, sec] = await Promise.all(['steve', 'jack', 'shams', 'secretary'].map((n) => login(`${n}@example.com`)));
    const teams = (await sec('GET', '/teams')).body.teams;
    const boat = (name) => teams.find((t) => t.name === name).id;
    const wahoo = (await sec('GET', '/meta')).body.species.find((x) => x.name === 'Wahoo').id;
    const sheet = (teamId, extra = {}) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries({ teamId, caughtOn: new Date().toISOString().slice(0, 10), declared: 'yes', deviceLat: '6.3', deviceLng: '-10.8',
        fish: JSON.stringify([{ speciesId: wahoo, anglerId: 'other', anglerName: 'Guest', weightKg: '20' }]), ...extra })) fd.set(k, v);
      fd.set('scale_0', new Blob([PNG], { type: 'image/png' }), 'a.png');
      return fd;
    };
    assert.equal((await steve('GET', '/me')).body.user.weighmasterAt, 'Extreme');

    // Steve, weighmaster at Extreme, weighs Bait Master's fish: his weigh-in, at his station.
    let r = await steve('POST', '/weigh/sheet', sheet(boat('Bait Master')));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.catches[0].weighRole, r.body.catches[0].weighedByName, r.body.catches[0].weighStation], ['weighmaster', 'Steve Kissik', 'Extreme']);
    // His own boat: he's its captain there, so he says why there was no weighmaster.
    assert.match((await steve('POST', '/weigh/sheet', sheet(boat('Aquaholic')))).body.error, /weighmaster/);
    assert.match((await steve('POST', '/weigh/sheet', sheet(boat('Aquaholic'), { noWeighmaster: 'other' }))).body.error, /Say why/);
    r = await steve('POST', '/weigh/sheet', sheet(boat('Aquaholic'), { noWeighmaster: 'closed', noWeighmasterNote: 'power cut' }));
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.catches[0].weighRole, r.body.catches[0].weighReason], ['captain', 'The weigh station was closed: power cut']);
    // A captain who isn't a weighmaster still weighs only his own boat.
    assert.match((await jack('POST', '/weigh/sheet', sheet(boat('Aquaholic')))).body.error, /own boat/);
    // The reason is for the officers and the crew; anyone else sees who weighed, not why.
    const id = r.body.catches[0].id;
    assert.equal((await sec('GET', `/catches/${id}`)).body.catch.weighReason, 'The weigh station was closed: power cut');
    const outsider = await (await fetch(`${base}/api/catches/${id}`)).json();
    assert.deepEqual([outsider.catch.weighRole, outsider.catch.weighReason], ['captain', null]);

    // Appointing: the secretary only, and only captains of JHMMC boats.
    const rayan = (await sec('GET', '/admin/users')).body.users.find((u) => u.email === 'rayan@example.com').id;
    const shamsId = (await shams('GET', '/me')).body.user.id;
    assert.equal((await shams('PUT', `/weighmasters/${shamsId}`, { station: 'Beerville' })).status, 403);
    assert.equal((await sec('PUT', `/weighmasters/${rayan}`, { station: 'Beerville' })).status, 400, 'not a captain');
    assert.equal((await sec('PUT', `/weighmasters/${shamsId}`, { station: 'Nowhere' })).status, 400);
    assert.equal((await sec('PUT', `/weighmasters/${shamsId}`, { station: 'Beerville' })).status, 200);
    const list = (await sec('GET', '/weighmasters')).body.captains;
    assert.equal(list.find((c) => c.id === shamsId).station, 'Beerville');
    assert.equal((await sec('PUT', `/weighmasters/${shamsId}`, { station: null })).status, 200);
    assert.equal((await shams('GET', '/me')).body.user.weighmasterAt, null);
  } finally {
    srv.close();
  }
});
