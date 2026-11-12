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
    await marwan('POST', '/auth/register', { acceptRules: true, firstName: 'Marwan', lastName: 'Abdalkareem', email: 'm@example.com', password: 'password1' });
    await marwan('POST', '/teams', { name: 'Exocet', country: 'Guinea' });
    const bob = as();
    await bob('POST', '/auth/register', { acceptRules: true, firstName: 'Bob', lastName: 'Baines', email: 'bob@example.com', password: 'password1' });
    const bottomLine = (await bob('POST', '/teams', { name: 'Bottom Line', country: 'Sierra Leone' })).body.team;
    const visitor = as();
    await visitor('POST', '/auth/register', { acceptRules: true, firstName: 'Ama', lastName: 'Owusu', email: 'ama@example.com', password: 'password1' });
    const sp = Object.fromEntries((await marwan('GET', '/meta')).body.species.map((s) => [s.name, s.id]));

    // A good day: two species, mixed results; the boat and country come from Marwan's boat.
    let r = await marwan('POST', '/outings', {
      date: '2026-10-18', technique: ['Casting', 'Not a technique'], area: 'Off Conakry', depthM: '60', waterC: '29',
      fish: [{ speciesId: sp['Sailfish'], released: 2, lost: 1 }, { speciesId: sp.Wahoo, kept: 1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.outing.line, '2026-10-18 | Exocet | Guinea | Sailfish: 3 (2 released, 1 lost); Wahoo: 1 (1 kept) | Casting | Off Conakry, 60 m | 29°C');
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
    assert.deepEqual([season.year, season.outings, season.blank, season.species], ['2026', 3, 2, 'Sailfish']);
    assert.equal(season.billfishPerDay.toFixed(2), '0.67');
    assert.equal(season.months[9].perDay.toFixed(2), '0.67', 'October: 2 sailfish over 3 days');
    assert.deepEqual(season.best, { days: 1, water: [29, 29], depth: [60, 60], techniques: ['Casting'] });

    // Only whoever logged it (or the admin) removes an outing.
    assert.equal((await bob('DELETE', `/outings/${log.outings[0].id}`)).status, 403);
    assert.equal((await marwan('DELETE', `/outings/${log.outings[0].id}`)).status, 200);

    // Fish on at sea: each fish as it's landed, spot and time from the phone.
    // The first one starts the boat's line for the day.
    const deckhand = as();
    await deckhand('POST', '/auth/register', { acceptRules: true, firstName: 'Kofi', lastName: 'Mensah', email: 'kofi@example.com', password: 'password1' });
    const code = (await marwan('GET', '/teams/1')).body.team.joinCode;
    assert.equal((await deckhand('POST', '/teams/join', { code })).status, 200);
    const land = (who, extra) => who('POST', '/outings/fish', { speciesId: sp['Sailfish'], fate: 'released', lat: 9.4, lng: -13.9, landedAt: '2026-10-20T09:15:00Z', date: '2026-10-20', ...extra });
    r = await land(marwan, { clientId: 'a1' });
    assert.equal(r.status, 201);
    assert.equal((await land(marwan, { clientId: 'a1' })).body.trip.landings.length, 1, 'sent twice without signal: counted once');
    r = await land(deckhand, { fate: 'kept', speciesId: sp.Wahoo, lat: 9.41, lng: -13.88, weightKg: '18.5' });
    assert.equal(r.body.trip.landings[1].weightKg, 18.5, 'estimated weight');
    assert.match((await land(deckhand, { weightKg: '-2' })).body.error, /kilograms/);
    r = await land(deckhand, {});
    let trip = r.body.trip;
    assert.equal(trip.boat, 'Exocet');
    assert.equal(trip.line, '2026-10-20 | Exocet | Guinea | Sailfish: 2 (2 released); Wahoo: 1 (1 kept) |  |  | ');
    assert.deepEqual(trip.landings.map((l) => [l.species, l.fate, l.lat, l.loggedBy]),
      [['Sailfish', 'released', 9.4, 'Marwan Abdalkareem'], ['Wahoo', 'kept', 9.41, 'Kofi Mensah'], ['Sailfish', 'released', 9.4, 'Kofi Mensah']]);
    assert.match((await land(visitor, {})).body.error, /boat/, 'on a boat to log fish');
    assert.match((await land(marwan, { fate: 'eaten' })).body.error, /Released, kept or lost/);
    // A released fish's estimate, given afterwards; a kept one waits for the scale.
    r = await deckhand('PATCH', `/outings/fish/${trip.landings[0].id}`, { weightKg: 150 });
    assert.equal(r.body.trip.landings[0].weightKg, 150);
    assert.match((await deckhand('PATCH', `/outings/fish/${trip.landings[1].id}`, { weightKg: 20 })).body.error, /scale/);
    assert.equal((await bob('PATCH', `/outings/fish/${trip.landings[0].id}`, { weightKg: 1 })).status, 403);
    // The log shows each fish, never the spots.
    const pub = (await as()('GET', '/outings')).body.outings.find((o) => o.id === trip.id);
    assert.equal(pub.fish.length, 2);
    assert.deepEqual(pub.landings.map((l) => [l.species, l.fate, l.weightKg]),
      [['Sailfish', 'released', 150], ['Wahoo', 'kept', 18.5], ['Sailfish', 'released', null]]);
    assert.equal(JSON.stringify(pub).includes('9.41'), false);
    // A mistap comes back off; the crew finishes the trip at the end of the day.
    r = await deckhand('DELETE', `/outings/fish/${trip.landings[1].id}`);
    assert.deepEqual(r.body.trip.fish.map((f) => [f.species, f.released, f.kept]), [['Sailfish', 2, 0]]);
    assert.equal((await bob('DELETE', `/outings/fish/${trip.landings[0].id}`)).status, 403, 'not his boat');
    r = await deckhand('PATCH', `/outings/${trip.id}`, { technique: ['Trolling'], area: 'Off Conakry', depthM: 80, waterC: 28.5 });
    assert.equal(r.body.trip.line, '2026-10-20 | Exocet | Guinea | Sailfish: 2 (2 released) | Trolling | Off Conakry, 80 m | 28.5°C');
    assert.equal((await bob('PATCH', `/outings/${trip.id}`, { area: 'x' })).status, 403);
    assert.equal((await marwan('GET', '/outings/trip?date=2026-10-20')).body.trip.id, trip.id);
    assert.match((await marwan('POST', '/outings', { date: '2026-10-20', noCatch: true })).body.error, /already has a line/, 'one line per boat per day');
    // The feed fills itself from Log fish: boat, species and fate, never a spot.
    // Posting by hand is closed.
    const feed = (await as()('GET', '/feed')).body.items;
    assert.ok(feed.some((x) => x.kind === 'log' && x.boat === 'Exocet' && x.species === 'Sailfish' && x.fate === 'released'));
    assert.equal(JSON.stringify(feed).includes('9.41'), false, 'no spots on the feed');
    assert.ok((await as()('GET', '/feed?type=logged')).body.items.every((x) => x.kind === 'log'));
    assert.equal((await as()('GET', '/feed?type=weighins')).body.items.length, 0, 'nothing weighed in yet');
    assert.match((await marwan('POST', '/catches', {})).body.error, /fills itself/);
    // A boat's own log (My boat): its trips and its own season.
    const exocet = trip.teamId;
    const own = (await marwan('GET', `/outings?team=${exocet}`)).body.outings;
    assert.ok(own.length > 0 && own.every((o) => o.teamId === exocet));
    assert.equal((await marwan('GET', `/outings/season?team=${exocet}&year=2026`)).body.outings, own.filter((o) => o.date.startsWith('2026')).length);
    assert.match((await marwan('GET', `/outings.csv?team=${exocet}`)).body, /Exocet/);
    assert.doesNotMatch((await marwan('GET', `/outings.csv?team=${exocet}`)).body, /Bottom Line/);
    // A wrong tap fixed: the species or the result changes, the time and spot stay.
    const tapped = (await marwan('GET', '/outings/trip?date=2026-10-20')).body.trip.landings[0];
    let fixed = (await marwan('PATCH', `/outings/fish/${tapped.id}`, { speciesId: sp['Blue marlin'], fate: 'kept' })).body.trip;
    const now1 = fixed.landings.find((l) => l.id === tapped.id);
    assert.deepEqual([now1.species, now1.fate, now1.lat, now1.landedAt], ['Blue marlin', 'kept', tapped.lat, tapped.landedAt]);
    assert.equal(fixed.fish.find((f) => f.species === 'Blue marlin').kept, 1, 'the counts follow');
    assert.equal((await bob('PATCH', `/outings/fish/${tapped.id}`, { fate: 'lost' })).status, 403);
    assert.match((await marwan('PATCH', `/outings/fish/${tapped.id}`, { fate: 'eaten' })).body.error, /Kept, released or lost/);
    await marwan('PATCH', `/outings/fish/${tapped.id}`, { speciesId: tapped.speciesId, fate: tapped.fate });

    // Outings: by month and species, 30 at a time.
    const oct = (await bob('GET', '/outings?month=2026-10')).body;
    assert.ok(oct.outings.every((o) => o.date.startsWith('2026-10')) && oct.months.includes('2026-10'));
    assert.ok((await bob('GET', `/outings?species=${sp.Sailfish}`)).body.outings.every((o) => o.fish.some((f) => f.species === 'Sailfish')));
    assert.ok(oct.species.some((x) => x.name === 'Sailfish') && oct.boats.some((x) => x.name === 'Exocet'));

    // One row per fish: the boat's own crew get the spots, nobody else.
    const ownCsv = (await marwan('GET', `/outings/fish.csv?team=${trip.teamId}`)).body;
    assert.match(ownCsv, /Latitude/);
    assert.match(ownCsv, /"Sailfish","Released"/);
    assert.doesNotMatch((await bob('GET', `/outings/fish.csv?team=${trip.teamId}`)).body, /Latitude/);
    assert.doesNotMatch((await as()('GET', '/outings/fish.csv')).body, /Latitude|9\.41/);

    // Trends: year against year, what's biting now, water and billfish by week.
    const tr = (await as()('GET', '/outings/trends?species=Sailfish')).body;
    assert.equal(tr.species, 'Sailfish');
    const y2026 = tr.years.find((y) => y.year === '2026');
    const sameSeason = (await as()('GET', '/outings/season?year=2026&species=Sailfish')).body;
    assert.equal(y2026.months[9].count, sameSeason.months[9].count, 'the same October count as the Season tab');
    assert.equal(y2026.first, '2026-10-20', 'the first sailfish still in the log (the 18th was removed)');
    assert.equal(tr.weeks.length, 26);
    assert.ok(Array.isArray(tr.now.biting));
    // The regional grid: 10 km squares, counts only, never a spot or a boat's name.
    assert.equal((await as()('GET', '/outings/grid')).status, 401, 'members only');
    const grid = (await bob('GET', '/outings/grid?species=Sailfish')).body;
    assert.equal(grid.size, 0.1);
    assert.ok(grid.cells.length > 0 && grid.cells.every((c) => c.north - c.south > 0.09 && c.fish > 0 && c.boats >= 1));
    assert.equal(JSON.stringify(grid).includes('9.41'), false, 'no exact spots');
    assert.equal(JSON.stringify(grid).includes('Exocet'), false, 'no boat names');
    const everything = (await bob('GET', '/outings/grid?year=all&month=all')).body;
    assert.ok(everything.cells.reduce((n, c) => n + c.fish, 0) >= grid.cells.reduce((n, c) => n + c.fish, 0), 'all years and months together');
    assert.equal(everything.month, null);
    // Depth charts: everyone signed in, never public.
    assert.equal((await as()('GET', '/charts')).status, 401);
    assert.equal((await visitor('GET', '/charts')).status, 200, 'not on a boat, but signed in');
    const { charts } = (await deckhand('GET', '/charts')).body;
    assert.ok(charts.length && charts[0].bounds.north > charts[0].bounds.south);
    assert.match(charts[0].cleanTiles, /clean=1/, 'the clean tiles, for the light chart');
    const chart = charts[0];
    const tile = (chart.tiles || chart.url).replace('/api', '').replace('{z}', 7).replace('{x}', 58).replace('{y}', 61);
    assert.equal((await fetch(at + tile)).status, 401, 'the chart needs signing in too');
    // The spots go on the crew's catch maps.
    const mine = (await deckhand('GET', '/me/spots')).body.spots;
    assert.ok(mine.every((x) => 'depthM' in x && 'waterC' in x), 'the depth and water saved with each fish (none here: no forecast in tests)');
    assert.deepEqual(mine.filter((x) => x.kind === 'log').map((x) => [x.species, x.released]), [['Sailfish', true], ['Sailfish', true]]);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
