const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

test('the season calendar: dinners and events, dates to be announced, changes told when they are near', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-calendar-'));
    const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), adminEmail: 'boss@example.com',
    pusher: { publicKey: 'k', send: async () => true } });
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
  const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
  const news = async (c) => ((await c('GET', '/feed?type=announcements')).body.items ?? []).filter((x) => x.kind === 'announcement');
  try {
    const sec = as();
    await sec('POST', '/auth/register', { acceptRules: true, name: 'Robert Khoueiry', email: 'boss@example.com', password: 'password1' });
    const member = as();
    await member('POST', '/auth/register', { acceptRules: true, name: 'Kofi Mensah', email: 'k@example.com', password: 'password1' });

    const dinner = (await sec('POST', '/events', { kind: 'dinner', name: 'Dinner for the 2 tournaments', date: day(5), place: 'Marshall', note: 'Open Season & Memorial' })).body.event;
    const later = (await sec('POST', '/events', { kind: 'tournament', name: 'Jackpot Tournament', date: day(60) })).body.event;
    const tba = (await sec('POST', '/events', { kind: 'tournament', name: 'End of Season Tournament', tba: true, whenText: 'April or May' })).body.event;
    assert.equal((await member('POST', '/events', { kind: 'dinner', name: 'X', date: day(3) })).status, 403, 'members only look');

    const { events } = (await member('GET', '/events')).body;
    assert.deepEqual(events.map((e) => [e.kind, e.name, e.place, e.whenText]), [
      ['dinner', 'Dinner for the 2 tournaments', 'Marshall', null],
      ['tournament', 'Jackpot Tournament', null, null],
      ['tournament', 'End of Season Tournament', null, 'April or May'],
    ], 'by date, the ones to be announced last');
    assert.equal(events[2].date, null);

    // A dinner never counts as a tournament: no tournament for its day.
    const tournaments = (await member('GET', '/tournaments')).body.tournaments ?? [];
    assert.ok(!tournaments.some((t) => t.name.startsWith('Dinner')));

    const newsBefore = (await news(member)).length;
    // Moved, but two months off: no notice.
    await sec('PATCH', `/events/${later.id}`, { kind: 'tournament', name: 'Jackpot Tournament', date: day(67) });
    assert.equal((await news(member)).length, newsBefore, 'no notice');
    // Moved, within two weeks: everyone's told, in the feed and on phones.
    const moved = (await sec('PATCH', `/events/${dinner.id}`, { kind: 'dinner', name: 'Dinner for the 2 tournaments', date: day(8), place: 'Marshall', note: 'Open Season & Memorial' })).body.event;
    assert.equal(moved.date, day(8));
    const latest = (await news(member))[0];
    assert.equal((await news(member)).length, newsBefore + 1);
    assert.match(latest.title, /Dinner for the 2 tournaments: new date/);
    // Given a date later: to be confirmed.
    const dated = (await sec('PATCH', `/events/${tba.id}`, { kind: 'tournament', name: 'End of Season Tournament', date: day(150), endDate: day(151), tbc: true })).body.event;
    assert.deepEqual([dated.date, dated.endDate, dated.tbc, dated.whenText], [day(150), day(151), true, null]);
    assert.match((await sec('PATCH', `/events/${tba.id}`, { kind: 'tournament', name: 'End of Season Tournament', date: day(150), endDate: day(140) })).body.error, /on or after/);
  } finally {
    srv.close();
  }
});
