// Africa Sportfishing, part of the app (public/js/pages-feed.js): The feed, catches, crews, boats and clubs.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// Home's cards, filled in as their data comes: the tournament on or next, today's fish to
// weigh (crews), today's sea with its tides, sun, moon and best times, what's biting, and the
// offer of notifications.
function homeCards(view) {
    // What's biting: every boat's fish in the last 14 days against the 14 before, the top few.
    api('/outings/trends').then((tr) => {
      const box = view.querySelector('#biting');
      const top = (tr.now?.biting || []).filter((r) => r.now > 0).slice(0, 3);
      if (!box || !top.length) return;
      const arrow = (r) => (r.now > r.before ? '<span class="up">↑</span>' : r.now < r.before ? '<span class="down">↓</span>' : '');
      box.innerHTML = html`<a class="home-tile wide biting-card" href="#/log?tab=trends&scope=regional">${raw(icon('fish'))}<span><b>What's biting</b>
        ${raw(top.map((r) => html`<span class="bite"><b>${r.species}</b> ${r.now}${raw(arrow(r))}${r.area ? ` · mostly ${r.area}` : ''}</span>`).join(''))}
        <span class="small muted">The last 14 days, ${plural(tr.now.boats, 'boat')}</span></span><span class="go" aria-hidden="true">›</span></a>`;
    }).catch(() => {});
    // Today's trip, for the card at the top: fish boated but not weighed in yet.
    if (state.me?.teamId) {
      api(`/outings/trip?date=${today()}`).then(({ trip }) => {
        if (!trip) return;
        const waiting = trip.landings.filter((l) => l.fate === 'kept' && !l.catchId);
        const weigh = view.querySelector('#weigh-call');
        if (state.me.canWeigh && waiting.length && weigh) {
          const counts = {};
          for (const l of waiting) counts[l.species] = (counts[l.species] || 0) + 1;
          weigh.innerHTML = html`<a class="card pad weigh-call" href="#/weigh">${raw(icon('weight'))}
            <span><b>${plural(waiting.length, 'fish')} boated today</b>
              <span class="small muted">${Object.entries(counts).map(([sp, n]) => `${n} ${sp.toLowerCase()}`).join(', ')}</span></span>
            <span class="btn primary">Go to the weigh-in</span></a>`;
        }
      }).catch(() => {});
    }
    // A tournament coming up or under way: JHMMC captains see it first thing, with
    // a big Enter your boat until they're in.
    // Everyone else sees it too, with a link to the tournament.
    {
      const captain = !!state.me?.canWeigh && !state.me.canHandleMoney && isJhmmc(state.me.clubId);
      api('/tournaments').then(({ tournaments }) => {
        const t = tournaments.find((x) => x.open);
        const box = view.querySelector('#tournament-call');
        if (!t || !box) return;
        box.innerHTML = !captain
          ? html`<a class="card pad tournament-call" href="#/tournaments">
              <div class="tc-head">${raw(icon('trophy'))}<span class="small">Tournament</span></div>
              <b class="tc-name">${t.name}</b>
              <span class="muted">${fmtDays(t)} · ${plural(t.boats, 'boat')} entered</span>
              <span class="small me-link">See the tournament ›</span>
            </a>`
          : t.mine
          ? html`<a class="card pad tournament-in" href="#/enter/${t.id}">${raw(icon('check'))}
              <span>Your boat is entered in <b>${t.name}</b> · ${fmtDays(t)}</span><span class="small">Anglers ›</span></a>`
          : html`<div class="card pad tournament-call">
              <div class="tc-head">${raw(icon('trophy'))}<span class="small">Tournament</span></div>
              <b class="tc-name">${t.name}</b>
              <span class="muted">${fmtDays(t)}</span>
              <a class="btn primary" href="#/enter/${t.id}">Enter your boat</a>
              <a class="small" href="#/tournaments">All tournaments ›</a>
            </div>`;
      }).catch(() => {});
    }
    // Until this phone has notifications on, offer them here (announcements, reminders).
    if (state.me) renderNotify(view.querySelector('#notify'), { what: 'announcements from JHMMC, like tournament reminders', hideWhenOn: true });
    // Today's sea, quietly: nothing shows if the forecast can't be had.
    const seaBox = view.querySelector('#sea-card');
    const place = seaPlace();
    if (seaBox) {
      if (navigator.onLine !== false && place.key !== 'here') {
        seaFor(place).then((s) => {
          const n = s.now;
          const next = s.solunar.major.find((p) => p.to > Number(s.localTime.slice(11, 13)) * 60 + Number(s.localTime.slice(14, 16)));
          seaBox.innerHTML = html`<div class="card sea-card"><a class="sea-card-today" href="#/sea">
            <span class="sea-card-top"><b>${raw(icon('wave'))} Sea today · ${place.name}</b>${n.rating ? raw(html`<span class="rating ${n.rating}">${n.rating[0].toUpperCase() + n.rating.slice(1)}</span>`) : ''}</span>
            <span class="small">${[n.windKn != null && `${n.windDir || ''} ${n.windKn} kn`, n.waveM != null && `waves ${wavesTxt(n.waveM)}`, n.waterC != null && `water ${tempTxt(n.waterC)}`, n.tide && `tide ${n.tide}`].filter(Boolean).join(' · ')}</span>
            ${next ? raw(html`<span class="small muted">Best time: ${hhmm(next.from)} – ${hhmm(next.to)} · sunset ${s.sun.set || ''}</span>`) : ''}</a></div>
            <a class="card pad day-card" href="#/sea">
              <span class="day-col day-tides"><span class="k">Tides today <span class="hint">▲ high ▼ low</span></span><span class="tides">${raw((s.tide?.turns || []).map((t) => html`<span><i class="${t.type === 'high' ? 'hi' : 'lo'}">${t.type === 'high' ? '▲' : '▼'}</i> <b>${t.time.slice(11, 16)}</b></span>`).join('') || '<span class="muted">—</span>')}</span></span>
              <span class="day-col"><span class="k">Sun</span><span>Rise <b>${s.sun.rise || '—'}</b></span><span>Set <b>${s.sun.set || '—'}</b></span></span>
              <span class="day-col"><span class="k">Moon</span><span><b>${s.moon.lit}%</b></span><span class="muted">${s.moon.name}</span></span>
              <span class="day-col"><span class="k">Best times</span>${raw(s.solunar.major.map((p) => html`<span class="nowrap"><b>${hhmm(p.from)}</b>–${hhmm(p.to)}</span>`).join(''))}</span>
            </a>`;
        }).catch(() => {});
      }
    }
}

PAGE_GROUPS.push((view) => ({
  // Home: what's on (a tournament, today's weigh-in), today's sea, the main places a tap away
  // (the fishing chart first), notifications and your account. The feed is a tab of its own.
  async home() {
    view.innerHTML = html`${raw(noBoatBanner())}
      <div id="tournament-call"></div>
      <div id="weigh-call"></div>
      <div id="sea-card"></div>
      <div class="home-tiles">
        <a class="home-tile big" href="#/chart">${raw(icon('map'))}<span><b>Fishing chart</b><span>Contours, hotspots, currents, water colour and your fish</span></span><span class="go" aria-hidden="true">›</span></a>
        ${state.me?.canWeigh || state.me?.canApprove ? raw(html`<a class="home-tile wide" href="#/weigh">${raw(icon('weight'))}<span><b>Weigh-in</b><span>${
          state.me.canApprove && !state.me.teamId ? 'For any boat, any day' : state.me.weighmasterAt ? `You're the weighmaster at ${state.me.weighmasterAt}` : `Today's fish for ${state.me.teamName || 'your boat'}${state.me.weighStation ? ` at ${state.me.weighStation}` : ''}`}</span></span><span class="go" aria-hidden="true">›</span></a>`) : ''}
        <div id="biting" class="home-wide-slot"></div>
        <a class="home-tile" href="#/log">${raw(icon('history'))}<b>Log</b><span>Trips and the season</span></a>
        <a class="home-tile" href="#/leaderboard">${raw(icon('leaderboard'))}<b>Leaderboard</b><span>The season's points</span></a>
        <a class="home-tile" href="#/tournaments">${raw(icon('trophy'))}<b>Tournaments</b><span>Coming up and results</span></a>
        <a class="home-tile" href="#/sea">${raw(icon('wave'))}<b>Sea conditions</b><span>The week ahead</span></a>
      </div>
      ${state.me ? raw('<div id="notify" class="feed-notify"></div>') : ''}
      ${state.me ? raw(html`<a class="card pad home-account" href="#/profile">${raw(icon('user'))}<span><b>My account</b><span class="small muted">${state.me.displayName || state.me.name}${state.me.teamName ? ` · ${state.me.teamName}` : ''}</span></span><span aria-hidden="true">›</span></a>`)
        : raw(html`<a class="card pad home-account" href="#/login">${raw(icon('user'))}<span><b>Sign in</b><span class="small muted">Or create an account</span></span><span aria-hidden="true">›</span></a>`)}`;
    homeCards(view);
  },

  async feed() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    // Fish logged at sea show under All; Weigh-ins and Announcements have their own tabs.
    const type = ['weighins', 'announcements'].includes(q.get('type')) ? q.get('type') : 'all';
    const tab = (key, label) => html`<a role="tab" href="#/feed${key === 'all' ? '' : `?type=${key}`}" aria-selected="${type === key}">${label}</a>`;
    // JHMMC's officers (and the admin) post announcements: a tournament, membership to pay…
    const officer = !!state.me?.canReview;
    view.innerHTML = html`${officer ? raw(html`<details class="card pad ann-new"><summary>${raw(icon('edit'))} New announcement</summary>
        <form class="stack" id="ann">
          <label>Title <input name="title" required maxlength="120" placeholder="e.g. Tournament this Saturday"></label>
          <label>Message <textarea name="body" maxlength="2000" rows="3" placeholder="e.g. Remember to pay your membership before Friday."></textarea></label>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post announcement</button></div>
        </form></details>`) : ''}
      <div class="line-tabs feed-tabs" role="tablist">${raw(tab('all', 'All'))}${raw(tab('weighins', 'Weigh-ins'))}${raw(tab('announcements', 'Announcements'))}</div>
      <div id="feed"></div>`;
    const form = view.querySelector('#ann');
    if (form) {
      bindForm(form, async () => {
        await api('/announcements', { method: 'POST', body: formData(form) });
        toast('Announcement posted.');
        route();
      });
    }
    await renderFeed(view.querySelector('#feed'), type === 'all' ? {} : { type });
  },

  async catch(id) {
    const { catch: c } = await api(`/catches/${id}`);
    // The secretary and admin see a registration's record on its page.
    const record = c.status !== 'unofficial' && state.me?.canReview ? (await api(`/registrations/log?catch=${c.id}`)).fish : null;
    view.innerHTML = html`
      <div class="feed">${raw(catchCard(c, { full: true }))}</div>
      ${record ? raw(html`<h2>Registration history</h2><div class="card"><ul class="list log">${raw(logItems(record))}</ul></div>`) : ''}
`;
    wireCards(view.querySelector('.feed'), new Map([[String(c.id), c]]));
    drawSpotMaps(view);
  },

  // Posting by hand is closed: the feed fills itself from weigh-ins and Log fish.
  async new() {
    location.replace(state.me?.teamId ? '#/fishon' : '#/');
  },

  // Join a crew with a code, register a boat, or carry on as an individual.
  // An invite link from a captain: #/join/CODE. Shows the boat, then joins in one tap
  // (after signing up or in, for a visitor).
  async join(code = '') {
    const res = await fetch(`/api/teams/invite/${encodeURIComponent(code)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      view.innerHTML = html`<div class="card pad empty"><p>${body.error || "This invite link doesn't work."}</p><a href="#/feed">Go to the feed</a></div>`;
      return;
    }
    const { team } = body;
    const who = team.captain ? `${team.captain} invites you` : "You're invited";
    const head = html`<h1>Join ${team.name}</h1>
      <p class="muted">${who} to join the crew of <b>${team.name}</b>${team.clubName ? ` (${team.clubName})` : ''} on Africa Sportfishing.
      As crew you log your fish at sea, keep the boat's log and see its catches on the fishing chart.</p>`;
    if (!state.me) {
      state.afterLogin = location.hash;
      view.innerHTML = html`${raw(head)}<div class="card pad stack">
        <a class="btn primary" href="#/register">Create my account</a>
        <a class="btn" href="#/login">I already have an account</a></div>`;
      return;
    }
    if (state.me.teamId === team.id) {
      toast(`You're already on ${team.name}.`);
      location.hash = `#/boat/${team.id}`;
      return;
    }
    if (state.me.teamId) {
      view.innerHTML = html`${raw(head)}<div class="card pad"><p>You're on <b>${state.me.teamName}</b> now. To join ${team.name},
        leave ${state.me.teamName} first from <a href="#/boat/${state.me.teamId}?manage=1">My boat</a>, then open this link again.</p></div>`;
      return;
    }
    view.innerHTML = html`${raw(head)}<form class="card pad stack" id="join-it"><p class="error"></p>
      <div><button type="submit" class="primary">Join ${team.name}</button></div></form>`;
    const form = view.querySelector('#join-it');
    bindForm(form, async () => {
      const r = await api('/teams/join', { method: 'POST', body: { code } });
      state.me = r.user;
      toast(`Welcome aboard ${team.name}!`);
      location.hash = `#/boat/${r.team.id}`;
    });
  },

  // The secretary appoints weighmasters: JHMMC members (a captain, the treasurer...), one weigh station each.
  async weighmasters() {
    if (!state.me?.canApprove) return needLogin(view, 'appoint weighmasters (the secretary)');
    const { members, stations } = await api('/weighmasters');
    const at = (st) => members.filter((m) => m.station === st).map((m) => m.name);
    const who = (m) => [m.role ? Object.fromEntries(ROLE_OPTIONS)[m.role] || m.role : '', m.boat ? `${m.captain ? 'Captain of ' : ''}${m.boat}` : ''].filter(Boolean).join(' · ');
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p><h1>Weighmasters</h1>
      ${raw(recordedNote('A weighmaster weighs the boats registered at his station.'))}
      <div class="card pad"><ul>${stations.map((st) => raw(html`<li><b>${st}</b>: ${at(st).join(', ') || 'no weighmaster yet'}</li>`))}</ul></div>
      <h2>JHMMC members</h2>
      <div class="filter-chips"><input type="search" id="wm-find" placeholder="Search by name or boat" aria-label="Search members"></div>
      <div class="card"><ul class="list" id="wm-list">${members.length ? members.map((m) => raw(html`<li class="wm-row" data-find="${`${m.name} ${m.nickname || ''} ${m.boat || ''}`.toLowerCase()}">
        <div><b>${m.name}</b>${m.nickname ? raw(html` <span class="muted">“${m.nickname}”</span>`) : ''}<div class="small muted">${who(m) || 'JHMMC member'}</div></div>
        <label class="small">Weighmaster at <select data-user="${m.id}">${raw(options(stations, m.station, 'Not a weighmaster'))}</select></label>
      </li>`)) : raw('<li class="muted">No JHMMC members yet.</li>')}</ul></div>`;
    view.querySelector('#wm-find').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const li of view.querySelectorAll('#wm-list [data-find]')) li.hidden = !!q && !li.dataset.find.includes(q);
    });
    view.addEventListener('change', async (e) => {
      const sel = e.target.closest('select[data-user]');
      if (!sel) return;
      try {
        await api(`/weighmasters/${sel.dataset.user}`, { method: 'PUT', body: { station: sel.value || null } });
        toast(sel.value ? `Weighmaster at ${sel.value}.` : 'No longer a weighmaster.');
        route();
      } catch (err) {
        toast(err.message);
      }
    });
  },

  async crew() {
    if (!state.me) return needLogin(view, 'join or register a boat');
    if (state.me.teamId) {
      location.hash = `#/boat/${state.me.teamId}?manage=1`;
      return;
    }
    const clubs = await loadClubs(true);
    view.innerHTML = html`<h1>Get on a boat</h1>
      <div class="two">
        <form class="card pad stack" id="join">
          <h2>Join a crew</h2>
          <label>Invite code <input name="code" required maxlength="12" autocapitalize="characters" autocomplete="off" placeholder="e.g. K7M2QX" class="code-input"></label>
          <p class="error"></p>
          <div><button type="submit" class="primary">Join boat</button></div>
        </form>
        <form class="card pad stack" id="create">
          <h2>Register a boat</h2>
          <label>Boat name <input name="name" required maxlength="80" placeholder="e.g. Sea Hunter II"></label>
          <div class="row">
            <label>Length (feet) <input name="lengthFt" type="number" min="10" max="200" step="1" inputmode="numeric" placeholder="e.g. 42"></label>
            <label>Make / model <input name="make" maxlength="60" placeholder="e.g. Bertram"></label>
          </div>
          <div class="row">
            <label class="homeport-field">Weigh station <input name="homePort" maxlength="80" placeholder="e.g. Dakar"></label>
            <label class="station-field" hidden>Home port (weigh station) <select name="weighStation">${raw(options(state.meta.weighStations, null, 'Choose…'))}</select></label>
            <label>Country <select name="country">${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
          </div>
          <div class="row">
            <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), null, 'No club'))}</select></label>
            <label class="division-field">Registered for <select name="division">${raw(options(DIVISIONS, 'ocean'))}</select></label>
          </div>
          <p class="error"></p>
          <div><button type="submit" class="primary">Register boat</button></div>
        </form>
      </div>
      <p class="small muted">Club not listed? <a href="#/clubs">Register it</a> first. No boat? <a href="#/feed">Continue to the feed</a>; you can join a crew any time.</p>`;
    const done = async ({ team, user }, msg) => {
      state.me = user;
      toast(msg);
      location.hash = `#/boat/${team.id}`;
    };
    const join = view.querySelector('#join');
    bindForm(join, async () => done(await api('/teams/join', { method: 'POST', body: formData(join) }), 'Welcome aboard!'));
    const create = view.querySelector('#create');
    create.clubId.addEventListener('change', () => syncDivision(create));
    bindForm(create, async () => done(await api('/teams', { method: 'POST', body: formData(create) }), 'Boat registered. Share the invite code with your crew.'));
  },

  async boats() {
    location.replace('#/participants?tab=boats');
  },

  // Everyone taking part, as photo cards: anglers or boats, with a search box.
  async participants() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const tab = q.get('tab') === 'boats' ? 'boats' : 'anglers';
    const { anglers } = tab === 'anglers' ? await api('/anglers') : { anglers: [] };
    const { teams } = tab === 'boats' ? await api('/teams') : { teams: [] };
    const items = tab === 'anglers'
      ? anglers.map((a) => ({ href: anglerHref(a.id, a.name), name: a.name, sub: a.teamName || 'Individual angler', ...a }))
      : teams.map((t) => ({
        href: `#/boat/${t.id}`, ...t,
        sub: [t.lengthFt ? `${+t.lengthFt}'` : '', t.make].filter(Boolean).join(' ') || t.homePort || '',
      }));
    const max = Math.max(1, ...items.map((i) => Math.max(i.released, i.weighed)));
    const bar = (label, n, cls) => (n ? `<div class="tally"><span>${label}</span><b>${n}</b></div>
      <div class="bar ${cls}"><i style="width:${Math.max(6, (n / max) * 100)}%"></i></div>` : '');
    const card = (i) => html`<a class="pcard" href="${i.href}" data-name="${(i.name + ' ' + i.sub).toLowerCase()}">
      ${i.photoUrl ? raw(html`<img src="${i.photoUrl}" alt="" loading="lazy">`) : raw(`<div class="ph">${icon(tab === 'boats' ? 'boat' : 'user')}</div>`)}
      <div class="pbody">
        <div class="pname">${i.name}</div>
        <div class="psub">${i.sub}</div>
        ${raw(bar('Released', i.released, 'green'))}${raw(bar('Weighed', i.weighed, 'blue'))}
      </div>
    </a>`;
    view.innerHTML = html`<h1 class="center">Participants</h1>
      <div class="seg" role="tablist">
        <a role="tab" href="#/participants?tab=anglers" aria-selected="${tab === 'anglers'}">Anglers</a>
        <a role="tab" href="#/participants?tab=boats" aria-selected="${tab === 'boats'}">Boats</a>
      </div>
      <label class="search">${raw(icon('search'))}
        <input type="search" placeholder="Search ${tab}" aria-label="Search ${tab}" autocomplete="off"></label>
      <div class="pgrid">${items.map((i) => raw(card(i)))}</div>
      <p class="muted empty" id="none" ${items.length ? 'hidden' : ''}>${items.length ? `No ${tab} match that search.` : tab === 'boats' ? 'No boats registered yet.' : 'No anglers yet.'}</p>
      ${tab === 'boats' && state.me && !state.me.teamId ? raw('<p class="center"><a class="btn primary" href="#/crew">Join or register a boat</a></p>') : ''}`;
    view.querySelector('.search input').addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      let shown = 0;
      for (const el of view.querySelectorAll('.pcard')) {
        el.hidden = !!term && !el.dataset.name.includes(term);
        if (!el.hidden) shown++;
      }
      view.querySelector('#none').hidden = shown > 0;
    });
  },

  async boat(id) {
    const [{ team, stats }, clubs] = await Promise.all([api(`/teams/${id}`), loadClubs()]);
    const inviteLink = `${location.origin}/#/join/${team.joinCode}`;
    const inviteMsg = `Join ${team.name} on the Africa Sportfishing app. Tap the link, sign up, and you're on the boat:\n${inviteLink}\n\n(Or enter the invite code ${team.joinCode} under More → Get on a boat.)`;
    const spec = [team.lengthFt ? `${+team.lengthFt}'` : '', team.make].filter(Boolean).join(' ');
    const division = isJhmmc(team.clubId) ? (team.division === 'river' ? 'River boat' : 'Ocean boat') : '';
    const station = isJhmmc(team.clubId) && team.weighStation ? `Weighs at ${team.weighStation}` : '';
    const facts = [division, station, spec, isJhmmc(team.clubId) ? '' : team.homePort, team.country].filter(Boolean).join(' · ');
    // The boat's page is the same for everyone; the crew manage it on its own page
    // (invite code, crew, guest anglers, details), from More → My boat.
    const manage = (team.isMember || team.canManage) && new URLSearchParams(location.hash.split('?')[1] || '').get('manage') === '1';
    const crewList = (actions) => html`<div class="card"><ul class="list">${team.members.map((m) => raw(html`<li class="member" data-uid="${m.id}">
        <span><a href="#/user/${m.id}">${m.name}</a> ${m.id === team.captainId ? raw('<span class="badge">Captain</span>') : ''}
          <span class="muted small">· ${plural(m.catches, 'catch')}</span></span>
        ${actions && team.canManage && m.id !== state.me.id ? raw(`<span class="actions"><button data-act="make-captain">Make captain</button><button data-act="remove" class="danger">Remove</button></span>`) : ''}
      </li>`))}${team.members.length ? '' : raw('<li class="muted">No crew yet.</li>')}</ul></div>`;
    if (!manage) {
      view.innerHTML = html`<div class="boat-hero ${team.photoUrl ? '' : 'no-photo'}">
          ${team.photoUrl ? raw(html`<img src="${team.photoUrl}" alt="${team.name}">`) : raw(`<svg class="hero-mark" viewBox="0 0 24 24" aria-hidden="true">${ICONS.boat}</svg>`)}
          <div class="hero-text"><h1>${team.name}</h1>
          <p>${facts}${team.clubName ? raw(html`${facts ? ' · ' : ''}<a href="#/club/${team.clubId}">${team.clubName}</a>`) : ''}</p></div>
        </div>
        <h2>Catches</h2>
        <div id="trophies"></div>
        <h2>Crew (${team.members.length})</h2>
        ${raw(crewList(false))}`;
      await renderTrophies(view.querySelector('#trophies'), { team: team.id });
      return;
    }
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>My boat</h1>
      <p><a href="#/boat/${team.id}">See ${team.name}'s page as everyone sees it ›</a></p>
      ${team.isMember && !team.canManage ? raw('<p class="small muted">New crew join with the boat\'s invite code: ask your captain.</p>') : ''}
      ${team.canManage ? raw(html`<div class="card pad invite">
        <div><div class="muted small">Invite your crew: they tap the link, sign up and they're aboard</div><div class="code">${team.joinCode}</div>
          <div class="muted small">The code is for anyone who'd rather type it in. Only you see it.</div></div>
        <div class="actions">
          <button type="button" class="primary" data-share-text="${inviteMsg}">Send the invite</button>
          <button data-act="copy-link">Copy invite link</button>
          <button data-act="copy-code">Copy code</button>
          <button data-act="new-code">New code</button>
        </div>
      </div>`) : ''}
      <h2>Crew (${team.members.length})</h2>
      ${raw(crewList(true))}
      ${team.canManage && team.guests.length ? raw(html`<h2>Guest anglers${raw(info('<p>Catches logged under a typed name. If one of them joins the crew, move their catches to their account.</p>'))}</h2>
      <div class="card"><ul class="list">${team.guests.map((g) => raw(html`<li class="member guest" data-name="${g.name}">
        <span><a href="${anglerHref(null, g.name)}">${g.name}</a> <span class="muted small">· ${plural(g.catches, 'catch')}</span></span>
        <span class="actions">
          <select aria-label="Crew member for ${g.name}">${raw(options(team.members.map((m) => [m.id, m.name]), null, 'Move to…'))}</select>
          <button data-act="link">Move</button>
        </span>
      </li>`))}</ul></div>`) : ''}
      ${team.canManage ? raw(html`<h2>Boat details</h2>
      <form class="card pad stack" id="edit">
        <label>Boat name <input name="name" required maxlength="80" value="${team.name}"></label>
        <div class="row">
          <label>Length (feet) <input name="lengthFt" type="number" min="10" max="200" step="1" inputmode="numeric" value="${team.lengthFt ?? ''}"></label>
          <label>Make / model <input name="make" maxlength="60" value="${team.make || ''}" placeholder="e.g. Bertram 42"></label>
        </div>
        ${raw(photoField('Boat photo', team.photoUrl))}
        <div class="row">
          <label class="homeport-field" ${isJhmmc(team.clubId) ? 'hidden' : ''}>Weigh station <input name="homePort" maxlength="80" value="${team.homePort || ''}"></label>
          <label class="station-field" ${isJhmmc(team.clubId) ? '' : 'hidden'}>Home port (weigh station) <select name="weighStation">${raw(options(state.meta.weighStations, team.weighStation, 'Choose…'))}</select></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, team.country, 'Choose…'))}</select></label>
        </div>
        <div class="row">
          <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), team.clubId, 'No club'))}</select></label>
          <label class="division-field">Registered for <select name="division">${raw(options(DIVISIONS, team.division))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>`) : ''}
      ${team.isMember ? raw('<p><button data-act="leave" class="danger">Leave this boat</button></p>') : ''}
`;

    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || btn.closest('.feed')) return;
      const uid = btn.closest('[data-uid]')?.dataset.uid;
      const guestRow = btn.closest('[data-name]');
      const name = team.members.find((m) => String(m.id) === uid)?.name;
      try {
        switch (btn.dataset.act) {
          case 'copy-code':
            return copyText(team.joinCode, 'Invite code copied');
          case 'copy-link':
            return copyText(inviteLink, 'Invite link copied');
          case 'new-code':
            if (!confirm('Make a new invite code? The old one stops working.')) return;
            await api(`/teams/${id}/code`, { method: 'POST' });
            break;
          case 'make-captain':
            if (!confirm(`Hand the captaincy to ${name}?`)) return;
            await api(`/teams/${id}/captain`, { method: 'POST', body: { userId: Number(uid) } });
            break;
          case 'remove':
            if (!confirm(`Remove ${name} from the crew?`)) return;
            await api(`/teams/${id}/members/${uid}`, { method: 'DELETE' });
            break;
          case 'link': {
            const to = guestRow.querySelector('select');
            if (!to.value) return toast('Choose the crew member first.');
            const who = to.selectedOptions[0].textContent;
            if (!confirm(`Move all of ${guestRow.dataset.name}'s catches on this boat to ${who}'s account?`)) return;
            const { moved } = await api(`/teams/${id}/guests/link`, { method: 'POST', body: { name: guestRow.dataset.name, userId: Number(to.value) } });
            toast(`Moved ${plural(moved, 'catch')} to ${who}`);
            break;
          }
          case 'leave':
            if (!confirm(`Leave ${team.name}? You will no longer be able to log catches for it.`)) return;
            state.me = (await api('/teams/leave', { method: 'POST' })).user;
            toast(`You left ${team.name}`);
            location.hash = '#/crew';
            return;
          default:
            return;
        }
        await refreshMe();
        route();
      } catch (ex) {
        toast(ex.message);
      }
    });
    const edit = view.querySelector('#edit');
    edit?.clubId.addEventListener('change', () => syncDivision(edit));
    if (edit) bindForm(edit, async () => {
      const { photo, ...fields } = formData(edit);
      await api(`/teams/${id}`, { method: 'PATCH', body: fields });
      if (photo?.size) {
        const fd = new FormData();
        fd.set('photo', await shrinkPhoto(photo));
        await api(`/teams/${id}/photo`, { method: 'POST', form: fd });
      }
      await refreshMe();
      toast('Boat saved');
      route();
    });
  },

  // Clubs: JHMMC (the admin) opens them; anyone else asks, and the admin decides.
  async clubs() {
    const admin = !!state.me?.isAdmin;
    const [clubs, { requests }] = await Promise.all([loadClubs(true), admin ? api('/admin/club-requests') : { requests: [] }]);
    view.innerHTML = html`<h1>Clubs</h1>
      ${requests.length ? raw(html`<h2>Requests to open a club (${requests.length})</h2>
        <div class="card"><ul class="list" id="club-requests">${requests.map((r) => raw(html`<li data-id="${r.id}">
          <b>${r.name}</b> <span class="muted small">${[r.city, r.country].filter(Boolean).join(', ')}</span>
          <div class="small muted">Asked by ${r.requestedBy || 'a member'}${r.email ? ` (${r.email})` : ''} · ${fmtWhen(r.createdAt)}</div>
          ${r.description ? raw(html`<p class="small">${r.description}</p>`) : ''}
          <div class="row-buttons"><button type="button" class="primary" data-decide="approve">Approve</button>
            <button type="button" class="danger" data-decide="decline">Decline</button></div>
        </li>`))}</ul></div>`) : ''}
      <div class="card"><ul class="list">
        ${clubs.length ? clubs.map((c) => raw(html`<li>
          <a href="#/club/${c.id}"><b>${c.name}</b></a>
          <div class="muted small">${[c.city, c.country].filter(Boolean).join(', ')} · ${plural(c.teams, 'boat')}</div>
        </li>`)) : raw('<li class="muted">No clubs yet.</li>')}
      </ul></div>
      <h2>${admin ? 'Open a club' : 'Ask to open a club'}</h2>
      ${admin ? '' : raw('<p class="small muted">JHMMC approves new clubs.</p>')}
      ${state.me ? raw(html`<form class="card pad stack" id="f">
        <label>Club name <input name="name" required maxlength="100"></label>
        <div class="row">
          <label>Country <select name="country" required>${raw(options(state.meta.countries, state.me?.country, 'Choose…'))}</select></label>
          <label>Town / harbour <input name="city" maxlength="80"></label>
        </div>
        <label>About <textarea name="description" maxlength="1000"></textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">${admin ? 'Open club' : 'Send request'}</button></div>
      </form>`) : raw('<p><a href="#/login" data-return>Sign in</a> to ask for a club.</p>')}`;
    const form = view.querySelector('#f');
    if (form) bindForm(form, async () => {
      const { club, requested } = await api('/clubs', { method: 'POST', body: formData(form) });
      state.clubs = null;
      if (requested) {
        toast('Request sent to JHMMC.');
        form.reset();
      } else {
        location.hash = `#/club/${club.id}`;
      }
    });
    view.querySelector('#club-requests')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-decide]');
      if (!btn) return;
      const li = btn.closest('[data-id]');
      try {
        await api(`/admin/club-requests/${li.dataset.id}`, { method: 'POST', body: { decision: btn.dataset.decide } });
        toast(btn.dataset.decide === 'approve' ? 'Club opened.' : 'Request declined.');
        state.clubs = null;
        route();
      } catch (err) {
        toast(err.message);
      }
    });
  },

  async club(id) {
    const [{ club, teams, stats }, records] = await Promise.all([api(`/clubs/${id}`), api(`/records?club=${id}`)]);
    const clubRecords = records.species.filter((s) => s.best);
    view.innerHTML = html`${isJhmmc(club.id) ? raw('<img class="club-logo" src="/jhmmc-logo.png" alt="JHMMC logo" width="345" height="294">') : ''}
      <h1>${club.name}</h1>
      <p class="muted">${[club.city, club.country].filter(Boolean).join(', ')}</p>
      ${club.description ? raw(html`<p>${club.description}</p>`) : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>fish weighed in</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? fmtWeight(stats.heaviestKg) : '—'}</b><span>heaviest</span></div>
      </div>
      <h2>Boats (${teams.length})</h2>
      <div class="card"><ul class="list">${teams.length ? teams.map((t) => raw(html`<li><a href="#/boat/${t.id}">${t.name}</a> <span class="muted small">· ${t.members} crew · ${plural(t.catches, 'catch')}</span></li>`)) : raw('<li class="muted">No boats in this club yet. Captains can pick the club on their boat page.</li>')}</ul></div>
      <h2>Club records</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Weight</th><th>Angler</th><th>Boat</th><th>Line</th></tr></thead>
        <tbody>${clubRecords.length ? clubRecords.map((s) => raw(html`<tr>
          <td>${s.name}</td>
          <td class="num"><a href="#/catch/${s.best.catchId}">${Math.round(s.best.weightKg * 10) / 10} kg</a><div class="muted small">${Math.round(s.best.weightKg * 2.20462)} lb</div></td>
          <td><a href="${anglerHref(s.best.userId, s.best.angler)}">${s.best.angler}</a><div class="muted small">${fmtDate(s.best.caughtOn)}</div></td>
          <td>${s.best.teamId ? raw(html`<a href="#/boat/${s.best.teamId}">${s.best.teamName}</a>`) : '—'}</td>
          <td class="nw">${s.best.lineClass || '—'}</td>
        </tr>`)) : raw('<tr><td colspan="5" class="muted">No weighed catches from this club yet.</td></tr>')}</tbody>
      </table></div>
      <p class="small"><a href="#/records?club=${club.id}">Club records by line class, and against the IGFA world records</a></p>
      ${club.name.toLowerCase() === state.meta.homeClub.toLowerCase() ? raw('<p><a class="btn" href="#/rules">JHMMC season rules</a></p>') : ''}
      <h2>Recent catches</h2>
      <div id="feed"></div>`;
    await renderFeed(view.querySelector('#feed'), { club: club.id });
  },
}));
