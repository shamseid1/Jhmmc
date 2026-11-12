'use strict';

// Sea conditions for a place: the Sea conditions page, the feed's card and the line on Log
// fish all ask here, so phones never call the forecast service themselves. Part of createApp.
module.exports = (ctx) => {
  const { api, sea } = ctx;
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
