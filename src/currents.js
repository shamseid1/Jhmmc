'use strict';

const fs = require('fs');

// The chart's data: the ocean model's surface currents, water temperature and waves (Open-Meteo's
// marine forecast, from Copernicus/Mercator) and the wind (its weather forecast) on a grid over
// the fishing grounds, every 3 hours for 3 days. One grid for everyone, fetched every 6 hours, in
// parts to keep each request small; the wind, smooth over this distance, on every other
// point and filled in between (Open-Meteo counts each point, so this keeps well inside the
// free allowance).
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
// Guinea-Bissau's south to the Ivory Coast border, well out past the shelf: about 1,100 points,
// 0.25° (28 km) apart, close enough that the changes at the shelf show.
const REGION = { south: 2.4, north: 9.4, west: -16.1, east: -7.0, step: 0.25 };
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

// Open-Meteo's free limit is 600 points a minute (and 5,000 an hour, 10,000 a day): the grid is
// asked for in parts of about 360 points a minute apart (about 4 minutes in all, every 6 hours).
// Nobody waits for that: get() answers at once with the last chart (kept on disk too, so a
// restart or an update doesn't start again from nothing), and refreshes it in the background.
// Until the very first chart is ready it says so (err.preparing). A refused fetch isn't tried
// again for 10 minutes, so visits don't keep knocking.
function createCurrents({ fetchImpl = globalThis.fetch, ttlMs = 6 * 3600e3, region = REGION, depth = null, file = null,
  gapMs = 61000, partSize = 360, retryMs = 10 * 60e3 } = {}) {
  let cached = null;
  try { if (file) cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { cached = null; }
  if (cached && (!cached.data?.frames || cached.data.step !== region.step)) cached = null; // another grid
  let pending = null;
  let failedAt = 0;
  const pause = () => new Promise((r) => setTimeout(r, gapMs));
  async function load() {
    const g = grid(region);
    const n = Math.ceil(g.pts.length / partSize);
    const size = Math.ceil(g.pts.length / n);
    const parts = Array.from({ length: n }, (_, k) => g.pts.slice(k * size, (k + 1) * size));
    const results = [];
    for (const [k, part] of parts.entries()) {
      if (k) await pause();
      const url = `${MARINE}?latitude=${part.map((p) => p[0]).join(',')}&longitude=${part.map((p) => p[1]).join(',')}`
        + '&hourly=ocean_current_velocity,ocean_current_direction,sea_surface_temperature,wave_height,wave_direction&forecast_days=3&timezone=GMT&cell_selection=nearest';
      // Refused for going over the minute's allowance: wait a minute and ask again (twice).
      let res;
      for (let tries = 0; ; tries++) {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
        if (res.status !== 429 || tries >= 2) break;
        await pause();
      }
      if (!res.ok) throw new Error(`Currents ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
      const body = await res.json();
      results.push(...(Array.isArray(body) ? body : [body]));
    }
    // The wind: if it fails, the chart still has the sea.
    let wind = null;
    try {
      await pause();
      const wgr = windGrid(region);
      const url = `${FORECAST}?latitude=${wgr.pts.map((p) => p[0]).join(',')}&longitude=${wgr.pts.map((p) => p[1]).join(',')}`
        + '&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=3&timezone=GMT';
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) { const body = await res.json(); wind = { results: Array.isArray(body) ? body : [body] }; }
    } catch { /* no wind this time */ }
    const data = frames(results, region, g, wind);
    // The seabed depth at each point (for the fishing chart's shelf): it doesn't change, so
    // the last chart's is kept if the depth service doesn't answer.
    if (depth) {
      try { data.depth = await depth.at(g.pts.map(([lat, lng]) => ({ lat, lng }))); } catch { /* none this time */ }
    }
    if (!data.depth && cached?.data?.depth?.length === g.pts.length) data.depth = cached.data.depth;
    return data;
  }
  function refresh() {
    if (pending || Date.now() - failedAt < retryMs) return pending;
    pending = load().then((data) => {
      cached = { at: Date.now(), data };
      if (file) fs.promises.writeFile(file, JSON.stringify(cached)).catch((err) => console.warn(`Chart not saved: ${err.message}`));
      return data;
    }).catch((err) => {
      failedAt = Date.now();
      console.warn(`Chart refresh failed: ${err.message}`);
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    // The chart now: the last one (refreshing it in the background if it's old). With wait,
    // a fresh one is waited for (the tests).
    async get({ wait = false } = {}) {
      if (!cached || Date.now() - cached.at >= ttlMs) {
        const p = refresh();
        if (wait) await p;
      }
      if (cached) return cached.data;
      throw Object.assign(new Error('The chart is being prepared. It will be ready in a few minutes.'), { preparing: true });
    },
    // Start fetching (at start-up, so the chart is ready before anyone asks).
    warm: () => { if (!cached || Date.now() - cached.at >= ttlMs) refresh(); },
  };
}

module.exports = { createCurrents, frames, grid, windGrid, REGION };
