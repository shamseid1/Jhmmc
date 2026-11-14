'use strict';

// Sea conditions for a place: the Sea conditions page, the feed's card and the line on Log
// fish all ask here, so phones never call the forecast service themselves. Part of createApp.
module.exports = (ctx) => {
  const { api, auth, chlorophyll, copernicus, currents, db, depth, satSst, sea } = ctx;
  const { mergeInto, hourOf, NONE } = require('../copernicus');
  const { sstInto } = require('../sst');
  // The grid with Copernicus's current and waves and the satellites' temperature put in,
  // worked out once for each set of downloads.
  let merged = { grid: null, cop: null, sat: null, out: null };
  const withBest = (grid, cop, sat) => {
    if (merged.grid !== grid || merged.cop !== cop || merged.sat !== sat) merged = { grid, cop, sat, out: sstInto(mergeInto(grid, cop), sat) };
    return merged.out;
  };

  // For the admin: the chart's forecast (when fetched, refused and why), and a try now.
  const adminOnly = (req, res, next) => (ctx.isAdminUser(req.user) ? next() : res.status(403).json({ error: 'Only the club admin can do that.' }));
  api.get('/admin/forecast', auth.requireUser, adminOnly, (_req, res) => res.json({ chart: currents?.status?.() ?? null, copernicus: copernicus?.status?.() ?? null }));
  api.post('/admin/forecast', auth.requireUser, adminOnly, async (_req, res) => {
    if (!currents?.tryNow) return res.status(503).json({ error: 'The chart\'s forecast is not set up here.' });
    currents.tryNow(); // in the background: about 5 minutes, a minute between its parts
    copernicus?.warm();
    res.json({ chart: currents.status(), copernicus: copernicus?.status?.() ?? null });
  });

  // The water colour (chlorophyll, newest clear view of the last week), for the fishing chart.
  api.get('/chlorophyll', async (_req, res) => {
    if (!chlorophyll) return res.status(503).json({ error: 'The water colour is not available right now.' });
    try {
      res.set('Cache-Control', 'public, max-age=3600').json(await chlorophyll.get());
    } catch (err) {
      if (err.preparing) return res.set('Cache-Control', 'no-store').json({ preparing: true });
      res.status(503).json({ error: 'The water colour is not available right now.' });
    }
  });

  // The water temperature measured by satellite (a day or two behind, about 3 km), for the
  // chart's temperature and its breaks.
  api.get('/sst', async (_req, res) => {
    if (!satSst) return res.status(503).json({ error: 'The satellite water temperature is not available right now.' });
    try {
      res.set('Cache-Control', 'public, max-age=3600').json(await satSst.get());
    } catch (err) {
      if (err.preparing) return res.set('Cache-Control', 'no-store').json({ preparing: true });
      res.status(503).json({ error: 'The satellite water temperature is not available right now.' });
    }
  });

  // The sea at Copernicus's full detail (1/12°, about 9 km), one hour at a time, for the chart's
  // lines and colours: what it covers, then each hour's current east and north (whole cm/s)
  // and waves (height in cm, the way they come from, period in tenths of a second), null on
  // land. The waves come on their own 1/12° grid (its edge can fall a point apart): each of the
  // current's points takes the wave grid's nearest.
  const waveIndex = new WeakMap(); // waves -> for each current point, its wave point (or -1)
  const toCurrentGrid = (C, W) => {
    if (!waveIndex.has(W)) {
      const idx = new Int32Array(C.nx * C.ny);
      for (let j = 0; j < C.ny; j++) {
        for (let i = 0; i < C.nx; i++) {
          const a = Math.round((C.west + i * C.step - W.west) / W.step); const b = Math.round((C.south + j * C.step - W.south) / W.step);
          idx[j * C.nx + i] = a >= 0 && b >= 0 && a < W.nx && b < W.ny ? b * W.nx + a : -1;
        }
      }
      waveIndex.set(W, idx);
    }
    const idx = waveIndex.get(W);
    return (arr) => (arr ? Array.from(idx, (k) => (k < 0 ? NONE : arr[k])) : null);
  };
  api.get('/currents/fine', async (_req, res) => {
    const C = (await copernicus?.get().catch(() => null))?.currents;
    if (!C) return res.set('Cache-Control', 'no-store').json({ ready: false });
    const { south, west, step, nx, ny, depth } = C;
    // With the seabed's depth at each point (for the hotspots at full detail), when it's in.
    res.set('Cache-Control', 'public, max-age=900').json({ ready: true, south, west, step, nx, ny, depth: depth || null, at: copernicus.status?.().at || null });
  });
  api.get('/currents/fine/:t', async (req, res) => {
    const cop = await copernicus?.get().catch(() => null);
    const C = cop?.currents; const W = C && cop?.waves;
    const u = C && hourOf(C, req.params.t, 'u');
    if (!u) return res.status(404).json({ error: 'No current for that hour.' });
    const out = (a) => (a ? a.map((x) => (x === NONE ? null : x)) : null);
    res.set('Cache-Control', 'public, max-age=3600').json({ u: out(u), v: out(hourOf(C, req.params.t, 'v')),
      ...(W ? (() => { const on = toCurrentGrid(C, W); return { wh: out(on(hourOf(W, req.params.t, 'wh'))), wd: out(on(hourOf(W, req.params.t, 'wd'))), tp: out(W.tp && on(hourOf(W, req.params.t, 'tp'))) }; })() : {}) });
  });

  // The fishing chart's preferences: the water temperature and depth billfish have been
  // landed in over the last two years, every boat's together (no spots, no boats), as the
  // middle 80%. Null until there are 5 such fish.
  api.get('/chart/fishing', (_req, res) => {
    const rows = db.prepare(`SELECT json_extract(l.conditions, '$.waterC') AS w, json_extract(l.conditions, '$.depthM') AS d
      FROM outing_landings l JOIN species s ON s.id = l.species_id
      WHERE s.category = 'Billfish' AND l.fate <> 'lost' AND l.conditions IS NOT NULL AND l.landed_at >= date('now', '-2 years')`).all();
    const band = (vals) => {
      const xs = vals.filter((v) => typeof v === 'number').sort((a, b) => a - b);
      if (xs.length < 5) return null;
      const q = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
      return { lo: q(0.1), hi: q(0.9), n: xs.length };
    };
    res.set('Cache-Control', 'private, max-age=3600').json({ water: band(rows.map((r) => r.w)), depth: band(rows.map((r) => r.d)) });
  });

  // The chart's data: the grid's currents, water temperature, waves and wind for every hour
  // (Render compresses it on the way).
  api.get('/currents', async (_req, res) => {
    if (!currents) return res.status(503).json({ error: 'The currents map is not available right now.' });
    try {
      const grid = await currents.get();
      const cop = await copernicus?.get().catch(() => null);
      const sat = await satSst?.get().catch(() => null);
      res.set('Cache-Control', 'public, max-age=900').json(withBest(grid, cop, sat));
    } catch (err) {
      // Not ready yet (just after an update): said at once, and the page asks again by itself.
      if (err.preparing) {
        const e = err.lastError;
        return res.set('Cache-Control', 'no-store').json({ preparing: true, message: err.message, fetching: err.fetching,
          refused: e ? { daily: /daily/i.test(e.message), hourly: /hourly/i.test(e.message), reason: e.message.replace(/^Currents \d+: /, ''), retryAt: new Date(e.retryAt).toISOString() } : null });
      }
      console.warn(`Currents failed: ${err.message}`);
      res.status(503).json({ error: 'The currents map is not available right now. Try again in a few minutes.' });
    }
  });

  // The depth (GEBCO) at up to 50 spots: "lat,lng|lat,lng". For the Depth check page.
  api.get('/depth', auth.requireUser, async (req, res) => {
    const spots = String(req.query.at ?? '').split('|').slice(0, 50).map((s) => s.split(',').map(Number))
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      .map(([lat, lng]) => ({ lat, lng }));
    if (!spots.length) return res.status(400).json({ error: 'Give at least one position.' });
    if (!depth) return res.status(503).json({ error: 'Depths are not available right now.' });
    try {
      const m = await depth.at(spots);
      res.json({ depths: spots.map((s, i) => ({ ...s, depthM: m[i] })) });
    } catch (err) {
      console.warn(`Depth failed: ${err.message}`);
      res.status(503).json({ error: 'Depths are not available right now. Try again in a minute.' });
    }
  });
  // Places to choose from: towns and ports by name.
  api.get('/sea/places', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ places: [] });
    if (!sea) return res.status(503).json({ error: 'Place search is not available right now.' });
    try {
      res.json({ places: await sea.search(q) });
    } catch (err) {
      console.warn(`Place search failed: ${err.message}`);
      res.status(503).json({ error: 'Place search is not available right now. Try again in a few minutes.' });
    }
  });

  // Sea conditions' "now" from the same data as the fishing chart: the water temperature the
  // satellites measured (not the forecast model's), and the current from Copernicus at full
  // detail. The forecast for the days ahead stays the forecast's.
  const { compass, rating } = require('../sea');
  const { tempNear } = require('../sst');
  const { currentNear, wavesNear } = require('../copernicus');
  const withBestNow = async (s, lat, lng) => {
    if (!s?.now) return s;
    const now = { ...s.now };
    const sat = await satSst?.get().catch(() => null);
    const t = tempNear(sat, lat, lng);
    if (t != null) { now.waterC = t; now.waterMeasured = sat.newest; }
    const cop = await copernicus?.get().catch(() => null);
    const hourNow = new Date().toISOString().slice(0, 13) + ':00';
    const c = currentNear(cop?.currents, lat, lng, hourNow);
    if (c) { now.currentKn = Math.round(c.kn * 10) / 10; now.currentDir = compass(c.deg); }
    // The waves as the chart has them: height, the way they come from, the swell's period.
    const w = wavesNear(cop?.waves, lat, lng, hourNow);
    if (w) {
      now.waveM = Math.round(w.m * 10) / 10;
      if (w.from != null) now.swellDir = compass(w.from);
      if (w.periodS != null) now.swellS = Math.round(w.periodS);
      now.rating = rating(now.windKn, now.waveM);
    }
    return { ...s, now };
  };
  api.get('/sea', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'Choose a place.' });
    }
    if (!sea) return res.status(503).json({ error: 'Sea conditions are not available right now.' });
    try {
      res.set('Cache-Control', 'private, max-age=600').json(await withBestNow(await sea.summary(lat, lng), lat, lng));
    } catch (err) {
      console.warn(`Sea conditions failed: ${err.message}`);
      res.status(503).json({ error: 'Sea conditions are not available right now. Try again in a few minutes.' });
    }
  });
  return {};
};
