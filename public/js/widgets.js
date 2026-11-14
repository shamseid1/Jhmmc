// Africa Sportfishing, part of the app (public/js/widgets.js): Maps, forms and widgets shared by the pages, the trends charts, photo shrinking and the viewer.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// The maps: satellite imagery (Esri World Imagery) with borders and place
// names (country, city, town) on top.
function addSatellite(L, map, { fullScreen = false, base = 'satellite', relief: reliefOn = true } = {}) {
  const esri = (service) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  // The place names and borders above everything drawn on the sea (the colours at 400, their
  // outlines 420, the moving lines 450), as on Windy, so a town is never painted over; under
  // your fish and spots. Esri's names follow the zoom: countries far out, towns close in.
  const names = map.getPane('names') || map.createPane('names');
  names.style.zIndex = 460;
  names.style.pointerEvents = 'none';
  // Two looks: the satellite photo, or a sea chart (Esri's Ocean map: light land, the sea
  // shaded by its depth from GEBCO's seabed map), each with its own names.
  const BASES = {
    // (The photo's names from Esri's layer for dark maps: quiet grey borders instead of thick
    // white lines between the countries; the names brightened to read on the photo.)
    // (The photo from Esri: no free imagery is as good; its names are ours, as on the plotter's.)
    satellite: { map: 'World_Imagery', credit: 'Imagery © Esri', maxNative: 16 },
    // A plotter's (as Garmin's), drawn from data, not pictures: a plain blue sea, the land in
    // charcoal from our coastline (so the sea's colours stand out), and white names.
    plotter: { credit: 'Names: GeoNames, Borders: geoBoundaries', maxNative: 16 },
  };
  const landPane = map.getPane('land') || map.createPane('land');
  landPane.style.zIndex = 250;
  landPane.style.pointerEvents = 'none';
  let landLayer = null;
  let coastZoom = null; // the coastline's show/hide on zoom (one at a time)
  // (GSHHG's coastline: full resolution, about 45 m, along all of West Africa, coarser beyond:
  // charts/tools/gshhg_coast.py.)
  const COUNTRY_NAMES = [['Mauritania', 19.5, -11.5], ['Senegal', 14.6, -14.6], ['The Gambia', 13.45, -15.5, 7], ['Guinea-Bissau', 12.05, -14.9, 6],
    ['Guinea', 10.6, -11.2], ['Sierra Leone', 8.6, -11.8], ['Liberia', 6.6, -9.4], ["Côte d'Ivoire", 7.6, -5.6], ['Mali', 15.5, -6.5],
    ['Burkina Faso', 12.4, -1.6], ['Ghana', 7.9, -1.1], ['Togo', 8.5, 1.0], ['Benin', 9.6, 2.3], ['Nigeria', 9.0, 7.8], ['Cameroon', 5.5, 12.0]];
  // On the land, as on Garmin (charts/tools/land_details.py): country borders, provinces and
  // counties (the water is the water layer's, OpenStreetMap's, alone).
  const details = L.layerGroup();
  let detailData = null;
  let detailBase = 'plotter';
  const bordersPane = map.getPane('borders') || map.createPane('borders');
  bordersPane.style.zIndex = 265; // over the water (260), under the depth lines' numbers and names
  bordersPane.style.pointerEvents = 'none';
  let bRenderer = null;
  const borderRenderer = () => (bRenderer ??= L.canvas({ pane: 'borders', padding: 0.3 }));
  const drawDetails = () => {
    details.clearLayers();
    if (!detailData) return;
    // On the photo: only the country borders, faint (its own colours show the rest).
    if (detailBase === 'satellite') {
      details.addLayer(L.polyline(detailData.borders, { pane: 'borders', renderer: borderRenderer(), interactive: false, color: '#ffffff', weight: 1, opacity: 0.45 }));
      return;
    }
    if (!map.getContainer().classList.contains('base-plotter')) return;
    const css = getComputedStyle(map.getContainer());
    const c = (k, d) => css.getPropertyValue(k).trim() || d;
    const z = map.getZoom();
    const renderer = L.canvas({ pane: 'land', padding: 0.3 });
    const o = { pane: 'land', renderer, interactive: false };
    // (Rivers and lakes: the water layer's, OpenStreetMap's, alone.)
    const { borders, states } = detailData;
    // Provinces and counties far out only: their lines are coarse, and close in they'd run beside
    // the rivers and coasts they really follow.
    if (z >= 6 && z <= 9) details.addLayer(L.polyline(states, { ...o, color: c('--plotter-state', '#4b5462'), weight: 0.8 }));
    // Country borders at every zoom, over the water (a border that's a river runs down its middle).
    details.addLayer(L.polyline(borders, { ...o, pane: 'borders', renderer: borderRenderer(), color: c('--plotter-border', '#c8d6c0'), weight: 1.3, opacity: 0.85 }));
    // The countries' names, as on Garmin, while the map's far enough out to show them.
    if (z >= 5 && z <= 8) {
      for (const [name, lat, lng, from = 5] of COUNTRY_NAMES) {
        if (z < from) continue;
        details.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'country-label', interactive: false, pane: 'names' }).setLatLng([lat, lng]).setContent(name));
      }
    }
  };
  map.on('zoomend', drawDetails);
  const drawLand = () => Promise.all([fetch(`/land-fine.json?v=${LAND_V}`).then((r) => r.json()),
    fetch(`/land-details.json?v=${LAND_V}`).then((r) => r.json()).catch(() => null)]).then(([{ fill, wide = [], coast }, more]) => {
    detailData = more;
    drawDetails();
    if (!map.getContainer().classList.contains('base-plotter')) return;
    landLayer?.remove();
    // Its colours from the page's style (--plotter-land, --plotter-coast), so they're set in one place.
    const css = getComputedStyle(map.getContainer());
    const renderer = L.canvas({ pane: 'land', padding: 0.3 });
    // The land filled (no edge drawn: its pieces are cut where the detail changes), then the
    // coastline on its own, only where there really is a coast.
    const landStyle = { pane: 'land', renderer, stroke: false, fillColor: css.getPropertyValue('--plotter-land').trim() || '#2b2f36', fillOpacity: 1, interactive: false };
    // The coarse land and the detailed apart: they overlap a little, and as one shape the
    // overlap would read as a hole (a hairline of sea).
    landLayer = L.layerGroup([
      L.polygon(wide, landStyle),
      L.polygon(fill, landStyle),
      details,
    ]).addTo(map);
    // The coastline drawn far out only: close in, the land against the water shows the coast, and
    // it would sit in the water where it and OpenStreetMap's river mouths don't quite agree.
    const coastLine = L.polyline(coast, { pane: 'land', renderer, color: css.getPropertyValue('--plotter-coast').trim() || '#5fb3f0', weight: 1.2, interactive: false });
    const showCoast = () => { if (map.getZoom() <= 10) landLayer.addLayer(coastLine); else landLayer.removeLayer(coastLine); };
    if (coastZoom) map.off('zoomend', coastZoom);
    coastZoom = showCoast; map.on('zoomend', showCoast); showCoast();
  }).catch(() => {});
  let layers = [];
  const ourNames = placeNames(L, map);
  const relief = reliefLayer(L, map);
  let baseNow = base;
  // The water on the land (rivers, lagoons, creeks), over the land and its details, under the depth lines.
  const waterPane = map.getPane('water') || map.createPane('water');
  waterPane.style.zIndex = 260;
  waterPane.style.pointerEvents = 'none';
  let waterOn = null;
  let credit = null;
  const setBase = (kind) => {
    const b = BASES[kind] || BASES.satellite;
    for (const l of layers) l.remove();
    landLayer?.remove(); landLayer = null;
    layers = [...(b.map ? [L.tileLayer(esri(b.map), { maxZoom: 18, maxNativeZoom: b.maxNative, attribution: b.credit, keepBuffer: 4 }).addTo(map)] : []),
      ...(b.names ? [L.tileLayer(esri(b.names), { maxZoom: 18, maxNativeZoom: b.maxNative, pane: 'names' }).addTo(map)] : [])];
    // The credit (the photo's comes with its tiles; the plotter's is its names').
    if (credit) map.attributionControl?.removeAttribution(credit);
    credit = b.map ? 'Names: GeoNames' : b.credit;
    if (credit) map.attributionControl?.addAttribution(credit);
    ourNames.set(true);
    baseNow = kind;
    relief.set(kind === 'plotter' && reliefOn);
    map.getContainer().classList.toggle('base-plotter', kind === 'plotter');
    waterOn?.remove(); waterOn = null;
    detailBase = kind;
    if (kind === 'satellite') {
      landLayer?.remove(); landLayer = details.addTo(map);
      if (detailData) drawDetails();
      else fetch(`/land-details.json?v=${LAND_V}`).then((r) => r.json()).then((d) => { detailData = d; drawDetails(); }).catch(() => {});
    }
    if (kind === 'plotter') {
      drawLand();
      const css = getComputedStyle(map.getContainer());
      // All water on the land in one blue (areas and lines alike), as Garmin's rivers; the sea apart.
      const inland = css.getPropertyValue('--plotter-inland').trim() || '#1f5d99';
      waterOn = waterLayer(L, { sea: inland, shore: inland }).addTo(map);
    }
  };
  setBase(base);
  map.attributionControl?.setPrefix(false); // no Leaflet logo; Esri's credit stays (their terms), small
  if (!fullScreen) twoFingers(map);
  // Places the club wants on every map.
  for (const p of MAP_PLACES) {
    L.circleMarker([p.lat, p.lng], { radius: 5, weight: 2, color: '#ffffff', fillColor: '#f5a524', fillOpacity: 1 })
      .bindTooltip(p.name, { permanent: true, direction: 'right', className: 'place-label', offset: [6, 0] })
      .addTo(map);
  }
  return { setBase, setRelief: (v) => { reliefOn = v; relief.set(baseNow === 'plotter' && v); } };
}
// On a phone, one finger scrolls the page past the map; two fingers move and zoom it (a short
// hint says so), as Google Maps does inside a page.
function twoFingers(map) {
  if (!('ontouchstart' in window)) return;
  const box = map.getContainer();
  map.dragging.disable();
  const hint = document.createElement('div');
  hint.className = 'map-hint';
  hint.textContent = 'Use two fingers to move the map';
  box.appendChild(hint);
  let timer = 0;
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) { map.dragging.enable(); hint.classList.remove('on'); return; }
    map.dragging.disable();
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    hint.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(() => hint.classList.remove('on'), 1200);
  }, { passive: true });
  box.addEventListener('touchend', (e) => { if (!e.touches.length) map.dragging.disable(); }, { passive: true });
}
// Each with its name and position.
// Places the club wants marked on every map (none now: Marshall is in the chart's own names).
const MAP_PLACES = [];
const spotPin = (L, released) => ({ radius: 9, weight: 3, color: '#ffffff', fillColor: released ? '#3fcf8e' : '#2f7cf6', fillOpacity: 1 });
// The small map on a catch's page, on satellite imagery.
// The Plotter map's place names, as on Garmin (charts/tools/geonames_places.py, from GeoNames):
// towns by size, and near the coast villages, rivers, creeks, lagoons, points, capes, islands,
// rocks and reefs, each from its own zoom; the most important first, none over another. Drawn
// by the app from data (kept for no signal like the depth lines).
const NAMES_V = '5';
const nameCells = new Map();
let nameIndex = null;
const nameCell = async (key) => {
  nameIndex ??= fetch(`/names/index.json?v=${NAMES_V}`).then((r) => r.json()).then((xs) => new Set(xs)).catch(() => null);
  const have = await nameIndex;
  if (have && !have.has(key)) return [];
  if (!nameCells.has(key)) nameCells.set(key, fetch(`/names/${key}.json?v=${NAMES_V}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return nameCells.get(key);
};
function placeNames(L, map) {
  const pane = map.getPane('placenames') || map.createPane('placenames');
  pane.style.zIndex = 465;
  pane.style.pointerEvents = 'none';
  const group = L.layerGroup().addTo(map);
  // The club's own places have their own marker and name: not twice.
  const own = new Set(MAP_PLACES.map((p) => p.name.toLowerCase()));
  let on = false; let ticket = 0;
  const draw = async () => {
    const t = ++ticket;
    if (!on) { group.clearLayers(); return; }
    const b = map.getBounds(); const z = map.getZoom();
    const keys = [];
    for (let la = Math.floor(b.getSouth()); la <= Math.floor(b.getNorth()); la++) for (let lo = Math.floor(b.getWest()); lo <= Math.floor(b.getEast()); lo++) keys.push(`${la}_${lo}`);
    if (keys.length > 120) { group.clearLayers(); return; }
    const cells = await Promise.all(keys.map(nameCell));
    if (t !== ticket) return;
    const size = map.getSize();
    const xs = cells.flat().filter((x) => x[0] <= z && b.contains([x[3], x[4]]) && !own.has(x[5].toLowerCase()))
      .sort((a, c) => a[0] - c[0] || a[1] - c[1]);
    // The club's own markers' spots (the dot and its name to the right) are kept clear.
    const boxes = MAP_PLACES.map((m) => { const q = map.latLngToContainerPoint([m.lat, m.lng]); return [q.x - 8, q.y - 11, q.x + 16 + m.name.length * 8.5, q.y + 11]; });
    const layers = [];
    const seen = new Map(); // a name -> where it's already shown (the same place is often in twice)
    for (const [zmin, rank, kind, lat, lng, name] of xs) {
      if (layers.length >= 45) break; // a plotter's few, not a road map's many
      const was = seen.get(name);
      if (was && was.some(([a0, b0]) => Math.abs(a0 - lat) < 0.05 && Math.abs(b0 - lng) < 0.05)) continue;
      const big = kind === 'town' && rank <= 1;
      const w = Math.round(name.length * (big ? 8.2 : 6.8)) + 6; const h = big ? 18 : 15;
      const p = map.latLngToContainerPoint([lat, lng]);
      const box = [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2];
      if (box[2] < 0 || box[3] < 0 || box[0] > size.x || box[1] > size.y) continue;
      if (boxes.some((o) => box[0] < o[2] + 8 && box[2] > o[0] - 8 && box[1] < o[3] + 10 && box[3] > o[1] - 10)) continue; // room round each
      boxes.push(box);
      seen.set(name, [...(seen.get(name) || []), [lat, lng]]);
      layers.push(L.marker([lat, lng], { pane: 'placenames', interactive: false, keyboard: false,
        icon: L.divIcon({ className: `pn pn-${kind}${big ? ' pn-big' : ''}`, html: esc(name), iconSize: [w, h], iconAnchor: [w / 2, h / 2] }) }));
    }
    group.clearLayers();
    for (const l of layers) group.addLayer(l);
  };
  map.on('moveend zoomend', draw);
  return { set: (v) => { on = v; draw(); } };
}
// The Plotter map's water on the land, as on Garmin (charts/tools/osm_water.py, OpenStreetMap):
// rivers with their real banks, lagoons and lakes (no line-only rivers), in one blue; zoomed out a
// coarse copy, from zoom 9 the full detail. Tile by tile from 1° squares.
const WATER_V = '5';
const waterFiles = new Map();
let waterIndex = null;
const waterFile = async (key, tier) => {
  waterIndex ??= fetch(`/water/index.json?v=${WATER_V}`).then((r) => r.json()).catch(() => null);
  const have = await waterIndex;
  if (have && !(have[key] || '').includes(tier)) return [];
  const k = `${key}.${tier}`;
  if (!waterFiles.has(k)) waterFiles.set(k, fetch(`/water/${k}.json?v=${WATER_V}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return waterFiles.get(k);
};
function waterLayer(L, { sea = '#0c2f5c', shore = '#5fb3f0' } = {}) {
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const size = this.getTileSize();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const cv = document.createElement('canvas');
      cv.width = size.x * dpr; cv.height = size.y * dpr;
      const map = this._map; const z = coords.z;
      const nw = coords.scaleBy(size);
      const a = map.unproject(nw, z); const b = map.unproject(nw.add(size), z);
      const south = b.lat; const north = a.lat; const west = a.lng; const east = b.lng;
      const tiers = z <= 8 ? ['a'] : z <= 10 ? ['b'] : ['b', 'c'];
      const jobs = [];
      // Areas are filed under every square they cover; line pieces (≤ half a degree) under their first point's.
      for (let la = Math.floor(south) - 1; la <= Math.floor(north); la++) for (let lo = Math.floor(west) - 1; lo <= Math.floor(east); lo++) for (const t of tiers) jobs.push(waterFile(`${la}_${lo}`, t));
      Promise.all(jobs).then((files) => {
        const ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr);
        const px = (lat, lng) => { const p = map.project([lat, lng], z); return [p.x - nw.x, p.y - nw.y]; };
        const crosses = (flat) => {
          let s0 = Infinity; let n0 = -Infinity; let w0 = Infinity; let e0 = -Infinity;
          for (let k = 0; k < flat.length; k += 2) { const la = flat[k] / 1e5; const lo = flat[k + 1] / 1e5; if (la < s0) s0 = la; if (la > n0) n0 = la; if (lo < w0) w0 = lo; if (lo > e0) e0 = lo; }
          return !(n0 < south || s0 > north || e0 < west || w0 > east);
        };
        const trace = (flat, close) => {
          for (let k = 0; k < flat.length; k += 2) { const [x, y] = px(flat[k] / 1e5, flat[k + 1] / 1e5); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
          if (close) ctx.closePath();
        };
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        // The fishing rivers mapped only as a line (around Marshall), in the water's own blue, wider
        // closer in; drawn first, so where a river's banks are mapped its area covers the line.
        ctx.strokeStyle = sea;
        for (const items of files) {
          for (const [kind, zmin, geo] of items) {
            if (kind !== 'l' || zmin > z || !crosses(geo)) continue;
            ctx.beginPath(); trace(geo, false);
            ctx.lineWidth = Math.max(1.5, (z - 7) * 1.1);
            ctx.stroke();
          }
        }
        // The water areas (holes are islands), with no outline, as on Garmin: an area's edge isn't
        // always a shore (a river's area is closed straight across its mouth, and a river comes in
        // pieces), and the water against the land shows the banks.
        const areas = [];
        for (const items of files) for (const [kind, zmin, geo] of items) if (kind === 'a' && zmin <= z && crosses(geo[0])) areas.push(geo);
        const shape = (geo) => { ctx.beginPath(); for (const ring of geo) trace(ring, true); };
        // Each fill reaches half a pixel past its edge, closing hairline gaps between pieces that
        // don't quite touch (the coastline under them would show through).
        ctx.fillStyle = sea; ctx.strokeStyle = sea; ctx.lineWidth = 1;
        for (const geo of areas) { shape(geo); ctx.fill('evenodd'); ctx.stroke(); }
        done(null, cv);
      });
      return cv;
    },
  });
  return new Layer({ pane: 'water', minZoom: 5, maxZoom: 14, updateWhenZooming: false, keepBuffer: 2, attribution: 'Water: © OpenStreetMap contributors' });
}
// The Plotter map's relief shading (charts/tools/relief_shade.py): light and shadow from the
// seabed, so every bump, hole and edge shows between the depth lines. One picture per 1° square,
// laid over the sea under the land, the squares in view only.
const SHADE_V = '2';
let shadeIndex = null;
function reliefLayer(L, map) {
  const pane = map.getPane('relief') || map.createPane('relief');
  pane.style.zIndex = 240; // over the sea (the map's background), under the land (250)
  pane.style.pointerEvents = 'none';
  const shown = new Map();
  let on = false;
  const draw = async () => {
    if (!on) { for (const o of shown.values()) o.remove(); shown.clear(); return; }
    shadeIndex ??= fetch(`/shade/index.json?v=${SHADE_V}`).then((r) => r.json()).then((xs) => new Set(xs)).catch(() => new Set());
    const have = await shadeIndex;
    if (!on) return;
    const b = map.getBounds();
    const want = new Set();
    if (map.getZoom() >= 7) {
      for (let la = Math.floor(b.getSouth()); la <= Math.floor(b.getNorth()); la++) for (let lo = Math.floor(b.getWest()); lo <= Math.floor(b.getEast()); lo++) if (have.has(`${la}_${lo}`)) want.add(`${la}_${lo}`);
    }
    for (const [k, o] of shown) if (!want.has(k)) { o.remove(); shown.delete(k); }
    for (const k of want) {
      if (shown.has(k)) continue;
      const [la, lo] = k.split('_').map(Number);
      shown.set(k, L.imageOverlay(`/shade/${k}.png?v=${SHADE_V}`, [[la, lo], [la + 1, lo + 1]], { pane: 'relief', interactive: false, className: 'relief-img' }).addTo(map));
    }
  };
  map.on('moveend zoomend', draw);
  return { set: (v) => { on = v; draw(); } };
}
// The depth lines drawn from GEBCO's seabed map (made once: charts/tools/gebco_contours.py):
// like a plotter, more lines the closer in (200 m apart far out, 5 m in shallow water from
// zoom 12), each labelled along the line in the depth unit chosen on More. Drawn tile by tile
// from the 1° squares in view (loaded as needed, kept for no signal by the app).
const CONTOURS_V = '11'; // (bumped: the land now saved with the lines)
const LAND_V = '8';
const contourCells = new Map(); // "lat_lng" -> Promise of its lines (or [])
let contourIndex = null; // the squares there are (the rest is land, or off the chart)
const contourCell = async (key) => {
  contourIndex ??= fetch(`/contours/index.json?v=${CONTOURS_V}`).then((r) => r.json()).then((xs) => new Set(xs)).catch(() => null);
  const have = await contourIndex;
  if (have && !have.has(key)) return [];
  if (!contourCells.has(key)) contourCells.set(key, fetch(`/contours/${key}.json?v=${CONTOURS_V}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  return contourCells.get(key);
};
function contourLayer(L, { color = '#12305e', halo = 'rgba(255,255,255,0.85)' } = {}) {
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const size = this.getTileSize();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const cv = document.createElement('canvas');
      cv.width = size.x * dpr; cv.height = size.y * dpr;
      const map = this._map;
      const z = coords.z;
      const nw = coords.scaleBy(size);
      const a = map.unproject(nw, z); const b = map.unproject(nw.add(size), z);
      const pad = 0.05;
      const south = b.lat - pad; const north = a.lat + pad; const west = a.lng - pad; const east = b.lng + pad;
      const keys = [];
      // A piece is filed under the square of its first point and reaches at most about half a
      // degree from it: the squares all round too.
      for (let la = Math.floor(south) - 1; la <= Math.floor(north) + 1; la++) for (let lo = Math.floor(west) - 1; lo <= Math.floor(east) + 1; lo++) keys.push(`${la}_${lo}`);
      Promise.all(keys.map(contourCell)).then((cells) => {
        const ctx = cv.getContext('2d');
        ctx.scale(dpr, dpr);
        const px = (lat, lng) => { const p = map.project([lat, lng], z); return [p.x - nw.x, p.y - nw.y]; };
        const labels = [];
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const lines of cells) {
          for (const [m, zmin, flat] of lines) {
            // As Garmin: none further out than zoom 9; at 9 the whole picture at once (the shelf
            // every 10 m, the slope close, the deep every 100-200 m); then finer as you zoom in.
            if (zmin - 1 > z) continue;
            // Only pieces that cross this tile: by their whole extent (a long straight stretch can
            // cross a tile without a point in it).
            let s0 = Infinity; let n0 = -Infinity; let w0 = Infinity; let e0 = -Infinity;
            for (let k = 0; k < flat.length; k += 2) {
              const la = flat[k] / 1e4; const lo = flat[k + 1] / 1e4;
              if (la < s0) s0 = la; if (la > n0) n0 = la; if (lo < w0) w0 = lo; if (lo > e0) e0 = lo;
            }
            if (n0 < south || s0 > north || e0 < west || w0 > east) continue;
            // Bolder for the lines that show from further out (the main depths).
            const major = zmin <= z - 2;
            ctx.strokeStyle = color; ctx.globalAlpha = major ? 0.7 : 0.4; ctx.lineWidth = major ? 1 : 0.6;
            ctx.beginPath();
            const pts = [];
            for (let k = 0; k < flat.length; k += 2) {
              const [x, y] = px(flat[k] / 1e4, flat[k + 1] / 1e4);
              if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
              pts.push([x, y]);
            }
            ctx.stroke();
            // Labels along the line, about every 220 px of it (wherever it is, at any zoom),
            // where they're well inside this tile.
            let walked = 0; let nextAt = 160;
            for (let k = 1; k < pts.length; k++) {
              const [x0, y0] = pts[k - 1]; const [x1, y1] = pts[k];
              const seg = Math.hypot(x1 - x0, y1 - y0);
              while (seg > 0 && walked + seg >= nextAt) {
                const t = (nextAt - walked) / seg; const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t;
                if (x > 18 && y > 10 && x < size.x - 18 && y < size.y - 10) labels.push({ m, x, y, ang: Math.atan2(y1 - y0, x1 - x0) });
                nextAt += 340;
              }
              walked += seg;
            }
          }
        }
        ctx.globalAlpha = 1;
        ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const placed = [];
        for (const l of labels) {
          if (placed.some((p) => Math.hypot(p.x - l.x, p.y - l.y) < 46)) continue; // not crowded
          placed.push(l);
          let ang = l.ang; if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI; // never upside down
          const text = String(Math.round(toUnit('depth', l.m)));
          ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(ang);
          ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(text, 0, 0);
          ctx.fillStyle = color; ctx.fillText(text, 0, 0);
          ctx.restore();
        }
        done(null, cv);
      });
      return cv;
    },
  });
  return new Layer({ minZoom: 9, maxZoom: 14, updateWhenZooming: false, keepBuffer: 3, className: 'gebco-lines', attribution: 'Depths: GEBCO' });
}
// The depth charts as one map layer: map tiles (sharp at every zoom, only the
// part in view is loaded) or, for an older chart, one picture.
// With { clean }: the charts' dark see-through shading over the water taken out, the contour
// lines and depths drawn light for the satellite's dark sea (made once, charts/tools/clean_pack.py).
const depthLayer = (L, charts, { clean = false } = {}) => L.layerGroup(charts.map((c) => {
  const bounds = [[c.bounds.south, c.bounds.west], [c.bounds.north, c.bounds.east]];
  // keepBuffer: the tiles just outside the screen are kept, so a pan doesn't show gaps.
  const opts = { bounds, minZoom: 8, minNativeZoom: c.minZoom, maxNativeZoom: c.maxZoom, opacity: 0.95, className: 'depth-tiles', keepBuffer: 4, updateWhenZooming: false };
  if (!c.tiles) return L.imageOverlay(c.url, bounds, { opacity: 0.95 });
  // From zoom 8, where the lines can be read; further out they'd only show as dark patches.
  // The clean tiles made once on the server; drawn here only for a chart without them.
  if (clean) return c.cleanTiles ? L.tileLayer(c.cleanTiles, opts) : new (cleanTiles(L))(c.tiles, opts);
  return L.tileLayer(c.tiles, opts);
}));
// Tiles redrawn without the shading: it's black at about 43% (alpha 100 to 114); the lines and
// numbers are stronger, so they stay (made a little bolder).
let CleanTiles = null;
function cleanTiles(L) {
  CleanTiles ??= L.TileLayer.extend({
    createTile(coords, done) {
      const cv = document.createElement('canvas');
      const img = new Image();
      img.onload = () => {
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        try {
          const d = ctx.getImageData(0, 0, cv.width, cv.height);
          const px = d.data;
          for (let i = 3; i < px.length; i += 4) { const a = px[i]; px[i] = a <= 114 ? 0 : Math.min(255, (a - 108) * 3.2); }
          ctx.putImageData(d, 0, 0);
        } catch { /* left as it is */ }
        done(null, cv);
      };
      img.onerror = (e) => done(e, cv);
      img.src = this.getTileUrl(coords);
      return cv;
    },
  });
  return CleanTiles;
}

async function drawSpotMaps(root) {
  const boxes = [...root.querySelectorAll('.spot-map-view:not(.leaflet-container)')];
  if (!boxes.length) return;
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    for (const box of boxes) box.outerHTML = '<p class="small muted">The map couldn\'t load just now.</p>';
    return;
  }
  for (const box of boxes) {
    const at = [Number(box.dataset.lat), Number(box.dataset.lng)];
    const map = L.map(box, { scrollWheelZoom: false }).setView(at, 11);
    addSatellite(L, map);
    L.circleMarker(at, spotPin(L, box.dataset.released === 'true')).addTo(map);
  }
}

// A post's media: its video (with the first photo as the still before it plays)
// and its photos; more than one swipes sideways.
function mediaHtml(item, alt = '') {
  const photos = item.photos ?? (item.photoUrl ? [{ url: item.photoUrl }] : []);
  const slides = [
    ...photos.map((x) => html`<img class="catch-photo" src="${x.url}" alt="${alt}" loading="lazy">`),
    // A video only reaches officers and the boat's crew; it goes after the photos.
    ...(item.videoUrl ? [html`<video class="catch-photo" src="${item.videoUrl}" controls playsinline preload="metadata"></video>`] : []),
  ];
  if (slides.length < 2) return slides[0] ?? '';
  return html`<div class="gallery-wrap"><div class="gallery">${slides.map((x) => raw(x))}</div>
    <span class="gallery-count">${raw(icon('camera'))} ${slides.length}</span></div>`;
}

// An empty page or list: a picture, a line, and the next step if there is one.
function emptyState(iconName, text, action = null) {
  return html`<div class="card empty-state"><span class="es-icon">${raw(icon(iconName))}</span><p>${text}</p>
    ${action ? raw(html`<a class="btn primary" href="${action[0]}">${action[1]}</a>`) : ''}</div>`;
}

// Club roles and how they read.
const ROLE_OPTIONS = [['', 'Member'], ['president', 'President'], ['vice_president', 'Vice President'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']];
const roleLabel = (role) => ROLE_OPTIONS.find(([k]) => k === role)?.[1] || role;

// A photo field that shows the photo already saved (a plain file box always
// says "No file chosen"), and the new one as soon as it's picked.
const photoField = (label, current) => html`<div class="photo-field"><span class="spot-head">${label}</span>
  <div class="photo-field-row">
    <img class="photo-field-img" src="${current || ''}" alt="" ${current ? '' : 'hidden'}>
    <label class="btn">${raw(icon('camera'))} <span>${current ? 'Change photo' : 'Add a photo'}</span>
      <input name="photo" type="file" accept="image/*" hidden></label>
  </div></div>`;
document.addEventListener('change', (e) => {
  const input = e.target.closest('.photo-field input[type=file]');
  const file = input?.files?.[0];
  if (!file) return;
  const img = input.closest('.photo-field').querySelector('img');
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  input.closest('label').querySelector('span').textContent = 'Change photo';
});

// The registration record, one entry per fish: where it stands now, and
// everything that happened to it, in order.
const LOG_ACTIONS = {
  registered: 'Registered', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
  repointed: 'Corrected', uncounted: 'Taken off the points',
};
const LOG_STATUS = {
  registered: 'Waiting', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
  repointed: 'Approved', uncounted: 'Not counted',
};
function logItems(fish) {
  if (!fish.length) return '<li class="muted">Nothing recorded yet.</li>';
  return fish.map((f) => html`<li class="log-entry">
    <div><span class="badge log-${f.status}">${LOG_STATUS[f.status]}</span> <b>${f.species}</b>
      ${f.weightKg ? ` · ${fmtWeight(f.weightKg)}` : f.released ? ' · released' : ''}${f.points != null ? ` · ${fmtPoints(f.points)}` : ''}</div>
    <div class="small muted">${f.boat || 'Boat removed'} · ${f.angler}${f.station ? ` · ${f.station}` : ''} · caught ${fmtDay(f.caughtOn)}</div>
    <ol class="log-steps">${f.steps.map((e) => raw(html`<li>
      <span class="small"><b>${LOG_ACTIONS[e.action]}</b> by ${e.userName}, ${fmtWhen(e.createdAt)}${e.lat != null ? raw(html` · <a href="https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=15/${e.lat}/${e.lng}" target="_blank" rel="noopener">where the phone was</a>`) : ''}</span>
      ${e.note ? raw(html`<div class="small log-note">${e.note}</div>`) : ''}
    </li>`))}</ol>
    <div class="small">${f.scalePhotoUrl ? raw(html`<a href="${f.scalePhotoUrl}" target="_blank" rel="noopener">Scale photo</a>`) : ''}${f.scaleVideoUrl ? raw(html` · <a href="${f.scaleVideoUrl}" target="_blank" rel="noopener">Scale video</a>`) : ''}
      ${!['withdrawn', 'deleted'].includes(f.status) ? raw(html`${f.scalePhotoUrl ? ' · ' : ''}<a href="#/catch/${f.catchId}">The fish</a>`) : ''}</div>
  </li>`).join('');
}

// The anglers on a boat for a tournament: crew to tick, guests by name, and
// whether each is a JHMMC member (non-members pay a temporary membership).
function anglerEditor(crew, anglers, official = false, named = []) {
  const on = (m) => anglers.find((a) => a.userId === m.id);
  const onPerson = (p) => anglers.find((a) => a.personId === p.id);
  const guests = anglers.filter((a) => !a.userId && !a.personId);
  const guestRow = (g = { name: '', member: false }) => html`<div class="guest-row">
    <input name="guestName" maxlength="80" placeholder="Guest's name" value="${g.name}" aria-label="Guest's name">
    ${official ? raw(html`<label class="check"><input type="checkbox" name="guestMember" ${g.member ? 'checked' : ''}> Member</label>`)
      : raw(html`<span class="badge ${g.member ? 'new' : 'guest'}">${g.member ? 'Member' : 'Non-member'}</span>`)}
    <button type="button" class="link danger" data-act="drop-guest">Remove</button></div>`;
  return html`<div class="crew-pick">${crew.length ? crew.map((m) => raw(html`<div class="crew-row" data-user="${m.id}">
      <label class="check"><input type="checkbox" name="fishing" ${on(m) ? 'checked' : ''}> ${m.name}</label>
      <span class="badge ${m.member ? 'new' : 'guest'}">${m.member ? 'Paid member' : 'Not a paid member'}</span>
    </div>`)) : raw('<p class="small muted">No crew with accounts yet: add the anglers as guests.</p>')}
    ${named.map((p) => raw(html`<div class="crew-row" data-person="${p.id}">
      <label class="check"><input type="checkbox" name="fishing" ${onPerson(p) ? 'checked' : ''}> ${p.name} <span class="muted small">(no account)</span></label>
      <span class="badge ${p.member ? 'new' : 'guest'}">${p.member ? 'Paid member' : 'Not a paid member'}</span>
    </div>`))}</div>
    <div class="guests">${guests.map((g) => raw(guestRow(g)))}</div>
    <div><button type="button" data-act="add-guest">+ Add a guest</button></div>
    <template class="guest-template">${raw(guestRow())}</template>`;
}
function wireAnglerEditor(form) {
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-act=add-guest]')) {
      form.querySelector('.guests').append(form.querySelector('.guest-template').content.cloneNode(true));
      form.querySelector('.guests .guest-row:last-child input').focus();
    } else if (e.target.closest('[data-act=drop-guest]')) {
      e.target.closest('.guest-row').remove();
    }
  });
}
function readAnglerEditor(form) {
  const crew = [...form.querySelectorAll('.crew-row')].filter((r) => r.querySelector('[name=fishing]').checked)
    .map((r) => (r.dataset.person ? { personId: Number(r.dataset.person) } : { userId: Number(r.dataset.user) }));
  const guests = [...form.querySelectorAll('.guests .guest-row')].map((r) => ({
    name: r.querySelector('[name=guestName]').value.trim(), member: !!r.querySelector('[name=guestMember]')?.checked,
  })).filter((g) => g.name);
  return [...crew, ...guests];
}

// ---- sea conditions -----------------------------------------------------------
// Forecast places off the Liberian coast, or wherever the phone is. The server asks the
// forecast (rounded to about 11 km) so the exact spot stays on the phone.
const SEA_PLACES = [
  { key: 'monrovia', name: 'Off Monrovia', lat: 6.2, lng: -10.95 },
  { key: 'robertsport', name: 'Off Robertsport', lat: 6.7, lng: -11.5 },
  { key: 'buchanan', name: 'Off Buchanan', lat: 5.8, lng: -10.1 },
  { key: 'harper', name: 'Off Harper', lat: 4.3, lng: -7.8 },
  { key: 'here', name: 'Where I am' },
];
const SEA_KEY = 'sea-place';
const SEA_RECENT = 'sea-recent';
// The place chosen last: one of the list, or one found by search (kept with its position).
// Before a place is chosen on this phone: off the main port of the member's country (Liberia
// and anywhere inland: off Monrovia).
const COUNTRY_SEA = {
  'Sierra Leone': ['Off Freetown', 8.45, -13.35], Guinea: ['Off Conakry', 9.45, -13.85], 'Guinea-Bissau': ['Off Bissau', 11.75, -15.8],
  "Côte d'Ivoire": ['Off Abidjan', 5.2, -4.0], Ghana: ['Off Accra', 5.45, -0.15], Togo: ['Off Lomé', 6.05, 1.25], Benin: ['Off Cotonou', 6.25, 2.4],
  Nigeria: ['Off Lagos', 6.3, 3.35], Cameroon: ['Off Limbe', 3.9, 9.15], 'Equatorial Guinea': ['Off Malabo', 3.85, 8.7], Gabon: ['Off Libreville', 0.4, 9.3],
  'São Tomé and Príncipe': ['Off São Tomé', 0.35, 6.8], Senegal: ['Off Dakar', 14.6, -17.55], 'The Gambia': ['Off Banjul', 13.5, -16.7],
  Mauritania: ['Off Nouakchott', 18.1, -16.1], 'Cabo Verde': ['Off Praia', 14.85, -23.5],
};
function seaPlace() {
  const start = () => {
    const c = COUNTRY_SEA[state.me?.country];
    return c ? { key: `country-${state.me.country}`, name: c[0], lat: c[1], lng: c[2] } : SEA_PLACES[0];
  };
  try {
    const v = localStorage.getItem(SEA_KEY);
    if (v?.startsWith('{')) { const p = JSON.parse(v); if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) return p; }
    return SEA_PLACES.find((p) => p.key === v) || start();
  } catch { return start(); }
}
const seaRecent = () => { try { return JSON.parse(localStorage.getItem(SEA_RECENT) || '[]').filter((p) => Number.isFinite(p.lat)); } catch { return []; } };
function setSeaPlace(p) {
  try {
    if (p.lat == null) { localStorage.setItem(SEA_KEY, p.key); return; }
    localStorage.setItem(SEA_KEY, JSON.stringify(p));
    // Searched places are remembered (the last six).
    if (p.key.startsWith('q:')) localStorage.setItem(SEA_RECENT, JSON.stringify([p, ...seaRecent().filter((x) => x.key !== p.key)].slice(0, 6)));
  } catch { /* chosen for now only */ }
}
const SEA_RATING = { good: 'Good day to fish', fair: 'Fair', rough: 'Rough' };
async function seaFor(place) {
  let { lat, lng } = place;
  if (place.key === 'here') {
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: false, maximumAge: 600000, timeout: 15000 }));
    ({ latitude: lat, longitude: lng } = pos.coords);
  }
  return api(`/sea?lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`);
}
const wavesTxt = (m) => (m == null ? '' : `${Number(toUnit('depth', m)).toFixed(1)} ${unit('depth')}`);
const tempTxt = (c) => (c == null ? '' : `${Number(toUnit('temp', c)).toFixed(1)}${unit('temp')}`);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const depthTxt = (m) => `${Math.round(toUnit('depth', m))} ${unit('depth')}`;
// Depths (the seabed map's, approximate) in bands wide enough that a few hundred metres either way doesn't matter.
function depthBands(depthsM) {
  const ft = unit('depth') === 'ft';
  const edges = ft ? [300, 600, 1000, 2000] : [100, 200, 300, 600];
  const inUnit = (m) => toUnit('depth', m);
  const names = [`under ${edges[0]}`, ...edges.slice(0, -1).map((e, i) => `${e} – ${edges[i + 1]}`), `over ${edges.at(-1)}`].map((n) => `${n} ${unit('depth')}`);
  const counts = names.map(() => 0);
  for (const m of depthsM) { const v = inUnit(m); const i = edges.findIndex((e) => v < e); counts[i < 0 ? edges.length : i] += 1; }
  return names.map((name, i) => ({ name, fish: counts[i] })).filter((r) => r.fish);
}
// The line under the GPS on Log fish (and saved with each fish): the sea right now, and the depth.
// The depth (the seabed map) and water temperature (the ocean model) are estimates: marked ~.
const estTxt = (t) => `~${t}`;
const seaLine = (n, moonLit, depthM) => html`<span>${raw(icon('wave'))} ${[depthM != null && `depth ${estTxt(depthTxt(depthM))}`, n.windKn != null && `${n.windDir || ''} ${n.windKn} kn`, n.waveM != null && `waves ${wavesTxt(n.waveM)}`,
  n.waterC != null && `water ${estTxt(tempTxt(n.waterC))}`, n.tide && `tide ${n.tide}`, moonLit != null && `moon ${moonLit}%`].filter(Boolean).join(' · ')}</span>`;

// ---- the currents map --------------------------------------------------------
// A grid (south-west corner, step in degrees, nx by ny) with u and v (knots, east and north)
// and water temperature; null on land. Values between grid points are blended (bilinear).
function sampler(g, f) {
  return (lat, lng, key) => {
    if (!f[key]) return null; // a layer this grid doesn't have (the wind, if it couldn't be fetched)
    const x = (lng - g.west) / g.step;
    const y = (lat - g.south) / g.step;
    const i = Math.floor(x); const j = Math.floor(y);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
    const fx = x - i; const fy = y - j;
    // Blend the corners that have water (so the colours and lines reach the coast).
    const corners = [[f[key][j * g.nx + i], (1 - fx) * (1 - fy)], [f[key][j * g.nx + i + 1], fx * (1 - fy)],
      [f[key][(j + 1) * g.nx + i], (1 - fx) * fy], [f[key][(j + 1) * g.nx + i + 1], fx * fy]];
    let s = 0; let w = 0;
    for (const [val, wt] of corners) if (val != null) { s += val * wt; w += wt; }
    return w > 0 ? s / w : null;
  };
}
const compassName = (deg) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
// Colour scales fixed for this coast (the same colour is the same value every day, so it can
// be learnt), each spending its colours where it matters to a fisherman.
// Water temperature off West Africa: about 24 °C in the cool season's upwelling to 31 °C;
// a step every half degree from 26 (where nearly all of it is most of the year), so a break
// of half a degree shows as a change of colour. Cool blue through green and yellow to red.
const SST_SCALE = [[24, [40, 60, 150]], [25, [40, 110, 190]], [26, [40, 160, 190]], [26.5, [50, 180, 160]], [27, [70, 190, 120]],
  [27.5, [120, 200, 80]], [28, [180, 210, 60]], [28.5, [230, 210, 55]], [29, [245, 180, 50]], [29.5, [245, 145, 45]],
  [30, [235, 105, 45]], [30.5, [215, 65, 50]], [31, [175, 40, 70]]];
// Wind and waves in the bands Sea conditions rates by: blue to green while it's good (wind
// under 12 kn, waves under 1.5 m), yellow to orange when fair, red from rough (wind 18 kn,
// waves 2.2 m), purple when it's dangerous.
const WIND_SCALE = [[0, [55, 70, 150]], [5, [45, 125, 195]], [9, [50, 170, 170]], [12, [130, 195, 75]], [15, [235, 205, 60]],
  [18, [240, 130, 45]], [22, [215, 55, 50]], [28, [160, 40, 110]], [35, [110, 40, 140]]];
const WAVE_SCALE = [[0, [55, 70, 150]], [0.5, [45, 125, 195]], [1, [50, 170, 170]], [1.5, [130, 195, 75]], [1.8, [235, 205, 60]],
  [2.2, [240, 130, 45]], [3, [215, 55, 50]], [4, [160, 40, 110]], [6, [110, 40, 140]]];
// What the wind and waves mean for a day out, as Sea conditions says it.
const windWord = (kn) => (kn < 12 ? 'good' : kn < 18 ? 'fair' : 'rough');
const waveWord = (m) => (m < 1.5 ? 'good' : m < 2.2 ? 'fair' : 'rough');
// Water colour (chlorophyll, mg/m³): deep blue for clear ocean water, through blue-green to
// green where plankton (and bait) are rich, and brown-green in coastal water.
const CHL_SCALE = [[0.03, [25, 35, 115]], [0.07, [35, 75, 175]], [0.12, [40, 120, 205]], [0.2, [40, 160, 190]], [0.35, [45, 170, 140]],
  [0.6, [70, 175, 90]], [1, [135, 185, 60]], [2, [195, 180, 55]], [5, [170, 120, 40]], [10, [120, 80, 30]]];
const chlWords = (v) => (v < 0.15 ? 'blue' : v < 0.35 ? 'blue-green' : v < 1 ? 'green' : 'brown-green');
// Each colour layer's value at a spot, from a frame's sampler.
const FIELD_VALUE = {
  sst: (at, lat, lng) => at(lat, lng, 'sst'),
  speed: (at, lat, lng) => { const u = at(lat, lng, 'u'); const v = at(lat, lng, 'v'); return u == null || v == null ? null : Math.hypot(u, v); },
  wind: (at, lat, lng) => { const u = at(lat, lng, 'wu'); const v = at(lat, lng, 'wv'); return u == null || v == null ? null : Math.hypot(u, v); },
  wave: (at, lat, lng) => at(lat, lng, 'wh'),
  chl: (at, lat, lng) => at(lat, lng, 'chl'),
};
// The current, scaled to the water here (Copernicus off West Africa: half the sea under
// 0.4 kn, 90% under 0.8, hardly any over 1.3): a step every 0.1 kn where most of it is, so
// slack and moving water stand apart, each step about as much of the sea. Darker is slower:
// deep blue slack water, through cyan and green to yellow, orange and red for the strongest.
const SPEED_SCALE = [[0, [45, 40, 120]], [0.1, [50, 70, 170]], [0.2, [45, 120, 200]], [0.3, [40, 165, 195]], [0.4, [55, 185, 140]],
  [0.6, [125, 200, 75]], [0.8, [230, 210, 60]], [1, [245, 150, 45]], [1.3, [225, 70, 50]], [1.6, [165, 35, 105]]];
function colourAt(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    if (v <= stops[k][0]) {
      const [v0, c0] = stops[k - 1]; const [v1, c1] = stops[k];
      const t = (v - v0) / (v1 - v0);
      return c0.map((c, n) => Math.round(c + (c1[n] - c) * t));
    }
  }
  return stops.at(-1)[1];
}
// The coastline (Natural Earth land, simplified to about 400 m): drawn as a mask so the colours
// and lines stop at the shore. `land` is a list of rings of [lat, lng]; toXY maps a point to pixels.
function fillLand(ctx, land, toXY) {
  ctx.beginPath();
  for (const ring of land || []) ring.forEach(([lat, lng], k) => { const [x, y] = toXY(lat, lng); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.fill();
}
// A picture laid over the grid's area, pixel for pixel where the map puts it: columns evenly
// spaced in longitude, rows evenly spaced as the map draws latitude (Web Mercator), each pixel
// sampled at its centre. toXY places a point on the picture (for the coastline cut).
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercLat = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
function raster(g, S) {
  const north = g.south + (g.ny - 1) * g.step; const east = g.west + (g.nx - 1) * g.step;
  const w = (g.nx - 1) * S; const h = (g.ny - 1) * S;
  const yN = mercY(north); const yS = mercY(g.south);
  return {
    w, h, bounds: [[g.south, g.west], [north, east]],
    lngAt: (px) => g.west + ((px + 0.5) / w) * (east - g.west),
    latAt: (py) => mercLat(yN - ((py + 0.5) / h) * (yN - yS)),
    toXY: (lat, lng) => [((lng - g.west) / (east - g.west)) * w, ((yN - mercY(lat)) / (yN - yS)) * h],
  };
}
// The colour layer for one hour as a canvas: smoothed between grid points, cut at the coast.
function fieldCanvas(g, f, kind, stops, land, S = 12) {
  const at = sampler(g, f);
  const R = raster(g, S); // 12 pixels per grid step (forecast): a sharp coast when zoomed in
  const cv = document.createElement('canvas');
  cv.width = R.w; cv.height = R.h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(R.w, R.h);
  const lngs = Array.from({ length: R.w }, (_, px) => R.lngAt(px));
  for (let py = 0; py < R.h; py++) {
    const lat = R.latAt(py);
    for (let px = 0; px < R.w; px++) {
      const v = FIELD_VALUE[kind](at, lat, lngs[px]);
      if (v == null) continue;
      const [r, gg, b] = colourAt(stops, v);
      const k = (py * R.w + px) * 4;
      // Faded over the last grid step and a half at the forecast's edges, so the area it
      // covers blends into the map rather than ending in a hard box.
      const edge = Math.min(px, R.w - 1 - px, py, R.h - 1 - py) / (1.5 * S);
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = edge >= 1 ? 235 : Math.round(235 * edge * edge * (3 - 2 * edge));
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  fillLand(ctx, land, R.toXY);
  return cv;
}
// The fishing chart: at each grid point, how promising the water looks, from what offshore
// fishermen look for: a temperature break (warm and cool water meeting), the edge of a current
// or an eddy (fast water by slow, or turning), the shelf break, and water at the temperature
// (and depth) billfish have been landed in this season, every boat's fish together. Each is
// 0 to 1; breaks and edges are ranked against the rest of the map that day, so the best of
// the day always shows. f.fish is the score; f.why the reasons (1 break, 2 edge, 4 shelf, 8 water).
const EDGE_MEMO = new WeakMap(); // a satellite grid -> its edges on each forecast grid
function fishingField(g, prefs = {}, chl = null, sat = null) {
  const { nx, ny } = g;
  const depth = g.depth || null;
  // Fishable water: 80 m deep or more (with depths to go by). Edges are measured only between
  // such points, so the coast itself (land, shallows, river mouths next to the sea) never looks
  // like a temperature break or a current edge; nearer shore there are no hotspots.
  const fishable = (k) => !depth || (depth[k] != null && depth[k] >= 80);
  // The water colour's edges (green water meeting blue) at each forecast point: the change of
  // its logarithm to the next points (it doesn't change with the hour here: a week's views).
  // (The colour's and the satellites' edges don't change with the hour: worked out once for
  // each grid, then kept.)
  const gridKey = `${g.south},${g.west},${g.step},${nx},${ny}`;
  const memo = (src, name, make) => {
    if (!src) return make();
    if (!EDGE_MEMO.has(src)) EDGE_MEMO.set(src, new Map());
    const m = EDGE_MEMO.get(src); const k = `${name}|${gridKey}|${depth ? 1 : 0}`;
    if (!m.has(k)) m.set(k, make());
    return m.get(k);
  };
  let colourEdge = null;
  if (chl?.values) colourEdge = memo(chl, 'colour', () => {
    const at = sampler(chl, { chl: chl.values });
    const lg = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = fishable(j * nx + i) ? at(g.south + j * g.step, g.west + i * g.step, 'chl') : null; lg.push(v > 0 ? Math.log10(v) : null); }
    const get = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : lg[j * nx + i]);
    const raw0 = lg.map((v, k) => {
      if (v == null) return null;
      const i = k % nx; const j = Math.floor(k / nx);
      const d = [get(i + 1, j), get(i - 1, j), get(i, j + 1), get(i, j - 1)].filter((x) => x != null).map((x) => Math.abs(x - v));
      return d.length ? Math.max(...d) : null;
    });
    return raw0;
  });
  // The temperature breaks measured by satellite (about 3 km), when there are: at each
  // forecast point, the sharpest change over 2 satellite steps (about 6 km) within its square.
  // Much finer than the forecast's own temperature, which smooths a narrow break away.
  let satBreak = null;
  let satT = null; // and its temperature at each forecast point
  if (sat?.values) ({ satBreak, satT } = memo(sat, 'sat', () => {
    let satBreak = null; let satT = null;
    const sv = sat.values; const sx = sat.nx; const sy = sat.ny;
    const sg = new Float32Array(sx * sy).fill(NaN);
    for (let j = 0; j < sy; j++) {
      for (let i = 0; i < sx; i++) {
        const c = sv[j * sx + i]; if (c == null) continue;
        let m = NaN;
        for (const [a, b] of [[i + 2, j], [i, j + 2], [i - 2, j], [i, j - 2]]) {
          if (a < 0 || b < 0 || a >= sx || b >= sy) continue;
          const o = sv[b * sx + a];
          if (o != null) m = Number.isNaN(m) ? Math.abs(o - c) : Math.max(m, Math.abs(o - c));
        }
        sg[j * sx + i] = m;
      }
    }
    const half = g.step / 2;
    const sAt = sampler(sat, { sst: sv });
    satT = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) satT.push(sAt(g.south + j * g.step, g.west + i * g.step, 'sst'));
    satBreak = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!fishable(j * nx + i)) { satBreak.push(null); continue; }
        const lat = g.south + j * g.step; const lng = g.west + i * g.step;
        const i0 = Math.max(0, Math.ceil((lng - half - sat.west) / sat.step)); const i1 = Math.min(sx - 1, Math.floor((lng + half - sat.west) / sat.step));
        const j0 = Math.max(0, Math.ceil((lat - half - sat.south) / sat.step)); const j1 = Math.min(sy - 1, Math.floor((lat + half - sat.south) / sat.step));
        let m = null;
        for (let b = j0; b <= j1; b++) for (let a = i0; a <= i1; a++) { const x = sg[b * sx + a]; if (!Number.isNaN(x) && (m == null || x > m)) m = x; }
        satBreak.push(m);
      }
    }
    return { satBreak, satT };
  }));
  const rank = (vals) => {
    const xs = vals.filter((v) => v != null).sort((a, b) => a - b);
    return (v) => {
      if (v == null || !xs.length) return 0;
      let lo = 0; let hi = xs.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; }
      return lo / xs.length;
    };
  };
  const shelf = (d) => {
    if (d == null) return 0;
    if (prefs.depth) { const { lo, hi } = prefs.depth; const pad = Math.max(50, (hi - lo) * 0.5); return d >= lo && d <= hi ? 1 : Math.max(0, 1 - Math.min(Math.abs(d - lo), Math.abs(d - hi)) / pad); }
    // No catches to go by yet: the shelf break and its slope (about 100 to 1,200 m) first, then blue water.
    if (d < 40) return 0;
    if (d < 100) return (d - 40) / 60;
    if (d <= 1200) return 1;
    return Math.max(0.35, 1 - (d - 1200) / 2500);
  };
  const warm = (t) => {
    if (t == null || !prefs.water) return 0.5;
    const { lo, hi } = prefs.water;
    return t >= lo && t <= hi ? 1 : Math.max(0, 1 - Math.min(Math.abs(t - lo), Math.abs(t - hi)));
  };
  for (const f of g.frames) {
    if (f.fish) continue;
    const at = (key, i, j) => (i < 0 || j < 0 || i >= nx || j >= ny || !fishable(j * nx + i) ? null : f[key][j * nx + i]);
    const grad = (val, i, j) => {
      const c = val(i, j); if (c == null) return null;
      const dx = [val(i + 1, j), val(i - 1, j)].filter((v) => v != null).map((v) => Math.abs(v - c));
      const dy = [val(i, j + 1), val(i, j - 1)].filter((v) => v != null).map((v) => Math.abs(v - c));
      if (!dx.length && !dy.length) return null;
      return Math.hypot(dx.length ? Math.max(...dx) : 0, dy.length ? Math.max(...dy) : 0);
    };
    const speed = (i, j) => { const u = at('u', i, j); const v = at('v', i, j); return u == null || v == null ? null : Math.hypot(u, v); };
    const tb = []; const ce = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        tb.push(satBreak ? satBreak[j * nx + i] : grad((a, b) => at('sst', a, b), i, j));
        // The edge: the change in speed, plus the turning (an eddy's spin).
        const sp = grad(speed, i, j);
        const dv = (at('v', i + 1, j) ?? at('v', i, j)) - (at('v', i - 1, j) ?? at('v', i, j));
        const du = (at('u', i, j + 1) ?? at('u', i, j)) - (at('u', i, j - 1) ?? at('u', i, j));
        ce.push(sp == null || Number.isNaN(dv - du) ? null : sp + Math.abs(dv - du) / 2);
      }
    }
    const rt = rank(tb); const rc = rank(ce); const rg = colourEdge && rank(colourEdge);
    // The edges' own sizes (not ranked), to say plainly how strong a spot is: the temperature
    // break in °C (over about 6 km by satellite, else a grid step), the current edge in knots,
    // the colour edge as log10 of how many times greener.
    f.tb = satBreak ? tb : null; f.ce = ce; f.ge = colourEdge;
    f.fish = []; f.why = [];
    for (let k = 0; k < nx * ny; k++) {
      if ((f.sst[k] == null && f.u[k] == null) || !fishable(k)) { f.fish.push(null); f.why.push(0); continue; }
      const b = rt(tb[k]) ** 2; const e = rc(ce[k]) ** 2; const sh = depth ? shelf(depth[k]) : 0.5; const w = warm(satT?.[k] ?? f.sst[k]);
      // With the water colour, its edges count too (green water meeting blue: bait).
      const ge = rg && colourEdge[k] != null ? rg(colourEdge[k]) ** 2 : null;
      // An edge makes a spot: a temperature break, a current edge or a colour edge. The shelf
      // and the water billfish like only raise it; on their own they never make a hotspot.
      // The water colour only supports (like the shelf): it's each spot's newest clear view of
      // the last week, so it can be days old under cloud; never a spot on its own.
      const edge = 0.55 * b + 0.45 * e;
      const score = edge * (0.65 + 0.35 * sh) * (0.85 + 0.15 * w) * (ge == null ? 1 : 0.9 + 0.1 * ge);
      f.fish.push(Math.round(score * 100) / 100);
      f.why.push((b > 0.8 ? 1 : 0) | (e > 0.8 ? 2 : 0) | (depth && sh > 0.8 ? 4 : 0) | (prefs.water && w > 0.9 ? 8 : 0) | (ge != null && ge > 0.8 ? 16 : 0));
    }
    // Peaks, not bands: a spot keeps its score only where it's among the strongest around it
    // (within about 60 km, whatever the grid); a long even front along the shelf is otherwise
    // one band, and what matters is where along it the edge is sharpest.
    const raw0 = f.fish.slice();
    const R = Math.max(2, Math.round(0.6 / g.step)); // about 60 km, whatever the grid
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (raw0[k] == null) continue;
        let top = 0;
        for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
          const ii = i + di; const jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && raw0[jj * nx + ii] != null) top = Math.max(top, raw0[jj * nx + ii]);
        }
        if (raw0[k] < 0.98 * top) f.fish[k] = Math.round(raw0[k] * 0.6 * 100) / 100;
      }
    }
  }
}
// Whether a spot's edges really stand out, by their own size (set from the water here: about
// the top 1% of the sea on a normal day): a temperature break of 0.5 °C over 6 km, a current
// edge of 0.4 kn; water 2x greener only adds. Each found is [kind, size, strong?]. As many
// spots as stand out are shown, no more and no fewer.
const EDGE_MARK = { tb: 0.5, ce: 0.4, ge: Math.log10(2) };
function standout(f, k) {
  const out = [];
  if (f.tb?.[k] >= EDGE_MARK.tb) out.push(['tb', f.tb[k], f.tb[k] >= 2 * EDGE_MARK.tb]);
  if (f.ce?.[k] >= EDGE_MARK.ce) out.push(['ce', f.ce[k], f.ce[k] >= 1.6 * EDGE_MARK.ce]);
  // The colour (can be days old) only adds to a spot that stands out already.
  if (out.length && f.ge?.[k] >= EDGE_MARK.ge) out.push(['ge', f.ge[k], false]);
  return out;
}
// The best few spots that hour: the hotspot peaks that really stand out, strongest first, at
// least ~20 km apart. [{ lat, lng, k, edges }]
function topSpots(g, f, n = Infinity) {
  const lim = hotspotLimit(f);
  const xs = [];
  f.fish.forEach((v, k) => { if (v != null && v >= lim) { const e = standout(f, k); if (e.length) xs.push([v + e.length * 0.05, k, e]); } });
  xs.sort((a, b) => b[0] - a[0]);
  const out = [];
  for (const [, k, edges] of xs) {
    const lat = g.south + Math.floor(k / g.nx) * g.step; const lng = g.west + (k % g.nx) * g.step;
    if (out.some((o) => Math.hypot(o.lat - lat, o.lng - lng) < 0.18)) continue;
    out.push({ lat, lng, k, edges });
    if (out.length >= n) break;
  }
  return out;
}
// The fishing chart's hotspots: the most promising water (the top 8% of the fishable sea that
// hour, and never below a fair score) as patches with a bright outline, so the chart underneath stays
// readable. Cut at the coast like the other layers.
function hotspotLimit(f) {
  if (f.fish?.lim != null) return f.fish.lim; // set when only some patches are kept
  const xs = (f.fish || []).filter((v) => v != null).sort((a, b) => a - b);
  return xs.length ? Math.max(0.4, xs[Math.floor(xs.length * 0.92)]) : Infinity;
}
// The patches' fill, a light see-through pink (the outline is drawn as lines, sharp at any zoom).
function hotspotCanvas(g, f, land) {
  const at = sampler(g, f);
  const lim = hotspotLimit(f);
  const R = raster(g, 8);
  const cv = document.createElement('canvas');
  cv.width = R.w; cv.height = R.h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(R.w, R.h);
  const lngs = Array.from({ length: R.w }, (_, px) => R.lngAt(px));
  for (let py = 0; py < R.h; py++) {
    const lat = R.latAt(py);
    for (let px = 0; px < R.w; px++) {
      const v = at(lat, lngs[px], 'fish');
      if (v == null || v < lim) continue;
      img.data.set([255, 64, 129, 75], (py * R.w + px) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  fillLand(ctx, land, R.toXY);
  return cv;
}
// Lines where a value crosses a level (marching squares), traced on a grid k times finer than
// the forecast's, as short line pieces; none over land. For the hotspots' outlines and the
// temperature lines.
function levelLines(g, f, key, level, land, k = 4, onLand = landTest(land)) {
  const at = sampler(g, f);
  const step = g.step / k;
  const nx = (g.nx - 1) * k + 1; const ny = (g.ny - 1) * k + 1;
  const val = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = at(g.south + j * step, g.west + i * step, key); val[j * nx + i] = v == null ? NaN : v - level; }
  const segs = [];
  const cross = (i0, j0, i1, j1) => { const a = val[j0 * nx + i0]; const b = val[j1 * nx + i1]; const t = a / (a - b); return [g.south + (j0 + (j1 - j0) * t) * step, g.west + (i0 + (i1 - i0) * t) * step]; };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const c = [val[j * nx + i], val[j * nx + i + 1], val[(j + 1) * nx + i + 1], val[(j + 1) * nx + i]]; // SW SE NE NW
      if (c.some((v) => Number.isNaN(v))) continue;
      const edges = [];
      if ((c[0] >= 0) !== (c[1] >= 0)) edges.push(cross(i, j, i + 1, j));
      if ((c[1] >= 0) !== (c[2] >= 0)) edges.push(cross(i + 1, j, i + 1, j + 1));
      if ((c[3] >= 0) !== (c[2] >= 0)) edges.push(cross(i, j + 1, i + 1, j + 1));
      if ((c[0] >= 0) !== (c[3] >= 0)) edges.push(cross(i, j, i, j + 1));
      for (let e = 0; e + 1 < edges.length; e += 2) {
        const [p, q] = [edges[e], edges[e + 1]];
        if (!onLand((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) segs.push([p, q]);
      }
    }
  }
  return segs;
}
const hotspotLines = (g, f, land) => levelLines(g, f, 'fish', hotspotLimit(f), land);
// The water temperature's lines (isotherms): every half degree (or every degree Fahrenheit),
// each with its temperature; the whole degrees bolder.
function isotherms(g, f, land, k = 3) {
  const xs = f.sst.filter((v) => v != null);
  if (!xs.length) return [];
  const F = unit('temp') !== '°C';
  const toLevel = (n) => (F ? ((n - 32) * 5) / 9 : n);
  const lo = F ? Math.ceil((Math.min(...xs) * 9) / 5 + 32) : Math.ceil(Math.min(...xs) * 2) / 2;
  const hi = F ? Math.floor((Math.max(...xs) * 9) / 5 + 32) : Math.floor(Math.max(...xs) * 2) / 2;
  const onLand = landTest(land);
  const out = [];
  for (let n = lo; n <= hi + 1e-9; n += F ? 1 : 0.5) {
    const segs = levelLines(g, f, 'sst', toLevel(n), land, k, onLand);
    if (segs.length) out.push({ label: F ? `${n}°` : `${n.toFixed(1)}°`, bold: F ? n % 2 === 0 : n % 1 === 0, segs });
  }
  return out;
}
// Distance (nautical miles) and bearing (degrees true) from one spot to another.
function navTo([lat1, lng1], [lat2, lng2]) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r; const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  const nm = 2 * 3440.065 * Math.asin(Math.sqrt(a));
  const y = Math.sin(dLng) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLng);
  const deg = ((Math.atan2(y, x) / r) + 360) % 360;
  return { nm, deg };
}
const navTxt = (from, to) => { const { nm, deg } = navTo(from, to); return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm · ${String(Math.round(deg) % 360).padStart(3, '0')}°`; };
// Whether a point is on land (the coastline's rings; each ring's box checked first).
function landTest(land) {
  const rings = (land || []).map((r) => {
    let s0 = 90; let n0 = -90; let w0 = 180; let e0 = -180;
    for (const [la, ln] of r) { s0 = Math.min(s0, la); n0 = Math.max(n0, la); w0 = Math.min(w0, ln); e0 = Math.max(e0, ln); }
    return { r, s0, n0, w0, e0 };
  });
  return (lat, lng) => rings.some(({ r, s0, n0, w0, e0 }) => {
    if (lat < s0 || lat > n0 || lng < w0 || lng > e0) return false;
    let inside = false;
    for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
      const [ya, xa] = r[a]; const [yb, xb] = r[b];
      if ((ya > lat) !== (yb > lat) && lng < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside;
    }
    return inside;
  });
}
// Each hotspot's name: why it's promising, at its best point (the few best, well apart).
function hotspotLabels(g, f) {
  const lim = hotspotLimit(f);
  const pts = [];
  f.fish.forEach((v, k) => { if (v != null && v >= lim) pts.push(k); });
  pts.sort((a, b) => f.fish[b] - f.fish[a]);
  const picked = [];
  for (const k of pts) {
    const lat = g.south + Math.floor(k / g.nx) * g.step; const lng = g.west + (k % g.nx) * g.step;
    if (picked.some((p) => Math.hypot(p.lat - lat, p.lng - lng) < 0.8)) continue;
    const why = f.why?.[k] || 0;
    const words = [why & 1 && 'Temp break', why & 2 && 'Current', why & 16 && 'Colour', why & 4 && 'Shelf', why & 8 && 'Billfish water'].filter(Boolean);
    if (words.length) picked.push({ lat, lng, text: words.join(' · ') });
    if (picked.length >= 6) break;
  }
  return picked;
}
// Moving particles that follow the current, leaving fading trails (drawn on a canvas over the map).
// style() says how to draw: { crests } for waves (short crests across the way they travel,
// as Windy draws them) instead of flowing lines, and { per }: screen area (px²) per line, so
// each layer has Windy's density (the wind far sparser than the currents).
function flowLayer(map, getField, getLand = () => null, bounds = null, style = () => ({})) {
  const box = map.getContainer();
  const cv = document.createElement('canvas');
  cv.className = 'flow-canvas';
  // In a pane of its own inside the map: over the colours and contours, under the place names
  // and the tap box. The canvas is pinned to the map (it moves with it while you drag, as the
  // map's own pictures do), so the lines stay on the water they're on and keep flowing; only a
  // zoom starts them afresh.
  const pane = map.getPane('flow') || map.createPane('flow');
  pane.style.zIndex = 450;
  pane.style.pointerEvents = 'none';
  pane.appendChild(cv);
  const ctx = cv.getContext('2d');
  let dpr = 1;
  let origin = map.containerPointToLayerPoint([0, 0]); // the canvas's corner on the map
  let W = 0; let H = 0;
  const place = () => { origin = map.containerPointToLayerPoint([0, 0]); cv.style.transform = `translate3d(${origin.x}px, ${origin.y}px, 0)`; };
  // A point on the canvas and the map's position there, and back.
  const toLatLng = (x, y) => map.layerPointToLatLng([x + origin.x, y + origin.y]);
  const toXY = (ll) => { const p = map.latLngToLayerPoint(ll); return [p.x - origin.x, p.y - origin.y]; };
  let parts = [];
  let raf = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = () => {
    const r = box.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  // Where the land is on the canvas (redrawn when it's placed again), so no line runs over it.
  let landAt = () => false;
  const mask = () => {
    const land = getLand();
    if (!land || !W) { landAt = () => false; return; }
    const w = Math.ceil(W); const h = Math.ceil(H);
    const m = document.createElement('canvas'); m.width = w; m.height = h;
    const mc = m.getContext('2d');
    fillLand(mc, land, (lat, lng) => toXY([lat, lng]));
    const px = mc.getImageData(0, 0, w, h).data;
    landAt = (x, y) => { const i = Math.floor(y) * w + Math.floor(x); return x >= 0 && y >= 0 && x < w && y < h && px[i * 4 + 3] > 0; };
  };
  // Lines start only where there is data (the map's grid, not the whole view), with the same
  // density at every zoom: zoomed out, fewer lines in the smaller patch of sea.
  let area = { x: 0, y: 0, w: 0, h: 0 };
  const findArea = () => {
    let x0 = 0; let y0 = 0; let x1 = W; let y1 = H;
    if (bounds) {
      const [ax, ay] = toXY(bounds[1]); const [bx, by] = toXY(bounds[0]); // north-east, south-west
      x0 = Math.max(0, bx); x1 = Math.min(W, ax); y0 = Math.max(0, ay); y1 = Math.min(H, by);
    }
    area = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const spawn = (p) => {
    for (let k = 0; k < 6; k++) {
      p.x = area.x + Math.random() * area.w; p.y = area.y + Math.random() * area.h;
      if (!landAt(p.x, p.y)) break;
    }
    p.age = 0; p.life = 2.5 + Math.random() * 3.5;
    return p;
  };
  const seed = () => {
    place(); mask(); findArea();
    const n = Math.round(Math.min(2200, (area.w * area.h) / (style().per || 140)));
    parts = Array.from({ length: n }, () => { const p = spawn({}); p.age = Math.random() * p.life; return p; });
    ctx.clearRect(0, 0, W, H);
  };
  // Speed by the clock, not the screen's frame rate (the same on a 60 or 120 Hz screen), and
  // strictly in proportion to the water's (1 knot: 22 pixels a second, half a knot 11): a line
  // shows the real current, its way and how fast relative to the rest; slack water barely moves.
  const PX_PER_KNOT_SECOND = 22;
  // As on Windy, the faster the water the brighter its line: four shades, by speed relative
  // to the layer's own (currents up to about 1 kn, wind about 20).
  const SHADES = [0.35, 0.55, 0.75, 0.95];
  let last = 0;
  let running = false;
  const step = (now) => {
    if (!running) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const at = getField();
    const st = style();
    // Slower when zoomed out (the sea is smaller on screen), a little faster zoomed in.
    const zoomK = Math.min(1.6, Math.max(0.35, 2 ** ((map.getZoom() - 7) * 0.6)));
    // Fade the old trails (each layer its own: the current's long and soft).
    ctx.globalCompositeOperation = 'destination-in';
    const crests = !!st.crests;
    ctx.fillStyle = `rgba(0,0,0,${Math.pow(crests ? 0.02 : st.fade || 0.12, dt).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = crests ? 2.2 : st.width || 1.3;
    ctx.lineCap = 'round';
    const full = st.full || 1; // the speed that draws brightest, in the field's units
    const paths = SHADES.map(() => new Path2D());
    for (const p of parts) {
      const ll = toLatLng(p.x, p.y);
      const u = at && at(ll.lat, ll.lng, 'u');
      const v = at && at(ll.lat, ll.lng, 'v');
      if (u == null || v == null || p.age > p.life || landAt(p.x, p.y) || p.x < 0 || p.y < 0 || p.x > W || p.y > H) {
        spawn(p);
        continue;
      }
      // A gentle drift, faster where the current is stronger (the same at every zoom).
      const kn = Math.hypot(u, v);
      const k = PX_PER_KNOT_SECOND * zoomK; // pixels a second per knot, the same everywhere on the map
      const nx = p.x + u * k * dt;
      const ny = p.y - v * k * dt;
      // Brighter for faster water, and faded in and out over the line's life (no popping).
      const life = Math.sin(Math.PI * Math.min(1, p.age / p.life));
      const shade = Math.min(SHADES.length - 1, Math.floor(Math.min(0.999, (kn / full) * 0.75 + life * 0.25) * SHADES.length));
      const path = paths[life < 0.25 ? 0 : shade];
      if (crests) {
        // A crest about 12 px long, square to the way the wave travels, fading in and out.
        const dx = nx - p.x; const dy = ny - p.y; const d = Math.hypot(dx, dy) || 1;
        const half = 6 * life;
        path.moveTo(nx - (dy / d) * half, ny + (dx / d) * half);
        path.lineTo(nx + (dy / d) * half, ny - (dx / d) * half);
      } else {
        path.moveTo(p.x, p.y);
        path.lineTo(nx, ny);
      }
      p.x = nx; p.y = ny; p.age += dt;
    }
    const alpha = st.alpha || 0.85;
    paths.forEach((path, i) => { ctx.strokeStyle = `rgba(255,255,255,${(alpha * SHADES[i] / 0.95).toFixed(3)})`; ctx.stroke(path); });
    raf = requestAnimationFrame(step);
  };
  const halt = () => { running = false; cancelAnimationFrame(raf); cv.style.visibility = 'hidden'; ctx.clearRect(0, 0, W, H); };
  const start = () => {
    halt();
    seed(); last = 0;
    cv.style.visibility = '';
    if (reduce) return;
    running = true;
    raf = requestAnimationFrame(step);
  };
  // After a drag: the canvas back on the screen's corner, its trails and lines moved with it
  // (they keep flowing, nothing restarts), the land and the area worked out for the new view.
  const settle = () => {
    const old = origin;
    place();
    const dx = origin.x - old.x; const dy = origin.y - old.y;
    if (!dx && !dy) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(cv, -dx * dpr, -dy * dpr);
    ctx.restore();
    for (const p of parts) { p.x -= dx; p.y -= dy; }
    mask(); findArea();
  };
  // Restart a moment after a zoom ends (a pinch fires several); a drag just settles.
  let timer = 0;
  let zooming = false;
  const later = () => { clearTimeout(timer); timer = setTimeout(start, 120); };
  size();
  map.on('zoomstart', () => { zooming = true; clearTimeout(timer); halt(); });
  map.on('zoomend', () => { zooming = false; later(); });
  map.on('moveend', () => { if (!zooming && running) settle(); });
  map.on('resize', () => { size(); later(); });
  start();
  // Stop when the page is left.
  const stop = () => { clearTimeout(timer); halt(); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);
  return { reseed: () => (running ? start() : seed()) };
}

// ---- keeping it decent: community rules, reporting, blocking ----------------
// The rules everyone agrees to (at sign-up, or once on their next visit). Shown on #/community too.
const COMMUNITY_RULES = [
  ['Fishing only', 'Post fish, boats, trips and club news. Nothing unrelated.'],
  ['Be respectful', 'No insults, harassment, threats, hate or discrimination, in posts, names or photos.'],
  ['Nothing offensive', 'No nudity, sexual, violent or shocking content.'],
  ['Be honest', 'Weights, photos and catches must be real and your own boat\'s.'],
  ['No spam', 'No advertising or links to sell things.'],
];
const rulesList = () => html`<ol class="rules-list">${COMMUNITY_RULES.map(([t, d]) => raw(html`<li><b>${t}.</b> ${d}</li>`))}</ol>
  <p class="small muted">Anything can be reported (the flag button): the club's officers look at every report within 24 hours and remove
  what breaks the rules. Someone who keeps breaking them loses their account. You can also block a person so you don't see their posts.</p>`;

// A small "Report" button, for something someone else posted (signed in only).
const REASONS = [['offensive', 'Offensive or inappropriate'], ['harassment', 'Harassment or abuse'], ['spam', 'Spam or advertising'],
  ['false', 'Not true or misleading'], ['other', 'Something else']];
const reportBtn = (kind, id, { userId = null, name = '', label = 'Report' } = {}) => (!state.me || (userId && userId === state.me.id) ? ''
  : html`<button type="button" class="link small muted report-link" data-report="${kind}" data-id="${id}" data-user="${userId || ''}" data-name="${name}">${raw(icon('flag'))} ${label}</button>`);

function openSheet(id, inner) {
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = id;
  dlg.className = 'sheet';
  dlg.innerHTML = inner;
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-report]');
  if (!btn) return;
  e.preventDefault();
  const { report: kind, id, user, name } = btn.dataset;
  const what = { log: 'this fish', catch: 'this photo', announcement: 'this announcement', user: 'this profile' }[kind];
  const dlg = openSheet('report-sheet', html`<h2>Report ${what}</h2>
    <p class="small muted">The club's officers will look at it within 24 hours. The person isn't told who reported it.</p>
    <form class="stack">
      <div class="report-reasons">${REASONS.map(([v, t], i) => raw(html`<label class="check"><input type="radio" name="reason" value="${v}" ${i ? '' : 'required'}> ${t}</label>`))}</div>
      <label>More detail (optional) <textarea name="note" maxlength="500" rows="2"></textarea></label>
      ${user && kind !== 'user' && Number(user) !== state.me?.id ? raw(html`<label class="check"><input type="checkbox" name="block"> Also hide posts from ${name || 'this person'}</label>`) : ''}
      <p class="error"></p>
      <div class="row-buttons"><button type="submit" class="primary">Send report</button><button type="button" data-close>Cancel</button></div>
    </form>`);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.querySelector('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const sendBtn = f.querySelector('[type=submit]');
    sendBtn.disabled = true;
    try {
      await api('/reports', { method: 'POST', body: { kind, id: Number(id), reason: f.reason.value, note: f.note.value } });
      if (f.block?.checked) {
        await api('/blocks', { method: 'POST', body: { userId: Number(user) } });
        state.me = (await api('/me')).user;
      }
      dlg.close();
      toast(f.block?.checked ? "Thanks. Reported, and you won't see their posts any more." : "Thanks. The club's officers will look at it.");
      if (f.block?.checked) route();
    } catch (err) {
      f.querySelector('.error').textContent = err.message;
      sendBtn.disabled = false;
    }
  });
});

// Once, for accounts made before the rules: agree to carry on.
async function rulesCheck() {
  if (!state.me || state.me.rulesAccepted || document.getElementById('rules-sheet')) return;
  const dlg = openSheet('rules-sheet', html`<h2>Community rules</h2>
    <p class="small muted">To keep Africa Sportfishing a good place for every angler:</p>${raw(rulesList())}
    <button type="button" class="primary setup-close" data-agree>I agree</button>`);
  // Agreeing is the only way on.
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.querySelector('[data-agree]').onclick = async () => {
    try {
      await api('/me/accept-rules', { method: 'POST' });
      state.me.rulesAccepted = true;
      dlg.close();
    } catch (err) {
      toast(err.message);
    }
  };
}

// The phone's position for the registration record, or null if it isn't
// allowed or takes too long: never holds up sending.
function phoneSpot(timeout = 8000) {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(done); resolve({ lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5) }); },
      () => { clearTimeout(done); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

// ---- trends (Log → Trends) ---------------------------------------------------
// Year against year by month, what's biting now, and water against billfish by
// week. Lines and bars in plain SVG; colours from --series-1..3 (validated,
// colour-blind safe), every series also named in a legend and at its line end.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function trendsHtml(tr, { perBoat, link, mine }) {
  const W = 340; const H = 150; const L = 28; const R = 44; const T = 10; const B = 22;
  const x = (i, n) => L + (i * (W - L - R)) / (n - 1);
  const value = (m) => (perBoat ? (m.boats ? m.count / m.boats : 0) : m.count);
  const top = Math.max(1, ...tr.years.flatMap((y) => y.months.map(value)));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const nice = (v) => (perBoat ? (Math.round(v * 10) / 10) : Math.round(v));
  const grid = [0, top / 2, top].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="tr-grid"/><text x="${L - 4}" y="${y(g) + 4}" class="tr-axis" text-anchor="end">${nice(g)}</text>`).join('');
  // This year's line stops at this month: the months to come aren't zeros.
  const thisYear = String(new Date().getFullYear());
  const thisMonth = new Date().getMonth();
  const lines = tr.years.map((yr, k) => {
    const pts = yr.months.slice(0, yr.year === thisYear ? thisMonth + 1 : 12).map((m, i) => [x(i, 12), y(value(m))]);
    const last = pts[pts.length - 1];
    return `<g class="tr-s${k + 1}"><polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="tr-line"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="tr-dot"><title>${esc(`${MONTH_SHORT[i]} ${yr.year}: ${nice(value(yr.months[i]))} ${tr.species ? tr.species.toLowerCase() : 'fish'}${perBoat ? ' per boat' : ''}`)}</title></circle>`).join('')}
      <text x="${last[0] + 6}" y="${last[1] + 4}" class="tr-label">${yr.year}</text></g>`;
  }).join('');
  const months = MONTH_SHORT.map((m, i) => (i % 2 ? '' : `<text x="${x(i, 12)}" y="${H - 6}" class="tr-axis" text-anchor="middle">${m[0]}</text>`)).join('');
  // "Sailfish arrived 3 weeks earlier than last year"
  const [cur, prev] = tr.years;
  let arrival = '';
  if (cur?.first && prev?.first) {
    const doy = (d) => (Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 864e5;
    const weeks = Math.round((doy(prev.first) - doy(cur.first)) / 7);
    arrival = weeks === 0 ? `${tr.species} arrived about the same time as in ${prev.year}.`
      : `${tr.species} arrived ${Math.abs(weeks)} week${Math.abs(weeks) === 1 ? '' : 's'} ${weeks > 0 ? 'earlier' : 'later'} than in ${prev.year} (first caught ${fmtDate(cur.first)}).`;
  } else if (cur?.first) arrival = `First ${tr.species.toLowerCase()} this year: ${fmtDate(cur.first)}.`;
  const yearChart = tr.species ? `<h2>Year against year${info(perBoat ? '<p>Fish per boat that logged fish that month, so more boats on the app doesn\'t look like more fish.</p>' : '<p>Fish caught each month. Tap “Per boat logging fish” to allow for more boats using the app.</p>')}</h2><div class="card pad">
    <label class="season-species">${esc(tr.species)} caught, by month
      <select id="trend-species">${options(tr.speciesList.map((v) => [v, v]), tr.species)}</select></label>
    <div class="tr-legend">${tr.years.map((yr, k) => `<span class="tr-s${k + 1}"><i></i>${yr.year}</span>`).join('')}
      <a class="small" href="${link({ per: perBoat ? '' : 'boat' })}">${perBoat ? 'Show totals' : 'Per boat logging fish'}</a></div>
    <svg viewBox="0 0 ${W} ${H}" class="tr-svg" role="img" aria-label="${esc(tr.species)} by month, year against year">${grid}${months}${lines}</svg>
    ${arrival ? `<p class="small">${esc(arrival)}</p>` : ''}
    <table class="sr-only"><thead><tr><th>Month</th>${tr.years.map((yr) => `<th>${yr.year}</th>`).join('')}</tr></thead>
      <tbody>${MONTH_SHORT.map((m, i) => `<tr><td>${m}</td>${tr.years.map((yr) => `<td>${nice(value(yr.months[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </div>` : '<div class="card pad empty">Trends start once fish are logged.</div>';

  // What's biting now
  const arrow = (r) => (r.now > r.before ? '↑ up' : r.now < r.before ? '↓ down' : '= same');
  const biting = `<h2>What's biting now${info(`<p>Fish caught in the last 14 days against the 14 before${mine ? '' : `, from ${plural(tr.now.boats, 'boat')} (${tr.now.boatsBefore} before)`}.</p>`)}</h2><div class="card">
    ${tr.now.biting.length ? `<ul class="list">${tr.now.biting.slice(0, 8).map((r) => `<li class="biting">
      <span><b>${esc(r.species)}</b>${r.area ? ` <span class="small muted">· mostly ${esc(r.area)}</span>` : ''}</span>
      <span class="small"><b>${r.now}</b> <span class="muted">vs ${r.before}</span> · ${arrow(r)}</span></li>`).join('')}</ul>`
      : '<p class="pad muted">No fish logged in the last four weeks.</p>'}</div>`;

  // Water and billfish by week: two charts on the same weeks (never two scales on one chart).
  const n = tr.weeks.length;
  const temps = tr.weeks.map((w) => (w.water == null ? null : toUnit('temp', w.water)));
  const tv = temps.filter((v) => v != null);
  const SW = 340; const SH = 90;
  const sx = (i) => L + (i * (SW - L - 8)) / (n - 1);
  let water = '';
  if (tv.length) {
    const lo = Math.floor(Math.min(...tv)) - 1; const hi = Math.ceil(Math.max(...tv)) + 1;
    const sy = (v) => 8 + (SH - 22) * (1 - (v - lo) / (hi - lo || 1));
    const segs = []; let cur2 = [];
    temps.forEach((v, i) => { if (v == null) { if (cur2.length) segs.push(cur2); cur2 = []; } else cur2.push(`${sx(i)},${sy(v)}`); });
    if (cur2.length) segs.push(cur2);
    water = `<svg viewBox="0 0 ${SW} ${SH}" class="tr-svg" role="img" aria-label="Water temperature by week">
      <line x1="${L}" x2="${SW - 8}" y1="${sy(hi)}" y2="${sy(hi)}" class="tr-grid"/><line x1="${L}" x2="${SW - 8}" y1="${sy(lo)}" y2="${sy(lo)}" class="tr-grid"/>
      <text x="${L - 4}" y="${sy(hi) + 4}" class="tr-axis" text-anchor="end">${hi}</text><text x="${L - 4}" y="${sy(lo) + 4}" class="tr-axis" text-anchor="end">${lo}</text>
      <g class="tr-s1">${segs.map((sg) => `<polyline points="${sg.join(' ')}" class="tr-line"/>`).join('')}
      ${temps.map((v, i) => (v == null ? '' : `<circle cx="${sx(i)}" cy="${sy(v)}" r="3.5" class="tr-dot"><title>Week of ${fmtDate(tr.weeks[i].start)}: ${v}${unit('temp')}</title></circle>`)).join('')}</g></svg>`;
  }
  const bTop = Math.max(1, ...tr.weeks.map((w) => w.billfish));
  const bw = (SW - L - 8) / n - 2;
  const bars = `<svg viewBox="0 0 ${SW} ${SH}" class="tr-svg" role="img" aria-label="Billfish caught by week">
    <line x1="${L}" x2="${SW - 8}" y1="${SH - 14}" y2="${SH - 14}" class="tr-grid"/>
    <text x="${L - 4}" y="${12}" class="tr-axis" text-anchor="end">${bTop}</text><text x="${L - 4}" y="${SH - 10}" class="tr-axis" text-anchor="end">0</text>
    <g class="tr-s1">${tr.weeks.map((w, i) => (w.billfish ? `<rect x="${sx(i) - bw / 2}" y="${(SH - 14) - ((SH - 22) * w.billfish) / bTop}" width="${bw}" height="${((SH - 22) * w.billfish) / bTop}" rx="2" class="tr-bar"><title>Week of ${fmtDate(w.start)}: ${w.billfish} billfish</title></rect>` : '')).join('')}</g>
    ${[0, Math.floor(n / 2), n - 1].map((i) => `<text x="${sx(i)}" y="${SH - 1}" class="tr-axis" text-anchor="middle">${new Date(`${tr.weeks[i].start}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`).join('')}</svg>`;
  const weekly = `<h2>Water and billfish, week by week${info('<p>The last 26 weeks, on the same weeks, so you can see the fish come as the water changes. Water temperature is the average of the trips that logged it.</p>')}</h2><div class="card pad">
    <p class="small"><b>Water temperature (${unit('temp')})</b></p>
    ${water || '<p class="small muted">No water temperatures logged yet.</p>'}
    <p class="small"><b>Billfish caught</b></p>${bars}</div>`;
  return yearChart + biting + weekly;
}

// Leaderboard: points, tournaments and the record book, one tab each.
// A dropdown chip whose choices are pages: picking one goes there.
document.addEventListener('change', (e) => {
  if (e.target.matches('select[data-go]')) location.hash = e.target.value.replace(/^#/, '');
});
const boardTabs = (on) => html`<div class="line-tabs" role="tablist">
  <a role="tab" href="#/leaderboard" aria-selected="${on === 'board'}">Points</a>
  <a role="tab" href="#/tournaments" aria-selected="${on === 'tournaments'}">Tournaments</a>
  <a role="tab" href="#/records" aria-selected="${on === 'records'}">Records</a></div>`;

// JHMMC boats for the secretary's weigh sheet, grouped by weigh station.
function boatOptions(boats, mine) {
  const label = (t) => `${t.name} (${t.division === 'river' ? 'River' : 'Ocean'})`;
  const order = [...new Set([mine, ...state.meta.weighStations].filter(Boolean)), null];
  const groups = order.map((w) => [w, boats.filter((t) => (t.weighStation || null) === w)]).filter(([, list]) => list.length);
  const opts = (list) => list.map((t) => `<option value="${esc(t.id)}">${esc(label(t))}</option>`).join('');
  if (groups.length < 2) return `<option value="">Choose…</option>${opts(boats)}`;
  return `<option value="">Choose…</option>${groups.map(([w, list]) =>
    `<optgroup label="${esc(w ? (w === mine ? `${w} (your station)` : w) : 'Other weigh stations')}">${opts(list)}</optgroup>`).join('')}`;
}

function speciesOptions(selected, placeholder) {
  const groups = {};
  for (const s of state.meta.species) (groups[s.category] ||= []).push(s);
  return (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
    Object.entries(groups).map(([cat, list]) =>
      `<optgroup label="${esc(cat)}">${list.map((s) =>
        `<option value="${s.id}"${String(s.id) === String(selected ?? '') ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`
    ).join('');
}

async function loadClubs(force) {
  if (!state.clubs || force) state.clubs = (await api('/clubs')).clubs;
  return state.clubs;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const err = form.querySelector('.error');
    btn.disabled = true;
    err.textContent = '';
    try {
      await handler(form);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// Phone photos are often 3-8 MB; shrink them to 1600px JPEGs before upload so
// posting works over Starlink or a weak signal. Falls back to the original.
async function shrinkPhoto(file, max = 1600) {
  if (!file?.size || !file.type.startsWith('image/')) return file;
  try {
    // An <img> applies the photo's EXIF rotation, so a portrait photo stays portrait
    // (createImageBitmap ignores it on some browsers, e.g. older Samsung Internet).
    const url = URL.createObjectURL(file);
    const img = new Image();
    try { img.src = url; await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    img.width = img.naturalWidth; img.height = img.naturalHeight;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1.5e6 && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.82));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

// Tapping a photo opens it whole, any shape, full screen; tap again to close.
const PHOTO_URL = /\.(jpe?g|png|webp)(\?|$)/i;
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[target="_blank"]');
  const img = !a && e.target.closest('img.catch-photo, img[data-view]');
  const src = a && PHOTO_URL.test(a.getAttribute('href') || '') ? a.getAttribute('href') : img && !img.closest('a') ? img.currentSrc || img.src : '';
  if (!src) return;
  e.preventDefault();
  let dlg = document.getElementById('photo-viewer');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'photo-viewer';
    dlg.innerHTML = '<img alt=""><button type="button" class="pv-close" aria-label="Close">×</button>';
    dlg.addEventListener('click', () => dlg.close());
    document.body.append(dlg);
  }
  dlg.querySelector('img').src = src;
  dlg.showModal();
});

// Replaces a photo field in form data with its shrunk version, or drops it if empty.
async function preparePhoto(fd, field) {
  const file = fd.get(field);
  if (!file?.size) fd.delete(field);
  else fd.set(field, await shrinkPhoto(file));
  return fd;
}

async function copyText(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copy this', text);
  }
}

// Who's signed in and the species list are kept on the phone too, so the app
// (and Log fish) opens at sea even before the offline copy has them.
const kept = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
async function refreshMe() {
  try {
    state.me = (await api('/me')).user;
    keep('kept-me', state.me);
  } catch (err) {
    if (err.status) throw err;
    state.me = kept('kept-me'); // no signal: the last one seen
  }
}
