'use strict';

// The depth of the sea at a spot, from GEBCO (the world's seabed map, a grid of about 450 m),
// through Open Topo Data's free service: a height below sea level, so "about" a depth, good
// offshore, rougher near reefs and the shelf edge. Spots are rounded to about 100 m, asked in
// batches (100 at most), and kept a month.
const URL_GEBCO = 'https://api.opentopodata.org/v1/gebco2020';
const r3 = (n) => Math.round(n * 1000) / 1000; // 0.001°, about 100 m (the map's grid is about 450 m)

function createDepth({ fetchImpl = globalThis.fetch, ttlMs = 30 * 864e5 } = {}) {
  const cache = new Map();
  // Depths in metres (positive), or null on land; same order as the spots.
  async function at(spots) {
    const keys = spots.map(({ lat, lng }) => `${r3(lat)},${r3(lng)}`);
    const missing = [...new Set(keys.filter((k) => { const h = cache.get(k); return !h || Date.now() - h.at > ttlMs; }))];
    for (let i = 0; i < missing.length; i += 100) {
      const part = missing.slice(i, i + 100);
      const res = await fetchImpl(`${URL_GEBCO}?locations=${part.join('|')}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Depth ${res.status}`);
      const out = await res.json();
      (out.results || []).forEach((r, k) => {
        const el = r.elevation;
        cache.set(part[k], { at: Date.now(), m: el == null || el >= 0 ? null : Math.round(-el) });
      });
      if (cache.size > 20000) cache.delete(cache.keys().next().value);
    }
    return keys.map((k) => cache.get(k)?.m ?? null);
  }
  return { at };
}

module.exports = { createDepth };
