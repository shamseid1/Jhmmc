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
      date: '2026-10-18', hours: '7', technique: ['Casting', 'Not a technique'], area: 'Off Conakry', depthM: '60', waterC: '29',
      fish: [{ speciesId: sp['Atlantic sailfish'], released: 2, lost: 1 }, { speciesId: sp.Wahoo, kept: 1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.outing.line, '2026-10-18 | Exocet | Guinea | 7 h | Atlantic sailfish: 3 (2 released, 1 lost); Wahoo: 1 (1 kept) | Casting | Off Conakry, 60 m | 29°C');
    // A blank day, on Bob's boat.
    r = await bob('POST', '/outings', { date: '2026-10-17', hours: 6, noCatch: true, technique: ['Trolling lures'] });
    assert.equal(r.body.outing.line, '2026-10-17 | Bottom Line | Sierra Leone | 6 h | No catch | Trolling lures |  | ');
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
    assert.match(csv.body, /"2026-10-17","Bottom Line","Sierra Leone","6","No catch","Trolling lures"/);

    // The season: 3 outings, 2 blank, 2 billfish caught (released or kept) over 3 days.
    const season = (await as()('GET', '/outings/season?year=2026')).body;
    assert.deepEqual([season.year, season.outings, season.blank, season.species], ['2026', 3, 2, 'Atlantic sailfish']);
    assert.equal(season.billfishPerDay.toFixed(2), '0.67');
    assert.equal(season.months[9].perDay.toFixed(2), '0.67', 'October: 2 sailfish over 3 days');
    assert.deepEqual(season.best, { days: 1, water: [29, 29], depth: [60, 60], techniques: ['Casting'] });

    // Only whoever logged it (or the admin) removes an outing.
    assert.equal((await bob('DELETE', `/outings/${log.outings[0].id}`)).status, 403);
    assert.equal((await marwan('DELETE', `/outings/${log.outings[0].id}`)).status, 200);
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
