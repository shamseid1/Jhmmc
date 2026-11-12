'use strict';

// The currents map: the ocean model's surface currents and water temperature (Open-Meteo's
// marine forecast, from Copernicus/Mercator) on a grid over the fishing grounds, every 3 hours
// for 3 days. One grid for everyone, fetched every 3 hours (a few hundred points per fetch,
// well inside the free allowance), in two halves to keep each request small.
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
// Guinea-Bissau's south to the Ivory Coast border, well out past the shelf (about 500 points).
const REGION = { south: 2.4, north: 9.4, west: -16.1, east: -7.0, step: 0.35 };
const KN_PER_KMH = 1 / 1.852;

function grid(r = REGION) {
  const ny = Math.round((r.north - r.south) / r.step) + 1;
  const nx = Math.round((r.east - r.west) / r.step) + 1;
  const pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([+(r.south + j * r.step).toFixed(3), +(r.west + i * r.step).toFixed(3)]);
  return { nx, ny, pts };
}

// The model's hourly lists at each point, made into frames every 3 hours: u and v (knots,
// east and north), and water temperature; null on land. The model's current includes the
// tide, which near the coast swings the water on and off shore every few hours; averaged over
// a day (two tides, 25 hours around each frame) it leaves the current itself: the Guinea
// Current, its eddies and edges, as a fishing chart shows it.
const TIDE_WINDOW = 12;
function frames(results, r = REGION, { nx, ny } = grid(r)) {
  const times = results.find((x) => x?.hourly?.time)?.hourly.time || [];
  // Each point's hourly u and v.
  const uv = results.map((x) => {
    const hu = []; const hv = [];
    for (let h = 0; h < times.length; h++) {
      const sp = x?.hourly?.ocean_current_velocity?.[h];
      const dir = x?.hourly?.ocean_current_direction?.[h]; // where it flows to, degrees
      if (sp == null || dir == null) { hu.push(null); hv.push(null); continue; }
      const kn = sp * KN_PER_KMH;
      const rad = (dir * Math.PI) / 180;
      hu.push(kn * Math.sin(rad));
      hv.push(kn * Math.cos(rad));
    }
    return [hu, hv];
  });
  const mean = (xs, h) => {
    let s = 0; let n = 0;
    for (let k = Math.max(0, h - TIDE_WINDOW); k <= Math.min(xs.length - 1, h + TIDE_WINDOW); k++) if (xs[k] != null) { s += xs[k]; n += 1; }
    return n ? Math.round((s / n) * 100) / 100 : null;
  };
  const out = [];
  for (let h = 0; h < times.length; h += 3) {
    const u = []; const v = []; const sst = [];
    results.forEach((x, k) => {
      u.push(mean(uv[k][0], h));
      v.push(mean(uv[k][1], h));
      const t = x?.hourly?.sea_surface_temperature?.[h];
      sst.push(t == null ? null : Math.round(t * 10) / 10);
    });
    out.push({ time: times[h], u, v, sst });
  }
  return { south: r.south, west: r.west, step: r.step, nx, ny, frames: out };
}

function createCurrents({ fetchImpl = globalThis.fetch, ttlMs = 3 * 3600e3, region = REGION } = {}) {
  let cached = null;
  let pending = null;
  async function load() {
    const g = grid(region);
    const half = Math.ceil(g.pts.length / 2);
    const parts = [g.pts.slice(0, half), g.pts.slice(half)];
    const results = [];
    for (const part of parts) {
      const url = `${MARINE}?latitude=${part.map((p) => p[0]).join(',')}&longitude=${part.map((p) => p[1]).join(',')}`
        + '&hourly=ocean_current_velocity,ocean_current_direction,sea_surface_temperature&forecast_days=3&timezone=GMT&cell_selection=nearest';
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Currents ${res.status}`);
      const body = await res.json();
      results.push(...(Array.isArray(body) ? body : [body]));
    }
    return frames(results, region, g);
  }
  return {
    async get() {
      if (cached && Date.now() - cached.at < ttlMs) return cached.data;
      pending ??= load().then((data) => { cached = { at: Date.now(), data }; return data; }).finally(() => { pending = null; });
      try {
        return await pending;
      } catch (err) {
        // Refused or slow: the last map, if there is one, rather than none.
        if (cached) return cached.data;
        throw err;
      }
    },
  };
}

module.exports = { createCurrents, frames, grid, REGION };
