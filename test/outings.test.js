const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

test('the regional log: one line per outing, blank days too, and the season at a glance', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-outings-'));
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher: { publicKey: 'k', send: async () => true } });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body) => {
      const headers = cookie ? { cookie } : {};
      if (body) headers['content-type'] = 'application/json';
      const res = await fetch(at + url, { method, headers, body: body && JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, body: json, type: res.headers.get('content-type') };
    };
  };
  try {
    const marwan = as();
    await marwan('POST', '/auth/register', { firstName: 'Marwan', lastName: 'Abdalkareem', email: 'm@example.com', password: 'password1' });
    await marwan('POST', '/teams', { name: 'Exocet', country: 'Guinea' });
    const bob = as();
    await bob('POST', '/auth/register', { firstName: 'Bob', lastName: 'Baines', email: 'bob@example.com', password: 'password1' });
    const bottomLine = (await bob('POST', '/teams', { name: 'Bottom Line', country: 'Sierra Leone' })).body.team;
    const visitor = as();
    await visitor('POST', '/auth/register', { firstName: 'Ama', lastName: 'Owusu', email: 'ama@example.com', password: 'password1' });
    const sp = Object.fromEntries((await marwan('GET', '/meta')).body.species.map((s) => [s.name, s.id]));

    // A good day: two species, mixed results; the boat and country come from Marwan's boat.
    let r = await marwan('POST', '/outings', {
      date: '2026-10-18', technique: ['Casting', 'Not a technique'], area: 'Off Conakry', depthM: '60', waterC: '29',
      fish: [{ speciesId: sp['Atlantic sailfish'], released: 2, lost: 1 }, { speciesId: sp.Wahoo, kept: 1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.outing.line, '2026-10-18 | Exocet | Guinea | Atlantic sailfish: 3 (2 released, 1 lost); Wahoo: 1 (1 kept) | Casting | Off Conakry, 60 m | 29°C');
    // A blank day, on Bob's boat.
    r = await bob('POST', '/outings', { date: '2026-10-17', noCatch: true, technique: ['Trolling'] });
    assert.equal(r.body.outing.line, '2026-10-17 | Bottom Line | Sierra Leone | No catch | Trolling |  | ');
    // What's refused.
    assert.match((await visitor('POST', '/outings', { date: '2026-10-17', noCatch: true })).body.error, /boats have to be on the app/, 'no boat: choose one');
    assert.match((await visitor('POST', '/outings', { date: '2026-10-17', noCatch: true, teamId: 9999 })).body.error, /boat/);
    assert.equal((await visitor('POST', '/outings', { date: '2026-10-16', noCatch: true, teamId: bottomLine.id })).status, 201, 'any boat on the app');
    assert.match((await marwan('POST', '/outings', { date: '2026-10-18', fish: [] })).body.error, /No catch/);
    assert.match((await marwan('POST', '/outings', { date: '2026-10-18', fish: [{ speciesId: sp.Wahoo }] })).body.error, /released, kept or lost/);
    assert.match((await marwan('POST', '/outings', { date: '2026-10-18', noCatch: true, waterC: 80 })).body.error, /°C/);
    assert.match((await marwan('POST', '/outings', { date: '2099-01-01', noCatch: true })).body.error, /future/);
    assert.equal((await as()('POST', '/outings', { date: '2026-10-18', noCatch: true })).status, 401);

    // The log: everyone signed in sees it, newest first, by country.
    const log = (await bob('GET', '/outings')).body;
    assert.deepEqual(log.outings.map((o) => [o.date, o.boat, o.loggedBy]),
      [['2026-10-18', 'Exocet', 'Marwan Abdalkareem'], ['2026-10-17', 'Bottom Line', 'Bob Baines'], ['2026-10-16', 'Bottom Line', 'Ama Owusu']]);
    assert.deepEqual(log.countries, ['Guinea', 'Sierra Leone']);
    assert.deepEqual((await bob('GET', '/outings?country=Guinea')).body.outings.map((o) => o.boat), ['Exocet']);
    assert.deepEqual(log.outings.map((o) => o.canDelete), [false, true, false]);
    assert.equal((await as()('GET', '/outings')).body.outings.length, 3, 'anyone can see the log');

    // As a spreadsheet.
    const csv = await bob('GET', '/outings.csv');
    assert.match(csv.type, /text\/csv/);
    assert.match(csv.body, /"2026-10-17","Bottom Line","Sierra Leone","No catch","Trolling"/);

    // The season: 3 outings, 2 blank, 2 billfish caught (released or kept) over 3 days.
    const season = (await as()('GET', '/outings/season?year=2026')).body;
    assert.deepEqual([season.year, season.outings, season.blank, season.species], ['2026', 3, 2, 'Atlantic sailfish']);
    assert.equal(season.billfishPerDay.toFixed(2), '0.67');
    assert.equal(season.months[9].perDay.toFixed(2), '0.67', 'October: 2 sailfish over 3 days');
    assert.deepEqual(season.best, { days: 1, water: [29, 29], depth: [60, 60], techniques: ['Casting'] });

    // Only whoever logged it (or the admin) removes an outing.
    assert.equal((await bob('DELETE', `/outings/${log.outings[0].id}`)).status, 403);
    assert.equal((await marwan('DELETE', `/outings/${log.outings[0].id}`)).status, 200);

    // Fish on at sea: each fish as it's landed, spot and time from the phone.
    // The first one starts the boat's line for the day.
    const deckhand = as();
    await deckhand('POST', '/auth/register', { firstName: 'Kofi', lastName: 'Mensah', email: 'kofi@example.com', password: 'password1' });
    const code = (await marwan('GET', '/teams/1')).body.team.joinCode;
    assert.equal((await deckhand('POST', '/teams/join', { code })).status, 200);
    const land = (who, extra) => who('POST', '/outings/fish', { speciesId: sp['Atlantic sailfish'], fate: 'released', lat: 9.4, lng: -13.9, landedAt: '2026-10-20T09:15:00Z', date: '2026-10-20', ...extra });
    r = await land(marwan, { clientId: 'a1' });
    assert.equal(r.status, 201);
    assert.equal((await land(marwan, { clientId: 'a1' })).body.trip.landings.length, 1, 'sent twice without signal: counted once');
    r = await land(deckhand, { fate: 'kept', speciesId: sp.Wahoo, lat: 9.41, lng: -13.88, weightKg: '18.5' });
    assert.equal(r.body.trip.landings[1].weightKg, 18.5, 'estimated weight');
    assert.match((await land(deckhand, { weightKg: '-2' })).body.error, /kilograms/);
    r = await land(deckhand, {});
    let trip = r.body.trip;
    assert.equal(trip.boat, 'Exocet');
    assert.equal(trip.line, '2026-10-20 | Exocet | Guinea | Atlantic sailfish: 2 (2 released); Wahoo: 1 (1 kept) |  |  | ');
    assert.deepEqual(trip.landings.map((l) => [l.species, l.fate, l.lat, l.loggedBy]),
      [['Atlantic sailfish', 'released', 9.4, 'Marwan Abdalkareem'], ['Wahoo', 'kept', 9.41, 'Kofi Mensah'], ['Atlantic sailfish', 'released', 9.4, 'Kofi Mensah']]);
    assert.match((await land(visitor, {})).body.error, /boat/, 'on a boat to log fish');
    assert.match((await land(marwan, { fate: 'eaten' })).body.error, /Released, kept or lost/);
    // A weight guessed after the fish is in.
    r = await deckhand('PATCH', `/outings/fish/${trip.landings[0].id}`, { weightKg: 30 });
    assert.equal(r.body.trip.landings[0].weightKg, 30);
    assert.equal((await bob('PATCH', `/outings/fish/${trip.landings[0].id}`, { weightKg: 1 })).status, 403);
    // The log shows each fish, never the spots.
    const pub = (await as()('GET', '/outings')).body.outings.find((o) => o.id === trip.id);
    assert.equal(pub.fish.length, 2);
    assert.deepEqual(pub.landings.map((l) => [l.species, l.fate, l.weightKg]),
      [['Atlantic sailfish', 'released', 30], ['Wahoo', 'kept', 18.5], ['Atlantic sailfish', 'released', null]]);
    assert.equal(JSON.stringify(pub).includes('9.41'), false);
    // A mistap comes back off; the crew finishes the trip at the end of the day.
    r = await deckhand('DELETE', `/outings/fish/${trip.landings[1].id}`);
    assert.deepEqual(r.body.trip.fish.map((f) => [f.species, f.released, f.kept]), [['Atlantic sailfish', 2, 0]]);
    assert.equal((await bob('DELETE', `/outings/fish/${trip.landings[0].id}`)).status, 403, 'not his boat');
    r = await deckhand('PATCH', `/outings/${trip.id}`, { technique: ['Trolling'], area: 'Off Conakry', depthM: 80, waterC: 28.5 });
    assert.equal(r.body.trip.line, '2026-10-20 | Exocet | Guinea | Atlantic sailfish: 2 (2 released) | Trolling | Off Conakry, 80 m | 28.5°C');
    assert.equal((await bob('PATCH', `/outings/${trip.id}`, { area: 'x' })).status, 403);
    assert.equal((await marwan('GET', '/outings/trip?date=2026-10-20')).body.trip.id, trip.id);
    assert.match((await marwan('POST', '/outings', { date: '2026-10-20', noCatch: true })).body.error, /already has a line/, 'one line per boat per day');
    // Depth charts: crews only, never public.
    assert.equal((await as()('GET', '/charts')).status, 401);
    assert.equal((await visitor('GET', '/charts')).status, 403, 'not on a boat');
    const { charts } = (await deckhand('GET', '/charts')).body;
    assert.ok(charts.length && charts[0].bounds.north > charts[0].bounds.south);
    const img = await fetch(at + charts[0].url.replace('/api', ''), { headers: {} });
    assert.equal(img.status, 401, 'the image needs signing in too');
    // The spots go on the crew's catch maps.
    const mine = (await deckhand('GET', '/me/spots')).body.spots;
    assert.deepEqual(mine.filter((x) => x.kind === 'log').map((x) => [x.species, x.released]), [['Atlantic sailfish', true], ['Atlantic sailfish', true]]);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
