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
// From Guinea-Bissau and the Bissagos (12°N) past Conakry and Freetown to the Ivory Coast border,
// well out past the shelf (1.5°N): about 1,300 points 0.3° (33 km) apart, with the wind on
// every other one, about 1,700 a fetch, four times a day, inside the free 10,000 a day.
const REGION = { south: 1.5, north: 12.0, west: -17.8, east: -7.0, step: 0.3 };
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
// restart or an update doesn't start again from nothing), and refreshes it in the background;
// a chart more than 12 hours old is never shown.
// Until the very first chart is ready it says so (err.preparing). A refused fetch isn't tried
// again for 10 minutes, so visits don't keep knocking.
function createCurrents({ fetchImpl = globalThis.fetch, ttlMs = 6 * 3600e3, region = REGION, depth = null, file = null,
  gapMs = 61000, partSize = 360, retryMs = 10 * 60e3, maxAgeMs = 12 * 3600e3 } = {}) {
  let cached = null;
  let saved = null;
  try { if (file) saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { saved = null; }
  // The last chart, even if it was another grid (the area or spacing changed): shown until the
  // new one is ready (it carries its own grid), but fetched again at once.
  if (saved?.data?.frames) cached = { at: saved.at, data: saved.data, otherGrid: saved.data.step !== region.step || saved.data.south !== region.south || saved.data.west !== region.west };
  let pending = null;
  let failedAt = 0;
  // A refusal is remembered on disk too, so a restart (every update) doesn't ask again before then.
  // When to try again after a refusal (never more than an hour off, whatever an older one said).
  let retryAt = saved?.refusal?.retryAt > Date.now() ? Math.min(saved.refusal.retryAt, Date.now() + 3600e3) : 0;
  let lastError = retryAt ? saved.refusal : null; // what went wrong last, for the waiting page
  const save = () => {
    if (file) fs.promises.writeFile(file, JSON.stringify({ ...(cached || {}), refusal: lastError })).catch((err) => console.warn(`Chart not saved: ${err.message}`));
  };
  // When to ask again after a refusal: Open-Meteo says which allowance ran out. The day's can
  // come back sooner than midnight (it has before), and a refused try costs nothing (it's
  // turned away at the first request), so it's tried again every hour.
  const nextTry = (msg) => {
    const now = new Date();
    if (/daily|hourly/i.test(msg)) return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1, 2);
    return Date.now() + retryMs;
  };
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
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let reason = text;
        try { reason = JSON.parse(text).reason || text; } catch { /* not JSON */ }
        throw new Error(`Currents ${res.status}: ${String(reason).slice(0, 120)}`);
      }
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
    if (pending || Date.now() < retryAt) return pending;
    pending = load().then((data) => {
      cached = { at: Date.now(), data };
      lastError = null;
      save();
      return data;
    }).catch((err) => {
      failedAt = Date.now();
      retryAt = nextTry(err.message);
      lastError = { message: err.message, at: failedAt, retryAt };
      save();
      console.warn(`Chart refresh failed: ${err.message} (next try ${new Date(retryAt).toISOString()})`);
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    // The chart now: the last one (refreshing it in the background if it's old). With wait,
    // a fresh one is waited for (the tests).
    async get({ wait = false } = {}) {
      if (!cached || cached.otherGrid || Date.now() - cached.at >= ttlMs) {
        const p = refresh();
        if (wait) await p;
      }
      // Never an old forecast: past two missed refreshes, none at all (the page says why).
      if (cached && Date.now() - cached.at < maxAgeMs) return { ...cached.data, updatedAt: cached.at }; // when it was fetched (for a phone without signal)
      throw Object.assign(new Error('The chart is being prepared. It will be ready in a few minutes.'), { preparing: true, lastError, fetching: !!pending });
    },
    // Start fetching (at start-up, so the chart is ready before anyone asks).
    warm: () => { if (!cached || cached.otherGrid || Date.now() - cached.at >= ttlMs) refresh(); },
    // For the admin: when the chart was last fetched, whether a fetch is on, the last refusal;
    // and a fetch now, whatever the wait after a refusal (the admin's own try).
    status: () => ({ fetchedAt: cached?.at ?? null, fetching: !!pending, refusal: lastError, nextTry: retryAt || null }),
    tryNow: () => { retryAt = 0; failedAt = 0; return refresh(); },
  };
}

module.exports = { createCurrents, frames, grid, windGrid, REGION };
