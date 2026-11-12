const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCurrents, grid } = require('../src/currents');

test('the chart grid: the sea in parts and the wind, frames every 3 hours, u/v in knots, land empty', async () => {
  const region = { south: 5, north: 5.6, west: -11, east: -10.4, step: 0.3 };
  const urls = [];
  const time = Array.from({ length: 72 }, (_, h) => `2026-11-12T${String(h % 24).padStart(2, '0')}:00`);
  const fetchOnce = async (url) => {
    urls.push(url);
    const lats = new URL(url).searchParams.get('latitude').split(',');
    if (url.includes('/v1/forecast')) {
      // 10 knots from the north at every wind point (every other point of the grid).
      return new Response(JSON.stringify(lats.map(() => ({ hourly: { time, wind_speed_10m: time.map(() => 10), wind_direction_10m: time.map(() => 0) } }))));
    }
    return new Response(JSON.stringify(lats.map((lat, k) => ({ hourly: k === 0 && urls.length === 1
      ? { time, ocean_current_velocity: time.map(() => null), ocean_current_direction: time.map(() => null), sea_surface_temperature: time.map(() => null) }
      : { time, ocean_current_velocity: time.map(() => 1.852), ocean_current_direction: time.map(() => 90), sea_surface_temperature: time.map(() => 28.44),
        wave_height: time.map(() => 1.26), wave_direction: time.map(() => 200) } }))));
  };
  const currents = createCurrents({ region, gapMs: 0, fetchImpl: fetchOnce });
  const g = grid(region);
  assert.deepEqual([g.nx, g.ny, g.pts.length], [3, 3, 9]);
  await assert.rejects(currents.get(), (e) => e.preparing, "not ready yet: said at once");
  const d = await currents.get({ wait: true });
  assert.equal(urls.length, 2, 'the sea (9 points, one part), and the wind');
  assert.equal(new URL(urls[1]).searchParams.get('latitude').split(',').length, 4, 'the wind on every other point');
  assert.equal(d.frames.length, 24, 'every 3 hours for 3 days');
  const f = d.frames[0];
  assert.deepEqual([f.u[0], f.v[0], f.sst[0]], [null, null, null], 'land');
  assert.deepEqual([f.u[1], f.v[1], f.sst[1]], [1, 0, 28.4], '1 knot to the east');
  assert.deepEqual([f.wh[1], f.wd[1]], [1.3, 200], 'waves');
  assert.deepEqual([Math.abs(f.wu[4]), f.wv[4]], [0, -10], 'the wind filled in between: 10 kn blowing south');
  await currents.get();
  assert.equal(urls.length, 2, 'shared and kept');

  // Kept on disk: after a restart the chart is there at once, without asking again.
  const file = require('node:path').join(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'wabg-chart-')), 'chart-grid.json');
  const first = createCurrents({ region, gapMs: 0, file, fetchImpl: async (url) => (await fetchOnce(url)) });
  await first.get({ wait: true });
  await new Promise((r) => setTimeout(r, 50)); // the file is written in the background
  let asked = 0;
  const again = createCurrents({ region, gapMs: 0, file, fetchImpl: async () => { asked += 1; throw new Error('offline'); } });
  assert.equal((await again.get()).frames.length, 24, 'the saved chart, at once');
  assert.equal(asked, 0);
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

test('the fishing chart: no preferences until there are billfish to go by', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createApp } = require('../src/app');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-fishing-'));
  const srv = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com' }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/chart/fishing`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { water: null, depth: null });
  } finally {
    srv.close();
  }
});

test('turned away for the day: the chart says so and waits until after midnight GMT', async () => {
  const region = { south: 5, north: 5.3, west: -11, east: -10.7, step: 0.3 };
  let asked = 0;
  const currents = createCurrents({ region, gapMs: 0, fetchImpl: async () => {
    asked += 1;
    return new Response(JSON.stringify({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }), { status: 429 });
  } });
  await currents.get({ wait: true }).catch(() => {});
  const err = await currents.get().catch((e) => e);
  assert.ok(err.preparing);
  assert.match(err.lastError.message, /Daily API request limit/);
  assert.ok(new Date(err.lastError.retryAt).getUTCHours() === 0, 'tries again just after midnight GMT');
  const before = asked;
  await currents.get().catch(() => {});
  assert.equal(asked, before, 'no knocking again before then');
});

test('never an old forecast: a saved chart past 12 hours is not shown', async () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const region = { south: 5, north: 5.3, west: -11, east: -10.7, step: 0.3 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-old-')), 'chart-grid.json');
  fs.writeFileSync(file, JSON.stringify({ at: Date.now() - 13 * 3600e3, data: { step: 0.3, frames: [{ time: '2026-11-01T00:00' }] } }));
  const currents = createCurrents({ region, gapMs: 0, file, fetchImpl: async () => new Response('{}', { status: 500 }) });
  const err = await currents.get().catch((e) => e);
  assert.ok(err.preparing, 'the old chart is not given out');
});
