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
      <p class="center"><a href="#/depth">Depth check: compare the seabed map with your chart ›</a></p>
      <p class="small muted center">Forecast: Open-Meteo. Good: wind under 12 kn and waves under 1.5 m. Rough: wind 18 kn or more, or waves 2.2 m or more.</p>`;
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
        ${item('#/spots', 'pin', 'Catch map', me.teamId ? 'Your crew\'s spots, and the region month by month' : 'Where fish are being caught, month by month')}
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
