'use strict';

const fs = require('fs');
const { decompress } = require('./blosc');

// The ocean currents for the fishing chart, straight from Copernicus Marine (the EU's ocean
// service, whose global model Open-Meteo also passes on): the hourly surface current with the
// tide and the waves' drift in it ("merged"), every 1/12° (about 9 km), from midnight GMT
// today for 3 days. Read from its open cloud store (zarr, packed with Blosc/LZ4), the blocks
// that cover our area. Fetched twice a day in the background (the model runs once a day),
// kept on disk. Until it's ready, or if Copernicus can't be reached, the chart keeps the
// current Open-Meteo gives (the same model, at the chart's coarser grid).
const STAC = 'https://stac.marine.copernicus.eu/metadata/GLOBAL_ANALYSISFORECAST_PHY_001_024';
const DATASET = 'cmems_mod_glo_phy_anfc_merged-uv_PT1H-i';
const AREA = { south: 1.5, north: 12.0, west: -17.8, east: -7.0 };
const NONE = -32768; // land, in the packed values

// The dataset's newest version in the catalogue, and its store split by area (each block one
// small square, all hours): its address, the grid and how it's cut.
async function describe(fetchImpl) {
  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Copernicus catalogue ${res.status}`);
    return res.json();
  };
  const product = await get(`${STAC}/product.stac.json`);
  const item = product.links.filter((l) => l.rel === 'item' && l.href.startsWith(`${DATASET}_`)).map((l) => l.href).sort().at(-1);
  if (!item) throw new Error('Copernicus: the currents dataset is not in the catalogue');
  const ds = await get(`${STAC}/${item}`);
  const a = ds.assets?.geoChunked;
  const d = a?.viewDims;
  if (!a?.href || !d) throw new Error('Copernicus: no area-split store');
  const dim = (k) => ({ ...d[k].coords, chunk: d[k].chunkLen.utotal });
  return { href: a.href, lat: dim('latitude'), lng: dim('longitude'), time: dim('time') };
}

// Values (m/s) to whole cm/s, small enough to keep and send.
const pack = (x) => (Number.isFinite(x) && Math.abs(x) < 100 ? Math.round(x * 100) : NONE);

async function load({ fetchImpl, area, hours, now, parallel }) {
  const s = await describe(fetchImpl);
  const idx = (c, v) => Math.round((v - c.min) / c.step);
  const j0 = Math.ceil((area.south - s.lat.min) / s.lat.step - 1e-6); const j1 = Math.floor((area.north - s.lat.min) / s.lat.step + 1e-6);
  const i0 = Math.ceil((area.west - s.lng.min) / s.lng.step - 1e-6); const i1 = Math.floor((area.east - s.lng.min) / s.lng.step + 1e-6);
  const nx = i1 - i0 + 1; const ny = j1 - j0 + 1;
  const day = new Date(now); const t0 = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const h0 = idx(s.time, t0);
  const last = Math.min(h0 + hours - 1, s.time.len - 1);
  if (last < h0) throw new Error('Copernicus: no forecast for today yet');
  const n = last - h0 + 1;
  const out = { u: Array.from({ length: n }, () => new Int16Array(nx * ny).fill(NONE)), v: Array.from({ length: n }, () => new Int16Array(nx * ny).fill(NONE)) };
  // Every block (variable, time, latitude, longitude) that holds part of the area and hours.
  const jobs = [];
  for (const [key, name] of [['u', 'utotal'], ['v', 'vtotal']]) {
    for (let tc = Math.floor(h0 / s.time.chunk); tc <= Math.floor(last / s.time.chunk); tc++) {
      for (let jc = Math.floor(j0 / s.lat.chunk); jc <= Math.floor(j1 / s.lat.chunk); jc++) {
        for (let ic = Math.floor(i0 / s.lng.chunk); ic <= Math.floor(i1 / s.lng.chunk); ic++) jobs.push({ key, name, tc, jc, ic });
      }
    }
  }
  let missing = 0;
  const one = async ({ key, name, tc, jc, ic }) => {
    let res;
    for (let tries = 0; ; tries++) {
      try {
        res = await fetchImpl(`${s.href}/${name}/${tc}.0.${jc}.${ic}`, { signal: AbortSignal.timeout(60000) });
        if (res.ok || res.status === 404 || res.status === 403 || tries >= 2) break;
      } catch (err) { if (tries >= 2) throw err; }
      await new Promise((r) => setTimeout(r, 2000 * (tries + 1)));
    }
    // A block that's all land isn't stored: the store says it's not there (404) or, being
    // closed to listing, forbidden (403).
    if (res.status === 404 || res.status === 403) { missing += 1; return; }
    if (!res.ok) throw new Error(`Copernicus ${res.status}`);
    const raw = decompress(new Uint8Array(await res.arrayBuffer()));
    const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const CT = s.time.chunk; const CJ = s.lat.chunk; const CI = s.lng.chunk;
    // The block's own size (the last ones can be cut short): from its length.
    const ct = f.length / (CJ * CI);
    for (let t = Math.max(h0, tc * CT); t <= Math.min(last, tc * CT + ct - 1); t++) {
      const dst = out[key][t - h0];
      for (let jj = 0; jj < CJ; jj++) {
        const j = jc * CJ + jj; if (j < j0 || j > j1) continue;
        for (let ii = 0; ii < CI; ii++) {
          const i = ic * CI + ii; if (i < i0 || i > i1) continue;
          dst[(j - j0) * nx + (i - i0)] = pack(f[((t - tc * CT) * CJ + jj) * CI + ii]);
        }
      }
    }
  };
  // A few at a time.
  let next = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { while (next < jobs.length) await one(jobs[next++]); }));
  // About a third of our area is land (no blocks); far more missing means the store has moved or closed.
  if (missing > jobs.length * 0.6) throw new Error(`Copernicus: ${missing} of ${jobs.length} blocks not there`);
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return {
    south: r5(s.lat.min + j0 * s.lat.step), west: r5(s.lng.min + i0 * s.lng.step), step: s.lat.step, nx, ny,
    t0: new Date(s.time.min + h0 * s.time.step).toISOString().slice(0, 16), hours: n,
    u: out.u.map((a) => Array.from(a)), v: out.v.map((a) => Array.from(a)),
  };
}

function createCopernicus({ fetchImpl = globalThis.fetch, file = null, ttlMs = 12 * 3600e3, maxAgeMs = 36 * 3600e3,
  retryMs = 60 * 60e3, area = AREA, hours = 72, parallel = 6 } = {}) {
  let cached = null;
  try { if (file) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  if (!cached?.data?.u) cached = null;
  let pending = null;
  let retryAt = 0;
  let lastError = null;
  function refresh() {
    if (pending || Date.now() < retryAt) return pending;
    pending = load({ fetchImpl, area, hours, now: Date.now(), parallel }).then((data) => {
      cached = { at: Date.now(), data };
      lastError = null;
      if (file) fs.promises.writeFile(file, JSON.stringify(cached)).catch(() => {});
      return data;
    }).catch((err) => { retryAt = Date.now() + retryMs; lastError = err.message; console.warn(`Copernicus currents: ${err.message}`); })
      .finally(() => { pending = null; });
    return pending;
  }
  const fresh = () => cached && Date.now() - cached.at < maxAgeMs;
  return {
    // The grid, or null (not ready, or too old to go by).
    async get({ wait = false } = {}) {
      if (!cached || Date.now() - cached.at >= ttlMs) { const p = refresh(); if (wait) await p; }
      return fresh() ? cached.data : null;
    },
    warm: () => { if (!cached || Date.now() - cached.at >= ttlMs) refresh(); },
    status: () => ({ at: cached ? new Date(cached.at).toISOString() : null, fetching: !!pending, error: lastError }),
  };
}

// One hour of the grid, as knots (null on land), at the hour given (ISO "YYYY-MM-DDTHH:00").
function hourOf(data, time) {
  const h = Math.round((Date.parse(`${time}:00Z`) - Date.parse(`${data.t0}:00Z`)) / 3600e3);
  if (!(h >= 0 && h < data.hours)) return null;
  return h;
}

module.exports = { createCopernicus, hourOf, NONE, AREA };

// The chart's own grid (every 0.3°, knots) with Copernicus's current put in at each of its
// points and hours (blended from the four nearest 1/12° points), where Copernicus has water;
// Open-Meteo's stays elsewhere (and every hour Copernicus doesn't have). A new object: the
// grid itself is left as it was.
const KN = 1 / 51.444; // cm/s to knots
function mergeInto(grid, cop) {
  if (!cop || !grid?.frames) return grid;
  const at = (arr, lat, lng) => {
    const x = (lng - cop.west) / cop.step; const y = (lat - cop.south) / cop.step;
    const i = Math.floor(x); const j = Math.floor(y);
    if (i < 0 || j < 0 || i >= cop.nx - 1 || j >= cop.ny - 1) return null;
    const fx = x - i; const fy = y - j;
    let s = 0; let w = 0;
    for (const [k, wt] of [[j * cop.nx + i, (1 - fx) * (1 - fy)], [j * cop.nx + i + 1, fx * (1 - fy)], [(j + 1) * cop.nx + i, (1 - fx) * fy], [(j + 1) * cop.nx + i + 1, fx * fy]]) {
      if (arr[k] !== NONE && wt > 0) { s += arr[k] * wt; w += wt; }
    }
    return w > 0.25 ? Math.round((s / w) * KN * 100) / 100 : null;
  };
  const frames = grid.frames.map((f) => {
    const h = hourOf(cop, f.time);
    if (h == null) return f;
    const u = f.u.slice(); const v = f.v.slice();
    for (let j = 0; j < grid.ny; j++) {
      for (let i = 0; i < grid.nx; i++) {
        const lat = grid.south + j * grid.step; const lng = grid.west + i * grid.step;
        const cu = at(cop.u[h], lat, lng); const cv = at(cop.v[h], lat, lng);
        if (cu != null && cv != null) { u[j * grid.nx + i] = cu; v[j * grid.nx + i] = cv; }
      }
    }
    return { ...f, u, v };
  });
  return { ...grid, frames, currentsFrom: 'Copernicus Marine' };
}

module.exports.mergeInto = mergeInto;
