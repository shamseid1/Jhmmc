const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decompress } = require('../src/blosc');
const { createCopernicus, mergeInto } = require('../src/copernicus');

test('Blosc with LZ4 and the byte shuffle, as the official library packs it', () => {
  // round(sin(n / 20) * 4) / 8 for n = 0..299, as 32-bit floats, packed by numcodecs.Blosc(lz4, shuffle).
  const hex = '02012101b0040000b0040000e600000014000000ce0000001a0001001e3e04001f800400041fc004000c2f003f04003b0f70000d0fa800050fd40001050200178004001ebe04001f800400041fc004000c2f00bf04003b0f70000d0fa800010fd0000101140004f4000802000f2401000f5001050f8801090ff4013d0050000f7000090fa400050ff4010a0002000404010008000f2801000f5001010f84010d0ff4013d0050000f7400090fa4000100140001e4010cd40000e8000404000402000ff401000038010f5401010f840109001c0000a8010f0400390054000d0400503e0000c03e';
  const out = decompress(Buffer.from(hex, 'hex'));
  const f = new Float32Array(out.buffer);
  assert.equal(f.length, 300);
  for (let n = 0; n < 300; n++) assert.equal(f[n], Math.round(Math.sin(n / 20) * 4) / 8);
});

// A made-up store: a 4 x 4 world of 1° squares in blocks of 2 x 2 points and 48 hours, the
// east current n/100 m/s at hour n, north 0.1 m/s; one block all land (not there: 403).
function store() {
  const H = 48;
  const t0 = Date.UTC(2026, 10, 12);
  const dims = {
    latitude: { coords: { min: 0, step: 1, len: 4 }, chunkLen: { utotal: 2 } },
    longitude: { coords: { min: -12, step: 1, len: 4 }, chunkLen: { utotal: 2 } },
    time: { coords: { min: t0, step: 3600e3, len: 200 }, chunkLen: { utotal: H } },
  };
  const blosc = (floats) => {
    const raw = Buffer.from(new Float32Array(floats).buffer);
    const head = Buffer.alloc(16);
    head[0] = 2; head[1] = 1; head[2] = 0x02 | 0x20; head[3] = 4; // stored as is
    head.writeUInt32LE(raw.length, 4); head.writeUInt32LE(raw.length, 8); head.writeUInt32LE(raw.length + 16, 12);
    return Buffer.concat([head, raw]);
  };
  const asked = [];
  return {
    asked,
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.endsWith('product.stac.json')) return Response.json({ links: [{ rel: 'item', href: 'cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/dataset.stac.json' }, { rel: 'item', href: 'other/dataset.stac.json' }] });
      if (url.endsWith('dataset.stac.json')) return Response.json({ assets: { geoChunked: { href: 'https://s3.example/geo.zarr', viewDims: dims } } });
      const [, name, tc, , jc, ic] = url.match(/geo\.zarr\/(\w+)\/(\d+)\.(\d+)\.(\d+)\.(\d+)$/).map((x, k) => (k > 1 ? Number(x) : x));
      if (jc === 1 && ic === 1) return new Response('denied', { status: 403 });
      const vals = [];
      for (let t = 0; t < H; t++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) vals.push(name === 'utotal' ? (tc * H + t) / 100 : 0.1);
      return new Response(blosc(vals));
    },
  };
}

test('Copernicus: the hourly current over the area, from today midnight, land left blank', async () => {
  const s = store();
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 10, 13, 9, 30);
  try {
    const cop = createCopernicus({ fetchImpl: s.fetchImpl, area: { south: 0, north: 3, west: -12, east: -9 }, hours: 72, parallel: 2 });
    const d = await cop.get({ wait: true });
    assert.ok(d, JSON.stringify(cop.status()));
    assert.deepEqual([d.south, d.west, d.nx, d.ny, d.t0, d.hours], [0, -12, 4, 4, '2026-11-13T00:00', 72]);
    // Hour 0 of today is the store's hour 24; hour 30 is in its second time block.
    assert.equal(d.u[0][0], 24); assert.equal(d.u[30][0], 54); assert.equal(d.v[5][5], 10);
    assert.equal(d.u[0][2 * 4 + 2], -32768, 'the land block');
    assert.ok(s.asked.some((u) => u.includes('/utotal/1.0.0.0')), 'the second time block');
    // Into the chart's grid: knots, where Copernicus has water; Open-Meteo's kept elsewhere.
    const grid = { south: 0, west: -12, step: 1, nx: 4, ny: 4, frames: [{ time: '2026-11-13T00:00', u: Array(16).fill(9), v: Array(16).fill(9) }, { time: '2026-11-20T00:00', u: [1], v: [1] }] };
    const m = mergeInto(grid, d);
    assert.equal(m.frames[0].u[0], Math.round((24 / 51.444) * 100) / 100);
    assert.equal(m.frames[0].u[2 * 4 + 2], 9, 'land in Copernicus: Open-Meteo\'s stays');
    assert.equal(m.frames[1].u[0], 1, 'an hour Copernicus doesn\'t have');
    assert.equal(grid.frames[0].u[0], 9, 'the grid itself unchanged');
  } finally { Date.now = realNow; }
});

test('Copernicus: most of the store gone is a failure, not an empty sea', async () => {
  const s = store();
  const cop = createCopernicus({ fetchImpl: async (url) => (url.includes('geo.zarr') ? new Response('', { status: 403 }) : s.fetchImpl(url)), area: { south: 0, north: 3, west: -12, east: -9 }, retryMs: 1 });
  assert.equal(await cop.get({ wait: true }), null);
  assert.match(cop.status().error, /blocks not there/);
});
