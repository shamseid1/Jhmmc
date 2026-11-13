const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSst, parse } = require('../src/sst');

const csv = (date, rows) => ['time,latitude,longitude,analysed_sst', 'UTC,degrees_north,degrees_east,degree_C',
  ...rows.map(([la, lo, v]) => `${date}T09:00:00Z,${la},${lo},${v}`)].join('\n');
const today = new Date().toISOString().slice(0, 10);

test('satellite water temperature: a grid of measured temperatures, land blank', async () => {
  const asked = [];
  const sst = createSst({ gapMs: 0, fetchImpl: async (url) => {
    asked.push(url);
    return new Response(csv(today, [[5, -11, 28.812], [5, -10.97, 28.9], [5.03, -11, 'NaN'], [5.03, -10.97, 29.334]]));
  } });
  const g = await sst.get({ wait: true });
  assert.match(decodeURIComponent(asked[0]), /jplMURSST41\.csv\?analysed_sst\[last\]\[\(1\.5\):3:\(12\)\]\[\(-17\.8\):3:\(-7\)\]/);
  assert.deepEqual([g.nx, g.ny, g.south, g.west, g.newest, g.source], [2, 2, 5, -11, today, 'NASA MUR']);
  assert.deepEqual(g.values, [28.81, 28.9, null, 29.33]);
});

test('NASA busy: asked again once, then NOAA\'s own; too old is never shown', async () => {
  const asked = [];
  const sst = createSst({ gapMs: 0, fetchImpl: async (url) => {
    asked.push(url);
    if (url.includes('jplMURSST41')) return new Response('Error { code=503; }', { status: 503 });
    return new Response(csv(today, [[5.025, -10.975, 29.46], [5.025, -10.925, 29.4], [5.075, -10.975, 29.5], [5.075, -10.925, 29.3]]));
  } });
  const g = await sst.get({ wait: true });
  assert.equal(asked.length, 3);
  assert.equal(g.source, 'NOAA blended');
  const old = createSst({ gapMs: 0, fetchImpl: async () => new Response(csv('2026-01-01', [[5, -11, 28], [5, -10.97, 28], [5.03, -11, 28], [5.03, -10.97, 28]])) });
  await assert.rejects(old.get({ wait: true }), /being prepared/);
  assert.equal(parse('a\nb\n').length, 0);
});

test('the measured temperature at a spot: the nearest sea the satellites saw (a port is on land)', () => {
  const { tempNear } = require('../src/sst');
  const sat = { south: 6, west: -11, step: 0.03, nx: 3, ny: 3, values: [28.44, 28.6, null, 28.7, null, null, null, null, null] };
  assert.equal(tempNear(sat, 6.06, -10.94), 28.6, 'on land: the nearest sea');
  assert.equal(tempNear(sat, 6, -11), 28.4);
  assert.equal(tempNear(sat, 9, -11), null, 'far off the map');
});
