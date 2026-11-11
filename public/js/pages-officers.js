// Africa Sportfishing, part of the app (public/js/pages-officers.js): The officers: the desk, activity, backups, boats, registrations, tournament sheets, members.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // Admin only: every account, with a one-time password reset link to pass on.
  // Admin: every boat. JHMMC boats get their weigh station (their home port)
  // and Ocean or River here; the rest of a boat's details are on its page.
  // The secretary's desk: one screen to start the day.
  async desk() {
    if (!state.me?.canReview) return needLogin(view, 'open the secretary desk');
    const d = await api('/desk');
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const first = (state.me.displayName || state.me.name || '').split(' ')[0];
    const fishName = (x) => `${x.boat || 'A boat'}'s ${x.species.toLowerCase()}${x.weightKg ? `, ${fmtWeight(x.weightKg)}` : x.released ? ' (released)' : ''}`;
    const waitedH = (x) => Math.round((Date.now() - parseTime(x.createdAt)) / 3600000);
    const stations = Object.entries(d.stations).sort((a, b) => b[1] - a[1]);
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Secretary desk</h1>
      <p class="small muted">${hello}, ${first}. ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
      <div class="desk-kpis">
        <a class="card ${d.toReview ? 'hot' : ''}" href="#/review"><b>${d.toReview}</b><span>fish to review</span></a>
        <a class="card ${d.disputed.length ? 'hot' : ''}" href="#/review"><b>${d.disputed.length}</b><span>${d.disputed.length === 1 ? 'dispute open' : 'disputes open'}</span></a>
        <a class="card" href="#/history"><b>${d.weighedToday}</b><span>registered today</span></a>
      </div>
      ${d.disputed.length || d.old.length ? raw(html`<h2>Needs attention</h2><div class="card">
        ${d.disputed.map((x) => raw(html`<a class="desk-row" href="#/catch/${x.id}"><span><b>Disputed: ${fishName(x)}</b><small>${x.last ? `${x.last.by}: "${x.last.reason}" · ${fmtWhen(x.last.at)}` : ''}</small></span><span class="pill-red">Dispute</span></a>`))}
        ${d.old.map((x) => raw(html`<a class="desk-row" href="#/catch/${x.id}"><span><b>${fishName(x)}</b><small>Waiting ${waitedH(x)} hours</small></span><span class="pill-amber">Over a day</span></a>`))}
      </div>`) : raw(`<div class="card pad muted">${d.toReview ? 'Nothing urgent: no disputes, and no fish waiting over a day.' : 'Nothing needs your attention.'}</div>`)}
      ${stations.length ? raw(html`<h2>To review, by weigh station</h2><div class="card">
        ${stations.map(([w, n]) => raw(html`<a class="desk-row" href="#/review?station=${encodeURIComponent(w)}"><b>${w}</b><span class="tab-count">${n}</span></a>`))}
      </div>`) : ''}
      ${d.next ? raw(html`<h2>Next tournament</h2><a class="card pad desk-link" href="#/sheet/${d.next.id}"><b>${d.next.name}</b> · ${fmtDay(d.next.date)}<br><small class="muted">${plural(d.next.boats, 'boat')} entered</small></a>`) : ''}
      <h2>Shortcuts</h2>
      <div class="desk-short">
        ${state.me.canApprove ? raw('<a class="card" href="#/review">Review catches</a><a class="card" href="#/weigh">Weigh-in</a>') : ''}
        <a class="card" href="#/tournaments?sheets=1">Tournament sheets</a><a class="card" href="#/club-members">Club members</a>
      </div>
      <p class="pdf-row">${raw(xlsxButton('Excel: members and tournaments'))}</p>
      <h2>Your last changes</h2>
      <div class="card">${d.mine.length ? raw(d.mine.map((x) => html`<div class="desk-row"><span>${x.action}<small>${fmtWhen(x.at)}</small></span></div>`).join('')) : raw('<div class="desk-row muted">None yet.</div>')}</div>
      <p><a href="#/activity">Full activity log ›</a></p>`;
  },

  // Everything the officers and the admin changed, who and when. Nobody can edit it.
  async activity() {
    if (!state.me?.canReview && !state.me?.isAdmin) return needLogin(view, 'see the activity log');
    const who = new URLSearchParams(location.hash.split('?')[1] || '').get('user') || '';
    const q = (before) => `/activity?${new URLSearchParams(Object.entries({ user: who, before: before ?? '' }).filter(([, v]) => v))}`;
    const first = await api(q());
    const ROLE = { admin: 'Admin', ...Object.fromEntries(ROLE_OPTIONS) };
    const row = (x) => html`<li><div><b>${x.userName}</b> <span class="small muted">${ROLE[x.role] || ''} · ${fmtWhen(x.at)}</span></div><div>${x.action}</div></li>`;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Activity log${raw(info('<p>Every change made by the JHMMC officers and the admin: approvals, corrections, points, the scoring table, season dates, tournaments, memberships and accounts. It can\'t be edited or deleted by anyone.</p><p>Changes to a fish are also sent to its crew; changes to the scoring table and season dates are announced in the feed.</p>'))}</h1>
      <label class="chip-select">Who <select id="who"><option value="">Everyone</option>${raw(first.people.map((p) => html`<option value="${p.id}" ${String(p.id) === who ? 'selected' : ''}>${p.name}</option>`).join(''))}</select></label>
      <div class="card"><ul class="list" id="acts">${first.items.length ? raw(first.items.map(row).join('')) : raw('<li class="muted">Nothing yet.</li>')}</ul></div>
      <button class="more" id="more" ${first.nextBefore ? '' : 'hidden'}>Load more</button>`;
    let next = first.nextBefore;
    view.querySelector('#who').addEventListener('change', (e) => { location.hash = `#/activity${e.target.value ? `?user=${e.target.value}` : ''}`; });
    view.querySelector('#more').addEventListener('click', async (e) => {
      const page = await api(q(next));
      view.querySelector('#acts').insertAdjacentHTML('beforeend', page.items.map(row).join(''));
      next = page.nextBefore;
      e.target.hidden = !next;
    });
  },

  // The admin's backups: nightly copies of the database, emailed, and downloads.
  async backups() {
    if (!state.me?.isAdmin) return needLogin(view, 'see backups');
    const { backups, emailOn } = await api('/admin/backups');
    const size = (b) => (b.size > 1e6 ? `${(b.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b.size / 1e3))} KB`);
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Backups</h1>
      <p>Every night the app copies its database (every fish, account, point and decision) and keeps the last 14 days.</p>
      <div class="card pad ${emailOn ? '' : 'warn-card'}">${emailOn
        ? raw('Each night\'s copy is also <b>emailed to you</b>, so it\'s safe even if the server\'s disk is lost. Keep those emails.')
        : raw('<b>Email isn\'t set up</b>, so the copies stay on the server only. Set up email (SMTP) on Render so each copy is also sent to you, or download one here now and then.')}</div>
      <p class="row-buttons"><button class="primary" id="b-now">Back up now and download</button>
        ${emailOn ? raw('<button id="b-mail">Back up now and email it</button>') : ''}</p>
      <h2>Copies on the server</h2>
      <div class="card"><ul class="list">${backups.length ? backups.map((b) => raw(html`<li><a href="/api/admin/backups/${b.name}" download>${raw(icon('download'))} ${fmtWhen(b.at)}</a> <span class="small muted">${size(b)}</span></li>`))
        : raw('<li class="muted">None yet: the first is made a minute after the app starts.</li>')}</ul></div>
      <p class="small muted">Photos aren't included.</p>`;
    view.querySelector('#b-now').addEventListener('click', async () => {
      const { backup } = await api('/admin/backups', { method: 'POST', body: {} });
      location.href = `/api/admin/backups/${backup.name}`;
      setTimeout(route, 1500);
    });
    view.querySelector('#b-mail')?.addEventListener('click', async (e) => {
      // Sending can take a few seconds: say so, and say plainly if it fails.
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const { emailed } = await api('/admin/backups', { method: 'POST', body: { email: true }, once: true });
        toast(emailed ? 'Emailed to you. Check your inbox (and Spam).' : 'Backed up.');
        route();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Back up now and email it';
        view.querySelector('#b-mail-error')?.remove();
        btn.closest('p').insertAdjacentHTML('afterend', html`<p class="card pad warn-card" id="b-mail-error"><b>The email wasn't sent.</b> ${err.message}</p>`);
      }
    });
  },

  async 'admin-boats'() {
    if (!state.me?.isAdmin && !state.me?.canApprove) {
      view.innerHTML = '<div class="card pad empty">Only the admin and the JHMMC secretary can see this page.</div>';
      return;
    }
    const { teams } = await api('/teams');
    const jhmmc = teams.filter((t) => isJhmmc(t.clubId));
    const others = teams.filter((t) => !isJhmmc(t.clubId));
    const find = (t) => `${t.name} ${t.clubName || ''} ${t.weighStation || t.homePort || ''}`.toLowerCase();
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Boats (${teams.length})${raw(info('<p>Set each JHMMC boat\'s weigh station, which is also its home port, and whether it fishes Ocean or River. Changes save straight away.</p>'))}</h1>
      ${raw(recordedNote('Changing a boat\'s weigh station or Ocean/River is visible to the officers.'))}
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by boat, club or station" aria-label="Search boats" autocomplete="off"></label>
      <h2>JHMMC boats (${jhmmc.length})</h2>
      <div class="card"><ul class="list">${jhmmc.length ? jhmmc.map((t) => raw(html`<li class="boat-row" data-id="${t.id}" data-find="${find(t)}">
        <a href="#/boat/${t.id}" class="boat-name"><b>${t.name}</b><span class="muted small">${plural(t.members, 'crew member')} ›</span></a>
        <div class="boat-fields">
          <label>Home port (weigh station) <select data-field="weighStation">${raw(options(state.meta.weighStations, t.weighStation, 'Not set'))}</select></label>
          <label>Registered for <select data-field="division">${raw(options(DIVISIONS, t.division))}</select></label>
        </div>
      </li>`)) : raw('<li class="muted">No JHMMC boats yet.</li>')}</ul></div>
      ${others.length ? raw(html`<h2>Other boats (${others.length})</h2>
      <div class="card"><ul class="list">${others.map((t) => raw(html`<li class="boat-row" data-find="${find(t)}">
        <a href="#/boat/${t.id}" class="boat-name"><b>${t.name}</b><span class="muted small">${[t.clubName || 'No club', t.homePort].filter(Boolean).join(' · ')} ›</span></a>
      </li>`))}</ul></div>`) : ''}`;
    view.querySelector('.search input').addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      for (const li of view.querySelectorAll('.boat-row')) li.hidden = !!term && !li.dataset.find.includes(term);
    });
    view.addEventListener('change', async (e) => {
      const sel = e.target.closest('select[data-field]');
      if (!sel) return;
      const row = sel.closest('[data-id]');
      try {
        await api(`/admin/teams/${row.dataset.id}`, { method: 'PATCH', body: { [sel.dataset.field]: sel.value } });
        const name = row.querySelector('b').textContent;
        toast(sel.dataset.field === 'division' ? `${name}: ${sel.value === 'river' ? 'River' : 'Ocean'}`
          : sel.value ? `${name} weighs at ${sel.value}` : `${name}: no weigh station`);
      } catch (ex) {
        toast(ex.message);
      }
    });
  },

  // Every boat's registrations waiting for the secretary, for JHMMC captains:
  // open for anyone to check, and for 24 hours to dispute.
  async pending() {
    if (!state.me?.canWeigh) return needLogin(view, 'see pending registrations (captains of JHMMC boats)');
    const { registrations } = await api('/registrations/pending');
    const until = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Pending registrations${raw(info('<p>Fish every JHMMC boat has registered that the secretary hasn\'t decided on yet.</p><p>If something looks wrong, dispute it within 24 hours with a reason; the secretary sees it before approving. <a href="#/rules?section=app-registrations">The rule</a></p>'))}</h1>
      ${registrations.length ? raw(html`<div class="stack">${registrations.map((c) => raw(html`<article class="card pad pending-item" data-id="${c.id}">
        <div class="catch-head"><h3 class="catch-title"><a href="#/catch/${c.id}">${c.species}</a></h3>
          <span class="weight">${c.weightKg ? fmtWeight(c.weightKg) : c.released ? 'Released' : ''}</span></div>
        <p class="meta"><a href="#/boat/${c.teamId}">${c.teamName}</a> · ${c.angler}${c.weighStation ? ` · ${c.weighStation}` : ''} · registered ${fmtWhen(c.createdAt)}</p>
        ${c.scalePhotoUrl || c.scaleVideoUrl ? raw(html`<div class="thumbs">${c.scalePhotoUrl ? raw(html`<a href="${c.scalePhotoUrl}" target="_blank" rel="noopener"><img src="${c.scalePhotoUrl}" alt="On the scale"></a>`) : ''}${c.scaleVideoUrl ? raw(html`<video src="${c.scaleVideoUrl}" controls playsinline preload="metadata"></video>`) : ''}</div>`) : ''}
        <p class="small ${c.disputes ? 'dispute-note' : 'muted'}">${c.disputes ? raw(`${icon('flag')} `) : ''}${c.disputes ? `${plural(c.disputes, 'dispute')} so far.` : 'No disputes.'}
          ${c.disputedByMe ? ' You disputed this fish.' : ''}
          ${c.canDispute ? ` Open for disputes until ${until(c.disputeUntil)}.` : ''}</p>
        ${c.canDispute ? raw(html`<button data-act="dispute" class="danger">${raw(icon('flag'))} Dispute</button>
        <form class="dispute-form stack" hidden>
          <label>Why are you disputing this fish? <textarea name="reason" required maxlength="500" placeholder="e.g. Not announced on the radio; the photo is from another day"></textarea></label>
          <p class="error"></p>
          <div class="actions"><button type="submit" class="danger">Send dispute</button> <button type="button" data-act="cancel">Cancel</button></div>
        </form>`) : ''}
      </article>`))}</div>`) : raw(emptyState('check', 'Nothing is waiting for the secretary.'))}`;
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act=dispute], button[data-act=cancel]');
      if (!btn) return;
      const item = btn.closest('.pending-item');
      const open = btn.dataset.act === 'dispute';
      item.querySelector('.dispute-form').hidden = !open;
      item.querySelector('[data-act=dispute]').hidden = open;
      if (open) item.querySelector('textarea').focus();
    });
    view.addEventListener('submit', async (e) => {
      const form = e.target.closest('.dispute-form');
      if (!form) return;
      e.preventDefault();
      try {
        await api(`/catches/${form.closest('.pending-item').dataset.id}/disputes`, { method: 'POST', body: formData(form) });
        toast('Dispute sent to the secretary');
        route();
      } catch (ex) {
        form.querySelector('.error').textContent = ex.message;
      }
    });
  },

  // The registration record for the secretary and admin, newest first.
  async history() {
    if (!state.me?.canReview) return needLogin(view, 'see the registration record (the club officers)');
    const team = new URLSearchParams(location.hash.split('?')[1] || '').get('team') || '';
    const [{ teams }, { fish, nextBefore }] = await Promise.all([api('/teams'), api(`/registrations/log?team=${encodeURIComponent(team)}`)]);
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Registration history${raw(info('<p>Every JHMMC registration, one entry per fish with where it stands now, and underneath everything that happened to it: who registered, disputed, approved, rejected or withdrew it, when, and where the captain\'s phone was. Nothing here can be changed.</p>'))}</h1>
      <label class="log-filter">Boat <select id="log-team">${raw(options(teams.filter((t) => isJhmmc(t.clubId)).map((t) => [t.id, t.name]), team, 'All boats'))}</select></label>
      <div class="card"><ul class="list log" id="log">${raw(logItems(fish))}</ul></div>
      ${nextBefore ? raw(html`<p><button id="log-more" data-before="${nextBefore}">Show older</button></p>`) : ''}`;
    view.querySelector('#log-team').addEventListener('change', (e) => {
      location.hash = e.target.value ? `#/history?team=${e.target.value}` : '#/history';
    });
    view.querySelector('#log-more')?.addEventListener('click', async (e) => {
      const more = await api(`/registrations/log?team=${encodeURIComponent(team)}&before=${e.target.dataset.before}`);
      view.querySelector('#log').insertAdjacentHTML('beforeend', logItems(more.fish));
      if (more.nextBefore) e.target.dataset.before = more.nextBefore;
      else e.target.remove();
    });
  },

  // Tournaments for captains (enter your boat) and officials (the registration sheet).
  // The season's tournaments: results for everyone, entry for captains, the
  // registration sheet for officials.
  async tournaments() {
    // On the Leaderboard everyone opens a tournament's results; officials reach
    // the registration sheets from More (Tournament sheets: ?sheets=1).
    const official = !!state.me?.canHandleMoney && new URLSearchParams(location.hash.split('?')[1] || '').get('sheets') === '1';
    // Tournaments are JHMMC's (for now): only JHMMC boats' captains enter; everyone sees the results.
    const captain = !!state.me?.canWeigh && !state.me.canHandleMoney && isJhmmc(state.me.clubId);
    const { tournaments, fee } = await api('/tournaments');
    const go = (t) => (official ? `#/sheet/${t.id}` : `#/tournament/${t.id}`);
    // On the Leaderboard: coming up (to join) first, then the results of those started or over.
    const listed = official ? tournaments : tournaments.filter((t) => t.date <= today());
    view.innerHTML = html`${official ? raw('<p class="back"><a href="#/more">‹ More</a></p><h1>Tournament sheets</h1>' + recordedNote('Entering or removing a boat, and marking memberships paid, are visible to the officers.')) : raw(html`<h1>Leaderboard</h1>${raw(boardTabs('tournaments'))}`)}
      ${captain && !official ? raw(html`<p class="small muted">Non-members pay a USD ${fee} temporary membership.</p>`) : ''}
      ${official && state.me?.canReview ? raw(html`<p><a class="btn primary" href="#/calendar?new=1">${raw(icon('trophy'))} New tournament</a></p>`) : ''}
      ${!official && tournaments.some((t) => t.open) ? raw(html`<h2 id="coming-up">Coming up</h2>
      <div class="stack">${tournaments.filter((t) => t.open).map((t) => raw(html`<div class="card pad tournament-call join-card" id="t-${t.id}">
        <div class="tc-head">${raw(icon('trophy'))}<span class="small">${t.date > today() ? 'Coming up' : 'Under way'}</span></div>
        <b class="tc-name">${t.name}</b>
        <span class="muted">${fmtDays(t)} · ${plural(t.boats, 'boat')} entered</span>
        ${captain ? raw(t.mine
          ? html`<p class="tournament-now">${raw(icon('check'))} Your boat is entered.</p><a class="btn" href="#/enter/${t.id}">Edit your anglers</a>`
          : html`<a class="btn primary" href="#/enter/${t.id}">Enter your boat</a>`)
          : raw(html`<a class="btn" href="#/tournament/${t.id}">See who's in</a>`)}
      </div>`))}</div>
      <h2>Results</h2>`) : ''}
      ${listed.length ? raw(html`<div class="card menu">${listed.map((t) => raw(html`<a class="menu-item" href="${go(t)}">
        <span class="mi-icon">${raw(icon('trophy'))}</span>
        <span class="mi-text"><b>${t.name}</b><span>${fmtDays(t)}${t.open ? '' : ' · over'}</span>
          <span>${official ? `${plural(t.boats, 'boat')} · ${plural(t.anglers, 'angler')} · ${t.guests} non-member${t.guests === 1 ? '' : 's'}${t.unpaid ? ` · ${t.unpaid} unpaid` : ''}`
            : captain ? (t.mine ? 'Your boat is entered' : t.open ? 'Not entered yet' : 'You did not enter') : `${plural(t.boats, 'boat')} entered`}</span></span>
        ${t.mine && captain ? raw(`<span class="badge new">In</span>`) : ''}
        <span class="mi-go" aria-hidden="true">›</span></a>`))}</div>`)
        : raw(html`<div class="card pad empty">${tournaments.length ? 'No results yet: they show here once a tournament starts.' : 'No tournaments on the calendar this season yet.'}${official ? raw(' <a href="#/calendar">Add one</a>') : ''}</div>`)}`;
  },

  // A captain enters their boat in a tournament with the anglers fishing on it.
  async enter(id) {
    if (!state.me?.canWeigh) return needLogin(view, 'enter tournaments (captains of JHMMC boats)');
    const { tournament, team, crew, named, entered, anglers, open, fee } = await api(`/tournaments/${id}/my-entry`);
    view.innerHTML = html`<p class="back"><a href="#/tournament/${id}">‹ ${tournament.name}</a></p>
      <h1>${tournament.name}</h1>
      <p class="muted">${fmtDays(tournament)} · <b>${team.name}</b> · ${team.division === 'river' ? 'River' : 'Ocean'}${team.station ? ` · ${team.station}` : ''}</p>
      <p class="tournament-now">${raw(icon(entered ? 'check' : 'trophy'))} ${entered ? 'Your boat is entered.' : 'Your boat is not entered yet.'}</p>
      ${open ? raw(html`<form class="card pad stack" id="entry">
        <h2>Anglers on ${team.name}${raw(info(html`<p>Tick your crew who are fishing and add anyone else as a guest.</p><p>Only people the secretary has marked as paid JHMMC members count as members; everyone else, guests included, pays a USD ${fee} temporary membership before the tournament day.</p>`))}</h2>
        ${raw(anglerEditor(crew, anglers, false, named))}
        <p class="error"></p>
        <div class="actions"><button type="submit" class="primary">${entered ? 'Save changes' : 'Enter my boat'}</button>
          ${entered ? raw('<button type="button" class="danger" data-act="withdraw">Withdraw my boat</button>') : ''}</div>
      </form>`) : raw(html`<div class="card pad">${anglers.length ? raw(html`<ol class="entry-anglers">${anglers.map((a) => raw(html`<li>${a.name} <span class="muted small">· ${a.member ? 'member' : 'non-member'}</span></li>`))}</ol>`)
        : raw('<p class="muted">This tournament is over.</p>')}</div>`)}`;
    const form = view.querySelector('#entry');
    if (!form) return;
    wireAnglerEditor(form);
    bindForm(form, async () => {
      await api(`/tournaments/${id}/entries/${team.id}`, { method: 'PUT', body: { entered: true, anglers: readAnglerEditor(form) } });
      toast(entered ? 'Saved' : `${team.name} is entered`);
      route();
    });
    form.querySelector('[data-act=withdraw]')?.addEventListener('click', async () => {
      if (!confirm(`Withdraw ${team.name} from ${tournament.name}?`)) return;
      await api(`/tournaments/${id}/entries/${team.id}`, { method: 'PUT', body: { entered: false } });
      toast('Withdrawn');
      route();
    });
  },

  // The secretary's registration sheet, like the club's "Teams registered" list.
  async sheet(id) {
    if (!state.me?.canHandleMoney) return needLogin(view, 'see the registration sheet (club officers and the treasurer)');
    const { tournament, boats, fee } = await api(`/tournaments/${id}/sheet`);
    // The treasurer ticks payments; entries and anglers are for the officers.
    const manage = !!state.me.canReview;
    const inBoats = boats.filter((b) => b.entered);
    const outBoats = boats.filter((b) => !b.entered);
    const all = inBoats.flatMap((b) => b.anglers);
    const guests = all.filter((a) => !a.member);
    const unpaid = guests.filter((a) => !a.paid);
    // Boats in, by weigh station and Ocean / River.
    const stations = [...new Set(inBoats.map((b) => b.station || 'No station'))];
    const count = (st, div) => inBoats.filter((b) => (b.station || 'No station') === st && (!div || b.division === div)).length;
    let n = 0;
    view.innerHTML = html`<p class="back"><a href="#/tournaments?sheets=1">‹ Tournament sheets</a></p>
      <h1>${tournament.name}</h1>
      <p class="muted">${fmtDays(tournament)} · <a href="#/tournament/${tournament.id}">Results</a></p>
      <div class="sheet-totals">
        <div><span>Boats in</span><b>${inBoats.length}</b></div>
        <div><span>Anglers</span><b>${all.length}</b><small>${all.length - guests.length} members · ${guests.length} non-members</small></div>
        <div><span>Temporary memberships</span><b>USD ${unpaid.length * fee}</b><small>${unpaid.length ? `${unpaid.length} of ${guests.length} still to pay` : guests.length ? 'all paid' : 'none due'}</small></div>
      </div>
      ${inBoats.length ? raw(html`<div class="card table-wrap"><table>
        <thead><tr><th>Station</th><th class="num">Ocean</th><th class="num">River</th><th class="num">Total</th></tr></thead>
        <tbody>${stations.map((st) => raw(html`<tr><td>${st}</td><td class="num">${count(st, 'ocean') || ''}</td><td class="num">${count(st, 'river') || ''}</td><td class="num"><b>${count(st)}</b></td></tr>`))}
          <tr><td><b>Total</b></td><td class="num"><b>${inBoats.filter((b) => b.division === 'ocean').length}</b></td><td class="num"><b>${inBoats.filter((b) => b.division === 'river').length}</b></td><td class="num"><b>${inBoats.length}</b></td></tr></tbody>
      </table></div>
      <p><button type="button" data-act="copy-sheet">Copy the list for WhatsApp</button></p>`) : ''}
      <h2>Boats in (${inBoats.length})</h2>
      ${inBoats.length ? raw(html`<div class="stack">${inBoats.map((b) => raw(html`<article class="card pad sheet-boat" data-team="${b.teamId}">
        <div class="catch-head"><h3 class="catch-title"><a href="#/boat/${b.teamId}">${b.teamName}</a></h3>
          ${manage ? raw('<label class="check"><input type="checkbox" data-act="in" checked> In</label>') : ''}</div>
        <p class="meta">${b.division === 'river' ? 'River' : 'Ocean'} · ${b.station || 'no weigh station'}</p>
        ${b.anglers.length ? raw(html`<ol class="entry-anglers">${b.anglers.map((a) => raw(html`<li data-angler="${a.id}" value="${++n}">
          <span>${a.name}</span>
          <span class="badge ${a.member ? 'new' : 'guest'}">${a.member ? 'Member' : 'Non-member'}</span>
          ${a.member ? '' : raw(html`<label class="check paid"><input type="checkbox" data-act="paid" ${a.paid ? 'checked' : ''}> Paid</label>`)}
        </li>`))}</ol>`) : raw('<p class="small muted">No anglers listed yet.</p>')}
        ${manage ? raw(html`<button type="button" data-act="edit" class="link">Edit anglers</button>
        <form class="stack angler-edit" hidden>${raw(anglerEditor(b.crew, b.anglers, true, b.named))}
          <p class="error"></p><div class="actions"><button type="submit" class="primary">Save anglers</button></div></form>`) : ''}
      </article>`))}</div>`) : raw('<div class="card pad empty">No boats in yet.</div>')}
      <h2>Not in (${outBoats.length})</h2>
      <div class="card"><ul class="list">${outBoats.length ? outBoats.map((b) => raw(html`<li class="member" data-team="${b.teamId}">
        <span>${b.teamName} <span class="muted small">· ${b.division === 'river' ? 'River' : 'Ocean'}${b.station ? ` · ${b.station}` : ''}</span></span>
        ${manage ? raw('<button type="button" data-act="put-in">Put in</button>') : ''}</li>`)) : raw('<li class="muted">Every JHMMC boat is in.</li>')}</ul></div>
      ${manage ? raw('<p class="small muted">The captain is notified.</p>') : ''}`;
    view.querySelector('.sheet-totals').insertAdjacentHTML('afterend', `<p class="pdf-row">${pdfButton('Download the sheet (PDF)')} ${xlsxButton('Excel', String(id))}</p>`);
    view.querySelector('[data-pdf]').pdf = () => {
      return {
        title: `${tournament.name}: registration sheet`,
        subtitle: `${fmtDays(tournament)}. ${plural(inBoats.length, 'boat')} in, ${plural(all.length, 'angler')} (${all.length - guests.length} members, ${guests.length} non-members). Temporary membership USD ${fee}: ${unpaid.length ? `${unpaid.length} still to pay, USD ${unpaid.length * fee}` : guests.length ? 'all paid' : 'none due'}.`,
        file: fileName(`${tournament.name} registration sheet`),
        // Each boat, with its anglers under it: members, then guests, and who has paid.
        sections: [
          ...(inBoats.length ? inBoats.map((b) => {
            const members = b.anglers.filter((a) => a.member);
            const guestsHere = b.anglers.filter((a) => !a.member);
            const owing = guestsHere.filter((a) => !a.paid).length;
            return {
              heading: `${b.teamName}  ·  ${b.division === 'river' ? 'River' : 'Ocean'}${b.station ? `  ·  ${b.station}` : ''}  ·  ${plural(b.anglers.length, 'angler')}${owing ? `  ·  USD ${owing * fee} to pay` : ''}`,
              head: ['#', 'Angler', 'Status', 'Paid'], none: 'No anglers listed yet.',
              body: [...members, ...guestsHere].map((a, n) => [n + 1, a.name, a.member ? 'JHMMC member' : 'Guest (temporary membership)',
                a.member ? 'Paid (season)' : a.paid ? `Paid (USD ${fee})` : `NOT PAID (USD ${fee})`]),
              widths: { 0: { cellWidth: 26 }, 1: { cellWidth: 170 }, 2: { cellWidth: 175 } },
              paint: (d) => { if (d.section === 'body' && d.column.index === 3 && String(d.cell.raw).startsWith('NOT')) { d.cell.styles.textColor = [198, 40, 40]; d.cell.styles.fontStyle = 'bold'; } },
            };
          }) : [{ head: ['Boats in'], none: 'No boats in yet.', body: [] }]),
          { heading: `Not in (${outBoats.length})`, head: ['Boat', 'Division', 'Weigh station'], none: 'Every JHMMC boat is in.',
            body: outBoats.map((b) => [b.teamName, b.division === 'river' ? 'River' : 'Ocean', b.station || '']) },
        ],
      };
    };
    const put = (teamId, body) => api(`/tournaments/${id}/entries/${teamId}`, { method: 'PUT', body });
    view.addEventListener('change', async (e) => {
      const box = e.target.closest('input[data-act]');
      if (!box || box.closest('.angler-edit')) return;
      const teamId = box.closest('[data-team]').dataset.team;
      try {
        if (box.dataset.act === 'in') {
          if (!confirm('Take this boat out of the tournament? Its anglers are removed too.')) { box.checked = true; return; }
          await put(teamId, { entered: false });
          route();
        } else if (box.dataset.act === 'paid') {
          await api(`/tournaments/${id}/anglers/${box.closest('[data-angler]').dataset.angler}`, { method: 'PATCH', body: { paid: box.checked } });
          toast(box.checked ? 'Marked paid' : 'Marked unpaid');
          route();
        }
      } catch (ex) {
        box.checked = !box.checked;
        toast(ex.message);
      }
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'put-in') {
        const teamId = btn.closest('[data-team]').dataset.team;
        await put(teamId, { entered: true });
        toast('In: now add its anglers');
        // Back on the sheet with this boat's angler list open.
        const to = `#/sheet/${id}?anglers=${teamId}`;
        if (location.hash === to) route();
        else location.hash = to;
      } else if (btn.dataset.act === 'edit') {
        const f = btn.nextElementSibling;
        f.hidden = !f.hidden;
      } else if (btn.dataset.act === 'copy-sheet') {
        let i = 0;
        const text = [`${tournament.name}: boats registered (${inBoats.length})`, ...inBoats.map((b) => [
          `\n${b.teamName} · ${b.division === 'river' ? 'River' : 'Ocean'} · ${b.station || 'no station'}`,
          ...b.anglers.map((a) => `${++i}. ${a.name}${a.member ? '' : ` (non-member${a.paid ? ', paid' : ''})`}`),
        ].join('\n')), `\nAll temporary memberships should be paid before the tournament day.`].join('\n');
        copyText(text, 'List copied');
      }
    });
    // Just put in: open its angler list.
    const openFor = new URLSearchParams(location.hash.split('?')[1] || '').get('anglers');
    const justIn = openFor && view.querySelector(`.sheet-boat[data-team="${openFor}"]`);
    if (justIn) {
      justIn.querySelector('.angler-edit').hidden = false;
      setTimeout(() => justIn.scrollIntoView({ block: 'start' }), 50);
    }
    for (const f of view.querySelectorAll('.angler-edit')) {
      wireAnglerEditor(f);
      bindForm(f, async () => {
        await put(f.closest('[data-team]').dataset.team, { entered: true, anglers: readAnglerEditor(f) });
        toast('Anglers saved');
        route();
      });
    }
  },

  // The secretary's list of who has paid their JHMMC membership this season.
  async 'club-members'() {
    if (!state.me?.canHandleMoney) return needLogin(view, 'keep the membership list (club officers and the treasurer)');
    const [{ season, people, named, others, canSetMembers }, { teams }] = await Promise.all([api('/club-members'), api('/teams')]);
    const label = `${season.start.slice(0, 4)}–${season.end.slice(2, 4)}`;
    const paid = people.filter((p) => p.paid).length;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Club members${raw(info(html`<p>Everyone in JHMMC, and who has paid their membership for the ${label} season (${fmtDay(season.start)} to ${fmtDay(season.end)}).</p><p>In tournaments, anyone who isn't ticked paid here counts as a non-member and pays the temporary membership.</p>`))}</h1>
      ${canSetMembers ? raw(html`<form class="card pad stack" id="add-member">
        <h3>Add someone to JHMMC</h3>
        <label class="search">${raw(icon('search'))}<input list="non-members" name="who" placeholder="Name, email or boat" autocomplete="off" aria-label="Find a person"></label>
        <datalist id="non-members">${raw(others.map((o) => html`<option value="${o.name} · ${o.email}">${o.teamName || 'No boat'}</option>`).join(''))}</datalist>
        <label class="check"><input type="checkbox" name="paid" checked> Paid ${label}</label>
        <p class="error"></p><div><button type="submit" class="primary">Add to JHMMC</button></div>
      </form>`) : ''}
      ${raw(recordedNote('Adding or removing members and marking them paid is visible to the officers.'))}
      <div class="sheet-totals"><div><span>Paid members</span><b>${paid + named.filter((p) => p.paid).length}</b></div><div><span>Not paid</span><b>${people.length - paid + named.filter((p) => !p.paid).length}</b></div></div>
      <div class="filter-bar member-filter">
        ${[['all', 'Everyone'], ['paid', 'Paid'], ['unpaid', 'Not paid']].map(([k, l]) => raw(html`<button type="button" class="${k === 'all' ? 'filter-toggle on' : 'filter-toggle'}" data-show="${k}">${l}</button>`))}
      </div>
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by name, email or boat" aria-label="Search people" autocomplete="off"></label>
      <div class="card"><ul class="list">${people.map((p) => raw(html`<li class="member member-pay" data-id="${p.id}" data-paid="${p.paid}" data-find="${`${p.name} ${p.nickname || ''} ${p.email} ${p.teamName || ''}`.toLowerCase()}">
        <span><b>${p.name}</b>${p.nickname ? raw(html` <span class="muted">“${p.nickname}”</span>`) : ''}<div class="muted small">${p.teamName || 'No boat'} · ${p.email}</div>
          ${p.isAdmin ? raw('<span class="badge new">Admin</span>')
            : state.me.isAdmin ? raw(html`<label class="role-pick">Role <select data-act="role">${raw(options(ROLE_OPTIONS, p.role || ''))}</select></label>`)
              : p.role ? raw(html`<span class="badge">${roleLabel(p.role)}</span>`) : ''}</span>
        <span class="pay-col"><label class="check"><input type="checkbox" ${p.paid ? 'checked' : ''}> Paid ${label}</label>
          ${canSetMembers && !p.isAdmin ? raw('<button type="button" class="link danger small" data-act="not-member">Remove from JHMMC</button>') : ''}</span>
      </li>`))}</ul></div>
      <h2>Members without an account${raw(info('<p>Children and anyone else who doesn\'t use the app. Give them their boat so its captain can pick them for tournaments.</p>'))}</h2>
      <div class="card"><ul class="list">${named.length ? named.map((p) => raw(html`<li class="member member-pay" data-person="${p.id}" data-paid="${p.paid}" data-find="${`${p.name} ${p.teamName || ''}`.toLowerCase()}">
        <span><b>${p.name}</b><div class="muted small">${p.teamName || 'No boat'} · no account ·
          <button type="button" class="link danger" data-act="remove-person">Remove</button></div></span>
        <label class="check"><input type="checkbox" ${p.paid ? 'checked' : ''}> Paid ${label}</label>
      </li>`)) : raw('<li class="muted">None yet.</li>')}</ul></div>
      <form class="card pad stack" id="add-person">
        <h3>Add a member without an account</h3>
        <div class="row">
          <label>Name <input name="name" required maxlength="80" placeholder="e.g. Sami Eid"></label>
          <label>Boat <select name="teamId">${raw(options(teams.filter((t) => isJhmmc(t.clubId)).map((t) => [t.id, t.name]), null, 'No boat'))}</select></label>
        </div>
        <label class="check"><input type="checkbox" name="paid" checked> Paid ${label}</label>
        <p class="error"></p><div><button type="submit" class="primary">Add member</button></div>
      </form>`;
    view.querySelector('.sheet-totals').insertAdjacentHTML('afterend', `<p class="pdf-row">${pdfButton('Download the list (PDF)')} ${xlsxButton('Excel: members and tournaments')}</p>`);
    // Fetched again when the PDF is made, so payments ticked since are in it.
    view.querySelector('[data-pdf]').pdf = async () => {
      const now = await api('/club-members');
      const rows = [...now.people.map((p) => [p.name, p.teamName || '', 'Yes', p.paid ? 'Paid' : 'Not paid']),
        ...now.named.map((p) => [p.name, p.teamName || '', 'No', p.paid ? 'Paid' : 'Not paid'])]
        .sort((a, b) => a[0].localeCompare(b[0]));
      const paidN = rows.filter((r) => r[3] === 'Paid').length;
      return {
        title: `JHMMC members ${label}`,
        subtitle: `Season ${fmtDay(season.start)} to ${fmtDay(season.end)}. ${plural(rows.length, 'member')}: ${paidN} paid, ${rows.length - paidN} not paid.`,
        file: fileName(`JHMMC members ${label} ${today()}`),
        sections: [{ head: ['Name', 'Boat', 'On the app', `Membership ${label}`], body: rows.map((r, i) => r) }],
      };
    };
    let show = 'all';
    const filter = () => {
      const term = view.querySelector('.search input').value.trim().toLowerCase();
      for (const li of view.querySelectorAll('.member-pay')) {
        const isPaid = li.dataset.paid === 'true';
        li.hidden = (term && !li.dataset.find.includes(term)) || (show === 'paid' && !isPaid) || (show === 'unpaid' && isPaid);
      }
    };
    view.querySelector('.search input').addEventListener('input', filter);
    view.querySelector('.member-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-show]');
      if (!btn) return;
      show = btn.dataset.show;
      for (const b of view.querySelectorAll('.member-filter [data-show]')) b.classList.toggle('on', b === btn);
      filter();
    });
    // The secretary adds someone with an account to JHMMC.
    const memberForm = view.querySelector('#add-member');
    if (memberForm) bindForm(memberForm, async () => {
      const typed = memberForm.who.value.trim().toLowerCase();
      const who = others.find((o) => `${o.name} · ${o.email}`.toLowerCase() === typed)
        || others.filter((o) => `${o.name} ${o.email} ${o.teamName || ''}`.toLowerCase().includes(typed)).reduce((a, o, i, l) => (l.length === 1 ? o : a), null);
      if (!who) throw new Error(typed ? 'Choose one person from the list.' : 'Type a name to find them.');
      if (!confirm(`Add ${who.name} to JHMMC${memberForm.paid.checked ? `, paid ${label}` : ''}?`)) return;
      await api(`/club-members/${who.id}`, { method: 'PUT', body: { member: true, ...(memberForm.paid.checked && { paid: true }) } });
      toast(`${who.name} is a JHMMC member`);
      route();
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act=not-member]');
      if (!btn) return;
      const li = btn.closest('[data-id]');
      const name = li.querySelector('b').textContent;
      if (!confirm(`Remove ${name} from JHMMC? Their paid tick for this season goes too.`)) return;
      try {
        await api(`/club-members/${li.dataset.id}`, { method: 'PUT', body: { member: false } });
        toast(`${name} is no longer a JHMMC member`);
        route();
      } catch (ex) {
        toast(ex.message);
      }
    });
    view.addEventListener('change', async (e) => {
      // The admin sets club roles here.
      const sel = e.target.closest('select[data-act=role]');
      if (sel) {
        try {
          await api(`/admin/users/${sel.closest('[data-id]').dataset.id}`, { method: 'PATCH', body: { role: sel.value } });
          toast(sel.value ? `${sel.closest('[data-id]').querySelector('b').textContent} is now the secretary` : 'Now a member');
        } catch (ex) {
          toast(ex.message);
        }
        return;
      }
      const box = e.target.closest('.member-pay input[type=checkbox]');
      if (!box) return;
      const li = box.closest('.member-pay');
      try {
        await api(li.dataset.person ? `/club-members/named/${li.dataset.person}` : `/club-members/${li.dataset.id}`, { method: 'PUT', body: { paid: box.checked } });
        li.dataset.paid = String(box.checked);
        const count = view.querySelectorAll('.member-pay[data-paid=true]').length;
        const [paidBox, unpaidBox] = view.querySelectorAll('.sheet-totals b');
        paidBox.textContent = count;
        unpaidBox.textContent = view.querySelectorAll('.member-pay').length - count;
        toast(box.checked ? `${li.querySelector('b').textContent}: paid member` : 'Marked not paid');
      } catch (ex) {
        box.checked = !box.checked;
        toast(ex.message);
      }
    });
    const addForm = view.querySelector('#add-person');
    bindForm(addForm, async () => {
      await api('/club-members/named', { method: 'POST', body: { name: addForm.name.value, teamId: addForm.teamId.value || null, paid: addForm.paid.checked } });
      toast(`${addForm.name.value} added`);
      route();
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act=remove-person]');
      if (!btn) return;
      const li = btn.closest('[data-person]');
      if (!confirm(`Remove ${li.querySelector('b').textContent} from the club list?`)) return;
      await api(`/club-members/named/${li.dataset.person}`, { method: 'DELETE' });
      route();
    });
  },

  async members() {
    if (!state.me?.isAdmin && !state.me?.canApprove) {
      view.innerHTML = '<div class="card pad empty">Only the admin and the JHMMC secretary can see this page.</div>';
      return;
    }
    // The secretary ticks who is in JHMMC; reset links and deleting accounts stay the admin's.
    const admin = !!state.me.isAdmin;
    const { users } = await api('/admin/users');
    let boats = null; // fetched when the admin first edits someone
    const inClub = users.filter((u) => u.jhmmc).length;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Members (${users.length})${raw(info(html`<p>Tick who belongs to JHMMC; the secretary then marks which of them have paid this season. Roles such as Secretary are set on the Club members page. Weighmasters are appointed on the Weighmasters page. When a member forgets their password, check the request came from their sign-up email, then make a reset link and send it to them. It works once and expires after 24 hours; they choose the new password themselves.</p>`))}</h1>
      ${admin ? '' : raw(recordedNote('Adding someone to JHMMC or taking them out is visible to the officers.'))}
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by name, email or boat" aria-label="Search members" autocomplete="off"></label>
      <div class="card"><ul class="list">${users.map((u) => raw(html`<li class="member-row" data-id="${u.id}" data-find="${`${u.name} ${u.nickname || ''} ${u.email} ${u.teamName || ''}`.toLowerCase()}">
        <div><b>${u.name}</b>${u.nickname ? raw(html` <span class="muted">“${u.nickname}”</span>`) : ''}<div class="muted small" data-line>${u.email}${u.teamName ? ` · ${u.teamName}` : ''}</div></div>
        ${admin ? raw('<div class="actions member-actions"><button data-act="edit-user">Edit</button><button data-act="reset-link">Create reset link</button></div>') : ''}
        <form class="stack edit-user" hidden></form>
        <div class="role">
          <label class="check"><input type="checkbox" data-act="jhmmc" ${u.jhmmc ? 'checked' : ''} ${u.isAdmin ? 'disabled' : ''}> JHMMC member</label>
          ${u.isAdmin ? raw('<span class="badge new">Admin</span>') : u.role ? raw(html`<span class="badge">${roleLabel(u.role)}</span>`) : ''}
        </div>
        <div class="reset-out" hidden></div>
        ${!admin || u.id === state.me.id ? '' : raw('<div class="delete-user"><button data-act="delete-user" class="link danger">Delete account</button></div>')}
      </li>`))}</ul></div>`;
    view.querySelector('.search input').addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      for (const li of view.querySelectorAll('.member-row')) li.hidden = !!term && !li.dataset.find.includes(term);
    });
    view.addEventListener('change', async (e) => {
      const box = e.target.closest('input[data-act=jhmmc]');
      if (box) {
        const row = box.closest('.member-row');
        const name = row.querySelector('b').textContent;
        const hasRole = !!row.querySelector('.badge:not(.new)');
        if (!box.checked && hasRole && !confirm(`Take ${name} out of JHMMC? They'll lose their role as well.`)) {
          box.checked = true;
          return;
        }
        try {
          const { role } = admin ? await api(`/admin/users/${row.dataset.id}`, { method: 'PATCH', body: { jhmmc: box.checked } })
            : { role: hasRole, ...(await api(`/club-members/${row.dataset.id}`, { method: 'PUT', body: { member: box.checked } })) };
          if (!role) row.querySelector('.badge:not(.new)')?.remove();
          toast(box.checked ? `${name} is a JHMMC member` : `${name} is no longer a JHMMC member`);
        } catch (ex) {
          box.checked = !box.checked;
          toast(ex.message);
        }
      }
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('.member-row');
      if (btn.dataset.act === 'copy-link') return copyText(row.dataset.link, 'Link copied');
      // The admin fixes a name, an email or a boat (never a password: that's the reset link).
      if (btn.dataset.act === 'edit-user') {
        const form = row.querySelector('.edit-user');
        if (!form.hidden) { form.hidden = true; return; }
        const u = users.find((x) => String(x.id) === row.dataset.id);
        boats ??= (await api('/teams')).teams.sort((a, b) => a.name.localeCompare(b.name));
        form.innerHTML = html`<div class="row">
            <label>First name <input name="firstName" required maxlength="40" value="${u.firstName || ''}"></label>
            <label>Last name <input name="lastName" required maxlength="40" value="${u.lastName || ''}"></label>
          </div>
          <label>Email <input name="email" type="email" required maxlength="120" value="${u.email}" ${u.isAdmin ? raw('disabled') : ''}></label>
          <label>Boat <select name="teamId">${raw(options(boats.map((t) => [t.id, t.name]), u.teamId ? String(u.teamId) : '', 'No boat'))}</select></label>
          <p class="small muted">They're told on their phone${u.isAdmin ? '' : ', and at their old email if it changes'}. It's in the Activity log.</p>
          <p class="error"></p>
          <div class="actions"><button type="submit" class="primary">Save</button><button type="button" data-act="edit-user">Cancel</button></div>`;
        form.hidden = false;
        // Bound once: opening the form again doesn't save twice.
        if (!form.dataset.bound) form.dataset.bound = '1';
        else { form.querySelector('input').focus(); return; }
        bindForm(form, async () => {
          const fd = formData(form);
          const u = users.find((x) => String(x.id) === row.dataset.id);
          const body = { firstName: fd.firstName, lastName: fd.lastName, teamId: fd.teamId || '', ...(u.isAdmin ? {} : { email: fd.email }) };
          const r = await api(`/admin/users/${u.id}/account`, { method: 'PATCH', body });
          const team = boats.find((t) => String(t.id) === String(body.teamId));
          Object.assign(u, { firstName: body.firstName, lastName: body.lastName, name: `${body.firstName} ${body.lastName}`,
            email: body.email ? body.email.toLowerCase() : u.email, teamId: team?.id ?? null, teamName: team?.name ?? null });
          row.querySelector('b').textContent = u.name;
          row.querySelector('[data-line]').textContent = `${u.email}${u.teamName ? ` · ${u.teamName}` : ''}`;
          row.dataset.find = `${u.name} ${u.nickname || ''} ${u.email} ${u.teamName || ''}`.toLowerCase();
          form.hidden = true;
          toast(Array.isArray(r.changes) ? 'Nothing to change' : `${u.name}: saved`);
        });
        form.querySelector('input').focus();
        return;
      }
      if (btn.dataset.act === 'delete-user') {
        const name = row.querySelector('b').textContent;
        if (!confirm(`Delete ${name}'s account? This can't be undone.\n\nTheir catches stay on the app under their name.`)) return;
        try {
          await api(`/admin/users/${row.dataset.id}`, { method: 'DELETE' });
          row.remove();
          toast(`${name}'s account was deleted`);
        } catch (ex) {
          toast(ex.message);
        }
        return;
      }
      if (btn.dataset.act !== 'reset-link') return;
      try {
        const { link, hours, name } = await api(`/admin/users/${row.dataset.id}/reset-link`, { method: 'POST' });
        row.dataset.link = link;
        const out = row.querySelector('.reset-out');
        out.innerHTML = html`<p class="small muted">New link for ${name}, valid for ${hours} hours. Any older link stops working.</p>
          <input readonly value="${link}" aria-label="Reset link">
          <div class="actions"><button data-act="copy-link">Copy link</button>
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(`Hello ${name}, here is your link to set a new password for the Africa Sportfishing app. It works once, within ${hours} hours: ${link}`)}">Send on WhatsApp</a></div>`;
        out.hidden = false;
        out.querySelector('input').select();
      } catch (ex) {
        toast(ex.message);
      }
    });
  },
}));
