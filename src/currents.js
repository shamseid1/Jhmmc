'use strict';

// The chart's data: the ocean model's surface currents, water temperature and waves (Open-Meteo's
// marine forecast, from Copernicus/Mercator) and the wind (its weather forecast) on a grid over
// the fishing grounds, every 3 hours for 3 days. One grid for everyone, fetched every 6 hours, in
// two halves to keep each request small; the wind, smooth over this distance, on every other
// point and filled in between (Open-Meteo counts each point, so this keeps well inside the
// free allowance).
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
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
// The wind grid: every other row and column (and the last), as indexes into the full grid.
const coarse = (n) => { const xs = []; for (let i = 0; i < n; i += 2) xs.push(i); if (xs.at(-1) !== n - 1) xs.push(n - 1); return xs; };
function windGrid(r = REGION) {
  const { nx, ny } = grid(r);
  const cx = coarse(nx); const cy = coarse(ny);
  const pts = [];
  for (const j of cy) for (const i of cx) pts.push([+(r.south + j * r.step).toFixed(3), +(r.west + i * r.step).toFixed(3)]);
  return { cx, cy, pts };
}
// One wind value at full-grid point (i, j), from the coarse grid's values (vals[cj][ci]).
function fill(vals, cx, cy, i, j) {
  const bracket = (xs, k) => { let a = 0; while (a < xs.length - 2 && xs[a + 1] <= k) a++; return [a, xs[a + 1] === xs[a] ? 0 : (k - xs[a]) / (xs[a + 1] - xs[a])]; };
  const [a, fx] = cx.length > 1 ? bracket(cx, i) : [0, 0];
  const [b, fy] = cy.length > 1 ? bracket(cy, j) : [0, 0];
  const at = (bb, aa) => vals[Math.min(bb, cy.length - 1)][Math.min(aa, cx.length - 1)];
  const c = [[at(b, a), (1 - fx) * (1 - fy)], [at(b, a + 1), fx * (1 - fy)], [at(b + 1, a), (1 - fx) * fy], [at(b + 1, a + 1), fx * fy]];
  let sum = 0; let w = 0;
  for (const [v, wt] of c) if (v != null && wt > 0) { sum += v * wt; w += wt; }
  return w > 0 ? Math.round((sum / w) * 10) / 10 : null;
}
function frames(results, r = REGION, { nx, ny } = grid(r), wind = null) {
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
  // The wind (knots, where it blows to) on the coarse grid, by the same hour.
  const wg = wind && windGrid(r);
  const windAt = (h, key) => {
    if (!wind) return null;
    const vals = wg.cy.map((_, b) => wg.cx.map((__, a) => {
      const x = wind.results[b * wg.cx.length + a]?.hourly;
      const k = x?.time ? x.time.indexOf(times[h]) : -1;
      const sp = k >= 0 ? x.wind_speed_10m?.[k] : null; const dir = k >= 0 ? x.wind_direction_10m?.[k] : null; // where it comes from
      if (sp == null || dir == null) return null;
      const rad = (dir * Math.PI) / 180;
      return key === 'u' ? -sp * Math.sin(rad) : -sp * Math.cos(rad);
    }));
    const out = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(fill(vals, wg.cx, wg.cy, i, j));
    return out;
  };
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const out = [];
  for (let h = 0; h < times.length; h += 3) {
    const u = []; const v = []; const sst = []; const wh = []; const wd = [];
    results.forEach((x, k) => {
      u.push(mean(uv[k][0], h));
      v.push(mean(uv[k][1], h));
      sst.push(r1(x?.hourly?.sea_surface_temperature?.[h]));
      wh.push(r1(x?.hourly?.wave_height?.[h]));
      const d = x?.hourly?.wave_direction?.[h]; // where the waves come from
      wd.push(d == null ? null : Math.round(d));
    });
    out.push({ time: times[h], u, v, sst, wh, wd, wu: windAt(h, 'u'), wv: windAt(h, 'v') });
  }
  return { south: r.south, west: r.west, step: r.step, nx, ny, frames: out };
}

function createCurrents({ fetchImpl = globalThis.fetch, ttlMs = 6 * 3600e3, region = REGION } = {}) {
  let cached = null;
  let pending = null;
  async function load() {
    const g = grid(region);
    const half = Math.ceil(g.pts.length / 2);
    const parts = [g.pts.slice(0, half), g.pts.slice(half)];
    const results = [];
    for (const part of parts) {
      const url = `${MARINE}?latitude=${part.map((p) => p[0]).join(',')}&longitude=${part.map((p) => p[1]).join(',')}`
        + '&hourly=ocean_current_velocity,ocean_current_direction,sea_surface_temperature,wave_height,wave_direction&forecast_days=3&timezone=GMT&cell_selection=nearest';
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Currents ${res.status}`);
      const body = await res.json();
      results.push(...(Array.isArray(body) ? body : [body]));
    }
    // The wind: if it fails, the chart still has the sea.
    let wind = null;
    try {
      const wgr = windGrid(region);
      const url = `${FORECAST}?latitude=${wgr.pts.map((p) => p[0]).join(',')}&longitude=${wgr.pts.map((p) => p[1]).join(',')}`
        + '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=3&timezone=GMT';
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) { const body = await res.json(); wind = { results: Array.isArray(body) ? body : [body] }; }
    } catch { /* no wind this time */ }
    return frames(results, region, g, wind);
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

module.exports = { createCurrents, frames, grid, windGrid, REGION };
