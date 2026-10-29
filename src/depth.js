// Sea depths for the maps: NOAA's ETOPO global relief (1 arc-minute grid,
// about 1.8 km), read from NOAA's ERDDAP server for the area being looked at.
// Good for the shelf, the drop-off and the canyons; not for navigation.

const ERDDAP = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.json';
const PER_DEGREE = 60; // ETOPO1: one value every arc-minute
const MAX_SIDE = 150; // grid points per side sent to a phone
const MAX_SPAN = 10; // degrees

// The area asked for, widened to quarter degrees so nearby views share a grid.
function depthArea(q) {
  const [south, west, north, east] = ['south', 'west', 'north', 'east'].map((k) => Number(q[k]));
  if (![south, west, north, east].every(Number.isFinite)) return { error: 'Give the map area.' };
  const snap = (v, up) => (up ? Math.ceil(v * 4) : Math.floor(v * 4)) / 4;
  const area = {
    south: Math.max(-90, snap(south, false)), north: Math.min(90, snap(north, true)),
    west: Math.max(-180, snap(west, false)), east: Math.min(180, snap(east, true)),
  };
  if (area.south >= area.north || area.west >= area.east) return { error: 'The map area is not valid.' };
  if (area.north - area.south > MAX_SPAN || area.east - area.west > MAX_SPAN) return { error: 'Zoom in to see depths.' };
  const span = Math.max(area.north - area.south, area.east - area.west);
  area.stride = Math.max(1, Math.ceil((span * PER_DEGREE) / MAX_SIDE));
  return area;
}

// Fetches the grid from ERDDAP: { lats, lons, alt } with alt in metres
// (negative under the sea), row by row from the southern edge.
async function fetchEtopo({ south, west, north, east, stride }) {
  const query = `altitude[(${south}):${stride}:(${north})][(${west}):${stride}:(${east})]`;
  const res = await fetch(`${ERDDAP}?${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`ERDDAP answered ${res.status}`);
  const { table } = await res.json();
  const col = (name) => table.columnNames.indexOf(name);
  const [iLat, iLon, iAlt] = [col('latitude'), col('longitude'), col('altitude')];
  const lats = [...new Set(table.rows.map((r) => r[iLat]))].sort((a, b) => a - b);
  const lons = [...new Set(table.rows.map((r) => r[iLon]))].sort((a, b) => a - b);
  const alt = new Array(lats.length * lons.length).fill(null);
  const latIndex = new Map(lats.map((v, i) => [v, i]));
  const lonIndex = new Map(lons.map((v, i) => [v, i]));
  for (const r of table.rows) alt[latIndex.get(r[iLat]) * lons.length + lonIndex.get(r[iLon])] = Math.round(r[iAlt]);
  return { lats, lons, alt };
}

// Grids already fetched, kept while the server runs (the sea floor doesn't move).
function createDepth({ source = fetchEtopo, keep = 200 } = {}) {
  const cache = new Map();
  return async function depth(query) {
    const area = depthArea(query);
    if (area.error) return area;
    const key = [area.south, area.west, area.north, area.east, area.stride].join(',');
    if (!cache.has(key)) {
      const grid = source(area);
      cache.set(key, grid);
      grid.catch(() => cache.delete(key));
      if (cache.size > keep) cache.delete(cache.keys().next().value);
    }
    return { ...area, ...(await cache.get(key)) };
  };
}

module.exports = { createDepth, depthArea, fetchEtopo };
