'use strict';

const fs = require('fs');
const { composite } = require('./chlorophyll');

// The water temperature measured by satellite, for the fishing chart's temperature and its
// breaks: NASA's MUR analysis (1 km, from several satellites, a day or two behind), every third
// point (about 3 km); if NOAA's PFEG server can't give it, NOAA's own blended analysis (5 km).
// Both free, with no account. Fetched twice a day in the background, kept on disk.
const SOURCES = [
  { name: 'NASA MUR', url: 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41', stride: 3 },
  { name: 'NOAA blended', url: 'https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsstDNDaily', stride: 1 },
];
const AREA = { north: 12.0, south: 1.5, west: -17.8, east: -7.0 };

// The CSV (time, latitude, longitude, analysed_sst in °C) into rows.
function parse(text) {
  const out = [];
  for (const line of text.split('\n').slice(2)) {
    const [time, la, lo, v] = line.split(',');
    if (!time || v === undefined) continue;
    out.push({ time, lat: Number(la), lng: Number(lo), v: v === 'NaN' ? null : Number(v) });
  }
  return out;
}

function createSst({ fetchImpl = globalThis.fetch, file = null, ttlMs = 12 * 3600e3, maxAgeMs = 3 * 864e5,
  retryMs = 60 * 60e3, gapMs = 45000, area = AREA, sources = SOURCES } = {}) {
  let cached = null;
  try { if (file) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  if (!cached?.data?.values) cached = null;
  let pending = null;
  let retryAt = 0;
  const pause = () => new Promise((r) => setTimeout(r, gapMs));
  async function load() {
    for (const src of sources) {
      const q = `analysed_sst[last][(${area.south}):${src.stride}:(${area.north})][(${area.west}):${src.stride}:(${area.east})]`;
      // The server is sometimes busy for a minute (503): asked again once before the next source.
      for (let tries = 0; tries < 2; tries++) {
        if (tries) await pause();
        try {
          const res = await fetchImpl(`${src.url}.csv?${encodeURIComponent(q).replace(/%2C/g, ',')}`, { signal: AbortSignal.timeout(120000) });
          if (!res.ok) continue;
          const data = composite([parse(await res.text())]);
          if (data) {
            data.values = data.values.map((v) => (v == null ? null : Math.round(v * 100) / 100));
            return { ...data, source: src.name };
          }
        } catch { /* asked again, or the next source */ }
      }
    }
    throw new Error('Satellite water temperature not available');
  }
  function refresh() {
    if (pending || Date.now() < retryAt) return pending;
    pending = load().then((data) => {
      cached = { at: Date.now(), data };
      if (file) fs.promises.writeFile(file, JSON.stringify(cached)).catch(() => {});
      return data;
    }).catch((err) => { retryAt = Date.now() + retryMs; console.warn(`Water temperature: ${err.message}`); })
      .finally(() => { pending = null; });
    return pending;
  }
  // Too old to go by: the measured day itself, not when it was fetched.
  const fresh = () => cached && Date.now() - Date.parse(`${cached.data.newest}T12:00:00Z`) < maxAgeMs;
  return {
    async get({ wait = false } = {}) {
      if (!cached || Date.now() - cached.at >= ttlMs) { const p = refresh(); if (wait) await p; }
      if (fresh()) return cached.data;
      throw Object.assign(new Error('The satellite water temperature is being prepared.'), { preparing: true });
    },
    warm: () => { if (!cached || Date.now() - cached.at >= ttlMs) refresh(); },
    ready: () => !!fresh(),
  };
}

// The chart's grid with the measured temperature put in at each of its points (the same at
// every hour: a day's measurement), where the satellites have sea; the forecast's stays
// elsewhere. A new object.
function sstInto(grid, sat) {
  if (!sat?.values || !grid?.frames) return grid;
  const vals = [];
  for (let j = 0; j < grid.ny; j++) {
    for (let i = 0; i < grid.nx; i++) {
      const x = (grid.west + i * grid.step - sat.west) / sat.step; const y = (grid.south + j * grid.step - sat.south) / sat.step;
      const a = Math.round(x); const b = Math.round(y);
      const v = a >= 0 && b >= 0 && a < sat.nx && b < sat.ny ? sat.values[b * sat.nx + a] : null;
      vals.push(v == null ? null : Math.round(v * 10) / 10);
    }
  }
  const frames = grid.frames.map((f) => ({ ...f, sst: f.sst ? f.sst.map((x, k) => vals[k] ?? x) : vals }));
  return { ...grid, frames, sstFrom: sat.source };
}

// The measured temperature at a spot: the nearest point the satellites saw as sea, within about
// 12 km (a port or a beach is on land on their map). Null if none.
function tempNear(sat, lat, lng, reach = 4) {
  if (!sat?.values) return null;
  const i0 = Math.round((lng - sat.west) / sat.step); const j0 = Math.round((lat - sat.south) / sat.step);
  let best = null; let bestD = Infinity;
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const i = i0 + di; const j = j0 + dj;
      if (i < 0 || j < 0 || i >= sat.nx || j >= sat.ny) continue;
      const v = sat.values[j * sat.nx + i];
      if (v != null && di * di + dj * dj < bestD) { best = v; bestD = di * di + dj * dj; }
    }
  }
  return best == null ? null : Math.round(best * 10) / 10;
}

module.exports = { createSst, parse, sstInto, tempNear, SOURCES };
