const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDepth, depthArea, fetchEtopo } = require('../src/depth');

test('depth areas are widened to quarter degrees, thinned to fit a phone, and refused when too big', () => {
  const a = depthArea({ south: '5.1', west: '-11.3', north: '6.9', east: '-10.05' });
  assert.deepEqual(a, { south: 5, north: 7, west: -11.5, east: -10, stride: 1 });
  assert.equal(depthArea({ south: 0, west: -20, north: 8, east: -12 }).stride, 4, '8 degrees: every 4th arc-minute');
  assert.match(depthArea({ south: 0, west: -30, north: 20, east: 0 }).error, /Zoom in/);
  assert.match(depthArea({ south: 'x' }).error, /area/);
});

test('ETOPO answers are read into a grid, and grids are kept', async () => {
  const realFetch = global.fetch;
  let asked = 0;
  global.fetch = async (url) => {
    asked++;
    assert.match(decodeURIComponent(url), /etopo180\.json\?altitude\[\(5\):1:\(5\.25\)\]\[\(-11\):1:\(-10\.75\)\]/);
    return {
      ok: true,
      json: async () => ({ table: { columnNames: ['latitude', 'longitude', 'altitude'], rows: [
        [5, -11, -1200.4], [5, -10.75, -300], [5.25, -11, -50], [5.25, -10.75, 12],
      ] } }),
    };
  };
  try {
    const depth = createDepth({ source: fetchEtopo });
    const grid = await depth({ south: 5, west: -11, north: 5.25, east: -10.75 });
    assert.deepEqual([grid.lats, grid.lons, grid.alt], [[5, 5.25], [-11, -10.75], [-1200, -300, -50, 12]]);
    await depth({ south: 5.1, west: -10.9, north: 5.2, east: -10.8 });
    assert.equal(asked, 1, 'the same area is fetched once');
  } finally {
    global.fetch = realFetch;
  }
});
