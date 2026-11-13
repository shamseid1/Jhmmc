const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decompress } = require('../src/blosc');
const { createCopernicus, mergeInto, hourOf } = require('../src/copernicus');

test('Blosc with LZ4 and the byte shuffle, as the official library packs it', () => {
  // round(sin(n / 20) * 4) / 8 for n = 0..299, as 32-bit floats, packed by numcodecs.Blosc(lz4, shuffle).
  const hex = '02012101b0040000b0040000e600000014000000ce0000001a0001001e3e04001f800400041fc004000c2f003f04003b0f70000d0fa800050fd40001050200178004001ebe04001f800400041fc004000c2f00bf04003b0f70000d0fa800010fd0000101140004f4000802000f2401000f5001050f8801090ff4013d0050000f7000090fa400050ff4010a0002000404010008000f2801000f5001010f84010d0ff4013d0050000f7400090fa4000100140001e4010cd40000e8000404000402000ff401000038010f5401010f840109001c0000a8010f0400390054000d0400503e0000c03e';
  const out = decompress(Buffer.from(hex, 'hex'));
  const f = new Float32Array(out.buffer);
  assert.equal(f.length, 300);
  for (let n = 0; n < 300; n++) assert.equal(f[n], Math.round(Math.sin(n / 20) * 4) / 8);
});

// A made-up store: a 4 x 4 world of 1° squares in blocks of 2 x 2 points and 48 steps. The
// current hourly: east n/100 m/s at hour n, north 0.1 m/s. The waves every 3 hours: n/10 m
// high at step n, from 200°. One block all land (not there: 403).
function store() {
  const H = 48;
  const t0 = Date.UTC(2026, 10, 12);
  const dims = (step, v) => ({
    latitude: { coords: { min: 0, step: 1, len: 4 }, chunkLen: { [v]: 2 } },
    longitude: { coords: { min: -12, step: 1, len: 4 }, chunkLen: { [v]: 2 } },
    time: { coords: { min: t0, step, len: 200 }, chunkLen: { [v]: H } },
    ...(v === 'utotal' ? { elevation: { coords: { values: [-0.5] }, chunkLen: { [v]: 1 } } } : {}),
  });
  const blosc = (vals, ints) => {
    const raw = Buffer.from((ints ? new Int16Array(vals) : new Float32Array(vals)).buffer);
    const head = Buffer.alloc(16);
    head[0] = 2; head[1] = 1; head[2] = 0x02 | 0x20; head[3] = ints ? 2 : 4; // stored as is
    head.writeUInt32LE(raw.length, 4); head.writeUInt32LE(raw.length, 8); head.writeUInt32LE(raw.length + 16, 12);
    return Buffer.concat([head, raw]);
  };
  const asked = [];
  return {
    asked,
    fetchImpl: async (url) => {
      asked.push(url);
      const wav = /WAV|wav\.zarr/.test(url);
      if (url.endsWith('product.stac.json')) return Response.json({ links: [{ rel: 'item', href: wav ? 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/dataset.stac.json' : 'cmems_mod_glo_phy_anfc_merged-uv_PT1H-i_202211/dataset.stac.json' }, { rel: 'item', href: 'other/dataset.stac.json' }] });
      // The waves as the real store keeps them: whole numbers, 0.01 a step, the direction from 180.
      if (url.endsWith('.zmetadata')) {
        return Response.json({ metadata: wav
          ? { 'VHM0/.zarray': { dtype: '<i2', fill_value: -32767 }, 'VHM0/.zattrs': { scale_factor: 0.01, add_offset: 0 }, 'VMDR/.zarray': { dtype: '<i2', fill_value: -32767 }, 'VMDR/.zattrs': { scale_factor: 0.01, add_offset: 180 }, 'VTPK/.zarray': { dtype: '<i2', fill_value: -32767 }, 'VTPK/.zattrs': { scale_factor: 0.01, add_offset: 0 } }
          : { 'utotal/.zarray': { dtype: '<f4' }, 'vtotal/.zarray': { dtype: '<f4' } } });
      }
      if (url.endsWith('dataset.stac.json')) return Response.json({ assets: { geoChunked: { href: `https://s3.example/${wav ? 'wav' : 'cur'}.zarr`, viewDims: wav ? dims(3 * 3600e3, 'VHM0') : dims(3600e3, 'utotal') } } });
      const m = wav ? url.match(/\.zarr\/(\w+)\/(\d+)\.(\d+)\.(\d+)$/) : url.match(/\.zarr\/(\w+)\/(\d+)\.0\.(\d+)\.(\d+)$/);
      if (!m) return new Response('no such key', { status: 403 });
      const [, name, tc, jc, ic] = m.map((x, k) => (k > 1 ? Number(x) : x));
      if (jc === 1 && ic === 1) return new Response('denied', { status: 403 });
      const vals = [];
      const val = { utotal: (n) => n / 100, vtotal: () => 0.1, VHM0: (n) => n * 10, VMDR: () => 2000, VTPK: () => 1240 }[name];
      for (let t = 0; t < H; t++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) vals.push(val(tc * H + t));
      return new Response(blosc(vals, wav));
    },
  };
}

test('Copernicus: the hourly current over the area, from today midnight, land left blank', async () => {
  const s = store();
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 10, 13, 9, 30);
  try {
    const cop = createCopernicus({ fetchImpl: s.fetchImpl, area: { south: 0, north: 3, west: -12, east: -9 }, hours: 72, parallel: 2 });
    const all = await cop.get({ wait: true });
    assert.ok(all?.currents && all?.waves, JSON.stringify(cop.status()));
    assert.equal(cop.ready(), true);
    const d = all.currents;
    assert.deepEqual([d.south, d.west, d.nx, d.ny, d.t0, d.stepH, d.steps], [0, -12, 4, 4, '2026-11-13T00:00', 1, 72]);
    const w = all.waves;
    assert.deepEqual([w.t0, w.stepH, w.steps], ['2026-11-13T00:00', 3, 25]);
    // Today 00:00 is the waves' step 8 (0.8 m); 04:00 is a third of the way from step 9 to 10.
    assert.equal(hourOf(w, '2026-11-13T00:00', 'wh')[0], 80);
    assert.equal(hourOf(w, '2026-11-13T04:00', 'wh')[0], 93);
    assert.equal(hourOf(w, '2026-11-13T04:00', 'wd')[0], 200);
    assert.equal(hourOf(w, '2026-11-13T04:00', 'tp')[0], 124, 'the period: 12.4 s');
    // Hour 0 of today is the store's hour 24; hour 30 is in its second time block.
    assert.equal(d.u[0][0], 24); assert.equal(d.u[30][0], 54); assert.equal(d.v[5][5], 10);
    assert.equal(d.u[0][2 * 4 + 2], -32768, 'the land block');
    assert.ok(s.asked.some((u) => u.includes('/utotal/1.0.0.0')), 'the second time block');
    // Into the chart's grid: knots, where Copernicus has water; Open-Meteo's kept elsewhere.
    const grid = { south: 0, west: -12, step: 1, nx: 4, ny: 4, frames: [{ time: '2026-11-13T00:00', u: Array(16).fill(9), v: Array(16).fill(9) }, { time: '2026-11-20T00:00', u: [1], v: [1] }] };
    const m = mergeInto(grid, all);
    assert.equal(m.frames[0].u[0], Math.round((24 / 51.444) * 100) / 100);
    assert.deepEqual([m.frames[0].wh[0], m.frames[0].wd[0]], [0.8, 200]);
    assert.equal(m.frames[0].u[2 * 4 + 2], 9, 'land in Copernicus: Open-Meteo\'s stays');
    assert.equal(m.frames[1].u[0], 1, 'an hour Copernicus doesn\'t have');
    assert.equal(grid.frames[0].u[0], 9, 'the grid itself unchanged');
  } finally { Date.now = realNow; }
});

test('Copernicus: most of the store gone is a failure, not an empty sea', async () => {
  const s = store();
  const cop = createCopernicus({ fetchImpl: async (url) => (url.includes('.zarr/') && !url.endsWith('.zmetadata') ? new Response('', { status: 403 }) : s.fetchImpl(url)), area: { south: 0, north: 3, west: -12, east: -9 }, retryMs: 1 });
  assert.equal(await cop.get({ wait: true }), null);
  assert.match(cop.status().error, /blocks not there/);
  assert.equal(cop.ready(), false);
});

test('the current at a spot: the nearest sea point, knots and the way it goes', () => {
  const { currentNear, NONE } = require('../src/copernicus');
  const C = { south: 0, west: 0, step: 1, nx: 2, ny: 1, t0: '2026-11-13T00:00', stepH: 1, steps: 2,
    u: [[NONE, 51.444], [NONE, 0]], v: [[NONE, 0], [NONE, -51.444]] };
  const a = currentNear(C, 0, 0, '2026-11-13T00:00');
  assert.deepEqual([Math.round(a.kn * 10) / 10, Math.round(a.deg)], [1, 90], 'land: the next point, 1 kn east');
  assert.equal(Math.round(currentNear(C, 0, 1, '2026-11-13T01:00').deg), 180);
  assert.equal(currentNear(C, 0, 1, '2026-11-14T00:00'), null, 'an hour not covered');
});

test('the waves at a spot: height, the way they come from, the period', () => {
  const { wavesNear, NONE } = require('../src/copernicus');
  const W = { south: 0, west: 0, step: 1, nx: 2, ny: 1, t0: '2026-11-13T00:00', stepH: 3, steps: 2,
    wh: [[NONE, 100], [NONE, 130]], wd: [[NONE, 180], [NONE, 200]], tp: [[NONE, 120], [NONE, 126]] };
  assert.deepEqual(wavesNear(W, 0, 0, '2026-11-13T00:00'), { m: 1, from: 180, periodS: 12 });
  assert.deepEqual(wavesNear(W, 0, 1, '2026-11-13T03:00'), { m: 1.3, from: 200, periodS: 12.6 });
});
