const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The demo copy (DEMO=1): a made-up JHMMC season to show the club, filled in
// through the app's own API so it is exactly what members would see.
// Anyone with the link signs in with these; their passwords can't be changed.
const PASSWORD = 'demo-pass-1';
const DEMO_ACCOUNTS = [
  // The first is who every visitor arrives as: a captain of his own boat, so nobody plays with a real member's boat.
  { role: 'Captain of Demo Boat', email: 'captain@example.com', password: PASSWORD },
  { role: 'Angler on Demo Boat', email: 'angler@example.com', password: PASSWORD },
  { role: 'Secretary', email: 'secretary@example.com', password: PASSWORD },
];
const PICTURES = path.join(__dirname, '..', 'demo');

async function seedDemo(base, { adminEmail = 'admin@example.com' } = {}) {
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const picture = (f) => new Blob([fs.readFileSync(path.join(PICTURES, f))], { type: 'image/jpeg' });
  // One signed-in member: a cookie and a call.
  async function member(first, last, email, password = PASSWORD) {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: first, lastName: last, email, password }),
    });
    const body = await r.json();
    if (!r.ok) throw Object.assign(new Error(`register ${email}: ${body.error}`), { status: r.status });
    const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const call = async (method, url, data) => {
      const form = data instanceof FormData;
      const res = await fetch(`${base}/api${url}`, {
        method, headers: { cookie, ...(form || !data ? {} : { 'content-type': 'application/json' }) },
        body: form ? data : data && JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`);
      return json;
    };
    return { id: body.user.id, call };
  }
  const multipart = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v instanceof Blob) f.append(k, v, `${k}.jpg`);
      else f.append(k, v);
    }
    return f;
  };

  // Already seeded (the admin exists): leave it.
  let boss;
  try {
    boss = await member('Club', 'Admin', adminEmail, crypto.randomBytes(18).toString('base64url'));
  } catch (err) {
    if (err.status === 409) return false;
    throw err;
  }
  // JHMMC members and their Ocean boats (made-up catches). The secretary is a stand-in.
  const sec = await member('Secretary', '(demo)', 'secretary@example.com');
  const [shams, jack, steve, faris] = [await member('Shams', 'Eid', 'shams@example.com'), await member('Jack', 'Asmar', 'jack@example.com'),
    await member('Steve', 'Kissik', 'steve@example.com'), await member('Faris', 'Eid', 'faris@example.com')];
  const [rayan, ziad, charbel, maamoun, elie, lewaa] = [await member('Rayan', 'Eid', 'rayan@example.com'), await member('Ziad', 'Sankari', 'ziad@example.com'),
    await member('Charbel', 'Chakour', 'charbel@example.com'), await member('Maamoun', 'Hassoun', 'maamoun@example.com'),
    await member('Elie', 'Daher', 'elie@example.com'), await member('Lewaa', 'Mosleh', 'lewaa@example.com')];
  const demoCap = await member('Demo', 'Captain', 'captain@example.com');
  const demoAngler = await member('Demo', 'Angler', 'angler@example.com');
  const caps = [shams, jack, steve, faris, demoCap];

  const jh = (await boss.call('GET', '/clubs')).clubs.find((c) => c.name === 'JHMMC').id;
  for (const u of [sec, ...caps, demoAngler, rayan, ziad, charbel, maamoun, elie, lewaa]) await boss.call('PATCH', `/admin/users/${u.id}`, { jhmmc: true });
  await boss.call('PATCH', `/admin/users/${sec.id}`, { role: 'secretary' });
  // Paid up for the season.
  for (const u of [...caps, demoAngler, rayan, ziad, charbel, maamoun, elie, lewaa]) await sec.call('PUT', `/club-members/${u.id}`, { paid: true });
  const boats = [['Liberian Girl', 'Beerville'], ['Bait Master', 'Extreme'], ['Aquaholic', 'Extreme'], ['Sea Monkey', 'Beerville'], ['Demo Boat', 'Beerville']];
  const teams = [];
  for (const [i, [name, weighStation]] of boats.entries()) {
    teams.push((await caps[i].call('POST', '/teams', { name, clubId: jh, weighStation, country: 'Liberia' })).team);
  }
  const [girl, bait, aqua, monkey, demoBoat] = teams;
  const aboard = async (u, i) => {
    const t = (await caps[i].call('POST', `/teams/${teams[i].id}/code`)).team;
    await u.call('POST', '/teams/join', { code: t.joinCode });
  };
  await aboard(rayan, 0); await aboard(ziad, 0); await aboard(charbel, 1); await aboard(maamoun, 1); await aboard(elie, 2); await aboard(lewaa, 3);
  await aboard(demoAngler, 4); await aboard(sec, 4); // the secretary fishes too
  const sp = Object.fromEntries((await boss.call('GET', '/meta')).species.map((s) => [s.name, s.id]));

  // Weigh-ins over the last three weeks, approved by the secretary.
  const sheet = (t, ago, fish) => multipart({
    teamId: String(t.id), caughtOn: day(ago), declared: 'yes', deviceLat: '6.30', deviceLng: '-10.80',
    fish: JSON.stringify(fish.map(([n, kg, a]) => ({ speciesId: sp[n], anglerId: String(a.id), weightKg: kg, released: kg ? '' : 'on' }))),
    ...Object.fromEntries(fish.map(([, , , f], i) => [`scale_${i}`, picture(f)])),
  });
  const sheets = [
    [girl, 20, [['Blue marlin', '212', shams, 'marlin1.jpg'], ['Yellowfin tuna', '64', rayan, 'tuna1.jpg']]],
    [bait, 18, [['Yellowfin tuna', '88', charbel, 'tuna2.jpg'], ['Grouper', '24', jack, 'grouper2.jpg']]],
    [aqua, 13, [['Dorado', '17', elie, 'dorado1.jpg']]],
    [girl, 9, [['Barracuda', '15', ziad, 'barracuda1.jpg']]],
    [bait, 6, [['Blue marlin', '168', maamoun, 'marlin2.jpg']]],
    [monkey, 5, [['Yellowfin tuna', '71', lewaa, 'tuna2.jpg']]],
    [aqua, 3, [['Yellowfin tuna', '52', steve, 'tuna1.jpg'], ['Grouper', '19', elie, 'grouper1.jpg']]],
    [demoBoat, 10, [['Yellowfin tuna', '58', demoCap, 'tuna2.jpg']]],
  ];
  const ids = [];
  for (const [t, ago, fish] of sheets) ids.push(...(await boss.call('POST', '/weigh/sheet', sheet(t, ago, fish))).catches.map((k) => k.id));
  for (const id of ids) await sec.call('POST', `/catches/${id}/review`, { decision: 'approve' });
  for (const [u, n, body] of [[charbel, 0, 'What a fish!'], [jack, 0, 'Congrats Shams'], [rayan, 6, 'Big one!'], [shams, 4, 'Nice tuna']]) {
    await u.call('POST', `/catches/${ids[n]}/like`);
    await u.call('POST', `/catches/${ids[n]}/comments`, { body });
  }
  for (const u of [sec, steve, ziad, lewaa]) await u.call('POST', `/catches/${ids[0]}/like`);

  // A tournament in two weeks, two boats already in (Liberian Girl not yet); an announcement.
  const ev = (await sec.call('POST', '/events', { kind: 'tournament', name: 'JHMMC Marlin Classic', date: day(-13), endDate: day(-14) })).event;
  await steve.call('PUT', `/tournaments/${ev.id}/entries/${aqua.id}`, { entered: true, anglers: [{ userId: steve.id }, { userId: elie.id }] });
  await jack.call('PUT', `/tournaments/${ev.id}/entries/${bait.id}`, { entered: true, anglers: [{ userId: jack.id }, { userId: charbel.id }, { userId: maamoun.id }] });
  await sec.call('POST', '/announcements', { title: 'Weigh station hours', body: 'Beerville and Extreme are open 3–7 pm every Saturday and Sunday this season.' });

  // Liberian Girl's trip this morning, logged at sea, and earlier trips in the log.
  const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const trip = (await rayan.call('POST', '/outings/fish', { speciesId: sp['Yellowfin tuna'], fate: 'kept', weightKg: '40', lat: '6.05', lng: '-10.95', landedAt: hoursAgo(3) })).trip;
  const landed = trip.landings[0];
  if (landed) await rayan.call('POST', `/outings/fish/${landed.id}/photo`, multipart({ photo: picture('tuna2.jpg') }));
  await rayan.call('POST', '/outings/fish', { speciesId: sp.Sailfish, fate: 'released', lat: '6.02', lng: '-10.99', landedAt: hoursAgo(2) });
  for (const [u, ago, name, released, kept] of [[ziad, 11, 'Yellowfin tuna', 0, 3], [elie, 8, 'Dorado', 2, 4], [rayan, 4, 'Sailfish', 2, 0]]) {
    await u.call('POST', '/outings', { date: day(ago), fish: [{ speciesId: sp[name], released, kept, lost: 0 }] });
  }
  // Two months of trips logged at sea by every boat, for the log, the season numbers and the catch maps.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const catches = [['Yellowfin tuna', 'kept'], ['Yellowfin tuna', 'kept'], ['Sailfish', 'released'], ['Sailfish', 'released'], ['Blue marlin', 'released'],
    ['Dorado', 'kept'], ['Wahoo', 'kept'], ['Skipjack tuna', 'kept'], ['Barracuda', 'released'], ['Yellowfin tuna', 'lost']];
  for (const [u, every, from] of [[rayan, 5, 2], [charbel, 6, 3], [elie, 7, 4], [lewaa, 8, 6], [demoCap, 6, 1]]) {
    for (let ago = from + 5; ago < 70; ago += every + Math.floor(rnd() * 3)) {
      const date = day(ago);
      // Mostly off Monrovia, some further up towards Robertsport.
      const north = rnd() < 0.3;
      const [lat0, lng0] = north ? [6.55, -11.55] : [5.95, -11.05];
      for (let k = 1 + Math.floor(rnd() * 3); k > 0; k -= 1) {
        const [name, fate] = catches[Math.floor(rnd() * catches.length)];
        const lat = (lat0 + (rnd() - 0.5) * 0.35).toFixed(4); const lng = (lng0 + (rnd() - 0.5) * 0.35).toFixed(4);
        await u.call('POST', '/outings/fish', { speciesId: sp[name], fate, date, lat, lng, landedAt: new Date(`${date}T${String(8 + k).padStart(2, '0')}:${10 + Math.floor(rnd() * 40)}:00Z`).toISOString() });
      }
    }
  }
  // Waiting for the secretary: today's marlin from Bait Master.
  // Weighmasters: Faris (Sea Monkey's captain) at Beerville, Steve (Aquaholic's) at Extreme.
  await sec.call('PUT', `/weighmasters/${faris.id}`, { station: 'Beerville' });
  await sec.call('PUT', `/weighmasters/${steve.id}`, { station: 'Extreme' });
  // Today Steve wasn't at Extreme, so Bait Master's captain weighed his own marlin.
  const today = sheet(bait, 0, [['Blue marlin', '186', maamoun, 'marlin3.jpg']]);
  today.append('noWeighmaster', 'absent');
  const waiting = (await jack.call('POST', '/weigh/sheet', today)).catches[0];
  // ...and another captain questions it.
  await faris.call('POST', `/catches/${waiting.id}/disputes`, { reason: 'The scale reading isn\u2019t clear in the photo.' });
  return true;
}

module.exports = { seedDemo, DEMO_ACCOUNTS };
