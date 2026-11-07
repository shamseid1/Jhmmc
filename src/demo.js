const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The demo copy (DEMO=1): a made-up JHMMC season to show the club, filled in
// through the app's own API so it is exactly what members would see.
// Anyone with the link signs in with these; their passwords can't be changed.
const PASSWORD = 'demo-pass-1';
const DEMO_ACCOUNTS = [
  { role: 'Captain of Liberian Girl', email: 'tony@example.com', password: PASSWORD },
  { role: 'Angler on Sea Hunter', email: 'sam@example.com', password: PASSWORD },
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
  const sec = await member('Musa', 'Kamara', 'secretary@example.com');
  const caps = [await member('Tony', 'Haddad', 'tony@example.com'), await member('James', 'Doe', 'james@example.com'),
    await member('Karim', 'Saab', 'karim@example.com')];
  const crew = [await member('Fatu', 'Johnson', 'fatu@example.com'), await member('Ali', 'Fawaz', 'ali@example.com'),
    await member('Samuel', 'Brown', 'sam@example.com'), await member('Rami', 'Khoury', 'rami@example.com')];
  const sl = await member('Abu', 'Sesay', 'abu@example.com');

  const jh = (await boss.call('GET', '/clubs')).clubs.find((c) => c.name === 'JHMMC').id;
  for (const u of [sec, ...caps, ...crew]) await boss.call('PATCH', `/admin/users/${u.id}`, { jhmmc: true });
  await boss.call('PATCH', `/admin/users/${sec.id}`, { role: 'secretary' });
  const boats = [['Liberian Girl', 'Beerville', 42, 'Bertram 42'], ['Sea Hunter', 'Extreme', 38, 'Hatteras 38'], ['Reel Deal', 'Barracuda Club', 35, 'Contender 35']];
  const teams = [];
  for (const [i, [name, weighStation, lengthFt, make]] of boats.entries()) {
    teams.push((await caps[i].call('POST', '/teams', { name, clubId: jh, weighStation, lengthFt, make, country: 'Liberia' })).team);
  }
  await sl.call('POST', '/teams', { name: 'Freetown Express', country: 'Sierra Leone', homePort: 'Freetown', lengthFt: 31, make: 'Yamaha 31' });
  const aboard = async (u, i) => {
    const t = (await caps[i].call('POST', `/teams/${teams[i].id}/code`)).team;
    await u.call('POST', '/teams/join', { code: t.joinCode });
  };
  await aboard(crew[0], 0); await aboard(crew[1], 0); await aboard(crew[2], 1); await aboard(crew[3], 2);
  const sp = Object.fromEntries((await boss.call('GET', '/meta')).species.map((s) => [s.name, s.id]));

  // Weigh-ins over the last three weeks, approved by the secretary.
  const sheet = (t, ago, fish) => multipart({
    teamId: String(t.id), caughtOn: day(ago), declared: 'yes', deviceLat: '6.30', deviceLng: '-10.80',
    fish: JSON.stringify(fish.map(([n, kg, a]) => ({ speciesId: sp[n], anglerId: String(a.id), weightKg: kg, released: kg ? '' : 'on' }))),
    ...Object.fromEntries(fish.map(([, , , f], i) => [`scale_${i}`, picture(f)])),
  });
  const sheets = [
    [teams[0], 20, [['Blue marlin', '212', caps[0], 'marlin1.jpg'], ['Yellowfin tuna', '64', crew[0], 'tuna1.jpg']]],
    [teams[1], 18, [['Yellowfin tuna', '88', crew[2], 'tuna2.jpg'], ['Wahoo', '24', caps[1], 'wahoo1.jpg']]],
    [teams[2], 13, [['Dorado', '17', crew[3], 'dorado1.jpg']]],
    [teams[0], 9, [['Sailfish', '', crew[1], 'sail1.jpg']]],
    [teams[1], 6, [['Blue marlin', '168', crew[2], 'marlin2.jpg']]],
    [teams[2], 3, [['Yellowfin tuna', '52', caps[2], 'tuna1.jpg'], ['Wahoo', '19', crew[3], 'wahoo1.jpg']]],
  ];
  const ids = [];
  for (const [t, ago, fish] of sheets) ids.push(...(await boss.call('POST', '/weigh/sheet', sheet(t, ago, fish))).catches.map((k) => k.id));
  for (const id of ids) await sec.call('POST', `/catches/${id}/review`, { decision: 'approve' });
  for (const [u, n, body] of [[crew[2], 0, 'What a fish!'], [caps[1], 0, 'Congrats Tony'], [crew[0], 6, 'Big one!'], [caps[0], 4, 'Nice tuna']]) {
    await u.call('POST', `/catches/${ids[n]}/like`);
    await u.call('POST', `/catches/${ids[n]}/comments`, { body });
  }
  for (const u of [sec, caps[2], crew[1], crew[3]]) await u.call('POST', `/catches/${ids[0]}/like`);

  // A tournament in two weeks, two boats already in; an announcement.
  const ev = (await sec.call('POST', '/events', { kind: 'tournament', name: 'JHMMC Marlin Classic', date: day(-13), endDate: day(-14) })).event;
  await caps[0].call('PUT', `/tournaments/${ev.id}/entries/${teams[0].id}`, { entered: true, anglers: [{ userId: caps[0].id }, { userId: crew[0].id }, { userId: crew[1].id }] });
  await caps[1].call('PUT', `/tournaments/${ev.id}/entries/${teams[1].id}`, { entered: true, anglers: [{ userId: caps[1].id }, { userId: crew[2].id }] });
  await sec.call('POST', '/announcements', { title: 'Weigh station hours', body: 'Beerville and Extreme are open 3–7 pm every Saturday and Sunday this season.' });

  // Sea Hunter's trip this morning, logged at sea, and earlier trips in the log.
  const hoursAgo = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const trip = (await crew[2].call('POST', '/outings/fish', { speciesId: sp['Yellowfin tuna'], fate: 'kept', weightKg: '40', lat: '6.05', lng: '-10.95', landedAt: hoursAgo(3) })).trip;
  const landed = trip.landings[0];
  if (landed) await crew[2].call('POST', `/outings/fish/${landed.id}/photo`, multipart({ photo: picture('tuna2.jpg') }));
  await crew[2].call('POST', '/outings/fish', { speciesId: sp.Sailfish, fate: 'released', lat: '6.02', lng: '-10.99', landedAt: hoursAgo(2) });
  for (const [u, ago, name, released, kept] of [[crew[0], 11, 'Yellowfin tuna', 0, 3], [crew[3], 8, 'Dorado', 2, 4], [crew[0], 4, 'Sailfish', 2, 0]]) {
    await u.call('POST', '/outings', { date: day(ago), fish: [{ speciesId: sp[name], released, kept, lost: 0 }] });
  }
  // Waiting for the secretary: today's marlin from Reel Deal.
  await boss.call('POST', '/weigh/sheet', sheet(teams[2], 0, [['Blue marlin', '186', crew[3], 'marlin3.jpg']]));
  return true;
}

module.exports = { seedDemo, DEMO_ACCOUNTS };
