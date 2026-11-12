'use strict';

// Sea conditions for a place: the Sea conditions page, the feed's card and the line on Log
// fish all ask here, so phones never call the forecast service themselves. Part of createApp.
module.exports = (ctx) => {
  const { api, auth, depth, sea } = ctx;

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
