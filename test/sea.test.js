const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSea, tideTurns, moon, rating, compass } = require('../src/sea');

// A made-up 9-day forecast for off Monrovia (GMT): a 12.4-hour tide, steady sea.
function fixture() {
  const start = Date.UTC(2026, 10, 10);
  const hours = Array.from({ length: 9 * 24 }, (_, h) => new Date(start + h * 3600e3).toISOString().slice(0, 16));
  const days = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2026, 10, 12 + d)).toISOString().slice(0, 10));
  const w = {
    timezone: 'GMT', utc_offset_seconds: 0,
    current: { temperature_2m: 29.2, wind_speed_10m: 9.4, wind_direction_10m: 225, wind_gusts_10m: 14.2 },
    hourly: { time: hours, wind_speed_10m: hours.map(() => 9), wind_direction_10m: hours.map(() => 220) },
    daily: { time: days, sunrise: days.map((d) => `${d}T06:21`), sunset: days.map((d) => `${d}T18:14`),
      wind_speed_10m_max: [9, 11, 16, 21, 13, 8, 7], wind_direction_10m_dominant: [225, 225, 270, 270, 225, 225, 180] },
  };
  const m = {
    timezone: 'GMT', utc_offset_seconds: 0,
    current: { wave_height: 1.12, swell_wave_height: 1.3, swell_wave_period: 12.2, swell_wave_direction: 200, sea_surface_temperature: 28.6, ocean_current_velocity: 1.1, ocean_current_direction: 90 },
    hourly: { time: hours, wave_height: hours.map(() => 1.1), sea_surface_temperature: hours.map(() => 28.6),
      sea_level_height_msl: hours.map((t) => 0.55 * Math.cos(((Date.parse(`${t}:00Z`) - Date.UTC(2026, 10, 12, 4, 18)) / 3600e3 / 12.42) * 2 * Math.PI)) },
    daily: { wave_height_max: [1.1, 1.3, 1.8, 2.4, 1.6, 1.0, 0.9] },
  };
  return { w, m };
}

test('sea conditions: the forecast made into what an angler needs', async () => {
  const { w, m } = fixture();
  const asked = [];
  const sea = createSea({ fetchImpl: async (url) => { asked.push(url); return new Response(JSON.stringify(url.includes('marine') ? m : w)); } });
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 10, 12, 10, 40);
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.UTC(2026, 10, 12, 10, 40)])); } static now() { return RealDate.UTC(2026, 10, 12, 10, 40); } };
  try {
    const s = await sea.summary(6.2345, -10.9876);
    // The exact spot never leaves the server: rounded to 0.1°.
    assert.ok(asked.every((u) => u.includes('latitude=6.2&longitude=-11')));
    assert.deepEqual([s.now.windKn, s.now.windDir, s.now.gustKn, s.now.waveM, s.now.waterC, s.now.currentKn, s.now.currentDir], [9, 'SW', 14, 1.1, 28.6, 0.6, 'E']);
    assert.equal(s.now.rating, 'good');
    assert.deepEqual(s.days.map((d) => d.rating), ['good', 'good', 'fair', 'rough', 'fair', 'good', 'good']);
    // Today's tide: two highs, two lows, the first low a little after 4 am.
    assert.deepEqual(s.tide.turns.map((t) => t.type), ['high', 'low', 'high', 'low'].slice(0, s.tide.turns.length));
    assert.ok(s.tide.turns.length >= 3);
    const firstLow = s.tide.turns.find((t) => t.type === 'low');
    assert.equal(firstLow.level, -0.55);
    assert.equal(s.now.tide, 'falling');
    assert.deepEqual([s.sun.rise, s.sun.set], ['06:21', '18:14']);
    assert.equal(s.solunar.major.length, 2);
    // Cached: a second ask for the same area doesn't go online again.
    await sea.summary(6.21, -10.99);
    assert.equal(asked.length, 2);
    // The conditions saved with a fish landed at 9:30.
    const c = await sea.at(6.2, -11, '2026-11-12T09:30:00Z');
    assert.deepEqual([c.windKn, c.windDir, c.waveM, c.waterC], [9, 'SW', 1.1, 28.6]);
  } finally {
    global.Date = RealDate;
    Date.now = realNow;
  }
});

test('ratings, compass, tide turns and the moon', () => {
  assert.equal(rating(8, 1.0), 'good');
  assert.equal(rating(14, 1.2), 'fair');
  assert.equal(rating(20, 1.0), 'rough');
  assert.equal(rating(9, 2.5), 'rough');
  assert.deepEqual([0, 44, 46, 180, 359].map(compass), ['N', 'NE', 'NE', 'S', 'N']);
  const t = ['2026-11-12T00:00', '2026-11-12T01:00', '2026-11-12T02:00', '2026-11-12T03:00', '2026-11-12T04:00'];
  assert.deepEqual(tideTurns(t, [0, 0.4, 0.5, 0.4, 0]).map((x) => [x.type, x.time]), [['high', '2026-11-12T02:00']]);
  assert.equal(moon(new Date(Date.UTC(2000, 0, 6, 18, 14))).name, 'New moon');
  assert.equal(moon(new Date(Date.UTC(2000, 0, 21, 4, 40))).name, 'Full moon');
});
