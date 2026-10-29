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

    // The admin adds people to JHMMC; the secretary keeps the season's paid members.
    const rayanId = (await cap('GET', '/me')).body.user.id;
    assert.match((await sec('PUT', `/club-members/${rayanId}`, { paid: true })).body.error, /isn't a JHMMC member/);
    for (const id of [rayanId, mateId]) await sec('PATCH', `/admin/users/${id}`, { jhmmc: true });
    assert.equal((await cap('GET', '/club-members')).status, 403);
    assert.equal((await cap('PUT', `/club-members/${rayanId}`, { paid: true })).status, 403);
    assert.equal((await sec('PUT', `/club-members/${rayanId}`, { paid: true })).status, 200);
    const register = (await sec('GET', '/club-members')).body;
    assert.deepEqual(register.people.map((p) => [p.name, p.paid]), [['Faris', false], ['Rayan Eid', true], ['Robert', false]], 'only JHMMC members (and the admin) are listed');

    // The captain sees the tournament and their crew, and enters with members and guests.
    const list = (await cap('GET', '/tournaments')).body;
    assert.equal(list.fee, 50);
    assert.deepEqual(list.tournaments.map((t) => [t.name, t.open, t.mine]), [['Old Cup', false, false], ['Memorial Tournament', true, false]]);
    const mine = (await cap('GET', `/tournaments/${memorial.id}/my-entry`)).body;
    assert.deepEqual([mine.team.name, mine.entered, mine.crew.map((c) => [c.name, c.member])], ['Liberian Girl', false, [['Faris', false], ['Rayan Eid', true]]]);
    assert.equal((await mate('GET', `/tournaments/${memorial.id}/my-entry`)).status, 403, 'crew members are not captains');
    const anglers = [{ userId: mine.crew[1].id, member: true }, { userId: mateId, member: true }, { name: 'Guest Nadine', member: false }, { name: 'Remon', member: false }];
    assert.equal((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [] })).status, 400);
    assert.match((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [...anglers, { name: 'remon' }] })).body.error, /twice/);
    assert.match((await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [{ userId: 9999, member: true }] })).body.error, /crew/);
    assert.equal((await cap('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: true, anglers })).status, 403, 'only your own boat');
    assert.match((await cap('PUT', `/tournaments/${past.id}/entries/${girl.id}`, { entered: true, anglers })).body.error, /over/, 'closed once over');
    let r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers });
    assert.deepEqual(r.body.anglers.map((a) => [a.name, a.member]), [['Rayan Eid', true], ['Faris', false], ['Guest Nadine', false], ['Remon', false]],
      "crew membership comes from the secretary's list, not the captain's tick");
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
    assert.deepEqual([counts.boats, counts.anglers, counts.guests, counts.unpaid], [1, 4, 3, 2]);
    // Faris pays his membership: he's a member now, and owes nothing for the tournament.
    await sec('PUT', `/club-members/${mateId}`, { paid: true });
    counts = (await sec('GET', '/tournaments')).body.tournaments.find((t) => t.id === memorial.id);
    assert.deepEqual([counts.guests, counts.unpaid], [2, 1]);
    assert.equal((await sec('GET', `/tournaments/${memorial.id}/sheet`)).body.boats[1].anglers.find((a) => a.name === 'Faris').member, true);
    // A captain can't make a guest a member; the secretary can, and a captain's later edit keeps it.
    r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [...anglers.slice(0, 2), { name: 'Guest Nadine', member: true }, { name: 'Remon', member: true }] });
    assert.deepEqual(r.body.anglers.slice(2).map((a) => [a.name, a.member]), [['Guest Nadine', false], ['Remon', false]]);
    r = await sec('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [...anglers.slice(0, 2), { name: 'Guest Nadine' }, { name: 'Remon', member: true }] });
    assert.equal(r.body.anglers.find((a) => a.name === 'Remon').member, true, 'the secretary marks a guest as a member');
    r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers });
    assert.equal(r.body.anglers.find((a) => a.name === 'Remon').member, true, "kept through the captain's edit");
    // The captain edits the list: Nadine stays (still paid), Remon drops out, a member joins.
    r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true,
      anglers: [{ userId: mine.crew[1].id }, { name: 'Guest Nadine' }, { name: 'Jens', member: true }] });
    assert.deepEqual(r.body.anglers.map((a) => [a.name, a.member, a.paid]), [['Rayan Eid', true, false], ['Guest Nadine', false, true], ['Jens', false, false]]);
    // The secretary puts the other boat in (anglers to follow) and takes it out again.
    assert.equal((await sec('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: true })).status, 200);
    sheet = (await sec('GET', `/tournaments/${memorial.id}/sheet`)).body;
    assert.equal(sheet.boats.find((b) => b.teamId === reel.id).entered, true);
    await sec('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: false });
    // Members without an account (children): the secretary lists them, the captain picks them.
    assert.equal((await cap('POST', '/club-members/named', { name: 'Sami', teamId: girl.id })).status, 403);
    assert.equal((await sec('POST', '/club-members/named', { name: '' })).status, 400);
    const sami = (await sec('POST', '/club-members/named', { name: 'Sami', teamId: girl.id })).body.id;
    const lea = (await sec('POST', '/club-members/named', { name: 'Lea', teamId: girl.id, paid: false })).body.id;
    assert.equal((await sec('POST', '/club-members/named', { name: 'sami', teamId: girl.id })).status, 409);
    const named = (await sec('GET', '/club-members')).body.named;
    assert.deepEqual(named.map((p) => [p.name, p.teamName, p.paid]), [['Lea', 'Liberian Girl', false], ['Sami', 'Liberian Girl', true]]);
    assert.deepEqual((await cap('GET', `/tournaments/${memorial.id}/my-entry`)).body.named.map((p) => [p.name, p.member]), [['Lea', false], ['Sami', true]]);
    r = await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true,
      anglers: [{ userId: mine.crew[1].id }, { personId: sami, member: false }, { personId: lea, member: true }] });
    assert.deepEqual(r.body.anglers.map((a) => [a.name, a.member]), [['Rayan Eid', true], ['Sami', true], ['Lea', false]],
      'their membership comes from the paid list too');
    await sec('PUT', `/club-members/named/${lea}`, { paid: true });
    assert.equal((await sec('GET', `/tournaments/${memorial.id}/sheet`)).body.boats[1].anglers.find((a) => a.name === 'Lea').member, true);
    counts = (await sec('GET', '/tournaments')).body.tournaments.find((t) => t.id === memorial.id);
    assert.equal(counts.guests, 0, 'everyone on the boat is now a paid member');
    await sec('DELETE', `/club-members/named/${lea}`);
    assert.deepEqual((await sec('GET', '/club-members')).body.named.map((p) => p.name), ['Sami']);

    // Club roles: the president and vice president act like the secretary; the treasurer only handles money.
    const pres = await person('Paul President', 'p@example.com');
    const treas = await person('Tina Treasurer', 't@example.com');
    const idsByEmail = Object.fromEntries((await sec('GET', '/admin/users')).body.users.map((u) => [u.email, u.id]));
    assert.equal((await sec('PATCH', `/admin/users/${idsByEmail['p@example.com']}`, { jhmmc: true, role: 'chairman' })).status, 400);
    await sec('PATCH', `/admin/users/${idsByEmail['p@example.com']}`, { jhmmc: true, role: 'president' });
    await sec('PATCH', `/admin/users/${idsByEmail['t@example.com']}`, { jhmmc: true, role: 'treasurer' });
    const presMe = (await pres('GET', '/me')).body.user;
    const treasMe = (await treas('GET', '/me')).body.user;
    assert.deepEqual([presMe.canReview, presMe.canApprove, treasMe.canReview, treasMe.canHandleMoney], [true, false, false, true]);
    assert.equal((await pres('GET', `/tournaments/${memorial.id}/sheet`)).status, 200);
    await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: true, anglers: [{ userId: rayanId }, { name: 'Visitor Vic' }] });
    const tSheet = (await treas('GET', `/tournaments/${memorial.id}/sheet`)).body;
    const guest = tSheet.boats.find((b) => b.teamId === girl.id).anglers.find((a) => !a.member);
    assert.deepEqual((await treas('PATCH', `/tournaments/${memorial.id}/anglers/${guest.id}`, { paid: true, member: true })).body,
      { ok: true, member: false, paid: true }, 'the treasurer ticks paid but cannot make a guest a member');
    assert.equal((await treas('PUT', `/club-members/${mateId}`, { paid: true })).status, 200);
    assert.equal((await treas('PUT', `/tournaments/${memorial.id}/entries/${reel.id}`, { entered: true })).status, 403, 'not entries');
    assert.equal((await treas('GET', '/officials/pending')).status, 403, 'nor reviewing fish');
    assert.equal((await pres('GET', '/officials/pending')).status, 403, 'only the secretary reviews fish');
    assert.equal((await sec('GET', '/officials/pending')).status, 200);
    assert.ok((await treas('GET', '/tournaments')).body.tournaments.find((t) => t.id === memorial.id).anglers >= 1, 'sees the counts');

    // A captain withdrawing removes the anglers too.
    await cap('PUT', `/tournaments/${memorial.id}/entries/${girl.id}`, { entered: false });
    sheet = (await sec('GET', `/tournaments/${memorial.id}/sheet`)).body;
    assert.ok(sheet.boats.every((b) => !b.entered && !b.anglers.length));
  } finally {
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
