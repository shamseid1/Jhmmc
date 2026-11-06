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

test('the secretary corrects species, angler or photo, waiting or approved; points follow', async () => {
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
    const fd = new FormData();
    for (const [k, v] of Object.entries({ teamId: seaHunter.id, caughtOn: today, declared: 'yes', deviceLat: '6.3', deviceLng: '-10.8' })) fd.set(k, v);
    fd.set('fish', JSON.stringify([{ speciesId: sp('Yellowfin tuna'), anglerId: 'other', anglerName: 'Guest', weightKg: '60' }]));
    fd.set('scale_0', new Blob([PNG], { type: 'image/png' }), 'scale.png');
    const [fish] = (await capA('POST', '/weigh/sheet', fd)).body.catches;
    const before = (await sec('GET', `/catches/${fish.id}`)).body.catch;
    const fix = (who, fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return who('POST', `/catches/${fish.id}/correct`, f); };
    assert.equal((await fix(capA, { speciesId: sp('Wahoo'), note: 'x' })).status, 403, 'the captain can\'t');
    assert.match((await fix(sec, { speciesId: sp('Wahoo') })).body.error, /note/);
    // Waiting: the species was wrong.
    let k = (await fix(sec, { speciesId: sp('Wahoo'), note: 'It was a wahoo' })).body.catch;
    assert.equal(k.species, 'Wahoo');
    assert.notEqual(k.points, before.points, 'points from the rules for a wahoo');
    // Approved: the angler and the photo.
    assert.equal((await sec('POST', `/catches/${fish.id}/review`, { decision: 'approve' })).status, 200);
    const capAId = (await capA('GET', '/me')).body.user.id;
    const f2 = { anglerId: String(capAId), note: 'Captain A caught it' };
    k = (await fix(sec, f2)).body.catch;
    assert.equal(k.userId, capAId);
    const pf = new FormData(); pf.set('note', 'Clearer photo'); pf.set('scalePhoto', new Blob([PNG, Buffer.from('x')], { type: 'image/png' }), 'new.png');
    const k2 = (await sec('POST', `/catches/${fish.id}/correct`, pf)).body.catch;
    assert.notEqual(k2.scalePhotoUrl, k.scalePhotoUrl);
    assert.equal(k2.status, 'approved');
    assert.equal((await fix(sec, { anglerId: String((await crewB('GET', '/me')).body.user.id), note: 'x' })).status, 400, 'only this boat\'s crew');
    const steps = (await sec('GET', `/registrations/log?catch=${fish.id}`)).body.fish[0].steps.map((e) => e.note).filter((n) => n?.startsWith('Corrected'));
    assert.equal(steps.length, 3);
    assert.match(steps[0], /species Yellowfin tuna to Wahoo: It was a wahoo/);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
