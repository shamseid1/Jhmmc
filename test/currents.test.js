const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCurrents, grid } = require('../src/currents');

test('the currents map: a grid in two halves, frames every 3 hours, u/v in knots, land empty', async () => {
  const region = { south: 5, north: 5.6, west: -11, east: -10.4, step: 0.3 };
  const urls = [];
  const time = Array.from({ length: 72 }, (_, h) => `2026-11-12T${String(h % 24).padStart(2, '0')}:00`);
  const currents = createCurrents({ region, fetchImpl: async (url) => {
    urls.push(url);
    const lats = new URL(url).searchParams.get('latitude').split(',');
    return new Response(JSON.stringify(lats.map((lat, k) => ({ hourly: k === 0 && urls.length === 1
      ? { time, ocean_current_velocity: time.map(() => null), ocean_current_direction: time.map(() => null), sea_surface_temperature: time.map(() => null) }
      : { time, ocean_current_velocity: time.map(() => 1.852), ocean_current_direction: time.map(() => 90), sea_surface_temperature: time.map(() => 28.44) } }))));
  } });
  const g = grid(region);
  assert.deepEqual([g.nx, g.ny, g.pts.length], [3, 3, 9]);
  const d = await currents.get();
  assert.equal(urls.length, 2, 'two halves');
  assert.equal(d.frames.length, 24, 'every 3 hours for 3 days');
  const f = d.frames[0];
  assert.deepEqual([f.u[0], f.v[0], f.sst[0]], [null, null, null], 'land');
  assert.deepEqual([f.u[1], f.v[1], f.sst[1]], [1, 0, 28.4], '1 knot to the east');
  await currents.get();
  assert.equal(urls.length, 2, 'shared and kept');
});

test('the tide is averaged out: a steady current stays, the to-and-fro goes', () => {
  const { frames } = require('../src/currents');
  const region = { south: 5, north: 5, west: -11, east: -11, step: 0.3 };
  const time = Array.from({ length: 72 }, (_, h) => `2026-11-12T${String(h % 24).padStart(2, '0')}:00`);
  // 0.5 kn east, plus a 1 kn tide north and south every 12.4 hours.
  const u = time.map(() => 0.5);
  const v = time.map((_, h) => Math.cos((2 * Math.PI * h) / 12.42));
  const hourly = { time, sea_surface_temperature: time.map(() => 28),
    ocean_current_velocity: u.map((x, h) => Math.hypot(x, v[h]) * 1.852),
    ocean_current_direction: u.map((x, h) => (Math.atan2(x, v[h]) * 180) / Math.PI) };
  const d = frames([{ hourly }], region, { nx: 1, ny: 1 });
  const mid = d.frames[12];
  assert.ok(Math.abs(mid.u[0] - 0.5) < 0.05, `east stays: ${mid.u[0]}`);
  assert.ok(Math.abs(mid.v[0]) < 0.12, `tide gone: ${mid.v[0]}`);
});
