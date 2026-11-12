const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const { COUNTRIES } = require('../src/db');
const { ZONES, zoneOf, dateIn } = require('../src/zones');

test('every country has its clock; a boat\'s day follows its own country', async () => {
  for (const c of COUNTRIES) assert.ok(ZONES[c], c);
  const lateNight = new Date('2026-11-11T23:30:00Z');
  assert.equal(dateIn(zoneOf('Liberia'), lateNight), '2026-11-11');
  assert.equal(dateIn(zoneOf('Nigeria'), lateNight), '2026-11-12', '00:30 in Lagos is the next day');
  assert.equal(dateIn(zoneOf('Cabo Verde'), new Date('2026-11-12T00:30:00Z')), '2026-11-11', 'Cabo Verde is an hour behind');
  assert.equal(zoneOf(undefined), 'Africa/Monrovia', "no country: the club's clock");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-zones-'));
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads'), nightlyBackups: false });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(at + url, { method, headers: { ...(cookie && { cookie }), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  try {
    await call('POST', '/auth/register', { acceptRules: true, firstName: 'Tunde', lastName: 'Bello', email: 'tunde@example.com', password: 'password1' });
    await call('POST', '/teams', { name: 'Lagos Lady', country: 'Nigeria' });
    assert.equal((await call('GET', '/me')).body.user.timeZone, 'Africa/Lagos', "the phone is told the boat's clock");
    const sp = (await call('GET', '/meta')).body.species.find((s) => s.name === 'Dorado').id;
    // Landed at 23:30 UTC last night: 00:30 this morning in Lagos, so today's trip there.
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const landedAt = `${yesterday}T23:30:00Z`;
    const r = await call('POST', '/outings/fish', { speciesId: sp, fate: 'released', lat: '6.4', lng: '3.4', landedAt });
    assert.equal(r.status, 201);
    assert.equal(r.body.trip.date, dateIn('Africa/Lagos', new Date(landedAt)));
    assert.notEqual(r.body.trip.date, yesterday, "not on Monrovia's day");
  } finally {
    srv.close();
  }
});
