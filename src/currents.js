'use strict';

const fs = require('fs');

// The chart's data on a grid over the fishing grounds, every hour for 3 days: the wind (Open-
// Meteo's weather forecast, ECMWF's model here) and, when Copernicus can't give them, the
// ocean model's surface currents, water temperature and waves (Open-Meteo's marine forecast).
// One grid for everyone, fetched every 6 hours, in parts to keep each request small.
// Open-Meteo counts each point: with the sea from Copernicus, the wind is asked for at every
// point (about 1,300 a fetch); with the sea from Open-Meteo too, the wind is asked for at every
// other point and filled in between, so the two keep inside the free 10,000 a day.
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
// From Guinea-Bissau and the Bissagos (12°N) past Conakry and Freetown to the Ivory Coast border,
// well out past the shelf (1.5°N): about 1,300 points 0.3° (33 km) apart.
const REGION = { south: 1.5, north: 12.0, west: -17.8, east: -7.0, step: 0.3 };
const KN_PER_KMH = 1 / 1.852;

function grid(r = REGION) {
  const ny = Math.round((r.north - r.south) / r.step) + 1;
  const nx = Math.round((r.east - r.west) / r.step) + 1;
  const pts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pts.push([+(r.south + j * r.step).toFixed(3), +(r.west + i * r.step).toFixed(3)]);
  return { nx, ny, pts };
}

// The model's hourly lists at each point, made into a frame for every hour: u and v (knots,
// east and north: the real current at that hour, the tide in it), water temperature, waves and
// wind; null on land.
// The wind grid: every other row and column (and the last), as indexes into the full grid.
const coarse = (n, every) => { const xs = []; for (let i = 0; i < n; i += every) xs.push(i); if (xs.at(-1) !== n - 1) xs.push(n - 1); return xs; };
function windGrid(r = REGION, every = 2) {
  const { nx, ny } = grid(r);
  const cx = coarse(nx, every); const cy = coarse(ny, every);
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
function frames(results0, r = REGION, { nx, ny } = grid(r), wind = null) {
  // Without the marine forecast (the sea from Copernicus): the hours from the wind's, the sea empty.
  const times = (results0.length ? results0 : wind?.results || []).find((x) => x?.hourly?.time)?.hourly.time || [];
  const results = results0.length ? results0 : Array(nx * ny).fill(null);
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
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  // The wind (knots, where it blows to) on the coarse grid, by the same hour.
  const wg = wind && windGrid(r, wind.every || 2);
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
  for (let h = 0; h < times.length; h++) {
    const u = []; const v = []; const sst = []; const wh = []; const wd = [];
    results.forEach((x, k) => {
      u.push(r2(uv[k][0][h]));
      v.push(r2(uv[k][1][h]));
      sst.push(r1(x?.hourly?.sea_surface_temperature?.[h]));
      wh.push(r1(x?.hourly?.wave_height?.[h]));
      const d = x?.hourly?.wave_direction?.[h]; // where the waves come from
      wd.push(d == null ? null : Math.round(d));
    });
    out.push({ time: times[h], u, v, sst, wh, wd, wu: windAt(h, 'u'), wv: windAt(h, 'v') });
  }
  return { south: r.south, west: r.west, step: r.step, nx, ny, hours: 1, seaFrom: results0.length ? 'Open-Meteo' : null, frames: out };
}

// Open-Meteo's free limit is 600 points a minute (and 5,000 an hour, 10,000 a day): the grid is
// asked for in parts of about 360 points a minute apart (about 4 minutes in all, every 6 hours).
// Nobody waits for that: get() answers at once with the last chart (kept on disk too, so a
// restart or an update doesn't start again from nothing), and refreshes it in the background;
// a chart more than 12 hours old is never shown.
// Until the very first chart is ready it says so (err.preparing). A refused fetch isn't tried
// again for 10 minutes, so visits don't keep knocking.
// seaElsewhere(): whether the currents, waves and temperature come from elsewhere (Copernicus
// and the satellites) just now; then only the wind is fetched here.
function createCurrents({ fetchImpl = globalThis.fetch, ttlMs = 6 * 3600e3, region = REGION, depth = null, file = null,
  gapMs = 61000, partSize = 360, retryMs = 10 * 60e3, maxAgeMs = 12 * 3600e3, seaElsewhere = () => false } = {}) {
  let cached = null;
  let saved = null;
  try { if (file) saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { saved = null; }
  // The last chart, even if it was another grid (the area or spacing changed): shown until the
  // new one is ready (it carries its own grid), but fetched again at once.
  if (saved?.data?.frames) cached = { at: saved.at, data: saved.data, otherGrid: saved.data.step !== region.step || saved.data.south !== region.south || saved.data.west !== region.west
    // Saved before the chart came hourly (3-hour steps, the tide averaged out): fetched again now.
    || !saved.data.hours };
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
  // Time for a new chart: none yet, another grid, 6 hours old, or only the wind while the sea
  // can't come from Copernicus any more.
  const stale = () => !cached || cached.otherGrid || Date.now() - cached.at >= ttlMs || (cached.data.seaFrom === null && !seaElsewhere());
  // Points asked for in parts of about partSize, a minute apart; each part's answers in order.
  let asked = 0;
  async function inParts(base, query, pts) {
    const n = Math.ceil(pts.length / partSize);
    const size = Math.ceil(pts.length / n);
    const results = [];
    for (let k = 0; k < n; k++) {
      if (asked++) await pause();
      const part = pts.slice(k * size, (k + 1) * size);
      const url = `${base}?latitude=${part.map((p) => p[0]).join(',')}&longitude=${part.map((p) => p[1]).join(',')}&${query}`;
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
    return results;
  }
  async function load() {
    const g = grid(region);
    asked = 0;
    // The sea from Open-Meteo only when Copernicus can't give it just now.
    const onlyWind = seaElsewhere();
    const results = onlyWind ? [] : await inParts(MARINE, 'hourly=ocean_current_velocity,ocean_current_direction,sea_surface_temperature,wave_height,wave_direction&forecast_days=3&timezone=GMT&cell_selection=nearest', g.pts);
    // The wind: at every point when it's all that's asked for here (then without it there's no
    // chart: an error), else every other point (if it fails, the chart still has the sea).
    let wind = null;
    const every = onlyWind ? 1 : 2;
    try {
      const wgr = windGrid(region, every);
      wind = { every, results: await inParts(FORECAST, 'hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=3&timezone=GMT', wgr.pts) };
    } catch (err) { if (onlyWind) throw err; console.warn(`Chart wind: ${err.message}`); }
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
      if (stale()) {
        const p = refresh();
        if (wait) await p;
      }
      // Never an old forecast: past two missed refreshes, none at all (the page says why).
      if (cached && Date.now() - cached.at < maxAgeMs) return { ...cached.data, updatedAt: cached.at }; // when it was fetched (for a phone without signal)
      throw Object.assign(new Error('The chart is being prepared. It will be ready in a few minutes.'), { preparing: true, lastError, fetching: !!pending });
    },
    // Start fetching (at start-up, so the chart is ready before anyone asks).
    warm: () => { if (stale()) refresh(); },
    // For the admin: when the chart was last fetched, whether a fetch is on, the last refusal;
    // and a fetch now, whatever the wait after a refusal (the admin's own try).
    status: () => ({ fetchedAt: cached?.at ?? null, fetching: !!pending, refusal: lastError, nextTry: retryAt || null, seaFrom: cached?.data?.seaFrom ?? null }),
    tryNow: () => { retryAt = 0; failedAt = 0; return refresh(); },
  };
}

module.exports = { createCurrents, frames, grid, windGrid, REGION };
