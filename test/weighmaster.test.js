const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('weighmasters: appointed members weigh their station\'s boats; a captain only his own boat, picking why', async () => {
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
    // His own boat, registered at his station: simply his weigh-in, no reason asked.
    r = await steve('POST', '/weigh/sheet', sheet(boat('Aquaholic')));
    assert.deepEqual([r.status, r.body.catches?.[0].weighRole, r.body.catches?.[0].weighReason], [201, 'weighmaster', null]);
    // A captain who isn't a weighmaster weighs his own boat and picks why there was none.
    assert.match((await jack('POST', '/weigh/sheet', sheet(boat('Bait Master')))).body.error, /weighmaster/);
    r = await jack('POST', '/weigh/sheet', sheet(boat('Bait Master'), { noWeighmaster: 'closed' }));
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.catches[0].weighRole, r.body.catches[0].weighReason], ['captain', 'The weigh station was closed']);
    const other = await jack('POST', '/weigh/sheet', sheet(boat('Bait Master'), { noWeighmaster: 'other' }));
    assert.equal(other.body.catches[0].weighReason, 'Other reason');
    // A captain who isn't a weighmaster weighs only his own boat.
    assert.equal((await jack('GET', '/me')).body.user.weighmasterAt, null);
    assert.match((await jack('POST', '/weigh/sheet', sheet(boat('Aquaholic')))).body.error, /own boat/);
    // A weighmaster weighs only the boats registered at his station.
    assert.match((await steve('POST', '/weigh/sheet', sheet(boat('Liberian Girl')))).body.error, /boats registered at Extreme/);
    // The reason is for the officers and the crew; anyone else sees who weighed, not why.
    const id = r.body.catches[0].id;
    assert.equal((await sec('GET', `/catches/${id}`)).body.catch.weighReason, 'The weigh station was closed');
    const outsider = await (await fetch(`${base}/api/catches/${id}`)).json();
    assert.deepEqual([outsider.catch.weighRole, outsider.catch.weighReason], ['captain', null]);

    // Appointing: the secretary only, and any JHMMC member (the treasurer, say), not only captains.
    const users = (await sec('GET', '/admin/users')).body.users;
    const rayanId = users.find((u) => u.email === 'rayan@example.com').id;
    const shamsId = (await shams('GET', '/me')).body.user.id;
    assert.equal((await shams('PUT', `/weighmasters/${shamsId}`, { station: 'Beerville' })).status, 403);
    assert.equal((await sec('PUT', `/weighmasters/${rayanId}`, { station: 'Nowhere' })).status, 400);
    const outsider2 = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Not', lastName: 'Member', email: 'nm@example.com', password: 'password123' }) });
    const nmId = (await outsider2.json()).user.id;
    assert.match((await sec('PUT', `/weighmasters/${nmId}`, { station: 'Beerville' })).body.error, /isn't a JHMMC member/);
    // Rayan (crew on Liberian Girl, not a captain) weighs at Beerville.
    assert.equal((await sec('PUT', `/weighmasters/${rayanId}`, { station: 'Beerville' })).status, 200);
    const list = (await sec('GET', '/weighmasters')).body.members;
    assert.equal(list.find((m) => m.id === rayanId).station, 'Beerville');
    assert.equal(list.find((m) => m.id === shamsId).station, null, 'captains are weighmasters only when appointed');
    assert.equal((await sec('PUT', `/weighmasters/${shamsId}`, { station: 'Beerville' })).status, 200, 'a captain can be appointed');
    assert.equal((await sec('PUT', `/weighmasters/${shamsId}`, { station: null })).status, 200);
    const rayan = await login('rayan@example.com');
    r = await rayan('POST', '/weigh/sheet', sheet(boat('Sea Monkey')));
    assert.deepEqual([r.status, r.body.catches?.[0].weighRole, r.body.catches?.[0].weighStation], [201, 'weighmaster', 'Beerville']);
    // His own boat is at his station too: his weigh-in as weighmaster.
    r = await rayan('POST', '/weigh/sheet', sheet(boat('Liberian Girl')));
    assert.deepEqual([r.status, r.body.catches?.[0].weighRole], [201, 'weighmaster']);
    assert.equal((await sec('PUT', `/weighmasters/${rayanId}`, { station: null })).status, 200);
    assert.equal((await rayan('GET', '/me')).body.user.weighmasterAt, null);
    assert.equal((await rayan('POST', '/weigh/sheet', sheet(boat('Sea Monkey')))).status, 403, 'crew without the role can\'t weigh');
  } finally {
    srv.close();
  }
});
