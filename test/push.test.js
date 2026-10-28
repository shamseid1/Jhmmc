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

test('the secretary gets a phone notification when fish are registered', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-push-'));
  // Stands in for the browsers' push services; "gone" endpoints act unsubscribed.
  const sent = [];
  const pusher = {
    publicKey: 'test-key',
    async send(sub, payload) {
      sent.push({ endpoint: sub.endpoint, ...payload });
      return !sub.endpoint.includes('gone');
    },
  };
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
  const sub = (name) => ({ endpoint: `https://push.example/${name}`, keys: { p256dh: 'p', auth: 'a' } });
  const settle = () => new Promise((r) => setTimeout(r, 50));
  try {
    const boss = as();
    await boss('POST', '/auth/register', { name: 'Boss', email: 'boss@example.com', password: 'password1' });
    const sec = as();
    await sec('POST', '/auth/register', { name: 'Robert', email: 'sec@example.com', password: 'password1' });
    const crew = as();
    await crew('POST', '/auth/register', { name: 'Deck Hand', email: 'crew@example.com', password: 'password1' });
    const cap = as();
    await cap('POST', '/auth/register', { name: 'Moses', email: 'cap@example.com', password: 'password1' });
    const users = (await boss('GET', '/admin/users')).body.users;
    const idOf = (email) => users.find((u) => u.email === email).id;
    await boss('PATCH', `/admin/users/${idOf('sec@example.com')}`, { role: 'secretary' });
    const jhmmc = (await cap('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const boat = (await cap('POST', '/teams', { name: 'Sea Hunter', clubId: jhmmc, weighStation: 'Extreme' })).body.team;
    await crew('POST', '/teams/join', { code: boat.joinCode });
    const wahoo = (await cap('GET', '/meta')).body.species.find((s) => s.name === 'Wahoo').id;

    assert.equal((await as()('GET', '/push/key')).body.publicKey, 'test-key');
    assert.equal((await as()('POST', '/push/subscribe', sub('anon'))).status, 401, 'members only');
    assert.equal((await sec('POST', '/push/subscribe', { endpoint: 'http://insecure', keys: {} })).status, 400);
    assert.equal((await sec('POST', '/push/subscribe', sub('sec-phone'))).status, 201);
    await sec('POST', '/push/subscribe', sub('sec-phone'));
    await sec('POST', '/push/subscribe', sub('sec-old-phone-gone'));
    await boss('POST', '/push/subscribe', sub('boss-phone'));
    await cap('POST', '/push/subscribe', sub('cap-phone'));
    await crew('POST', '/push/subscribe', sub('crew-phone'));

    assert.equal((await cap('GET', '/officials/pending')).status, 403);
    assert.equal((await sec('GET', '/officials/pending')).body.count, 0);

    await boss('POST', '/events', { date: new Date().toISOString().slice(0, 10), kind: 'tournament', name: 'October Cup' });
    // The captain sends in a sheet of two fish.
    const fd = new FormData();
    fd.set('teamId', boat.id);
    fd.set('declared', 'yes');
    fd.set('caughtOn', new Date().toISOString().slice(0, 10));
    fd.set('fish', JSON.stringify([
      { speciesId: wahoo, anglerId: 'other', anglerName: 'Guest', weightKg: '20' },
      { speciesId: wahoo, anglerId: 'other', anglerName: 'Guest', weightKg: '12' },
    ]));
    fd.set('scale_0', new Blob([PNG], { type: 'image/png' }), 'a.png');
    fd.set('scale_1', new Blob([PNG], { type: 'image/png' }), 'b.png');
    assert.equal((await cap('POST', '/weigh/sheet', fd)).status, 201);
    await settle();

    assert.deepEqual(sent.map((s) => s.endpoint).sort(), [sub('boss-phone'), sub('sec-old-phone-gone'), sub('sec-phone')].map((s) => s.endpoint).sort(),
      'the secretary and the admin, not the captain or crews');
    const note = sent.find((s) => s.endpoint.endsWith('sec-phone'));
    assert.deepEqual([note.title, note.body, note.url], ['Fish to review', 'Sea Hunter: 2 fish registered by Moses. 2 waiting in total.', '/#/review']);
    assert.equal((await sec('GET', '/officials/pending')).body.count, 2);

    // The phone that was gone is forgotten; switching off stops the rest.
    sent.length = 0;
    await sec('DELETE', '/push/subscribe', { endpoint: sub('sec-phone').endpoint });
    const one = new FormData();
    for (const [k, v] of Object.entries({ teamId: boat.id, declared: 'yes', anglerId: 'other', anglerName: 'Guest', speciesId: wahoo, weightKg: '9',
      caughtOn: new Date().toISOString().slice(0, 10) })) one.set(k, v);
    one.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'c.png');
    assert.equal((await cap('POST', '/weigh', one)).status, 201);
    await settle();
    assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.body]), [['boss-phone', 'Sea Hunter: 1 fish registered by Moses. 3 waiting in total.']]);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
