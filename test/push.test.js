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
  const mails = [];
  const mailer = { configured: true, send: async (m) => { mails.push(m); } };
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher, mailer });
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
    await boss('POST', '/auth/register', { acceptRules: true, name: 'Boss Admin', nickname: 'Boss', email: 'boss@example.com', password: 'password1' });
    const sec = as();
    await sec('POST', '/auth/register', { acceptRules: true, name: 'Robert Khoueiry', nickname: 'Robert', email: 'sec@example.com', password: 'password1' });
    const crew = as();
    await crew('POST', '/auth/register', { acceptRules: true, name: 'Deck Hand', email: 'crew@example.com', password: 'password1' });
    const cap = as();
    await cap('POST', '/auth/register', { acceptRules: true, name: 'Moses Doe', nickname: 'Moses', email: 'cap@example.com', password: 'password1' });
    const users = (await boss('GET', '/admin/users')).body.users;
    const idOf = (email) => users.find((u) => u.email === email).id;
    await boss('PATCH', `/admin/users/${idOf('sec@example.com')}`, { jhmmc: true, role: 'secretary' });
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

    // The captain sends in a sheet of two fish.
    const fd = new FormData();
    fd.set('teamId', boat.id);
    fd.set('declared', 'yes');
    fd.set('noWeighmaster', 'absent');
    fd.set('deviceLat', '6.3');
    fd.set('deviceLng', '-10.8');
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
    assert.deepEqual([note.title, note.body, note.url], ['Fish to review', 'Sea Hunter: 2 fish registered by Moses Doe. 2 waiting in total.', '/#/review']);
    assert.equal((await sec('GET', '/officials/pending')).body.count, 2);

    // The phone that was gone is forgotten; switching off stops the rest.
    sent.length = 0;
    await sec('DELETE', '/push/subscribe', { endpoint: sub('sec-phone').endpoint });
    const one = new FormData();
    for (const [k, v] of Object.entries({ teamId: boat.id, declared: 'yes', noWeighmaster: 'absent', deviceLat: '6.3', deviceLng: '-10.8', anglerId: 'other', anglerName: 'Guest', speciesId: wahoo, weightKg: '9',
      caughtOn: new Date().toISOString().slice(0, 10) })) one.set(k, v);
    one.set('scalePhoto', new Blob([PNG], { type: 'image/png' }), 'c.png');
    assert.equal((await cap('POST', '/weigh', one)).status, 201);
    await settle();
    assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.body]), [['boss-phone', 'Sea Hunter: 1 fish registered by Moses Doe. 3 waiting in total.']]);

    // An announcement goes to every phone with notifications on, captains and
    // crews included, but not the author's.
    sent.length = 0;
    await sec('POST', '/announcements', { title: 'Tournament Saturday', body: 'Pay your membership by Friday.' });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint.split('/').pop()).sort(), ['boss-phone', 'cap-phone', 'crew-phone']);
    assert.deepEqual([sent[0].title, sent[0].body, sent[0].url], ['JHMMC: Tournament Saturday', 'Pay your membership by Friday.', '/#/?type=announcements']);

    // Each person chooses what they're told about (More → Notifications).
    assert.deepEqual((await cap('GET', '/me')).body.user.notify, { announcements: true, myFish: true, weighins: true, logged: true });
    await cap('PATCH', '/me', { notify: { announcements: false, nonsense: true } });
    await boss('PATCH', '/me', { notify: { weighins: false, logged: false } });
    sent.length = 0;
    await sec('POST', '/announcements', { title: 'Second one' });
    await settle();
    assert.deepEqual(sent.map((s) => s.endpoint.split('/').pop()).sort(), ['boss-phone', 'crew-phone'], 'the captain switched announcements off');
    // The secretary approves one of the captain's fish: the captain hears about
    // their fish; everyone else hears about the weigh-in, except the admin, who
    // switched weigh-ins off.
    sent.length = 0;
    const waiting = (await sec('GET', '/officials/queue')).body.toReview;
    await sec('POST', `/catches/${waiting[0].id}/review`, { decision: 'approve' });
    await settle();
    const got = Object.fromEntries(sent.map((s) => [s.endpoint.split('/').pop(), s]));
    assert.deepEqual(Object.keys(got).sort(), ['cap-phone', 'crew-phone']);
    assert.equal(got['cap-phone'].title, 'Fish approved');
    assert.match(got['cap-phone'].body, /^Your Wahoo \(\d+ kg\) was approved: [\d.]+ points\.$/);
    assert.match(got['crew-phone'].body, /weighed a \d+ kg wahoo/);
    assert.equal(got['crew-phone'].quiet, false, 'the first fish of the day buzzes');
    // The boat's next fish that day updates the same notification, quietly.
    sent.length = 0;
    await sec('POST', `/catches/${waiting[1].id}/review`, { decision: 'approve' });
    await settle();
    const update = sent.find((s) => s.endpoint.endsWith('crew-phone'));
    assert.deepEqual([update.tag, update.quiet], [got['crew-phone'].tag, true]);
    assert.match(update.body, /^2 fish weighed in, heaviest a \d+ kg wahoo\.$/);

    // Fish logged at sea: everyone but whoever logged it (and the admin, who
    // switched it off), never the spot.
    sent.length = 0;
    await cap('POST', '/outings/fish', { speciesId: wahoo, fate: 'kept', lat: 6.31, lng: -10.8 });
    await settle();
    assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.title, s.body]), [['crew-phone', 'Fish on', 'Sea Hunter boated a wahoo.']]);
    assert.equal(JSON.stringify(sent).includes('6.31'), false);

    // Only JHMMC (the admin) opens clubs: anyone else's is a request. It stays
    // hidden until approved, and the person hears back either way.
    sent.length = 0;
    const asked = await cap('POST', '/clubs', { name: 'Conakry Big Game', country: 'Guinea' });
    assert.deepEqual([asked.status, asked.body.requested], [201, true]);
    await settle();
    assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.title]), [['boss-phone', 'Club request']]);
    // ...and by email to the admin.
    const mail = mails.find((m) => m.subject.startsWith('Club request'));
    assert.equal(mail.to, 'boss@example.com');
    assert.match(mail.subject, /Conakry Big Game \(Guinea\)/);
    assert.match(mail.text, /#\/clubs/);
    assert.equal((await cap('GET', '/clubs')).body.clubs.some((c) => c.name === 'Conakry Big Game'), false, 'not listed yet');
    assert.equal((await cap('GET', `/clubs/${asked.body.club.id}`)).status, 404);
    assert.equal((await cap('GET', '/admin/club-requests')).status, 403);
    const reqs = (await boss('GET', '/admin/club-requests')).body.requests;
    assert.deepEqual(reqs.map((r) => [r.name, r.country, r.requestedBy]), [['Conakry Big Game', 'Guinea', 'Moses']]);
    sent.length = 0;
    assert.equal((await boss('POST', `/admin/club-requests/${reqs[0].id}`, { decision: 'approve' })).status, 200);
    await settle();
    assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.title]), [['cap-phone', 'Club approved']]);
    assert.ok((await cap('GET', '/clubs')).body.clubs.some((c) => c.name === 'Conakry Big Game'));
    // The admin's own club opens straight away; a declined request disappears.
    assert.equal((await boss('POST', '/clubs', { name: 'Sherbro Anglers', country: 'Sierra Leone' })).body.requested, false);
    const no = (await crew('POST', '/clubs', { name: 'Not Yet', country: 'Ghana' })).body.club;
    await boss('POST', `/admin/club-requests/${no.id}`, { decision: 'decline' });
    assert.equal((await boss('GET', '/admin/club-requests')).body.requests.length, 0);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the Android app gets its notifications from Firebase', async () => {
  const { createPusher } = require('../src/push');
  const { DatabaseSync } = require('node:sqlite');
  const crypto = require('node:crypto');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { project_id: 'asf-test', client_email: 'push@asf-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    const { message } = JSON.parse(init.body);
    if (message.token === 'gone-token') return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
    return new Response('{}');
  };
  const env = { FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(account)).toString('base64') };
  const pusher = createPusher(db, { env, fetchImpl });
  assert.equal(await pusher.send({ endpoint: 'fcm:live-token' }, { title: 'Weigh-in', body: 'Blue marlin', url: '/#/catch/1' }), true);
  // Signed in once with the service account's key (a JWT the key's public half checks).
  const assertion = new URLSearchParams(calls[0].init.body.toString()).get('assertion');
  const [h, p, sig] = assertion.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, account.client_email);
  const sent = JSON.parse(calls[1].init.body).message;
  assert.equal(calls[1].url, 'https://fcm.googleapis.com/v1/projects/asf-test/messages:send');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual([sent.token, sent.notification.title, sent.data.url], ['live-token', 'Weigh-in', '/#/catch/1']);
  // An uninstalled app's token is gone for good; the access token is reused.
  assert.equal(await pusher.send({ endpoint: 'fcm:gone-token' }, { title: 'x' }), false);
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
  // Without Firebase set up, Android phones are skipped (and kept).
  const off = createPusher(db, { env: {}, fetchImpl: () => assert.fail('no call') });
  assert.equal(await off.send({ endpoint: 'fcm:live-token' }, { title: 'x' }), true);
});

test('the iPhone app gets its notifications from Apple', async () => {
  const { createPusher } = require('../src/push');
  const { DatabaseSync } = require('node:sqlite');
  const crypto = require('node:crypto');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  // Pasted into a dashboard on one line, as phones do.
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, ' ');
  const calls = [];
  const apnsSend = async (path, headers, body) => {
    calls.push({ path, headers, body: JSON.parse(body) });
    return path.includes('dead') ? { status: 410, body: '{"reason":"Unregistered"}' } : { status: 200, body: '' };
  };
  const env = { APNS_KEY: pem, APNS_KEY_ID: 'KEY123', APNS_TEAM_ID: 'TEAM45' };
  const pusher = createPusher(db, { env, apnsSend });
  assert.equal(await pusher.send({ endpoint: 'apns:abcd1234' }, { title: 'Weigh-in', body: 'Sailfish', url: '/#/catch/2' }), true);
  const [c] = calls;
  assert.equal(c.path, '/3/device/abcd1234');
  assert.equal(c.headers['apns-topic'], 'com.africasportfishing.app');
  assert.deepEqual([c.body.aps.alert.title, c.body.url], ['Weigh-in', '/#/catch/2']);
  // Signed with the push key (ES256), naming the key and the team.
  const [h, p, sig] = c.headers.authorization.replace('bearer ', '').split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).kid, 'KEY123');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, 'TEAM45');
  // A deleted app's token is gone for good.
  assert.equal(await pusher.send({ endpoint: 'apns:dead' }, { title: 'x' }), false);
});
