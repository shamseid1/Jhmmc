const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

test('captains enter their anglers; the secretary keeps the registration sheet', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-entries-'));
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com', pusher: { publicKey: 'k', send: async () => true } });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(at + url, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
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
  const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
  try {
    const sec = await person('Robert', 'boss@example.com');
    const cap = await person('Rayan Eid', 'r@example.com');
    const mate = await person('Faris', 'f@example.com');
    const other = await person('Kofi', 'k@example.com');
    const jhmmc = (await cap('GET', '/clubs')).body.clubs.find((c) => c.name === 'JHMMC').id;
    const girl = (await cap('POST', '/teams', { name: 'Liberian Girl', clubId: jhmmc, weighStation: 'Beerville' })).body.team;
    await mate('POST', '/teams/join', { code: girl.joinCode });
    const reel = (await other('POST', '/teams', { name: 'Afro Queen', clubId: jhmmc, division: 'river', weighStation: 'Barracuda Club' })).body.team;
    const mateId = (await mate('GET', '/me')).body.user.id;
    const memorial = (await sec('POST', '/events', { date: day(5), endDate: day(6), kind: 'tournament', name: 'Memorial Tournament' })).body.event;
    const past = (await sec('POST', '/events', { date: day(-10), kind: 'tournament', name: 'Old Cup' })).body.event;

    // The captain sees the tournament and their crew, and enters with members and guests.
    const list = (await cap('GET', '/tournaments')).body;
    assert.equal(list.fee, 50);
    assert.deepEqual(list.tournaments.map((t) => [t.name, t.open, t.mine]), [['Old Cup', false, false], ['Memorial Tournament', true, false]]);
    const mine = (await cap('GET', `/tournaments/${memorial.id}/my-entry`)).body;
    assert.deepEqual([mine.team.name, mine.entered, mine.crew.map((c) => c.name)], ['Liberian Girl', false, ['Faris', 'Rayan Eid']]);
    assert.equal((await mate('GET', `/tournaments/${memorial.id}/my-entry`)).status, 403, 'crew members are not captains');
    const anglers = [{ userId: mine.crew[1].id, member: true }, { userId: mateId, member: true }, { name: 'Guest Nadine', member: false }, { name: 'Remon', member: false }];
    assert.equal((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [] })).status, 400);
    assert.match((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [...anglers, { name: 'remon' }] })).body.error, /twice/);
    assert.match((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [{ userId: 9999, member: true }] })).body.error, /crew/);
    assert.equal((await cap('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: true, anglers })).status, 403, 'only your own boat');
    assert.match((await cap('PUT', `/tournaments/${past.id}/entries/${girl.id}`, { entered: true, anglers })).body.error, /over/, 'closed once over');
    let r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers });
    assert.deepEqual(r.body.anglers.map((a) => [a.name, a.member]), [['Rayan Eid', true], ['Faris', true], ['Guest Nadine', false], ['Remon', false]]);
    assert.equal((await cap('GET', '/tournaments')).body.tournaments.find((t) => t.id === memorial.id).mine, true);

    // The secretary's sheet: every JHMMC boat, who's in, anglers, and paid temporary memberships.
    assert.equal((await cap('GET', `/tournaments/${memorial.id}/sheet`)).status, 403);
    let sheet = (await sec('GET', `/tournaments/${memorial.id}/sheet`)).body;
    assert.deepEqual(sheet.boats.map((b) => [b.teamName, b.division, b.station, b.entered, b.anglers.length]),
      [['Afro Queen', 'river', 'Barracuda Club', false, 0], ['Liberian Girl', 'ocean', 'Beerville', true, 4]]);
    const nadine = sheet.boats[1].anglers.find((a) => a.name === 'Guest Nadine');
    assert.equal((await cap('PATCH', `/tournaments/${memorial.id}/anglers/${nadine.id}`, { paid: true })).status, 403);
    assert.deepEqual((await sec('PATCH', `/tournaments/${memorial.id}/anglers/${nadine.id}`, { paid: true })).body, { ok: true, member: false, paid: true });
    let counts = (await sec('GET', '/tournaments')).body.tournaments.find((t) => t.id === memorial.id);
    assert.deepEqual([counts.boats, counts.anglers, counts.guests, counts.unpaid], [1, 4, 2, 1]);
    // The captain edits the list: Nadine stays (still paid), Remon drops out, a member joins.
    r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true,
      anglers: [{ userId: mine.crew[1].id, member: true }, { name: 'Guest Nadine', member: false }, { name: 'Jens', member: true }] });
    assert.deepEqual(r.body.anglers.map((a) => [a.name, a.paid]), [['Rayan Eid', false], ['Guest Nadine', true], ['Jens', false]]);
    // The secretary puts the other boat in (anglers to follow) and takes it out again.
    assert.equal((await sec('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: true })).status, 200);
    sheet = (await sec('GET', `/tournaments/${memorial.id}/sheet`)).body;
    assert.equal(sheet.boats.find((b) => b.teamId === reel.id).entered, true);
    await sec('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: false });
    // A captain withdrawing removes the anglers too.
    await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: false });
    sheet = (await sec('GET', `/tournaments/${memorial.id}/sheet`)).body;
    assert.ok(sheet.boats.every((b) => !b.entered && !b.anglers.length));
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
