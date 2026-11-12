// Africa Sportfishing, part of the app (public/js/widgets.js): Maps, forms and widgets shared by the pages, the trends charts, photo shrinking and the viewer.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// The maps: satellite imagery (Esri World Imagery) with borders and place
// names (country, city, town) on top.
function addSatellite(L, map, { fullScreen = false } = {}) {
  const esri = (service) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  const imagery = L.tileLayer(esri('World_Imagery'), { maxZoom: 18, attribution: 'Imagery © Esri', keepBuffer: 4 }).addTo(map);
  L.tileLayer(esri('Reference/World_Boundaries_and_Places'), { maxZoom: 18 }).addTo(map);
  map.attributionControl?.setPrefix(false); // no Leaflet logo; Esri's credit stays (their terms), small
  if (!fullScreen) twoFingers(map);
  // Places the club wants on every map.
  for (const p of MAP_PLACES) {
    L.circleMarker([p.lat, p.lng], { radius: 5, weight: 2, color: '#ffffff', fillColor: '#f5a524', fillOpacity: 1 })
      .bindTooltip(p.name, { permanent: true, direction: 'right', className: 'place-label', offset: [6, 0] })
      .addTo(map);
  }
  return { imagery };
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
const MAP_PLACES = [
  { name: 'Marshall', lat: 6.15, lng: -10.3833 },
];
const spotPin = (L, released) => ({ radius: 9, weight: 3, color: '#ffffff', fillColor: released ? '#3fcf8e' : '#2f7cf6', fillOpacity: 1 });
// The small map on a catch's page, on satellite imagery.
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
function seaPlace() {
  try {
    const v = localStorage.getItem(SEA_KEY);
    if (v?.startsWith('{')) { const p = JSON.parse(v); if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) return p; }
    return SEA_PLACES.find((p) => p.key === v) || SEA_PLACES[0];
  } catch { return SEA_PLACES[0]; }
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
// Colour scales, fixed like Windy's (the same colour is the same value every day). Water
// temperature in Windy's yellow-orange-red, with more steps over the tropical range so a
// break of a degree or two still shows.
const SST_SCALE = [[18, [175, 190, 60]], [22, [230, 200, 50]], [25, [245, 160, 40]], [27, [240, 125, 35]], [29, [228, 88, 35]], [31, [200, 52, 42]], [33, [150, 28, 48]]];
// Wind in Windy's own colours (knots): violet-blue when calm, teal, green, then gold and red.
const WIND_SCALE = [[0, [98, 113, 183]], [2, [57, 97, 159]], [6, [74, 148, 169]], [10, [77, 141, 123]], [14, [83, 165, 83]], [17, [53, 159, 53]],
  [21, [167, 157, 81]], [25, [159, 127, 58]], [29, [161, 108, 92]], [33, [129, 58, 78]], [37, [175, 80, 136]], [41, [117, 74, 147]]];
// Waves in Windy's colours: cyan for small, deepening blue to purple, red only for big seas.
const WAVE_SCALE = [[0, [90, 200, 205]], [0.5, [70, 170, 210]], [1, [62, 125, 205]], [1.5, [62, 92, 192]], [2, [78, 66, 172]], [3, [125, 60, 160]], [4.5, [185, 70, 110]], [6, [205, 85, 85]]];
// Each colour layer's value at a spot, from a frame's sampler.
const FIELD_VALUE = {
  sst: (at, lat, lng) => at(lat, lng, 'sst'),
  speed: (at, lat, lng) => { const u = at(lat, lng, 'u'); const v = at(lat, lng, 'v'); return u == null || v == null ? null : Math.hypot(u, v); },
  wind: (at, lat, lng) => { const u = at(lat, lng, 'wu'); const v = at(lat, lng, 'wv'); return u == null || v == null ? null : Math.hypot(u, v); },
  wave: (at, lat, lng) => at(lat, lng, 'wh'),
};
const SPEED_SCALE = [[0, [60, 50, 160]], [0.2, [50, 110, 200]], [0.4, [40, 160, 170]], [0.8, [60, 170, 70]], [1.2, [200, 170, 60]], [1.6, [190, 60, 90]], [2.2, [230, 230, 240]]];
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
function fieldCanvas(g, f, kind, stops, land) {
  const at = sampler(g, f);
  const R = raster(g, 12); // 12 pixels per grid step: a sharp coast when zoomed in
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
      img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 235;
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
function fishingField(g, prefs = {}) {
  const { nx, ny } = g;
  const depth = g.depth || null;
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
    const at = (key, i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? null : f[key][j * nx + i]);
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
        tb.push(grad((a, b) => at('sst', a, b), i, j));
        // The edge: the change in speed, plus the turning (an eddy's spin).
        const sp = grad(speed, i, j);
        const dv = (at('v', i + 1, j) ?? at('v', i, j)) - (at('v', i - 1, j) ?? at('v', i, j));
        const du = (at('u', i, j + 1) ?? at('u', i, j)) - (at('u', i, j - 1) ?? at('u', i, j));
        ce.push(sp == null || Number.isNaN(dv - du) ? null : sp + Math.abs(dv - du) / 2);
      }
    }
    const rt = rank(tb); const rc = rank(ce);
    f.fish = []; f.why = [];
    for (let k = 0; k < nx * ny; k++) {
      if (f.sst[k] == null && f.u[k] == null) { f.fish.push(null); f.why.push(0); continue; }
      const b = rt(tb[k]) ** 2; const e = rc(ce[k]) ** 2; const sh = depth ? shelf(depth[k]) : 0.5; const w = warm(f.sst[k]);
      f.fish.push(Math.round((0.3 * b + 0.25 * e + 0.3 * sh + 0.15 * w) * 100) / 100);
      f.why.push((b > 0.55 ? 1 : 0) | (e > 0.55 ? 2 : 0) | (depth && sh > 0.8 ? 4 : 0) | (prefs.water && w > 0.9 ? 8 : 0));
    }
  }
}
// The fishing chart's hotspots: the most promising water (the top eighth of the sea that hour,
// and never below a fair score) as patches with a bright outline, so the chart underneath stays
// readable. Cut at the coast like the other layers.
function hotspotLimit(f) {
  const xs = (f.fish || []).filter((v) => v != null).sort((a, b) => a - b);
  return xs.length ? Math.max(0.55, xs[Math.floor(xs.length * 0.88)]) : Infinity;
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
function isotherms(g, f, land) {
  const xs = f.sst.filter((v) => v != null);
  if (!xs.length) return [];
  const F = unit('temp') !== '°C';
  const toLevel = (n) => (F ? ((n - 32) * 5) / 9 : n);
  const lo = F ? Math.ceil((Math.min(...xs) * 9) / 5 + 32) : Math.ceil(Math.min(...xs) * 2) / 2;
  const hi = F ? Math.floor((Math.max(...xs) * 9) / 5 + 32) : Math.floor(Math.max(...xs) * 2) / 2;
  const onLand = landTest(land);
  const out = [];
  for (let n = lo; n <= hi + 1e-9; n += F ? 1 : 0.5) {
    const segs = levelLines(g, f, 'sst', toLevel(n), land, 3, onLand);
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
    const words = [why & 1 && 'Temperature break', why & 2 && 'Current edge', why & 4 && 'Shelf', why & 8 && 'Billfish water'].filter(Boolean);
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
  // and the tap box. Placed back on the screen's corner after each move.
  const pane = map.getPane('flow') || map.createPane('flow');
  pane.style.zIndex = 450;
  pane.style.pointerEvents = 'none';
  pane.appendChild(cv);
  const place = () => { const p0 = map.containerPointToLayerPoint([0, 0]); cv.style.transform = `translate3d(${p0.x}px, ${p0.y}px, 0)`; };
  const ctx = cv.getContext('2d');
  let parts = [];
  let raf = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = () => {
    const r = box.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  // Where the land is on screen (redrawn when the map moves), so no line runs over it.
  let landAt = () => false;
  const mask = () => {
    const land = getLand();
    const r = box.getBoundingClientRect();
    if (!land || !r.width) { landAt = () => false; return; }
    const W = Math.ceil(r.width); const H = Math.ceil(r.height);
    const m = document.createElement('canvas'); m.width = W; m.height = H;
    const mc = m.getContext('2d');
    fillLand(mc, land, (lat, lng) => { const pt = map.latLngToContainerPoint([lat, lng]); return [pt.x, pt.y]; });
    const px = mc.getImageData(0, 0, W, H).data;
    landAt = (x, y) => { const i = Math.floor(y) * W + Math.floor(x); return x >= 0 && y >= 0 && x < W && y < H && px[i * 4 + 3] > 0; };
  };
  // Lines start only where there is data on screen (the map's grid, not the whole view), with
  // the same density at every zoom: zoomed out, fewer lines in the smaller patch of sea.
  let area = { x: 0, y: 0, w: 0, h: 0 };
  const spawn = (p) => {
    for (let k = 0; k < 6; k++) {
      p.x = area.x + Math.random() * area.w; p.y = area.y + Math.random() * area.h;
      if (!landAt(p.x, p.y)) break;
    }
    p.age = 0; p.life = 3 + Math.random() * 3;
    return p;
  };
  const seed = () => {
    place();
    mask();
    const r = box.getBoundingClientRect();
    let x0 = 0; let y0 = 0; let x1 = r.width; let y1 = r.height;
    if (bounds) {
      const a = map.latLngToContainerPoint(bounds[1]); const b = map.latLngToContainerPoint(bounds[0]); // north-east, south-west
      x0 = Math.max(0, b.x); x1 = Math.min(r.width, a.x); y0 = Math.max(0, a.y); y1 = Math.min(r.height, b.y);
    }
    area = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    const n = Math.round(Math.min(2200, (area.w * area.h) / (style().per || 140)));
    parts = Array.from({ length: n }, () => { const p = spawn({}); p.age = Math.random() * p.life; return p; });
    ctx.clearRect(0, 0, r.width, r.height);
  };
  // Speed by the clock, not the screen's frame rate (the same on a 60 or 120 Hz screen).
  // Like Windy: a lively flow that still reads (1 knot: 22 pixels a second), with weak water
  // still creeping along so its direction shows.
  const PX_PER_KNOT_SECOND = 22;
  const MIN_PX_SECOND = 5;
  let last = 0;
  // One animation loop at a time, and none while the map is being moved or pinched (the
  // lines are in screen pixels, so they would be left behind or dragged across the map).
  let running = false;
  const step = (now) => {
    if (!running) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    const r = box.getBoundingClientRect();
    const at = getField();
    // Slower when zoomed out (the sea is smaller on screen), a little faster zoomed in.
    const zoomK = Math.min(1.6, Math.max(0.35, 2 ** ((map.getZoom() - 7) * 0.6)));
    // Fade the old trails within about a second: short streaks, as on Windy.
    ctx.globalCompositeOperation = 'destination-in';
    const crests = !!style().crests;
    ctx.fillStyle = `rgba(0,0,0,${Math.pow(crests ? 0.02 : 0.12, dt).toFixed(3)})`;
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = crests ? 2.2 : 1.3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (const p of parts) {
      const ll = map.containerPointToLatLng([p.x, p.y]);
      const u = at && at(ll.lat, ll.lng, 'u');
      const v = at && at(ll.lat, ll.lng, 'v');
      if (u == null || v == null || p.age > p.life || landAt(p.x, p.y)) {
        spawn(p);
        continue;
      }
      // A gentle drift, faster where the current is stronger (the same at every zoom).
      const kn = Math.hypot(u, v);
      const k = kn > 0.001 ? (Math.max(PX_PER_KNOT_SECOND * kn, MIN_PX_SECOND) * zoomK) / kn : 0;
      const nx = p.x + u * k * dt;
      const ny = p.y - v * k * dt;
      if (crests) {
        // A crest about 12 px long, square to the way the wave travels, fading in and out.
        const dx = nx - p.x; const dy = ny - p.y; const d = Math.hypot(dx, dy) || 1;
        const half = 6 * Math.sin(Math.PI * Math.min(1, p.age / p.life));
        ctx.moveTo(nx - (dy / d) * half, ny + (dx / d) * half);
        ctx.lineTo(nx + (dy / d) * half, ny - (dx / d) * half);
      } else {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
      }
      p.x = nx; p.y = ny; p.age += dt;
    }
    ctx.stroke();
    raf = requestAnimationFrame(step);
  };
  const halt = () => { running = false; cancelAnimationFrame(raf); cv.style.visibility = 'hidden'; ctx.clearRect(0, 0, cv.width, cv.height); };
  const start = () => {
    halt();
    seed(); last = 0;
    cv.style.visibility = '';
    if (reduce) return;
    running = true;
    raf = requestAnimationFrame(step);
  };
  // Restart a moment after the last move ends (a pinch fires several).
  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(start, 120); };
  size();
  map.on('movestart zoomstart', () => { clearTimeout(timer); halt(); });
  map.on('move zoom', () => { clearTimeout(timer); if (running) halt(); });
  map.on('moveend zoomend', later);
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
