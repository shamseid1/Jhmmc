const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChlorophyll, parse, composite } = require('../src/chlorophyll');

const csv = (rows) => `time,altitude,latitude,longitude,chlor_a\nUTC,m,degrees_north,degrees_east,mg m^-3\n${rows.map((r) => r.join(',')).join('\n')}\n`;

test('water colour: the newest clear view at each spot, from either satellite', async () => {
  const a = parse(csv([
    ['2026-11-09T12:00:00Z', 0, 6.1, -10.5, 0.2], ['2026-11-09T12:00:00Z', 0, 6.1, -10.4, 'NaN'],
    ['2026-11-10T12:00:00Z', 0, 6.1, -10.5, 'NaN'], ['2026-11-10T12:00:00Z', 0, 6.1, -10.4, 'NaN'],
    ['2026-11-09T12:00:00Z', 0, 6.0, -10.5, 1.5], ['2026-11-10T12:00:00Z', 0, 6.0, -10.5, 0.9],
    ['2026-11-10T12:00:00Z', 0, 6.0, -10.4, 'NaN'],
  ]));
  const b = parse(csv([['2026-11-08T12:00:00Z', 0, 6.1, -10.4, 0.1]]));
  const g = composite([a, b]);
  assert.deepEqual([g.nx, g.ny], [2, 2]);
  const at = (lat, lng) => g.values[Math.round((lat - g.south) / g.step) * g.nx + Math.round((lng - g.west) / g.step)];
  assert.equal(at(6.1, -10.5), 0.2, 'cloudy on the 10th: the 9th');
  assert.equal(at(6.0, -10.5), 0.9, 'the newest');
  assert.equal(at(6.1, -10.4), 0.1, 'from the other satellite');
  assert.equal(at(6.0, -10.4), null, 'cloud all week');
  assert.deepEqual([g.oldest, g.newest], ['2026-11-08', '2026-11-10']);

  let asked = 0;
  const chl = createChlorophyll({ fetchImpl: async () => { asked += 1; return new Response(csv([['2026-11-10T12:00:00Z', 0, 6.1, -10.5, 0.3], ['2026-11-10T12:00:00Z', 0, 6.0, -10.4, 0.4]])); } });
  await assert.rejects(chl.get(), (e) => e.preparing);
  assert.equal((await chl.get({ wait: true })).values.filter((v) => v != null).length, 2);
  assert.equal(asked, 2, 'both satellites');
});
