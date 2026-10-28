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

test('captains see pending registrations, dispute them within 24 hours, and everything is on record', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-disputes-'));
  const dbFile = path.join(tmp, 'fishing.db');
  const pusher = { publicKey: 'k', send: async () => true };
  const app = createApp({ dbFile, uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher });
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
  const person = async (name, email) => {
    const c = as();
    await c('POST', '/auth/register', { name, email, password: 'password1' });
    return c;
  };
  try {
    const boss = await person('Boss', 'boss@example.com');
    const sec = await person('Robert', 'sec@example.com');
    const capA = await person('Captain A', 'a@example.com');
    const capB = await person('Captain B', 'b@example.com');
    const crewB = await person('Deck Hand', 'crew@example.com');
    const outsider = await person('Tema Captain', 't@example.com');
    const users = (await boss('GET', '/admin/users')).body.users;
    await boss('PATCH', `/admin/users/${users.find((u) => u.email === 'sec@example.com').id}`, { role: 'secretary' });
    const jhmmc = (await capA('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const seaHunter = (await capA('POST', '/teams', { name: 'Sea Hunter', clubId: jhmmc, weighStation: 'Extreme' })).body.team;
    const reelDeal = (await capB('POST', '/teams', { name: 'Reel Deal', clubId: jhmmc, weighStation: 'Beerville' })).body.team;
    await crewB('POST', '/teams/join', { code: reelDeal.joinCode });
    const tema = (await outsider('POST', '/clubs', { name: 'Tema Game Fishing', country: 'Ghana' })).body.club;
    await outsider('POST', '/teams', { name: 'Black Star', clubId: tema.id });
    const species = (await capA('GET', '/meta')).body.species;
    const sp = (n) => species.find((x) => x.name === n).id;

    // Today is a tournament, so fish can be registered.
    await sec('POST', '/events', { date: new Date().toISOString().slice(0, 10), kind: 'tournament', name: 'October Cup' });
    // Captain A sends two fish, from the dock (the phone's position comes along).
    const fd = new FormData();
    for (const [k, v] of Object.entries({ teamId: seaHunter.id, caughtOn: new Date().toISOString().slice(0, 10), declared: 'yes',
      deviceLat: '6.3', deviceLng: '-10.8' })) fd.set(k, v);
    fd.set('fish', JSON.stringify([
      { speciesId: sp('Wahoo'), anglerId: 'other', anglerName: 'Guest', weightKg: '20' },
      { speciesId: sp('Atlantic blue marlin'), anglerId: 'other', anglerName: 'Guest', weightKg: '210' },
    ]));
    fd.set('scale_0', new Blob([PNG], { type: 'image/png' }), 'a.png');
    fd.set('scale_1', new Blob([PNG], { type: 'image/png' }), 'b.png');
    const [wahoo, marlin] = (await capA('POST', '/weigh/sheet', fd)).body.catches;

    // Every JHMMC captain sees them; crews and other clubs don't.
    const seen = (await capB('GET', '/registrations/pending')).body.registrations;
    assert.deepEqual(seen.map((r) => [r.species, r.teamName, r.canDispute]).sort(),
      [['Atlantic blue marlin', 'Sea Hunter', true], ['Wahoo', 'Sea Hunter', true]]);
    assert.ok(seen.every((r) => r.scalePhotoUrl), 'with the scale photos');
    assert.ok((await capA('GET', '/registrations/pending')).body.registrations.every((r) => !r.canDispute), 'not your own boat');
    assert.equal((await crewB('GET', '/registrations/pending')).status, 403);
    assert.equal((await outsider('GET', '/registrations/pending')).status, 403);

    // Disputes: a reason, once, by another JHMMC captain.
    assert.equal((await capB('POST', `/catches/${marlin.id}/disputes`, { reason: '' })).status, 400);
    assert.equal((await capB('POST', `/catches/${marlin.id}/disputes`, { reason: 'That marlin was caught yesterday' })).status, 201);
    assert.equal((await capB('POST', `/catches/${marlin.id}/disputes`, { reason: 'Again' })).status, 409);
    assert.equal((await capA('POST', `/catches/${marlin.id}/disputes`, { reason: 'Mine' })).status, 400);
    assert.equal((await crewB('POST', `/catches/${marlin.id}/disputes`, { reason: 'Crew' })).status, 403);
    assert.equal((await outsider('POST', `/catches/${marlin.id}/disputes`, { reason: 'Outsider' })).status, 403);
    const listed = (await capB('GET', '/registrations/pending')).body.registrations.find((r) => r.id === marlin.id);
    assert.deepEqual([listed.disputes, listed.disputedByMe, listed.canDispute], [1, true, false]);

    // The secretary sees the dispute and must say how it was settled.
    const queued = (await sec('GET', '/officials/queue')).body.toReview.find((c) => c.id === marlin.id);
    assert.deepEqual(queued.disputes.map((d) => [d.author, d.boat, d.reason]), [['Captain B', 'Reel Deal', 'That marlin was caught yesterday']]);
    assert.ok(Date.parse(queued.disputeUntil) > Date.now());
    assert.match((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'approve' })).body.error, /disputed/);
    assert.equal((await sec('POST', `/catches/${marlin.id}/review`, { decision: 'approve', note: 'Checked the radio log: caught today' })).status, 200);
    assert.match((await capB('POST', `/catches/${marlin.id}/disputes`, { reason: 'Late' })).body.error, /already decided/);

    // After 24 hours, disputes close.
    const db = openDb(dbFile);
    db.prepare("UPDATE catches SET created_at = datetime('now', '-25 hours') WHERE id = ?").run(wahoo.id);
    db.close();
    assert.equal((await capB('GET', '/registrations/pending')).body.registrations.find((r) => r.id === wahoo.id).canDispute, false);
    assert.match((await capB('POST', `/catches/${wahoo.id}/disputes`, { reason: 'Too late' })).body.error, /24 hours/);

    // Captain A withdraws the wahoo; the record keeps it all.
    assert.equal((await capA('DELETE', `/catches/${wahoo.id}`)).status, 200);
    assert.equal((await capA('GET', '/registrations/log')).status, 403, 'the record is for the secretary and admin');
    const log = (await sec('GET', '/registrations/log')).body.entries;
    const of = (id) => log.filter((e) => e.catchId === id).reverse().map((e) => [e.action, e.userName, e.note ?? null]);
    assert.deepEqual(of(marlin.id), [
      ['registered', 'Captain A', null],
      ['disputed', 'Captain B', 'That marlin was caught yesterday'],
      ['approved', 'Robert', 'Checked the radio log: caught today'],
    ]);
    assert.deepEqual(of(wahoo.id), [['registered', 'Captain A', null], ['withdrawn', 'Captain A', null]]);
    const registered = log.find((e) => e.catchId === wahoo.id && e.action === 'registered');
    assert.deepEqual([registered.boat, registered.species, registered.weightKg, registered.points, registered.lat, registered.lng],
      ['Sea Hunter', 'Wahoo', 20, 100, 6.3, -10.8]);
    const withdrawn = log.find((e) => e.catchId === wahoo.id && e.action === 'withdrawn');
    assert.match(withdrawn.scalePhotoUrl, /^\/uploads\//, 'the scale photo stays as evidence');
    assert.equal((await fetch(at.replace('/api', '') + withdrawn.scalePhotoUrl)).status, 200);
    assert.equal((await boss('GET', `/registrations/log?team=${reelDeal.id}`)).body.entries.length, 0, 'filtered by boat');
    assert.equal((await boss('GET', `/registrations/log?catch=${marlin.id}`)).body.entries.length, 3, 'one fish');
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
