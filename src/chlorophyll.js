'use strict';

const fs = require('fs');

// Water colour for the fishing chart: chlorophyll from NOAA CoastWatch (satellites VIIRS on
// NOAA-20 and S-NPP, near real-time, a 4 km grid, free and with no account), as mg per m³:
// green water is rich in plankton (and bait), blue water clear. Clouds hide the sea, so each
// spot takes its newest clear view over the last 7 days, from either satellite. Every other
// grid point is kept (about 8 km), over the chart's area. Fetched twice a day in the
// background, kept on disk; until the first is ready get() says it's being prepared.
const ERDDAP = 'https://coastwatch.noaa.gov/erddap/griddap';
const SOURCES = ['noaacwN20VIIRSchlaDaily', 'noaacwNPPVIIRSchlaDaily'];
const AREA = { north: 12.0, south: 1.5, west: -17.8, east: -7.0 };

// One satellite's CSV (time, altitude, latitude, longitude, chlor_a) into rows.
function parse(text) {
  const out = [];
  for (const line of text.split('\n').slice(2)) {
    const [time, , la, lo, v] = line.split(',');
    if (!time || v === undefined) continue;
    out.push({ time, lat: Number(la), lng: Number(lo), v: v === 'NaN' ? null : Number(v) });
  }
  return out;
}

// The newest clear view at each point, on one regular grid (south-west corner, step, nx by ny).
function composite(rowsList) {
  const rows = rowsList.flat();
  const lats = [...new Set(rows.map((r) => r.lat))].sort((a, b) => a - b);
  const lngs = [...new Set(rows.map((r) => r.lng))].sort((a, b) => a - b);
  if (lats.length < 2 || lngs.length < 2) return null;
  const step = (lats.at(-1) - lats[0]) / (lats.length - 1);
  const nx = lngs.length; const ny = lats.length;
  const south = lats[0]; const west = lngs[0];
  const values = new Array(nx * ny).fill(null);
  const when = new Array(nx * ny).fill('');
  let newest = ''; let oldest = '';
  for (const r of rows) {
    if (r.v == null || !(r.v > 0)) continue;
    const j = Math.round((r.lat - south) / step); const i = Math.round((r.lng - west) / step);
    const k = j * nx + i;
    if (r.time >= when[k]) { when[k] = r.time; values[k] = Math.round(r.v * 1000) / 1000; }
    if (r.time > newest) newest = r.time;
    if (!oldest || r.time < oldest) oldest = r.time;
  }
  return { south: +south.toFixed(5), west: +west.toFixed(5), step: +step.toFixed(6), nx, ny, values, newest: newest.slice(0, 10), oldest: oldest.slice(0, 10) };
}

function createChlorophyll({ fetchImpl = globalThis.fetch, file = null, ttlMs = 12 * 3600e3, maxAgeMs = 4 * 864e5, retryMs = 60 * 60e3, area = AREA, stride = 2 } = {}) {
  let cached = null;
  try { if (file) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  if (!cached?.data?.values) cached = null;
  let pending = null;
  let retryAt = 0;
  async function load() {
    const results = [];
    for (const id of SOURCES) {
      const q = `chlor_a[last-6:1:last][0][(${area.north}):${stride}:(${area.south})][(${area.west}):${stride}:(${area.east})]`;
      try {
        const res = await fetchImpl(`${ERDDAP}/${id}.csv?${encodeURIComponent(q).replace(/%2C/g, ',')}`, { signal: AbortSignal.timeout(90000) });
        if (res.ok) results.push(parse(await res.text()));
      } catch { /* the other satellite may do */ }
    }
    const data = results.length ? composite(results) : null;
    if (!data) throw new Error('Water colour not available');
    return data;
  }
  function refresh() {
    if (pending || Date.now() < retryAt) return pending;
    pending = load().then((data) => {
      cached = { at: Date.now(), data };
      if (file) fs.promises.writeFile(file, JSON.stringify(cached)).catch(() => {});
      return data;
    }).catch((err) => { retryAt = Date.now() + retryMs; console.warn(`Water colour: ${err.message}`); })
      .finally(() => { pending = null; });
    return pending;
  }
  return {
    async get({ wait = false } = {}) {
      if (!cached || Date.now() - cached.at >= ttlMs) { const p = refresh(); if (wait) await p; }
      if (cached && Date.now() - cached.at < maxAgeMs) return cached.data;
      throw Object.assign(new Error('The water colour is being prepared.'), { preparing: true });
    },
    warm: () => { if (!cached || Date.now() - cached.at >= ttlMs) refresh(); },
  };
}

module.exports = { createChlorophyll, parse, composite };
