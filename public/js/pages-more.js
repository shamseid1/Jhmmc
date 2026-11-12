// Africa Sportfishing, part of the app (public/js/pages-more.js): Notifications, installing the app, the More menu.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // Notifications: this phone on or off, and which kinds the person wants.
  async notifications() {
    if (!state.me) return needLogin(view, 'choose your notifications');
    const me = state.me;
    const kinds = [
      ['announcements', 'Announcements from JHMMC', 'Tournaments, membership reminders and other news from the officers.'],
      ...(me.canWeigh ? [['myFish', 'Your fish approved or not counted', 'When the secretary decides on a fish you registered.']] : []),
      ['weighins', 'Every weigh-in', 'Each time any boat\'s fish is approved.'],
      ['logged', 'Fish logged at sea', 'Each time a boat logs a fish.'],
    ];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Notifications</h1>
      <div id="notify"></div>
      <h2>Tell me about</h2>
      <form class="card menu notify-kinds" id="kinds">${kinds.map(([k, label, sub]) => raw(html`<label class="notify-kind">
        <span class="mi-text"><b>${label}</b><span>${sub}</span></span>
        <input type="checkbox" class="switch" name="${k}" ${me.notify?.[k] ? 'checked' : ''}></label>`))}</form>
      <p class="small muted">You're not told about what you did yourself, such as your own fish or announcement.</p>
`;
    renderNotify(view.querySelector('#notify'), { what: 'the things you choose below' });
    view.querySelector('#kinds').addEventListener('change', async (e) => {
      try {
        state.me = (await api('/me', { method: 'PATCH', body: { notify: { [e.target.name]: e.target.checked } } })).user;
        toast('Saved.');
      } catch (err) {
        e.target.checked = !e.target.checked;
        toast(err.message);
      }
    });
  },

  // Sea conditions: wind, waves, water, current, tide, sun and moon, the best fishing times
  // and the week ahead, for a place off the coast or wherever the phone is.
  async sea() {
    const place = seaPlace();
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Sea conditions</h1>
      <div class="sea-place"><select id="sea-where" aria-label="Place">
          ${SEA_PLACES.filter((p) => p.key !== 'here').map((p) => raw(html`<option value="${p.key}" ${p.key === place.key ? 'selected' : ''}>${p.name}</option>`))}
          ${seaRecent().length ? raw(html`<optgroup label="Recent">${seaRecent().map((p) => raw(html`<option value="${p.key}" ${p.key === place.key ? 'selected' : ''}>${p.name}</option>`))}</optgroup>`) : ''}
          <option value="here" ${place.key === 'here' ? 'selected' : ''}>Where I am</option>
          <option value="search">Search a town or port…</option></select>
        <span id="sea-rating"></span></div>
      <form id="sea-search" class="card pad stack" hidden>
        <label>Town or port <input name="q" required minlength="2" maxlength="60" placeholder="e.g. Freetown, Takoradi, Dakar" autocomplete="off" enterkeyhint="search"></label>
        <div class="row-buttons"><button type="submit" class="primary">Search</button><button type="button" data-cancel>Cancel</button></div>
        <ul class="sea-results"></ul>
        <p class="small muted">The forecast is for the sea just off the place you choose.</p>
      </form>
      <div id="sea-body"><div class="card pad muted">Getting the forecast…</div></div>`;
    const where = view.querySelector('#sea-where');
    const search = view.querySelector('#sea-search');
    where.addEventListener('change', () => {
      if (where.value === 'search') {
        search.hidden = false;
        search.q.focus();
        return;
      }
      setSeaPlace([...SEA_PLACES, ...seaRecent()].find((p) => p.key === where.value) || SEA_PLACES[0]);
      route();
    });
    search.querySelector('[data-cancel]').onclick = () => { search.hidden = true; where.value = place.key; };
    search.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = search.querySelector('.sea-results');
      out.innerHTML = '<li class="muted">Searching…</li>';
      try {
        const { places } = await api(`/sea/places?q=${encodeURIComponent(search.q.value.trim())}`);
        out.innerHTML = places.length ? places.map((p, i) => html`<li><button type="button" class="link" data-i="${i}"><b>${p.name}</b>
          <span class="small muted">${[p.region, p.country].filter(Boolean).join(', ')}</span></button></li>`).join('')
          : '<li class="muted">Nothing found. Try another spelling, or a nearby bigger town.</li>';
        out.onclick = (ev) => {
          const b = ev.target.closest('[data-i]');
          if (!b) return;
          const p = places[b.dataset.i];
          setSeaPlace({ key: `q:${p.lat},${p.lng}`, name: `Off ${p.name}${p.countryCode ? ` (${p.countryCode})` : ''}`, lat: p.lat, lng: p.lng });
          route();
        };
      } catch (err) {
        out.innerHTML = html`<li class="error">${err.message}</li>`;
      }
    });
    let s;
    try {
      s = await seaFor(place);
    } catch (err) {
      view.querySelector('#sea-body').innerHTML = html`<div class="card pad">${place.key === 'here' && err.code ? "The phone didn't share its location. Choose a place above, or allow location." : err.message || 'Sea conditions are not available right now.'}</div>`;
      return;
    }
    const n = s.now;
    view.querySelector('#sea-rating').innerHTML = n.rating ? html`<span class="rating ${n.rating}">● ${SEA_RATING[n.rating]}</span>` : '';
    // Today's tide as a curve, with "now".
    const pts = s.tide.curve;
    const lo = Math.min(...pts.map((p) => p[1]), 0) - 0.1;
    const hi = Math.max(...pts.map((p) => p[1]), 0) + 0.1;
    const X = (h) => 6 + (h / 23) * 348;
    const Y = (v) => 90 - ((v - lo) / (hi - lo || 1)) * 80;
    const path = pts.map(([h, v], i) => `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const nowH = Number(s.localTime.slice(11, 13)) + Number(s.localTime.slice(14, 16)) / 60;
    const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    view.querySelector('#sea-body').innerHTML = html`<div class="sea-now">
        <div class="card"><b>${n.windKn ?? '–'} kn</b><span>Wind ${n.windDir || ''}</span><small>${n.gustKn != null ? `gusts ${n.gustKn}` : ''}</small></div>
        <div class="card"><b>${n.waveM != null ? wavesTxt(n.waveM) : '–'}</b><span>Waves</span><small>${n.swellM != null ? `swell ${wavesTxt(n.swellM)}${n.swellS ? ` · ${n.swellS} s` : ''}` : ''}</small></div>
        <div class="card"><b>${n.waterC != null ? tempTxt(n.waterC) : '–'}</b><span>Water</span><small>${n.airC != null ? `air ${tempTxt(n.airC)}` : ''}</small></div>
        <div class="card"><b>${n.currentKn ?? '–'} kn</b><span>Current ${n.currentDir ? `to ${n.currentDir}` : ''}</span><small>${n.tide ? `tide ${n.tide}` : ''}</small></div>
        <div class="card"><b>${s.sun.rise || '–'}</b><span>Sunrise</span><small>${s.sun.set ? `sunset ${s.sun.set}` : ''}</small></div>
        <div class="card"><b>${s.moon.lit}%</b><span>Moon</span><small>${s.moon.name}</small></div>
      </div>
      ${pts.length > 3 ? raw(html`<h2>Tide today</h2><div class="card pad"><svg class="tide-svg" viewBox="0 0 360 96" preserveAspectRatio="none" aria-label="Today's tide">
          <path d="${path} L${X(pts.at(-1)[0])},96 L${X(pts[0][0])},96Z" class="tide-fill"/><path d="${path}" class="tide-line"/>
          <line x1="${X(nowH)}" x2="${X(nowH)}" y1="0" y2="96" class="tide-now"/></svg>
        <div class="tide-times">${s.tide.turns.map((t) => raw(html`<span>${t.type === 'high' ? 'High' : 'Low'}<b>${t.time.slice(11, 16)}</b><small>${t.level > 0 ? '+' : ''}${t.level} m</small></span>`))}</div>
        <p class="small muted">Times from the ocean model, not a local tide table: right for timing, close for height.</p></div>`) : ''}
      <h2>Best fishing times</h2>
      <div class="card pad"><ul class="solunar">
        ${s.solunar.major.map((p) => raw(html`<li><b>Major</b><span>${hhmm(p.from)} – ${hhmm(p.to)}</span></li>`))}
        ${s.solunar.minor.map((p) => raw(html`<li><span>Minor</span><span>${hhmm(p.from)} – ${hhmm(p.to)}</span></li>`))}</ul>
        <p class="small muted">From the moon (solunar table). Fish tend to feed more around these times.</p></div>
      <h2>Next 7 days</h2>
      <ul class="card sea-days">${s.days.map((d) => raw(html`<li><span class="d"><b>${day(d.date)}</b>${Number(d.date.slice(8))}</span>
        <span class="w">${[d.windKn != null && `${d.windDir || ''} ${d.windKn} kn`, d.waveM != null && `waves ${wavesTxt(d.waveM)}`, d.waterC != null && tempTxt(d.waterC)].filter(Boolean).join(' · ')}</span>
        ${d.rating ? raw(html`<span class="rating ${d.rating}">${d.rating[0].toUpperCase() + d.rating.slice(1)}</span>`) : ''}</li>`))}</ul>
      <a class="card pad cur-link" href="#/chart">${raw(icon('map'))}<span><b>Fishing chart</b><span class="small muted">Depth contours, hotspots, currents, water temperature, wind, waves and your fish</span></span><span aria-hidden="true">›</span></a>
      <p class="center"><a href="#/depth">Depth check: compare the seabed map with your chart ›</a></p>
      <p class="small muted center">Forecast: Open-Meteo. Good: wind under 12 kn and waves under 1.5 m. Rough: wind 18 kn or more, or waves 2.2 m or more.</p>`;
  },

  // The chart: full screen, like Windy: the satellite with the club's depth contours (white lines
  // and depths). On top, one layer at a time: none, the hotspots (outlined), currents, water
  // temperature, wind or waves (colours, with moving lines); your own fish too. The time from
  // now to 3 days ahead. Tap the sea for everything at that spot.
  currents() { location.replace('#/chart'); },
  async chart() {
    const crew = !!(state.me?.teamId || state.me?.isAdmin);
    // Opened from the old Catch map (or "See them on the map"): the catches on, the map on them.
    const hq = new URLSearchParams(location.hash.split('?')[1] || '');
    const cf = { year: hq.get('year') || '', species: hq.get('species') || '', month: hq.get('month') || '' };
    const fromCatches = hq.has('catches') || hq.has('year') || hq.get('view') === 'regional';
    const LAYERS = [
      ['none', 'None', 'ban'], ['hotspots', 'Hotspots', 'target'], ['currents', 'Currents', 'currents'], ['sst', 'Temperature', 'thermometer'], ['wind', 'Wind', 'wind'], ['wave', 'Waves', 'wave'],
    ];
    // Each tile's thin strip: the colours that layer uses on the map.
    const grad = (stops) => `linear-gradient(90deg,${stops.map(([, c]) => `rgb(${c})`).join(',')})`;
    const PREVIEW = {
      none: 'transparent', hotspots: '#ff4081',
      currents: grad(SPEED_SCALE), sst: grad(SST_SCALE), wind: grad(WIND_SCALE), wave: grad(WAVE_SCALE),
    };
    const square = (attr, key, label, ic, on) => raw(html`<button type="button" class="chart-sq" ${raw(attr)}="${key}" aria-pressed="${on}">
      ${raw(icon(ic))}<span class="sq-name">${label}</span><i class="sq-strip" style="background:${PREVIEW[key]}"></i></button>`);
    view.innerHTML = html`<div class="chart">
      <div id="chart-map" class="chart-map"><div class="chart-wait">Getting the chart…</div></div>
      <div class="chart-note" id="chart-note" role="status" hidden></div>
      <div class="chart-top">
        <button type="button" class="chart-btn" data-back aria-label="Back">${raw(icon('back'))}</button>
        <button type="button" class="chart-title" id="chart-title" data-open-layers>Fishing chart</button>
      </div>
      <div class="chart-tools">
        <button type="button" class="chart-tool" data-open-layers aria-label="Layers">${raw(icon('layers'))}</button>
        ${state.me ? raw(html`<button type="button" class="chart-tool" data-open-list aria-label="Your fish, as a list" hidden>${raw(icon('list'))}</button>`) : ''}
        <span class="chart-gap"></span>
        <button type="button" class="chart-tool" data-zoom="1" aria-label="Zoom in">${raw(icon('plus'))}</button>
        <button type="button" class="chart-tool" data-zoom="-1" aria-label="Zoom out">${raw(icon('minus'))}</button>
        <button type="button" class="chart-tool" data-locate aria-label="My position">${raw(icon('locate'))}</button>
      </div>
      <div class="chart-panel" id="chart-list" hidden>
        <div class="panel-head"><b>Your fish</b><button type="button" class="chart-x" data-close-list aria-label="Close">${raw(icon('close'))}</button></div>
        <ul class="catch-list" id="catch-list"></ul>
      </div>
      <div class="chart-panel" id="chart-panel" hidden>
        <div class="panel-head"><b>Layers</b><button type="button" class="chart-x" data-close-layers aria-label="Close">${raw(icon('close'))}</button></div>
        <div class="sq-grid">${LAYERS.map(([k, label, ic]) => square('data-layer', k, label, ic, k === 'none'))}</div>
        ${state.me ? raw(html`<div class="panel-switches">
          <label>Depth contours <input type="checkbox" class="switch" data-show="contours" checked></label></div>
        <div class="panel-head"><b>Catches</b></div>
        <div class="panel-switches catches">
          <label><span>Your fish<small>${crew ? 'Your crew\'s exact spots. Only your crew sees them.' : 'Your own posts with a spot. Only you see them.'}</small></span><input type="checkbox" class="switch" data-show="fish" checked></label>
          <label><span>Regional<small>Where everyone's fish are caught: 10 km circles, no spots or boats.</small></span><input type="checkbox" class="switch" data-show="regional" ${hq.get('view') === 'regional' ? 'checked' : ''}></label>
        </div>
        <div class="catch-filters" id="catch-filters"></div>`) : ''}
      </div>
      <div class="chart-bottom">
        <div class="tl-row"><button type="button" class="chart-play" id="cur-play" aria-label="Play">${raw(icon('play'))}</button>
          <div class="tl-wrap"><div class="tl" id="tl" tabindex="0" aria-label="Time: swipe through the hours"></div><span class="tl-mark" aria-hidden="true"></span><span class="tl-bubble" id="tl-when"></span></div></div>
        <div class="chart-legend" id="chart-legend"></div>
      </div>
    </div>`;
    // The layers panel: opened with the layers button (or the name at the top), closed with the
    // cross or a tap on the map; picking a square shows it at once.
    const panel = view.querySelector('#chart-panel');
    const openLayers = (on) => { panel.hidden = !on; };
    view.querySelectorAll('[data-open-layers]').forEach((b) => b.addEventListener('click', () => openLayers(panel.hidden)));
    view.querySelector('[data-close-layers]').addEventListener('click', () => openLayers(false));
    const titleFor = (k) => LAYERS.find(([x]) => x === k)?.[1];
    // The name at the top: the map, and what's on it.
    let layer = 'none';
    // "Fishing chart", with the layer showing under it in small (so it fits a small phone).
    const setTitle = () => { view.querySelector('#chart-title').innerHTML = layer === 'none' ? 'Fishing chart' : html`<small>Fishing chart</small>${titleFor(layer)}`; };
    // Back to where the chart was opened from (or Sea conditions, if it was opened directly).
    const cameFrom = state.pagesSeen > 1;
    view.querySelector('[data-back]').addEventListener('click', () => { if (cameFrom) history.back(); else location.hash = '#/sea'; });
    let data;
    let L;
    let land = null;
    let redraw = null; // set once the map is up
    let prefs = {};
    fetch('/land.json').then((r) => r.json()).then((x) => { land = x; redraw?.(); }).catch(() => {});
    const box = view.querySelector('#chart-map');
    try {
      [L, prefs] = await Promise.all([loadLeaflet(), api('/chart/fishing').catch(() => ({}))]);
    } catch (err) {
      box.innerHTML = html`<div class="chart-wait">${err.message || 'The map couldn\'t load just now.'}</div>`;
      return;
    }
    box.innerHTML = '';
    // Opens close enough in for the depth contours (they show from zoom 8), off Marshall.
    // Pinching stops at the furthest zoom (no shrinking past it and bouncing back, which showed
    // empty grey around the map), and the map stays around West Africa.
    const map = L.map(box, { zoomControl: false, attributionControl: false, minZoom: 5, bounceAtZoomLimits: false,
      maxBounds: [[-12, -35], [24, 10]], maxBoundsViscosity: 1 }).setView([6.05, -10.55], 8);
    // The map's credit (Esri's terms): small, bottom left, just above the time strip.
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
    const bar = view.querySelector('.chart-bottom');
    const chartEl = view.querySelector('.chart');
    const lift = () => chartEl.style.setProperty('--bar-h', `${bar.hidden ? 0 : bar.offsetHeight}px`);
    new ResizeObserver(lift).observe(bar);
    lift();
    addSatellite(L, map, { fullScreen: true });
    const overlays = {};
    // The contours: the lines and depths only (white, without the charts' grey shading), so the
    // sea looks the same inside the charts and out.
    let contours = null;
    function syncContours() {
      contours?.remove();
      if (view.querySelector('[data-show=contours]')?.checked) contours?.addTo(map);
    }
    if (state.me) {
      api('/charts').then(({ charts }) => {
        if (!charts.length) return;
        contours = depthLayer(L, charts, { clean: true });
        syncContours();
      }).catch(() => {});
    }
    view.querySelectorAll('[data-show]').forEach((c) => c.addEventListener('change', () => {
      if (c.dataset.show === 'contours') return syncContours();
      if (c.dataset.show === 'regional') return; // drawn for the filters (below)
      const o = overlays[c.dataset.show];
      if (o) { if (c.checked) o.addTo(map); else o.remove(); }
    }));
    // The buttons down the side, as on a plotter: zoom, and the map on where you are.
    view.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => map.setZoom(map.getZoom() + Number(b.dataset.zoom))));
    let me = null;
    view.querySelector('[data-locate]').addEventListener('click', () => {
      navigator.geolocation.getCurrentPosition((pos) => {
        const at0 = [pos.coords.latitude, pos.coords.longitude];
        me?.remove();
        me = L.circleMarker(at0, { radius: 7, weight: 3, color: '#fff', fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
        map.setView(at0, Math.max(map.getZoom(), 10));
      }, () => toast('Your position isn\'t available. Check that location is on for the app.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
    map.on('click', () => openLayers(false));
    // ---- the catches: your fish (exact spots) and the region's (10 km circles) ----
    // One set of filters for both: year, species and month.
    let mySpots = [];
    let grid = null;
    const pins = new Map(); // a fish -> its pin
    const est = (x) => [x.depthM != null && estTxt(depthTxt(x.depthM)), x.waterC != null && estTxt(tempTxt(x.waterC))].filter(Boolean).join(' · ');
    const fishLink = (x) => (x.kind === 'catch' ? `#/catch/${x.id}` : x.kind === 'log' ? `#/fishon?date=${x.date}` : null);
    const shownFish = () => mySpots.filter((x) => (!cf.year || x.date.startsWith(cf.year)) && (!cf.species || x.species === cf.species)
      && (!cf.month || Number(x.date.slice(5, 7)) === Number(cf.month)));
    // Your fish over everything on the sea (the region's circles, the moving lines, outlines).
    if (!map.getPane('pins')) map.createPane('pins').style.zIndex = 610;
    const drawFish = () => {
      overlays.fish?.remove();
      pins.clear();
      const list = shownFish();
      overlays.fish = L.layerGroup(list.map((x) => {
        const pin = L.circleMarker([x.lat, x.lng], { pane: 'pins', radius: 6, weight: 2, color: '#fff', fillColor: x.released ? '#3fcf8e' : '#1a73e8', fillOpacity: 1 })
          .bindPopup(`<dl><dt>${esc(x.species)}</dt><dd>${x.weightKg ? `${x.estimate ? '~' : ''}${esc(fmtWeight(x.weightKg))}` : ''}${x.released ? ' released' : ''}</dd>
            <dt>Date</dt><dd>${esc(fmtDate(x.date))}</dd>${x.boat ? `<dt>Boat</dt><dd>${esc(x.boat)}</dd>` : ''}
            ${x.depthM != null ? `<dt>Depth</dt><dd>${esc(estTxt(depthTxt(x.depthM)))}</dd>` : ''}${x.waterC != null ? `<dt>Water</dt><dd>${esc(estTxt(tempTxt(x.waterC)))}</dd>` : ''}</dl>
            ${fishLink(x) ? `<a class="pop-link" href="${fishLink(x)}">${x.kind === 'log' ? 'Open the trip' : 'Open the catch'} ›</a>` : ''}`, { className: 'chart-pop' });
        pins.set(x, pin);
        return pin;
      }));
      if (view.querySelector('[data-show=fish]')?.checked) overlays.fish.addTo(map);
      // The list: the same fish, newest first; a tap flies to it.
      const ul = view.querySelector('#catch-list');
      if (ul) {
        ul.innerHTML = list.length ? list.map((x, n) => html`<li><button type="button" data-fish="${n}"><em><b>${x.species}</b>${x.weightKg ? ` · ${x.estimate ? '~' : ''}${fmtWeight(x.weightKg)}` : ''}${x.released ? ' · released' : ''}</em>
          <span>${fmtDate(x.date)}${x.angler ? ` · ${x.angler}` : ''}${est(x) ? ` · ${est(x)}` : ''}</span></button></li>`).join('')
          : '<li class="empty">No fish with a spot for this choice.</li>';
        ul.onclick = (e) => {
          const b = e.target.closest('[data-fish]');
          if (!b) return;
          const x = list[b.dataset.fish];
          view.querySelector('#chart-list').hidden = true;
          if (!view.querySelector('[data-show=fish]').checked) { view.querySelector('[data-show=fish]').checked = true; overlays.fish.addTo(map); }
          map.setView([x.lat, x.lng], Math.max(map.getZoom(), 10));
          pins.get(x)?.openPopup();
        };
      }
      const lb = view.querySelector('[data-open-list]');
      if (lb) lb.hidden = !mySpots.length;
    };
    const drawRegional = async () => {
      overlays.regional?.remove(); overlays.regional = null;
      if (!view.querySelector('[data-show=regional]')?.checked) return;
      const gq = new URLSearchParams({ year: cf.year || 'all', month: cf.month || 'all', ...(cf.species && { species: cf.species }) });
      try { grid = await api(`/outings/grid?${gq}`); } catch { return; }
      if (!view.isConnected || !view.querySelector('[data-show=regional]')?.checked) return;
      const most = Math.max(1, ...grid.cells.map((c) => c.fish));
      overlays.regional?.remove();
      overlays.regional = L.layerGroup(grid.cells.map((c) => L.circle([(c.south + c.north) / 2, (c.west + c.east) / 2],
        { radius: 6000, color: '#fff', weight: 1, fillColor: '#ffd166', fillOpacity: 0.25 + 0.55 * (c.fish / most) })
        .bindPopup(`<dl><dt>Fish</dt><dd>${c.fish}</dd><dt>Boats</dt><dd>${c.boats}</dd></dl>`, { className: 'chart-pop' }))).addTo(map);
      filters();
    };
    // The filters: what's in your fish and the region's, together.
    const filters = () => {
      const box0 = view.querySelector('#catch-filters');
      if (!box0) return;
      const years = [...new Set([...mySpots.map((x) => x.date.slice(0, 4)), ...(grid?.years || [])])].sort().reverse();
      const species = [...new Set([...mySpots.map((x) => x.species), ...(grid?.speciesList || [])])].sort();
      const sel = (k, label, items) => html`<select data-cf="${k}" aria-label="${label}">${raw(items.map(([v, t]) => html`<option value="${v}"${v === cf[k] ? ' selected' : ''}>${t}</option>`).join(''))}</select>`;
      box0.innerHTML = sel('year', 'Year', [['', 'All years'], ...years.map((y) => [y, y])])
        + sel('species', 'Species', [['', 'All species'], ...species.map((x) => [x, x])])
        + sel('month', 'Month', [['', 'All months'], ...MONTH_SHORT.map((m, n) => [String(n + 1), m])]);
    };
    if (state.me) {
      view.querySelector('#catch-filters').addEventListener('change', (e) => {
        const k = e.target.dataset.cf;
        if (!k) return;
        cf[k] = e.target.value;
        drawFish();
        drawRegional();
      });
      view.querySelector('[data-show=regional]').addEventListener('change', drawRegional);
      view.querySelector('[data-open-list]').addEventListener('click', () => { openLayers(false); view.querySelector('#chart-list').hidden = false; });
      view.querySelector('[data-close-list]').addEventListener('click', () => { view.querySelector('#chart-list').hidden = true; });
      map.on('click', () => { view.querySelector('#chart-list').hidden = true; });
      api('/me/spots').then(({ spots }) => {
        mySpots = spots.filter((x) => x.lat != null);
        drawFish();
        filters();
        // Opened for the catches: the map on them.
        const list = shownFish();
        if (fromCatches && list.length) map.fitBounds(L.latLngBounds(list.map((x) => [x.lat, x.lng])).pad(0.3), { maxZoom: 10 });
      }).catch(() => {});
      filters();
      drawRegional();
    }
    syncContours();
    // Until the forecast is here: the chart alone (with its contours), a note on top, and the
    // forecast's layers and time strip waiting.
    const note = view.querySelector('#chart-note');
    const tlRow = view.querySelector('.tl-row');
    const waiting = (on) => {
      tlRow.hidden = on;
      view.querySelector('.chart-bottom').hidden = on;
      view.querySelector('.chart').style.setProperty('--bar-h', on ? '0px' : `${view.querySelector('.chart-bottom').offsetHeight}px`);
      view.querySelectorAll('[data-layer]').forEach((b) => { if (b.dataset.layer !== 'none') b.disabled = on; });
      if (!on) note.hidden = true;
    };
    const say = (h) => { note.innerHTML = h; note.hidden = false; };
    waiting(true);
    // The chart's data: if the server can't be reached (no signal, or it's restarting after an
    // update), it keeps trying quietly every 20 seconds while the page is open.
    for (;;) {
      try { data = await api('/currents'); break; } catch (err) {
        say(html`<b>Can't get the forecast just now.</b> ${err.message} Trying again by itself…`);
        await wait(20000);
        if (!view.isConnected) return;
      }
    }
    // Just after an update the server is still fetching the forecast (a few minutes): say
    // so, and open the chart by itself as soon as it's ready.
    // (Anything without a chart in it counts as not ready yet.)
    while (!Array.isArray(data?.frames)) {
      // If the forecast service turned the server away, say why and when it tries again.
      const r = data?.refused;
      say(r && !data.fetching
        ? html`<b>No forecast layers for now.</b> They come back by themselves.`
        : html`<b>Getting the latest sea forecast…</b> The layers come on by themselves in a few minutes.`);
      await wait(20000);
      if (!view.isConnected) return;
      try { data = await api('/currents'); } catch { /* try again in a moment */ }
    }
    waiting(false);
    // The waves' direction as a vector (where they go), worked out once per frame.
    for (const f of data.frames) {
      if (!f.wh || f.xu) continue;
      f.xu = f.wd.map((d, k) => (d == null || f.wh[k] == null ? null : Math.sin(((d + 180) * Math.PI) / 180)));
      f.xv = f.wd.map((d, k) => (d == null || f.wh[k] == null ? null : Math.cos(((d + 180) * Math.PI) / 180)));
    }
    fishingField(data, prefs);
    const hasWind = data.frames.some((f) => f.wu);
    if (!hasWind) view.querySelector('[data-layer=wind]').disabled = true;
    // Every hour, from the first of the forecast's 3-hour steps to the last; the hours between
    // two steps are blended from them (as Windy does between its model's steps).
    const t0 = Date.parse(`${data.frames[0].time}:00Z`);
    const HOURS = (data.frames.length - 1) * 3 + 1;
    const BLEND = ['u', 'v', 'sst', 'wh', 'wu', 'wv', 'xu', 'xv', 'fish'];
    const hourCache = new Map();
    const frameAt = (h) => {
      const i = Math.floor(h / 3); const t = (h % 3) / 3;
      if (!t || i >= data.frames.length - 1) return data.frames[Math.min(i, data.frames.length - 1)];
      if (hourCache.has(h)) return hourCache.get(h);
      const a = data.frames[i]; const b = data.frames[i + 1];
      const f = { time: new Date(t0 + h * 3600e3).toISOString().slice(0, 16), wd: t < 0.5 ? a.wd : b.wd, why: t < 0.5 ? a.why : b.why };
      for (const k of BLEND) {
        if (!a[k] || !b[k]) { f[k] = a[k] || b[k] || null; continue; }
        f[k] = a[k].map((x, n) => (x == null || b[k][n] == null ? (x ?? b[k][n]) : x + (b[k][n] - x) * t));
      }
      hourCache.set(h, f);
      return f;
    };
    let hour = Math.min(HOURS - 1, Math.max(0, Math.floor((Date.now() - t0) / 3600e3)));
    const nowHour = hour;
    let cur = frameAt(hour);
    // Each layer: its colours, the lines' field (and how fast they look), and its scale's ends.
    // per: screen area per line, Windy's density for each (the wind far sparser than the water).
    const num1 = (x) => String(Math.round(x * 10) / 10);
    const LAYER = {
      // The scale's unit, and each colour's value in it. None: just the chart. Hotspots: outlined,
      // with the current's lines faint over them.
      none: { lines: null, per: 1e9 },
      hotspots: { hot: true, lines: ['u', 'v', 1], per: 420 },
      currents: { colour: 'speed', stops: SPEED_SCALE, lines: ['u', 'v', 1], unit: () => 'kn', label: num1 },
      sst: { colour: 'sst', stops: SST_SCALE, lines: ['u', 'v', 1], unit: () => unit('temp'), label: (v) => Math.round(toUnit('temp', v)) },
      wind: { colour: 'wind', stops: WIND_SCALE, lines: ['wu', 'wv', 1 / 6], per: 1100, overLand: true, unit: () => 'kn', label: (v) => v },
      wave: { colour: 'wave', stops: WAVE_SCALE, lines: ['xu', 'xv', 0.45], per: 550, crests: true, unit: () => unit('depth'), label: (v) => num1(toUnit('depth', v)) },
    };

    let labels = null;
    let at = null;
    let lines = null;
    // The pictures: each hour's drawn once (off to the side, made into a file without holding the
    // screen up), kept for the hours seen, and put on the map only when it's ready, over the one
    // before, which goes then: no blank moment and no flicker while the time moves.
    const pics = new Map(); // key -> Promise of a picture URL
    const picFor = (key, draw) => {
      if (!pics.has(key)) {
        pics.set(key, new Promise((ok) => draw().toBlob((b) => ok(b ? URL.createObjectURL(b) : null))));
        if (pics.size > 150) { const [old] = pics.keys(); pics.get(old).then((u) => u && URL.revokeObjectURL(u)); pics.delete(old); }
      }
      return pics.get(key);
    };
    window.addEventListener('hashchange', () => { for (const p of pics.values()) p.then((u) => u && URL.revokeObjectURL(u)); pics.clear(); }, { once: true });
    const imgBounds = raster(data, 1).bounds;
    let shown = null; // the picture on the map
    let ticket = 0;
    const putPic = async (key, draw, opacity, className) => {
      const mine = ++ticket;
      if (!key) { shown?.remove(); shown = null; return; }
      const url = await picFor(key, draw);
      if (mine !== ticket || !url) return;
      const next = L.imageOverlay(url, imgBounds, { opacity, className, interactive: false });
      next.once('load', () => {
        if (mine !== ticket) { next.remove(); return; }
        shown?.remove();
        shown = next;
      });
      next.addTo(map);
    };
    let outline = null;
    const outlines = new Map(); // hour -> the hotspots' line pieces
    let isPlaying = false;
    // While playing, the next hour's picture is drawn ahead, so each step is ready when it comes.
    const ahead = (h) => {
      const L1 = LAYER[layer]; const f = frameAt(h); const coast = L1.overLand ? null : land;
      if (L1.hot) picFor(`${layer}|${h}|${coast ? 'cut' : 'whole'}`, () => hotspotCanvas(data, f, land));
      else if (L1.colour) picFor(`${layer}|${h}|${coast ? 'cut' : 'whole'}`, () => fieldCanvas(data, f, L1.colour, L1.stops, coast));
    };
    const show = () => {
      const f = frameAt(hour);
      cur = f;
      const L1 = LAYER[layer];
      at = sampler(data, f);
      if (L1.lines) {
        const [ku, kv, k] = L1.lines;
        lines = (lat, lng, key) => { const x = at(lat, lng, key === 'u' ? ku : kv); return x == null ? null : x * k; };
      } else lines = null;
      labels?.remove(); labels = null;
      outline?.remove(); outline = null;
      const coast = L1.overLand ? null : land;
      const key = `${layer}|${hour}|${coast ? 'cut' : 'whole'}`;
      if (L1.hot) {
        putPic(key, () => hotspotCanvas(data, f, land), 1, 'hot-image');
        const lk = `${hour}|${land ? 1 : 0}`;
        if (!outlines.has(lk)) outlines.set(lk, hotspotLines(data, f, land));
        if (!map.getPane('outlines')) { map.createPane('outlines').style.zIndex = 420; map.getPane('outlines').style.pointerEvents = 'none'; }
        outline = L.polyline(outlines.get(lk), { pane: 'outlines', color: '#ff4081', weight: 2.5, opacity: 1, interactive: false, smoothFactor: 0 }).addTo(map);
        labels = L.layerGroup(hotspotLabels(data, f).map((p) => L.tooltip({ permanent: true, direction: 'center', className: 'hot-label', interactive: false })
          .setLatLng([p.lat, p.lng]).setContent(p.text))).addTo(map);
      } else if (L1.colour) {
        // The wind blows over the land too (as on Windy); the sea's layers stop at the shore.
        // A little see-through, so the contours show under the colours.
        putPic(key, () => fieldCanvas(data, f, L1.colour, L1.stops, coast), 0.85, 'field-image');
      } else putPic(null);
      if (isPlaying && hour + 1 < HOURS) setTimeout(() => ahead(hour + 1), 30);
      view.querySelector('#tl-when').textContent = new Date(t0 + hour * 3600e3).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      // The scale like Windy's: the unit, then each colour's value where it sits (every other
      // one when there are many).
      const legend = view.querySelector('#chart-legend');
      legend.hidden = !L1.stops && !L1.hot;
      if (L1.hot) {
        legend.innerHTML = html`<span class="lg-key"><i></i>Hotspots: temperature breaks, current edges, the shelf</span>`;
        return;
      }
      if (!L1.stops) return;
      const n = L1.stops.length;
      const every = n > 9 ? 2 : 1;
      legend.innerHTML = html`<span class="lg-unit">${L1.unit()}</span><span class="lg-bar" style="background:linear-gradient(90deg,${L1.stops.map(([, c]) => `rgb(${c})`).join(',')})">${
        L1.stops.map(([v], k) => (k !== n - 1 && (k % every || n - 1 - k < every) ? '' : raw(html`<b style="left:${(k / (n - 1)) * 100}%" class="${k === 0 ? 'first' : k === n - 1 ? 'last' : ''}">${L1.label(v)}</b>`)))}</span>`;
    };
    const bounds = [[data.south, data.west], [data.south + (data.ny - 1) * data.step, data.west + (data.nx - 1) * data.step]];
    const flow = flowLayer(map, () => lines, () => (LAYER[layer].overLand ? null : land), bounds, () => LAYER[layer]);
    redraw = () => { show(); flow.reseed(); };
    // The time strip, like Windy's: the days as blocks with a mark for each hour, swiped under
    // a fixed pointer; it settles on whole hours and the bubble says which.
    const PX = 22; // per hour
    const tl = view.querySelector('#tl');
    const days = [];
    for (let h = 0; h < HOURS; h++) {
      const d = new Date(t0 + h * 3600e3);
      const key = d.toDateString();
      if (days.at(-1)?.key !== key) days.push({ key, d, hours: [] });
      days.at(-1).hours.push({ h: d.getHours(), label: d.toLocaleTimeString(undefined, { hour: 'numeric' }) });
    }
    tl.innerHTML = html`<span class="tl-pad"></span>${days.map((day, n) => raw(html`<div class="tl-day${n % 2 ? ' alt' : ''}" style="width:${day.hours.length * PX}px">
      <b>${day.d.toLocaleDateString(undefined, { weekday: 'long' })} ${day.d.getDate()}</b>
      <span class="tl-hours">${day.hours.map(({ h, label }) => raw(h % 3 ? '<i></i>' : html`<i class="big"><em>${label}</em></i>`))}</span></div>`))}<span class="tl-pad"></span>`;
    const pads = () => { for (const p of tl.querySelectorAll('.tl-pad')) p.style.width = `${Math.max(0, tl.clientWidth / 2 - PX / 2)}px`; };
    pads();
    tl.scrollLeft = hour * PX;
    let ticking = false;
    tl.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const h = Math.min(HOURS - 1, Math.max(0, Math.round(tl.scrollLeft / PX)));
        if (h !== hour) { hour = h; show(); }
      });
    }, { passive: true });
    window.addEventListener('resize', () => { if (view.isConnected) { pads(); tl.scrollLeft = hour * PX; } });
    // Play: hour by hour to 3 days ahead, round again from now; touching the strip stops it.
    const playBtn = view.querySelector('#cur-play');
    let playing = 0;
    const stopPlay = () => { clearInterval(playing); playing = 0; isPlaying = false; playBtn.innerHTML = icon('play'); playBtn.setAttribute('aria-label', 'Play'); };
    tl.addEventListener('pointerdown', stopPlay);
    tl.addEventListener('wheel', stopPlay, { passive: true });
    playBtn.addEventListener('click', () => {
      if (playing) return stopPlay();
      playBtn.innerHTML = icon('pause'); playBtn.setAttribute('aria-label', 'Pause');
      isPlaying = true;
      ahead(hour + 1);
      playing = setInterval(() => {
        if (!view.isConnected) return stopPlay();
        const next = hour + 1 >= HOURS ? nowHour : hour + 1;
        tl.scrollTo({ left: next * PX, behavior: next === nowHour ? 'auto' : 'smooth' });
      }, 500);
    });
    // Keys (a keyboard or a screen reader): left and right step an hour.
    tl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      tl.scrollTo({ left: Math.min(HOURS - 1, Math.max(0, hour + (e.key === 'ArrowRight' ? 1 : -1))) * PX });
    });
    view.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => {
      layer = b.dataset.layer;
      view.querySelectorAll('[data-layer]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      setTitle();
      show();
      flow.reseed();
    }));
    // Tap the sea: everything at that spot.
    map.on('click', (e) => {
      if (!at) return;
      const { lat, lng } = e.latlng;
      const u = at(lat, lng, 'u'); const v = at(lat, lng, 'v');
      const wu = at(lat, lng, 'wu'); const wv = at(lat, lng, 'wv');
      const t = at(lat, lng, 'sst'); const wh = at(lat, lng, 'wh');
      const f = cur;
      if (u == null && wu == null) return;
      // Directions and reasons: the nearest grid point's (they don't blend).
      const i0 = Math.round((lng - data.west) / data.step); const j0 = Math.round((lat - data.south) / data.step);
      const fish = at(lat, lng, 'fish');
      const hot = fish != null && fish >= hotspotLimit(f);
      const why = f.why?.[j0 * data.nx + i0] || 0;
      const reasons = [why & 1 && 'temperature break', why & 2 && 'current edge', why & 4 && 'shelf', why & 8 && 'the water billfish like'].filter(Boolean);
      const d = data.depth?.[j0 * data.nx + i0];
      const wd = f.wd?.[j0 * data.nx + i0];
      const deg = (x, y) => (Math.atan2(x, y) * 180) / Math.PI;
      // Short, as a plotter shows it: the name, then the value (compass points as N, SE…).
      const pt = (deg0) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg0 % 360) + 360) % 360) / 45) % 8];
      const rows = [
        hot && reasons.length && ['Hotspot', reasons.join(', ')],
        d != null && ['Depth', estTxt(depthTxt(d))],
        u != null && ['Current', `${Math.hypot(u, v).toFixed(1)} kn → ${pt(deg(u, v))}`],
        t != null && ['Water', estTxt(tempTxt(t))],
        wu != null && ['Wind', `${Math.round(Math.hypot(wu, wv))} kn from ${pt(deg(wu, wv) + 180)}`],
        wh != null && ['Waves', `${wavesTxt(wh)}${wd != null ? ` from ${pt(wd)}` : ''}`],
      ].filter(Boolean);
      L.popup({ className: 'chart-pop', closeButton: false, autoPanPadding: [16, 90] }).setLatLng(e.latlng)
        .setContent(`<dl>${rows.map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>`).openOn(map);
    });
    show();
  },

  // Depth check: the seabed map's depth (GEBCO) at positions typed as a chart plotter shows
  // them, or at your own logged fish, to compare with your chart.
  async depth() {
    if (!state.me) return needLogin(view, 'check depths');
    view.innerHTML = html`<p class="back"><a href="#/sea">‹ Sea conditions</a></p>
      <h1>Depth check</h1>
      <p class="small muted">Positions as your plotter shows them, one per line: <b>N 06° 18.740' W 010° 48.740'</b>, or <b>6.3123, -10.8123</b>.
      Each gets the depth from GEBCO, the world's seabed map (a grid of about 450 m), to compare with your chart.</p>
      <form class="card pad stack" id="dc">
        <label>Positions <textarea name="pos" rows="5" placeholder="N 06° 18.740' W 010° 48.740'"></textarea></label>
        <div class="row-buttons"><button type="submit" class="primary">Get depths</button><button type="button" data-mine>Use my last fish</button></div>
        <p class="error"></p>
      </form>
      <div id="dc-out"></div>`;
    const form = view.querySelector('#dc');
    const out = view.querySelector('#dc-out');
    // N/S and E/W with degrees and minutes (or seconds), or two plain numbers.
    const parse = (line) => {
      const hemi = [...line.matchAll(/([NSEW])\s*(\d+(?:\.\d+)?)(?:[°\s]+(\d+(?:\.\d+)?)['′]?)?(?:\s*(\d+(?:\.\d+)?)["″])?/gi)];
      if (hemi.length >= 2) {
        const v = ([, h, d, m, s]) => (Number(d) + (Number(m) || 0) / 60 + (Number(s) || 0) / 3600) * (/[SW]/i.test(h) ? -1 : 1);
        const lat = hemi.find((x) => /[NS]/i.test(x[1]));
        const lng = hemi.find((x) => /[EW]/i.test(x[1]));
        return lat && lng ? { lat: v(lat), lng: v(lng) } : null;
      }
      const n = line.match(/(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/);
      return n ? { lat: Number(n[1]), lng: Number(n[2]) } : null;
    };
    view.querySelector('[data-mine]').onclick = async () => {
      try {
        const { spots } = await api('/me/spots');
        const mine = spots.filter((x) => x.lat != null).slice(0, 15);
        if (!mine.length) { toast('No fish with a spot yet.'); return; }
        form.pos.value = mine.map((x) => `${fmtCoords(x.lat, x.lng)}  (${x.species}, ${x.date})`).join('\n');
      } catch (err) { toast(err.message); }
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = form.pos.value.split('\n').map((l) => l.trim()).filter(Boolean);
      const rows = lines.map((l) => ({ line: l, pos: parse(l) }));
      const bad = rows.filter((r) => !r.pos || Math.abs(r.pos.lat) > 90 || Math.abs(r.pos.lng) > 180);
      form.querySelector('.error').textContent = bad.length ? `Couldn't read: ${bad.map((r) => r.line).join('; ')}` : '';
      const good = rows.filter((r) => !bad.includes(r));
      if (!good.length) return;
      out.innerHTML = '<div class="card pad muted">Getting depths…</div>';
      try {
        const { depths } = await api(`/depth?at=${good.map((r) => `${r.pos.lat.toFixed(5)},${r.pos.lng.toFixed(5)}`).join('|')}`);
        out.innerHTML = html`<ul class="card depth-list">${good.map((r, i) => raw(html`<li><span>${fmtCoords(r.pos.lat, r.pos.lng)}
          ${r.line.includes('(') ? raw(html`<small class="muted">${r.line.slice(r.line.indexOf('('))}</small>`) : ''}</span>
          <b>${depths[i].depthM == null ? 'land' : `${Math.round(toUnit('depth', depths[i].depthM))} ${unit('depth')}`}</b></li>`))}</ul>
          <p class="small muted">Compare with your chart at the same positions. GEBCO is approximate: close offshore where the bottom is
          gentle, less so near reefs, wrecks and the shelf edge, where the depth changes within a few hundred metres.</p>`;
      } catch (err) {
        out.innerHTML = html`<div class="card pad">${err.message}</div>`;
      }
    });
  },

  // How to put the app on the home screen, for each kind of phone.
  async install() {
    const ua = navigator.userAgent;
    const iphone = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const samsung = /SamsungBrowser/.test(ua);
    const steps = iphone
      ? ['Tap the <b>Share</b> button: the square with an arrow (at the bottom in Safari, at the top right in Chrome).',
        'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.',
        'Open <b>Sportfishing</b> from your home screen (notifications only work there).']
      : samsung
        ? ['Tap the <b>menu</b> (☰) at the bottom right.', 'Tap <b>Add page to</b>, then <b>Home screen</b>.', 'Tap <b>Add</b>.']
        : ['Tap the browser\'s <b>menu</b> (⋮) at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b>.'];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <div class="install-head"><img src="/icon-192.png" alt="" width="72" height="72"><div><h1>Install the app</h1>
        <p class="muted">Opens full screen, like any other app.</p></div></div>
      ${isInstalled() ? raw('<div class="card pad"><p style="margin:0">It\'s installed: you\'re using the app now.</p></div>') : raw(html`
      <div class="card pad stack" data-install-ready ${installPrompt ? '' : raw('hidden')}>
        <button type="button" class="primary" id="install-now">${raw(icon('download'))} Install now</button>
      </div>
      <h2>${installPrompt ? 'Or, step by step' : 'Step by step'}</h2>
      <ol class="card pad install-steps">${steps.map((t) => raw(`<li>${t}</li>`))}</ol>`)}`;
    view.querySelector('#install-now')?.addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      if (outcome === 'accepted') view.querySelector('[data-install-ready]').hidden = true;
    });
  },

  async more() {
    const me = state.me;
    if (me?.canReview) await refreshPending();
    const clubRequests = me?.isAdmin ? (await api('/admin/club-requests').catch(() => ({ requests: [] }))).requests.length : 0;
    const item = (href, iconName, label, sub = '', count = 0) => `<a class="menu-item" href="${href}">
      <span class="mi-icon">${icon(iconName)}</span>
      <span class="mi-text"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
      ${count ? `<span class="count-badge" aria-hidden="true">${count}</span>` : ''}
      <span class="mi-go" aria-hidden="true">›</span></a>`;
    view.innerHTML = html`<div class="page-head"><h1 class="center">More</h1>${raw(themeButton())}</div>
      ${me ? raw(html`<div class="card pad me-card">
          <a class="me-photo" href="#/user/${me.id}" aria-label="My dashboard">${me.photoUrl ? raw(html`<img src="${me.photoUrl}" alt="">`) : raw(`<span class="me-ph">${icon('user')}</span>`)}</a>
          <span class="me-who"><b>${me.displayName}</b><span class="muted small">${me.teamName ? `${me.teamName}${me.isCaptain ? ' · Captain' : ''}` : 'Individual angler'}</span>
            <span class="small me-links"><a class="me-link" href="#/user/${me.id}">My dashboard ›</a>${me.teamId ? raw(html`<a class="me-link" href="#/boat/${me.teamId}">Boat ›</a>`) : ''}</span></span>
        </div>`)
        : raw(`<div class="card pad"><p style="margin-top:0">Sign in to log fish with your boat.</p>
          <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Create account</a></div>`)}
      ${isInstalled() ? '' : raw(`<div class="card pad install-card">
        <img src="/icon-192.png" alt="" width="48" height="48">
        <div><b>Get the app</b><span class="small muted">On your home screen, opens like any other app</span></div>
        <button type="button" class="primary" data-install>${icon('download')} Install</button>
      </div>`)}
      ${me ? raw(`<h2>Account</h2><div class="card menu">
        ${me.teamId ? item(`#/boat/${me.teamId}?manage=1`, 'boat', 'My boat', `${me.teamName}: invite code, crew, details`) : item('#/crew', 'boat', 'Get on a boat', 'Join a crew or register your boat')}
        ${item('#/profile', 'edit', 'Edit profile', 'Name, photo, units, password')}
        ${item('#/notifications', 'bell', 'Notifications', 'What this phone tells you about')}
      </div>
      <h2>Fishing</h2><div class="card menu">
        ${item('#/sea', 'wave', 'Sea conditions', 'Wind, waves, water, tide and the week ahead')}
        ${item('#/chart', 'map', 'Fishing chart', 'Contours, hotspots, currents, wind, waves and your catches')}
        ${item('#/log', 'history', 'Log', me.teamId ? "Your boat's log, and the regional log" : "Every boat's trips, and the season at a glance")}
      </div>
      ${me.canWeigh && !me.canApprove ? `<h2>Weigh-in &amp; points</h2><div class="card menu">
        ${item('#/weigh', 'weight', 'Weigh-in', me.weighmasterAt ? `You're the weighmaster at ${me.weighmasterAt}: its boats` : `Today's fish for ${me.teamName}${me.weighStation ? ` at ${me.weighStation}` : ''}`)}
        ${item('#/pending', 'eye', 'Pending registrations', 'Fish waiting for the secretary; dispute within 24 hours')}
      </div>` : ''}`) : ''}
      ${me?.canReview || me?.canHandleMoney ? raw(`<h2>JHMMC</h2><div class="card menu">
        ${me.canReview ? item('#/desk', 'review', 'Secretary desk', state.pending ? `${plural(state.pending, 'fish')} waiting · start here` : 'Everything waiting for you, in one place', state.pending) : ''}
        ${me.canApprove ? item('#/review', 'review', 'Review catches', state.pending ? `${plural(state.pending, 'registration')} waiting` : 'Check and approve points', state.pending) : ''}
        ${me.canApprove ? item('#/weigh', 'weight', 'Weigh-in', 'For any boat, any day (a paper form)') : ''}
        ${item('#/tournaments?sheets=1', 'trophy', 'Tournament sheets', "Who's in, anglers, memberships to collect")}
        ${item('#/club-members', 'participants', 'Club members', 'Who has paid their membership this season')}
        ${me.canReview ? item('#/history', 'history', 'Registration history', 'Every registration, dispute and decision') : ''}
        ${me.canReview || me.isAdmin ? item('#/activity', 'history', 'Activity log', 'Everything the officers and the admin changed') : ''}
        ${me.canReview || me.isAdmin ? item('#/reports', 'flag', 'Reports', me.openReports ? `${plural(me.openReports, 'report')} to look at` : 'Posts and profiles members reported', me.openReports) : ''}
        ${me.canApprove && !me.isAdmin ? item('#/members', 'key', 'Members', 'Everyone on the app: tick who is in JHMMC') : ''}
        ${me.canApprove && !me.isAdmin ? item('#/admin-boats', 'boat', 'JHMMC boats', 'Weigh stations, Ocean or River') : ''}
        ${me.canApprove ? item('#/weighmasters', 'weight', 'Weighmasters', 'Who weighs at each weigh station') : ''}
        ${me.canReview ? item('#/calendar', 'calendar', 'Season calendar', 'Season dates and tournaments') : ''}
        ${me.canReview ? item('#/scoring', 'calculator', 'Scoring table', 'Points per kg for each species') : ''}
      </div>`) : ''}
      ${me?.isAdmin ? raw(`<h2>Platform admin</h2><div class="card menu">
        ${item('#/members', 'key', 'Members', 'Accounts, roles, password reset links')}
        ${item('#/admin-boats', 'boat', 'Boats', 'Weigh stations, Ocean or River')}
        ${item('#/clubs', 'clubs', 'Clubs', clubRequests ? 'Requests to open a club waiting for you' : 'Open clubs and answer requests', clubRequests)}
        ${item('#/backups', 'download', 'Backups', 'Copies of every fish, account and point')}
      </div>`) : ''}
      <h2>Info</h2><div class="card menu">
        ${raw(item('#/rules?book=jhmmc', 'rules', 'JHMMC rules', '2026-2027 season'))}
        ${raw(item('#/community', 'shield', 'Community rules', 'What can be posted; reporting and blocking'))}
        ${raw(item('#/rules?book=igfa', 'scale', 'IGFA rules', 'International Angling Rules summary'))}
        ${raw(me?.canReview ? '' : item('#/scoring', 'calculator', 'How points work', 'Points per kg for each species'))}
        ${raw(me?.canReview ? '' : item('#/calendar', 'calendar', 'Season calendar', 'Tournaments'))}
        ${raw(me?.isAdmin ? '' : item('#/clubs', 'clubs', 'Clubs', 'Every club, or ask to open one'))}
        ${raw(me ? '' : item('#/log', 'history', 'Regional log', "Every boat's trips"))}
        ${raw(item('/support', 'rules', 'Help', 'Getting started, your account, contact us'))}
        ${raw(item('/privacy', 'key', 'Privacy policy', 'What the app keeps, who sees it, deleting your account'))}
      </div>
      ${me ? raw('<p class="center"><button id="logout">Sign out</button></p>') : ''}`;
    view.querySelector('#logout')?.addEventListener('click', async () => {
      await signOut();
      location.hash = '#/';
    });
  },
}));
