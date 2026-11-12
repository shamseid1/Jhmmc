const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDepth } = require('../src/depth');

test('depths from the seabed map: rounded spots, batches, land, kept', async () => {
  const asked = [];
  const depth = createDepth({ fetchImpl: async (url) => {
    asked.push(url);
    const locs = decodeURIComponent(url.split('locations=')[1]).split('|');
    return new Response(JSON.stringify({ results: locs.map((l) => ({ elevation: l.startsWith('7') ? 12.5 : -Number(l.split(',')[0]) * 100 })) }));
  } });
  const m = await depth.at([{ lat: 6.1234, lng: -10.9876 }, { lat: 7.1, lng: -11 }, { lat: 6.1236, lng: -10.9881 }]);
  assert.deepEqual(m, [613, null, 613], 'positive metres, null on land, same spot asked once');
  assert.match(asked[0], /gebco2020\?locations=6\.125,-10\.99\|7\.1,-11$/);
  await depth.at([{ lat: 6.1234, lng: -10.9876 }]);
  assert.equal(asked.length, 1, 'kept');
});
