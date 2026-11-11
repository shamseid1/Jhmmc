// Africa Sportfishing, part of the app (public/js/pages-board.js): The leaderboard, a tournament's results and the scoring table.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // Official JHMMC standings from approved catches.
  // Behind a number on the points tables: the boat's or angler's fish that count.
  async 'points-fish'() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const { title, fish, total, scope, division, board } = await api(`/points/fish?${q}`);
    const byBoat = q.has('team');
    view.innerHTML = html`<p class="back"><a href="#/" data-back>‹ Back</a></p>
      <h1>${title || 'Fish'}</h1>
      <p class="muted">${scope === 'tournaments' ? 'JHMMC Tournaments' : board === 'jhmmc' ? 'JHMMC Season' : 'All of West Africa'} · ${division === 'river' ? 'River' : 'Ocean'} · this season</p>
      <div class="stats3">
        <div class="card s"><b>${fish.length}</b><span>fish</span></div>
        <div class="card s"><b>${total}</b><span>points</span></div>
        <div class="card s"><b>${fish.filter((f) => f.released).length}</b><span>released</span></div>
      </div>
      ${fish.length ? raw(html`<div class="card"><ul class="list drill-list">${fish.map((f) => raw(html`<li><a href="#/catch/${f.id}">
        <span><span><b>${f.species}</b>${f.weightKg ? ` · ${fmtWeight(f.weightKg)}` : f.released ? ' · released' : ''}</span>
          <span class="small muted">${fmtDate(f.caughtOn)} · ${byBoat ? f.angler : f.teamName}${f.pointsNote ? ` · ${f.pointsNote}` : ''}</span></span>
        <b class="drill-pts">${fmtPoints(f.points)}</b></a></li>`))}</ul></div>`)
        : raw('<div class="card pad empty">No fish count here yet.</div>')}`;
    view.querySelector('[data-back]').addEventListener('click', (e) => {
      if (history.length > 1) {
        e.preventDefault();
        history.back();
      }
    });
  },

  // The club leaderboard (West Africa side): choose a club and see its points
  // leaderboard, laid out like JHMMC's. Only JHMMC keeps points in the app so far.
  // For now JHMMC is Africa Sportfishing: one points board for every boat
  // weighed in through JHMMC, and the JHMMC Season (JHMMC boats only).
  async leaderboard() {
    await this.points(undefined, { base: '#/leaderboard', top: html`<h1>Leaderboard</h1>${raw(boardTabs('board'))}` });
  },

  async points(_arg, { base = '#/points', top = '' } = {}) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    // Old #/points links (from the JHMMC side) open the leaderboard.
    if (!top) {
      location.replace(`#/leaderboard${q.size ? `?${q}` : ''}`);
      return;
    }
    const link = (params) => `${base}${base.includes('?') ? '&' : '?'}${params}`;
    // Tap a number: the fish behind it.
    const drill = (who) => `#/points-fish?${new URLSearchParams({ scope: q.get('scope') || 'overall', division: q.get('division') || 'ocean', board: q.get('board') || 'all', ...who })}`;
    const division = q.get('division') === 'river' ? 'river' : 'ocean';
    // Two trophies: overall points (every day) and tournament points only.
    const scope = q.get('scope') === 'tournaments' ? 'tournaments' : 'overall';
    const board = q.get('board') === 'jhmmc' || scope === 'tournaments' ? 'jhmmc' : 'all';
    const { boats, biggest, season, pending } = await api(`/points?division=${division}&scope=${scope}&board=${board}`);
    view.innerHTML = html`${raw(top)}
      <div class="filter-chips">
        <select class="chip-select" data-go aria-label="Which table">${raw(options([
          [link(`board=all&division=${division}`), 'All of West Africa'],
          [link(`board=jhmmc&division=${division}`), 'JHMMC Season'],
          [link(`scope=tournaments&division=${division}`), 'JHMMC Tournaments'],
        ], link(scope === 'tournaments' ? `scope=tournaments&division=${division}` : `board=${board}&division=${division}`)))}</select>
        <select class="chip-select" data-go aria-label="Division">${raw(options(DIVISIONS.map(([key, label]) => [link(`${scope === 'tournaments' ? 'scope=tournaments' : `board=${board}`}&division=${key}`), label]),
          link(`${scope === 'tournaments' ? 'scope=tournaments' : `board=${board}`}&division=${division}`)))}</select>
      </div>
      ${boats.length ? raw(html`<h2>${scope === 'tournaments' ? 'Tournament points by boat' : 'Overall points by boat'}${raw(info(html`<p>${scope === 'tournaments'
        ? `JHMMC Tournaments: JHMMC boats' points from fish caught during the season's tournaments, all tournaments added up.`
        : board === 'jhmmc' ? `JHMMC Season: JHMMC boats only, every fishing day of the season, ${fmtDay(season.start)} to ${fmtDay(season.end)}.`
          : `Every boat in West Africa, every fishing day of the season, ${fmtDay(season.start)} to ${fmtDay(season.end)}. Only JHMMC boats compete in the JHMMC Season and Tournaments.`}
</p><p>Fish registered at the weigh station and approved by the JHMMC secretary.
        ${pending ? `${plural(pending, 'registration')} waiting for the secretary.` : ''}</p><p><a href="#/scoring">How points work</a></p>`))}</h2>
      <section class="card pad bars" aria-label="${scope === 'tournaments' ? 'Tournament' : 'Overall'} points for the top ${Math.min(boats.length, TOP_BARS)} ${division} boats">${raw(pointsBars(boats.slice(0, TOP_BARS)))}</section>`) : ''}
      ${boats.length ? raw(html`<h2>Boats</h2><ol class="card rank-list">${boats.map((b, i) => raw(html`<li>
        <span class="rk">${i + 1}</span>
        <a class="nm" href="#/boat/${b.teamId}">${b.teamName}</a>
        <a class="drill fish" href="${drill({ team: b.teamId })}">${plural(b.catches, 'fish')}</a>
        <a class="drill pts" href="${drill({ team: b.teamId })}">${b.points}</a></li>`))}</ol>`) : ''}
      ${boats.length ? '' : raw(emptyState('trophy', scope === 'tournaments' ? 'No approved tournament fish yet this season.' : 'No approved catches yet this season.',
        state.me?.canWeigh ? ['#/weigh', 'Go to the weigh-in'] : null))}
      <h2>Biggest catches</h2>
      ${biggest.length ? raw(html`<ol class="card rank-list big-list">${biggest.map((c, i) => raw(html`<li>
        <span class="rk">${i + 1}</span>
        <a class="nm" href="#/catch/${c.id}"><span>${c.species} <span class="big-angler">· ${c.angler || 'the crew'}</span></span><span class="muted small">${c.teamName}</span></a>
        <a class="pts big-wt" href="#/catch/${c.id}">${fmtWeight(c.weightKg)}<span class="muted small">${fmtPoints(c.points)}</span></a></li>`))}</ol>`) : raw(emptyState('fish', 'No fish weighed in yet this season.'))}
      <p class="pdf-row">${raw(pdfButton())}</p>`;
    // The club's PDF: the JHMMC table (Season, or Tournaments if that's on screen), Ocean and River both.
    view.querySelector('[data-pdf]').pdf = async () => {
      const table = scope === 'tournaments' ? 'JHMMC Tournaments' : 'JHMMC Season';
      const [ocean, river] = await Promise.all(['ocean', 'river'].map((d) => api(`/points?division=${d}&scope=${scope}&board=jhmmc`)));
      const part = (side, r) => [
        ...(r.boats.length ? [{ heading: `${side}: points by boat`, bars: r.boats.slice(0, 15).map((b) => ({ label: b.teamName, value: b.points })) }] : []),
        { heading: `${side}: boats`, head: ['#', 'Boat', 'Fish', 'Points'], none: `No approved ${side.toLowerCase()} fish yet.`,
          body: r.boats.map((b, i) => [i + 1, b.teamName, b.catches, b.points]),
          widths: { 0: { cellWidth: 30 }, 2: { halign: 'right', cellWidth: 60 }, 3: { halign: 'right', cellWidth: 70 } } },
        { heading: `${side}: biggest catches`, head: ['#', 'Species', 'Weight', 'Angler', 'Boat', 'Points'], none: `No ${side.toLowerCase()} fish weighed in yet.`,
          body: r.biggest.map((c, i) => [i + 1, c.species, fmtWeight(c.weightKg), c.angler || '', c.teamName, c.points]),
          widths: { 0: { cellWidth: 26 }, 2: { halign: 'right', cellWidth: 60 }, 5: { halign: 'right', cellWidth: 50 } } },
      ];
      const waiting = ocean.pending + river.pending;
      return {
        title: `${table} leaderboard: Ocean and River`,
        subtitle: `Season ${fmtDay(season.start)} to ${fmtDay(season.end)}. JHMMC boats, approved fish only${waiting ? `; ${plural(waiting, 'registration')} waiting for the secretary` : ''}.`,
        file: fileName(`${table} leaderboard ${today()}`),
        sections: [...part('Ocean', ocean), { newPage: true }, ...part('River', river)],
      };
    };
  },

  async tournament(id) {
    const division = new URLSearchParams(location.hash.split('?')[1] || '').get('division') === 'river' ? 'river' : 'ocean';
    const { tournament, results, entries: allEntries } = await api(`/tournaments/${id}?division=${division}`);
    // Each tab lists only its own division's boats.
    const entries = allEntries.filter((e) => e.division === division);
    const side = division === 'river' ? 'River' : 'Ocean';
    view.innerHTML = html`<p class="back"><a href="#/leaderboard?division=${division}">‹ Leaderboard</a></p>
      <h1>${tournament.name}</h1>
      <p class="muted">${fmtDays(tournament)}</p>
      ${raw(divisionTabs(`#/tournament/${id}`, division))}
      ${results.length ? results.map((b, i) => raw(html`<section class="card pad result">
        <div class="catch-head"><h3 class="catch-title">${i + 1}. <a href="#/boat/${b.teamId}">${b.teamName}</a></h3><span class="weight">${fmtPoints(b.points)}</span></div>
        <ul class="list compact">${b.catches.map((c) => raw(html`<li><a href="#/catch/${c.id}">${c.species}</a>
          ${c.weightKg ? ` · ${fmtWeight(c.weightKg)}` : c.released ? ' · released' : ''} · ${c.angler}<span class="num-right">${fmtPoints(c.points)}</span></li>`))}</ul>
      </section>`)) : raw(html`<div class="card pad empty">${entries.length ? 'No approved results for this tournament yet.' : 'No boats entered yet.'}</div>`)}
      <h2>${side} boats entered (${entries.length})${raw(info('<p>Only entered boats compete. Boats fishing on these days without entering score for the season only.</p>'))}</h2>
      ${state.me?.canWeigh && !state.me.canHandleMoney && isJhmmc(state.me.clubId) && tournament.endDate >= today()
        ? raw(html`<p><a class="btn primary" href="#/enter/${id}">${raw(icon('trophy'))} Enter your boat</a></p>`) : ''}
      ${state.me?.canHandleMoney ? raw(html`<p><a class="btn" href="#/sheet/${id}">Open the registration sheet</a></p>`) : ''}
      ${raw(html`<div class="card"><ul class="list">${entries.length ? entries.map((e) => raw(html`<li><a href="#/boat/${e.teamId}">${e.teamName}</a></li>`))
          : raw(html`<li class="muted">No ${side} boats entered yet.</li>`)}</ul></div>`)}
      <p class="pdf-row">${raw(pdfButton())}</p>`;
    view.querySelector('[data-pdf]').pdf = () => ({
      title: `${tournament.name}: ${side} results`, subtitle: fmtDays(tournament),
      file: fileName(`${tournament.name} ${side} results`),
      sections: [
        { heading: 'Results by boat', head: ['#', 'Boat', 'Fish', 'Points'], none: 'No approved results yet.',
          body: results.map((b, i) => [i + 1, b.teamName, b.catches.length, b.points]),
          widths: { 0: { cellWidth: 30 }, 2: { halign: 'right', cellWidth: 60 }, 3: { halign: 'right', cellWidth: 70 } } },
        { heading: 'Fish', head: ['Boat', 'Species', 'Weight', 'Angler', 'Points'], none: 'No approved fish yet.',
          body: results.flatMap((b) => b.catches.map((c) => [b.teamName, c.species, c.weightKg ? fmtWeight(c.weightKg) : c.released ? 'released' : '', c.angler, c.points])),
          widths: { 4: { halign: 'right', cellWidth: 60 } } },
        { heading: `${side} boats entered (${entries.length})`, head: ['Boat'], none: 'No boats entered yet.', body: entries.map((e) => [e.teamName]) },
      ],
    });
  },

  // Points per kg for each species; the secretary can edit it.
  async scoring() {
    const editable = !!state.me?.canReview;
    const meta = await api('/meta');
    state.meta = meta;
    view.innerHTML = html`<p class="back"><a href="#/leaderboard">‹ Leaderboard</a></p>
      <h1>How points work</h1>
      <div class="card pad rulebook">
        <ul>
          <li><b>Season points:</b> every fishing day scores. A captain can only weigh in fish <b>on the day they are brought in</b>, with a photo of each fish on the scale taken there and then.</li>
          <li><b>Tournament points:</b> each tournament has its own results from its days only, with its own winner. Those fish count for the season too.</li>
          <li>Only fish <b>registered at the weigh station</b> (by its weighmaster) count, once the secretary approves them. Posts on the feed never count.</li>
          <li>A kept fish scores its <b>weight in kg × the points for its species</b>.</li>
          <li>A <b>released marlin scores 500</b>. A marlin under 100 kg that is kept scores <b>minus 500</b>, whatever it weighs.</li>
          <li>A <b>released sailfish</b> scores as a 25 kg sailfish.</li>
          <li>Fish under <b>2 kg (ocean)</b> or <b>1 kg (river)</b> don't count. Ocean and river boats have separate standings.</li>
        </ul>
      </div>
      <h2>Points per kg</h2>
      ${state.me?.canReview ? raw(recordedNote('Changing the points for a species is announced to everyone in the feed.')) : ''}
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Points per kg</th></tr></thead>
        <tbody>${meta.species.map((x) => raw(html`<tr><td>${x.name}</td><td class="num">${editable
          ? raw(html`<input class="ppk" data-id="${x.id}" type="number" min="0" max="100" step="0.5" value="${x.pointsPerKg}" aria-label="Points per kg for ${x.name}">`)
          : x.pointsPerKg}</td></tr>`))}</tbody>
      </table></div>
      ${editable ? raw('<p class="small muted">Saves as you go. Applies to catches approved from now on.</p>') : ''}`;
    view.addEventListener('change', async (e) => {
      const input = e.target.closest('.ppk');
      if (!input) return;
      try {
        await api(`/species/${input.dataset.id}`, { method: 'PATCH', body: { pointsPerKg: Number(input.value) } });
        toast('Saved');
      } catch (ex) {
        toast(ex.message);
      }
    });
  },
}));
