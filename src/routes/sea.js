'use strict';

// Sea conditions for a place: the Sea conditions page, the feed's card and the line on Log
// fish all ask here, so phones never call the forecast service themselves. Part of createApp.
module.exports = (ctx) => {
  const { api, auth, chlorophyll, currents, db, depth, sea } = ctx;

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

  // The chart's data: the grid's currents, water temperature, waves and wind every 3 hours
  // (Render compresses it on the way).
  api.get('/currents', async (_req, res) => {
    if (!currents) return res.status(503).json({ error: 'The currents map is not available right now.' });
    try {
      res.set('Cache-Control', 'public, max-age=900').json(await currents.get());
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

  api.get('/sea', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'Choose a place.' });
    }
    if (!sea) return res.status(503).json({ error: 'Sea conditions are not available right now.' });
    try {
      res.set('Cache-Control', 'private, max-age=600').json(await sea.summary(lat, lng));
    } catch (err) {
      console.warn(`Sea conditions failed: ${err.message}`);
      res.status(503).json({ error: 'Sea conditions are not available right now. Try again in a few minutes.' });
    }
  });
  return {};
};
