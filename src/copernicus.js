'use strict';

const fs = require('fs');
const { decompress } = require('./blosc');

// The sea for the fishing chart, straight from Copernicus Marine (the EU's ocean service, whose
// global models Open-Meteo also passes on), every 1/12° (about 9 km), from midnight GMT today
// for 3 days:
// - the current: hourly, at the surface, with the tide and the waves' drift in it ("merged");
// - the waves (Météo-France's wave model): their height, the way they come from and their
//   period (the seconds between the biggest, the swell's), every
//   3 hours (the hours between are blended).
// Read from its open cloud store (zarr, packed with Blosc/LZ4), only the blocks that cover our
// area. Fetched twice a day in the background (the models run once or twice a day), kept on
// disk. Until it's ready, or if Copernicus can't be reached, the chart keeps Open-Meteo's
// (the same models, at the chart's coarser grid).
const STAC = 'https://stac.marine.copernicus.eu/metadata';
const SETS = {
  currents: { product: 'GLOBAL_ANALYSISFORECAST_PHY_001_024', dataset: 'cmems_mod_glo_phy_anfc_merged-uv_PT1H-i', vars: { u: ['utotal', 100], v: ['vtotal', 100] } }, // cm/s
  waves: { product: 'GLOBAL_ANALYSISFORECAST_WAV_001_027', dataset: 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i', vars: { wh: ['VHM0', 100], wd: ['VMDR', 1], tp: ['VTPK', 10] } }, // cm, degrees, tenths of a second
};
const AREA = { south: 1.5, north: 12.0, west: -17.8, east: -7.0 };
const NONE = -32768; // land, in the packed values

// The dataset's newest version in the catalogue, and its store split by area (each block one
// small square, all times): its address, the grid and how it's cut.
async function describe(fetchImpl, set) {
  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Copernicus catalogue ${res.status}`);
    return res.json();
  };
  const product = await get(`${STAC}/${set.product}/product.stac.json`);
  const item = product.links.filter((l) => l.rel === 'item' && l.href.startsWith(`${set.dataset}_`)).map((l) => l.href).sort().at(-1);
  if (!item) throw new Error(`Copernicus: ${set.dataset} is not in the catalogue`);
  const ds = await get(`${STAC}/${set.product}/${item}`);
  const a = ds.assets?.geoChunked;
  const d = a?.viewDims;
  if (!a?.href || !d) throw new Error('Copernicus: no area-split store');
  const first = Object.values(set.vars)[0][0];
  const dim = (k) => ({ ...d[k].coords, chunk: d[k].chunkLen[first] });
  // How each variable is stored (the store's own description): 32-bit floats, or 16-bit whole
  // numbers with a scale and an offset; and the value that means none.
  const meta = (await get(`${a.href}/.zmetadata`)).metadata;
  const kinds = {};
  for (const [name] of Object.values(set.vars)) {
    const arr = meta[`${name}/.zarray`]; const at = meta[`${name}/.zattrs`] || {};
    if (!arr || !['<f4', '<i2'].includes(arr.dtype)) throw new Error(`Copernicus: ${name} is stored as ${arr?.dtype}`);
    kinds[name] = { dtype: arr.dtype, fill: arr.fill_value, scale: at.scale_factor ?? 1, offset: at.add_offset ?? 0 };
  }
  // The currents have a depth level (the surface only), the waves none: it's in the blocks' names.
  return { href: a.href, lat: dim('latitude'), lng: dim('longitude'), time: dim('time'), level: !!d.elevation, kinds };
}

const pack = (x, scale) => (Number.isFinite(x) && Math.abs(x * scale) < 32000 ? Math.round(x * scale) : NONE);

async function load(set, { fetchImpl, area, hours, now, parallel }) {
  const s = await describe(fetchImpl, set);
  const idx = (c, v) => Math.round((v - c.min) / c.step);
  const j0 = Math.ceil((area.south - s.lat.min) / s.lat.step - 1e-6); const j1 = Math.floor((area.north - s.lat.min) / s.lat.step + 1e-6);
  const i0 = Math.ceil((area.west - s.lng.min) / s.lng.step - 1e-6); const i1 = Math.floor((area.east - s.lng.min) / s.lng.step + 1e-6);
  const nx = i1 - i0 + 1; const ny = j1 - j0 + 1;
  const day = new Date(now); const t0 = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const stepH = Math.round(s.time.step / 3600e3);
  const h0 = idx(s.time, t0);
  // Enough steps to cover every hour asked for (the last hour needs the step after it).
  const last = Math.min(h0 + Math.ceil((hours - 1) / stepH), s.time.len - 1);
  if (last < h0) throw new Error('Copernicus: no forecast for today yet');
  const n = last - h0 + 1;
  const keys = Object.keys(set.vars);
  const out = Object.fromEntries(keys.map((k) => [k, Array.from({ length: n }, () => new Int16Array(nx * ny).fill(NONE))]));
  // Every block (variable, time, latitude, longitude) that holds part of the area and times.
  const jobs = [];
  for (const key of keys) {
    for (let tc = Math.floor(h0 / s.time.chunk); tc <= Math.floor(last / s.time.chunk); tc++) {
      for (let jc = Math.floor(j0 / s.lat.chunk); jc <= Math.floor(j1 / s.lat.chunk); jc++) {
        for (let ic = Math.floor(i0 / s.lng.chunk); ic <= Math.floor(i1 / s.lng.chunk); ic++) jobs.push({ key, tc, jc, ic });
      }
    }
  }
  let missing = 0;
  const one = async ({ key, tc, jc, ic }) => {
    const [name, scale] = set.vars[key];
    let res;
    for (let tries = 0; ; tries++) {
      try {
        res = await fetchImpl(`${s.href}/${name}/${tc}${s.level ? '.0' : ''}.${jc}.${ic}`, { signal: AbortSignal.timeout(60000) });
        if (res.ok || res.status === 404 || res.status === 403 || tries >= 2) break;
      } catch (err) { if (tries >= 2) throw err; }
      await new Promise((r) => setTimeout(r, 2000 * (tries + 1)));
    }
    // A block that's all land isn't stored: the store says it's not there (404) or, being
    // closed to listing, forbidden (403).
    if (res.status === 404 || res.status === 403) { missing += 1; return; }
    if (!res.ok) throw new Error(`Copernicus ${res.status}`);
    const raw = decompress(new Uint8Array(await res.arrayBuffer()));
    const kind = s.kinds[name];
    const ints = kind.dtype === '<i2';
    const f = ints ? new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2) : new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const value = (x) => (ints ? (x === kind.fill ? NaN : x * kind.scale + kind.offset) : x);
    const CT = s.time.chunk; const CJ = s.lat.chunk; const CI = s.lng.chunk;
    const ct = f.length / (CJ * CI); // the block's own length in time (the last can be short)
    for (let t = Math.max(h0, tc * CT); t <= Math.min(last, tc * CT + ct - 1); t++) {
      const dst = out[key][t - h0];
      for (let jj = 0; jj < CJ; jj++) {
        const j = jc * CJ + jj; if (j < j0 || j > j1) continue;
        for (let ii = 0; ii < CI; ii++) {
          const i = ic * CI + ii; if (i < i0 || i > i1) continue;
          dst[(j - j0) * nx + (i - i0)] = pack(value(f[((t - tc * CT) * CJ + jj) * CI + ii]), scale);
        }
      }
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { while (next < jobs.length) await one(jobs[next++]); }));
  // About a third of our area is land (no blocks); far more missing means the store has moved or closed.
  if (missing > jobs.length * 0.6) throw new Error(`Copernicus: ${missing} of ${jobs.length} blocks not there`);
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return {
    south: r5(s.lat.min + j0 * s.lat.step), west: r5(s.lng.min + i0 * s.lng.step), step: s.lat.step, nx, ny,
    t0: new Date(s.time.min + h0 * s.time.step).toISOString().slice(0, 16), stepH, steps: n,
    ...Object.fromEntries(keys.map((k) => [k, out[k].map((a) => Array.from(a))])),
  };
}

// The seabed's depth at each point of a 1/12° grid (metres, null on land), from GEBCO's world
// seabed map (every 15", so every 20th point) on NOAA's PFEG server: one request. For the
// hotspots at full detail (deep enough to fish, the shelf break). The seabed doesn't change:
// fetched once for a grid and kept.
const GEBCO = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/GEBCO_2020.csv';
async function depthFor(fetchImpl, g) {
  const north = g.south + (g.ny - 1) * g.step; const east = g.west + (g.nx - 1) * g.step;
  const q = `elevation[(${g.south}):20:(${north.toFixed(5)})][(${g.west}):20:(${east.toFixed(5)})]`;
  const res = await fetchImpl(`${GEBCO}?${encodeURIComponent(q).replace(/%2C/g, ',')}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Seabed depth ${res.status}`);
  const out = new Array(g.nx * g.ny).fill(null);
  for (const line of (await res.text()).split('\n').slice(2)) {
    const [la, lo, el] = line.split(',').map(Number);
    if (!Number.isFinite(el)) continue;
    const i = Math.round((lo - g.west) / g.step); const j = Math.round((la - g.south) / g.step);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) out[j * g.nx + i] = el < 0 ? -el : null;
  }
  return out;
}

function createCopernicus({ fetchImpl = globalThis.fetch, file = null, ttlMs = 12 * 3600e3, maxAgeMs = 36 * 3600e3,
  retryMs = 60 * 60e3, area = AREA, hours = 72, parallel = 6 } = {}) {
  let cached = null;
  try { if (file) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  if (!cached?.data?.currents) cached = null; // none, or saved in an older form
  let pending = null;
  let retryAt = 0;
  let lastError = null;
  function refresh() {
    if (pending || Date.now() < retryAt) return pending;
    const opts = { fetchImpl, area, hours, now: Date.now(), parallel };
    pending = Promise.allSettled([load(SETS.currents, opts), load(SETS.waves, opts)]).then(async ([c, w]) => {
      const errs = [c, w].filter((x) => x.status === 'rejected').map((x) => x.reason.message);
      lastError = errs.length ? errs.join('; ') : null;
      if (errs.length) { retryAt = Date.now() + retryMs; console.warn(`Copernicus: ${lastError}`); }
      // Whatever came; the other is kept from last time while it's fresh enough.
      const old = cached && Date.now() - cached.at < maxAgeMs ? cached.data : {};
      if (c.status === 'rejected' && w.status === 'rejected') return;
      const data = { currents: c.value || old.currents || null, waves: w.value || old.waves || null };
      // The seabed under the current's grid: kept from before for the same grid, else fetched.
      const C = data.currents; const was = cached?.data?.currents;
      if (C && !C.depth) {
        if (was?.depth && was.south === C.south && was.west === C.west && was.nx === C.nx && was.ny === C.ny) C.depth = was.depth;
        else C.depth = await depthFor(fetchImpl, C).catch((err) => { console.warn(`Copernicus: ${err.message}`); return null; });
      }
      cached = { at: Date.now(), data };
      if (file) fs.promises.writeFile(file, JSON.stringify(cached)).catch(() => {});
    }).finally(() => { pending = null; });
    return pending;
  }
  const fresh = () => cached && Date.now() - cached.at < maxAgeMs;
  return {
    // { currents, waves } (either can be null), or null (not ready, or too old to go by).
    async get({ wait = false } = {}) {
      if (!cached || Date.now() - cached.at >= ttlMs) { const p = refresh(); if (wait) await p; }
      return fresh() ? cached.data : null;
    },
    // Whether both are here and fresh: then the forecast service isn't needed for the sea.
    ready: () => !!(fresh() && cached.data.currents && cached.data.waves),
    warm: () => { if (!cached || Date.now() - cached.at >= ttlMs) refresh(); },
    status: () => ({ at: cached ? new Date(cached.at).toISOString() : null, fetching: !!pending, error: lastError,
      currents: !!cached?.data?.currents, waves: !!cached?.data?.waves, seabed: !!cached?.data?.currents?.depth }),
  };
}

// One hour of a set (ISO "YYYY-MM-DDTHH:00"): each value packed as stored, blended between two
// steps when the hour falls between them (a direction: the nearer step's). Null if it's not covered.
function hourOf(set, time, key) {
  const x = (Date.parse(`${time}:00Z`) - Date.parse(`${set.t0}:00Z`)) / (set.stepH * 3600e3);
  if (!(x >= 0 && x <= set.steps - 1)) return null;
  const a = Math.floor(x); const t = x - a;
  if (!t) return set[key][a];
  if (key === 'wd') return set[key][t < 0.5 ? a : a + 1];
  const A = set[key][a]; const B = set[key][a + 1];
  return A.map((p, k) => (p === NONE || B[k] === NONE ? (p === NONE ? B[k] : p) : Math.round(p + (B[k] - p) * t)));
}

// The chart's own grid (every 0.3°) with Copernicus's current (knots) and waves (metres, the
// way they come from) put in at each of its points and hours, where Copernicus has water;
// Open-Meteo's stays elsewhere (and at any hour Copernicus doesn't have). A new object: the
// grid itself is left as it was.
const KN = 1 / 51.444; // cm/s to knots
function mergeInto(grid, cop) {
  if (!cop || !grid?.frames) return grid;
  // Blended from the four nearest points that have water (a direction: the nearest).
  const at = (set, arr, lat, lng, nearest) => {
    const x = (lng - set.west) / set.step; const y = (lat - set.south) / set.step;
    const i = Math.floor(x); const j = Math.floor(y);
    if (i < 0 || j < 0 || i >= set.nx - 1 || j >= set.ny - 1) return null;
    const fx = x - i; const fy = y - j;
    const pts = [[j * set.nx + i, (1 - fx) * (1 - fy)], [j * set.nx + i + 1, fx * (1 - fy)], [(j + 1) * set.nx + i, (1 - fx) * fy], [(j + 1) * set.nx + i + 1, fx * fy]];
    if (nearest) { const best = pts.filter(([k]) => arr[k] !== NONE).sort((p, q) => q[1] - p[1])[0]; return best && best[1] > 0.1 ? arr[best[0]] : null; }
    let s = 0; let w = 0;
    for (const [k, wt] of pts) if (arr[k] !== NONE && wt > 0) { s += arr[k] * wt; w += wt; }
    return w > 0.25 ? s / w : null;
  };
  const C = cop.currents; const W = cop.waves;
  const frames = grid.frames.map((f) => {
    const cu = C && hourOf(C, f.time, 'u'); const cv = C && hourOf(C, f.time, 'v');
    const wh = W && hourOf(W, f.time, 'wh'); const wd = W && hourOf(W, f.time, 'wd');
    if (!cu && !wh) return f;
    const n = grid.nx * grid.ny;
    const g = { ...f };
    if (cu) { g.u = f.u ? f.u.slice() : Array(n).fill(null); g.v = f.v ? f.v.slice() : Array(n).fill(null); }
    if (wh) { g.wh = f.wh ? f.wh.slice() : Array(n).fill(null); g.wd = f.wd ? f.wd.slice() : Array(n).fill(null); }
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const lat = grid.south + j * grid.step; const lng = grid.west + i * grid.step; const k = j * grid.nx + i;
        if (cu) {
          const a = at(C, cu, lat, lng); const b = at(C, cv, lat, lng);
          if (a != null && b != null) { g.u[k] = Math.round(a * KN * 100) / 100; g.v[k] = Math.round(b * KN * 100) / 100; }
        }
        if (wh) {
          const h = at(W, wh, lat, lng); const d = at(W, wd, lat, lng, true);
          if (h != null) { g.wh[k] = Math.round(h / 10) / 10; if (d != null) g.wd[k] = Math.round(d); }
        }
      }
    }
    return g;
  });
  return { ...grid, frames, currentsFrom: C ? 'Copernicus Marine' : undefined, wavesFrom: W ? 'Copernicus Marine' : undefined };
}

// The current at a spot and time (knots, and the way it flows, degrees): the nearest point
// Copernicus has as sea, within about 25 km. Null if none, or the hour isn't covered.
function currentNear(C, lat, lng, time, reach = 3) {
  const u = C && hourOf(C, time, 'u'); const v = C && hourOf(C, time, 'v');
  if (!u || !v) return null;
  const i0 = Math.round((lng - C.west) / C.step); const j0 = Math.round((lat - C.south) / C.step);
  let best = null; let bestD = Infinity;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = i0 + di; const j = j0 + dj;
      if (i < 0 || j < 0 || i >= C.nx || j >= C.ny) continue;
      const k = j * C.nx + i;
      if (u[k] !== NONE && v[k] !== NONE && di * di + dj * dj < bestD) { best = k; bestD = di * di + dj * dj; }
    }
  }
  if (best == null) return null;
  return { kn: Math.hypot(u[best], v[best]) * KN, deg: ((Math.atan2(u[best], v[best]) * 180) / Math.PI + 360) % 360 };
}

// The waves at a spot and time (metres, the way they come from, the period in seconds): the
// nearest point Copernicus has as sea, within about 25 km. Null if none.
function wavesNear(W, lat, lng, time, reach = 3) {
  const h = W && hourOf(W, time, 'wh');
  if (!h) return null;
  const i0 = Math.round((lng - W.west) / W.step); const j0 = Math.round((lat - W.south) / W.step);
  let best = null; let bestD = Infinity;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = i0 + di; const j = j0 + dj;
      if (i < 0 || j < 0 || i >= W.nx || j >= W.ny) continue;
      if (h[j * W.nx + i] !== NONE && di * di + dj * dj < bestD) { best = j * W.nx + i; bestD = di * di + dj * dj; }
    }
  }
  if (best == null) return null;
  const d = hourOf(W, time, 'wd')?.[best]; const p = W.tp ? hourOf(W, time, 'tp')?.[best] : NONE;
  return { m: h[best] / 100, from: d == null || d === NONE ? null : d, periodS: p == null || p === NONE ? null : p / 10 };
}

module.exports = { createCopernicus, hourOf, mergeInto, currentNear, wavesNear, NONE, AREA, SETS };
