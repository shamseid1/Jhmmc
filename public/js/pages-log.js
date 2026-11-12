// Africa Sportfishing, part of the app (public/js/pages-log.js): Log fish at sea, the boat's log and season numbers, the catch maps.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // Log fish: each fish as it's landed, the phone's spot taken there and
  // then. Works without signal: fish wait on the phone and go when it's back.
  async fishon() {
    if (!state.me) return needLogin(view, 'log fish');
    if (!state.me.teamId) {
      view.innerHTML = html`<h1>Log fish</h1>${raw(noBoatBanner())}`;
      return;
    }
    // Opened without a day it's live, at sea. A trip ends on its own: the next
    // day starts a new one. Except a night trip: before 5 am, if the boat landed
    // a fish in the last 8 hours (yesterday evening), it's still yesterday's trip.
    const asked = new URLSearchParams(location.hash.split('?')[1] || '').get('date');
    let day = asked || today();
    const live = !asked || asked === today();
    if (!asked && hourIn(myZone()) < 5) {
      const yesterday = dateIn(myZone(), Date.now() - 864e5);
      try {
        const { trip: last } = await api(`/outings/trip?date=${yesterday}`);
        if (last?.landings?.some((l) => l.landedAt && Date.now() - Date.parse(l.landedAt) < 8 * 36e5)) day = yesterday;
      } catch { /* no signal: today's trip */ }
    }
    // Without signal these fail; the fish waiting on the phone still show.
    const [got, list0] = await Promise.all([
      api(`/outings/trip?date=${day}`, { once: true }).catch(() => null),
      state.techniques ? null : api('/outings?country=__none__', { once: true }).catch(() => null),
    ]);
    let trip = got?.trip ?? null;
    if (list0) state.techniques = list0.techniques;
    const techniques = state.techniques || [];
    // Big buttons for the boat's usual fish, always the same four in the same place.
    const QUICK = {
      ocean: ['Blue marlin', 'Yellowfin tuna', 'Sailfish', 'Dorado'],
      river: ['Barracuda', 'Grouper', 'Crevalle', 'Snapper'],
    };
    const byName = new Map(state.meta.species.map((x) => [x.name, x]));
    const byId = new Map(state.meta.species.map((x) => [String(x.id), x]));
    const quick = QUICK[state.me.division === 'river' ? 'river' : 'ocean'].map((n) => byName.get(n)).filter(Boolean);
    view.innerHTML = html`<p class="back"><a href="#/log">‹ Log</a></p>
      <h1>Log fish</h1>
      <div class="fo-day"><span>${state.me.teamName || 'Your boat'}</span><span class="chip-date">${day === today() ? 'Today' : live ? 'Last night' : fmtDate(day)}</span></div>
      <p class="small muted">${live ? 'Tap the fish, then Kept, Released or Lost.' : 'An earlier trip. Fish are logged at sea, as they\'re landed, so its spots are right.'}</p>
      <div class="card pad stack fishon" ${live ? '' : raw('hidden')}>
        <div class="quick-species" role="radiogroup" aria-label="Species" ${quick.length ? '' : 'hidden'}>${quick.map((x) => raw(html`<label class="qs"><input type="radio" name="fo-sp" value="${x.id}"><span>${x.name}</span></label>`))}</div>
        <select id="fo-species" aria-label="Other species">${raw(speciesOptions(null, 'Other species…'))}</select>
        <div class="fates">
          <button type="button" class="fate kept" data-fate="kept">Kept</button>
          <button type="button" class="fate released" data-fate="released">Released</button>
          <button type="button" class="fate lost" data-fate="lost">Lost</button>
        </div>
        ${live ? raw('<span class="small muted" id="fo-gps">Finding GPS…</span>') : ''}
        <button type="button" class="link small" id="fo-nocatch" hidden>No fish ${live ? 'today' : 'that day'}? Log it as no catch</button>
        <p class="error"></p>
      </div>
      <h2>The fish</h2>
      <div class="card"><ul class="list" id="fo-list"></ul></div>
      <p><a class="btn" href="#/spots">${raw(icon('pin'))} See them on my catch map</a></p>
      <div id="fo-finish"></div>`;
    const list = view.querySelector('#fo-list');
    const finish = view.querySelector('#fo-finish');
    const QUEUE = 'fishon-queue';
    // Fish logged on this phone and not sent yet. Each belongs to whoever logged it (its id starts
    // with theirs): with two accounts on one phone, one person's fish never go out under the other's.
    const mine = (x) => String(x.clientId).startsWith(`${state.me.id}-`);
    const allQueued = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return []; } };
    const queued = () => allQueued().filter(mine);
    const saveQueue = (q) => { try { localStorage.setItem(QUEUE, JSON.stringify([...allQueued().filter((x) => !mine(x)), ...q])); } catch {} };
    const time = (iso) => parseTime(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // Fish logged at sea have a time and a spot; fish added afterwards have neither.
    const where = (x) => (x.lat != null && x.lat !== '' ? `${time(x.landedAt)} · ${fmtCoords(x.lat, x.lng)}` : x.fromScale ? 'from the weigh station' : 'added afterwards');
    function draw() {
      const waiting = queued().filter((x) => x.date === day);
      const landed = trip?.landings || [];
      // Registered at the weigh station: its scale weight.
      // A released fish's estimate (it never sees a scale).
      // Several of a species weighed: nobody knows which weight was which, so
      // the weights go under the list, for the species.
      const scale = (l) => (l.scaleKg != null ? ` · ⚖️ ${fmtWeight(l.scaleKg)}` : l.scaleShared ? ' · ⚖️ weighed' : l.fate === 'released' && l.weightKg ? ` · ~${fmtWeight(l.weightKg)} (est.)` : '');
      list.innerHTML = [...landed.map((l, n) => html`<li class="fo-row"><div class="fo-main"><b>${n + 1}. ${l.species}</b>${scale(l)} <span class="pill ${l.fate}">${l.fate}</span>
          <div class="small muted">${where(l)}${l.loggedBy ? ` · ${l.loggedBy}` : ''}
            ${l.fate === 'released' && l.scaleKg == null && !l.scaleShared ? raw(html`· <button type="button" class="link small" data-estimate="${l.id}" data-kg="${l.weightKg ?? ''}">${l.weightKg ? 'Change estimate' : 'Estimate weight'}</button>`) : ''}
            ${l.fromScale ? '' : raw(html`· <button type="button" class="link small" data-edit="${l.id}">Edit</button> · <button type="button" class="link danger small" data-undo="${l.id}">Undo</button>`)}
            ${l.photoUrl && l.fate !== 'lost' ? raw(html`<div><label class="small"><input type="checkbox" data-on-profile="${l.id}" ${l.onProfile ? 'checked' : ''}> Show on our boat's page</label></div>`) : ''}</div></div>
          <label class="fo-photo" aria-label="${l.photoUrl ? 'Change the photo' : 'Add a photo'} of the ${l.species}">
            ${l.photoUrl ? raw(html`<img src="${l.photoUrl}" alt="">`) : raw(html`${raw(icon('camera'))}<span>Add photo</span>`)}
            <input type="file" accept="image/*" hidden data-photo-for="${l.id}"></label></li>`),
        ...waiting.map((x, n) => html`<li><b>${landed.length + n + 1}. ${x.species}</b> <span class="pill ${x.fate}">${x.fate}</span>
          <div class="small muted">${where(x)} · <b>waiting for signal</b>
            · <button type="button" class="link danger small" data-drop="${x.clientId}">Remove</button></div></li>`)].join('')
        || `<li class="muted">${trip?.noCatch ? 'Logged as no catch.' : live ? 'No fish yet today.' : 'No fish logged that day.'}</li>`;
      list.insertAdjacentHTML('beforeend', (trip?.fish || []).filter((f) => f.weighedKg.length > 1).map((f) => html`<li class="fo-weighed">${raw(weighedLine(f))}</li>`).join(''));
      view.querySelector('#fo-nocatch').hidden = !!trip || waiting.length > 0;
      if (!trip) {
        finish.innerHTML = '';
        return;
      }
      finish.innerHTML = html`<h2>Trip details <span class="muted small">(optional)</span></h2>
        <form class="card pad stack" id="fo-trip">
          <span class="spot-head">Technique</span>
          <div class="chips">${techniques.map((t) => raw(html`<label class="chip2"><input type="checkbox" name="technique" value="${t}" ${trip.technique.includes(t) ? 'checked' : ''}> ${t}</label>`))}</div>
          <div class="three">
            <label>Rough area <input name="area" maxlength="80" placeholder="e.g. Off Marshall" value="${trip.area || ''}"></label>
            <label>Depth (${unit('depth')}) <input name="depthM" type="number" min="0" step="1" inputmode="numeric" placeholder="optional" value="${trip.depthM == null ? '' : Math.round(toUnit('depth', trip.depthM))}"></label>
            <label>Water (${unit('temp')}) <input name="waterC" type="number" min="${toUnit('temp', 10)}" max="${toUnit('temp', 40)}" step="0.5" inputmode="decimal" placeholder="optional" value="${toUnit('temp', trip.waterC)}"></label>
          </div>
          <p class="small muted">In the log: ${trip.line}</p>
          <p class="error"></p>
          <div><button type="submit" class="primary">Save the trip</button></div>
        </form>`;
      const form = finish.querySelector('#fo-trip');
      bindForm(form, async () => {
        const fd = formData(form);
        trip = (await api(`/outings/${trip.id}`, { method: 'PATCH', body: {
          area: fd.area, depthM: fromUnit('depth', fd.depthM), waterC: fromUnit('temp', fd.waterC),
          technique: [...form.querySelectorAll('[name=technique]:checked')].map((x) => x.value),
        } })).trip;
        toast('Trip saved to the log.');
        draw();
      });
    }
    // Send whatever is waiting, oldest first; stop at the first one that can't go.
    let sending = false;
    async function flush() {
      if (sending) return;
      sending = true;
      try {
        for (const x of queued()) {
          try {
            const r = await api('/outings/fish', { method: 'POST', body: x });
            saveQueue(queued().filter((y) => y.clientId !== x.clientId));
            if (x.date === day) trip = r.trip;
          } catch (err) {
            if (err.status >= 400 && err.status < 500) {
              // Refused (not a signal problem): drop it and say why.
              saveQueue(queued().filter((y) => y.clientId !== x.clientId));
              toast(`${x.species} wasn't logged: ${err.message}`);
              continue;
            }
            break;
          }
        }
      } finally {
        sending = false;
        if (view.contains(list)) draw();
      }
    }
    // Shown on the angler's and boat's profiles, or not.
    list.addEventListener('change', async (e) => {
      const box = e.target.closest('[data-on-profile]');
      if (!box) return;
      try {
        trip = (await api(`/outings/fish/${box.dataset.onProfile}`, { method: 'PATCH', body: { onProfile: box.checked } })).trip;
        toast(box.checked ? "Shown on your boat's page." : "Hidden from your boat's page.");
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      }
    });
    // A photo of a logged fish: take one or pick one, any time.
    list.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-photo-for]');
      const file = input?.files?.[0];
      if (!file) return;
      toast('Adding the photo…');
      try {
        const fd = new FormData();
        fd.set('photo', await shrinkPhoto(file));
        trip = (await api(`/outings/fish/${input.dataset.photoFor}/photo`, { method: 'POST', form: fd })).trip;
        toast('Photo added. It shows on the feed.');
        draw();
      } catch (err) {
        toast(err.message);
      }
    });
    list.addEventListener('click', async (e) => {
      // A wrong tap: change the species or the result; the time and spot stay.
      const edit = e.target.closest('[data-edit]');
      if (edit) {
        const l = trip.landings.find((x) => String(x.id) === edit.dataset.edit);
        const row = edit.closest('li');
        row.querySelector('.fo-edit')?.remove();
        row.insertAdjacentHTML('beforeend', html`<div class="fo-edit stack">
          <select aria-label="Species">${raw(speciesOptions(l.speciesId))}</select>
          <div class="fates">${['kept', 'released', 'lost'].map((f) => raw(html`<button type="button" class="fate ${f}${f === l.fate ? ' on' : ''}" data-set-fate="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`))}</div>
          <div class="row-buttons"><button type="button" class="primary" data-save="${l.id}">Save</button><button type="button" data-cancel>Cancel</button></div></div>`);
        return;
      }
      const setFate = e.target.closest('[data-set-fate]');
      if (setFate) {
        for (const b2 of setFate.parentElement.children) b2.classList.toggle('on', b2 === setFate);
        return;
      }
      if (e.target.closest('[data-cancel]')) {
        e.target.closest('.fo-edit').remove();
        return;
      }
      const save = e.target.closest('[data-save]');
      if (save) {
        const box = save.closest('.fo-edit');
        try {
          trip = (await api(`/outings/fish/${save.dataset.save}`, { method: 'PATCH', body: {
            speciesId: box.querySelector('select').value, fate: box.querySelector('[data-set-fate].on').dataset.setFate,
          } })).trip;
          toast('Fish changed.');
          draw();
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      const est = e.target.closest('[data-estimate]');
      if (est) {
        const typed = prompt(`Estimated weight of the released fish (${unit('weight')})`, toUnit('weight', est.dataset.kg || null));
        if (typed === null) return;
        try {
          trip = (await api(`/outings/fish/${est.dataset.estimate}`, { method: 'PATCH', body: { weightKg: fromUnit('weight', typed) } })).trip;
          draw();
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      const undo = e.target.closest('[data-undo]');
      const drop = e.target.closest('[data-drop]');
      if (drop) {
        saveQueue(queued().filter((y) => y.clientId !== drop.dataset.drop));
        draw();
      }
      if (undo && confirm('Take this fish off the trip?')) {
        try {
          trip = (await api(`/outings/fish/${undo.dataset.undo}`, { method: 'DELETE' })).trip;
          draw();
        } catch (err) {
          toast(err.message);
        }
      }
    });
    // A blank day goes in the log too: it says as much about the season.
    view.querySelector('#fo-nocatch').addEventListener('click', async () => {
      try {
        await api('/outings', { method: 'POST', body: { date: day, noCatch: true } });
        trip = (await api(`/outings/trip?date=${day}`)).trip;
        toast('No catch logged.');
      } catch (err) {
        toast(err.message);
      }
      draw();
    });
    draw();
    flush();
    // Keep a GPS fix warm so the spot is right where the fish came aboard.
    const gps = view.querySelector('#fo-gps');
    let fix = null;
    let watch = null;
    if (!live) {
      // An earlier day: no GPS.
    } else if (navigator.geolocation) {
      watch = navigator.geolocation.watchPosition((pos) => {
        fix = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), at: Date.now() };
        gps.textContent = `GPS: ${fmtCoords(fix.lat, fix.lng)} (±${Math.round(pos.coords.accuracy)} m)`;
        gps.classList.remove('gps-wait');
        view.querySelector('.fates')?.classList.remove('waiting');
      }, (err) => {
        // The phone only sends a new spot when the boat moves: a still boat keeps
        // its last one. A spot is dropped only once the GPS has been lost a while.
        if (err.code === 1 || (fix && Date.now() - fix.at > 120000)) {
          fix = null;
          gps.classList.add('gps-wait');
          view.querySelector('.fates')?.classList.add('waiting');
        }
        if (fix) return;
        gps.textContent = err.code === 1 ? 'Location is off for this app. Fish are logged with their spot.'
          : 'Finding GPS… Fish can be logged as soon as the spot is taken.';
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
    } else {
      gps.textContent = "This phone can't share its location, so fish can't be logged at sea from it.";
    }
    // At sea a fish is only logged with its spot: the buttons wait for the GPS.
    if (live) {
      gps.classList.add('gps-wait');
      view.querySelector('.fates')?.classList.add('waiting');
    }
    const stop = () => {
      if (watch != null) navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
      window.removeEventListener('hashchange', stop);
      window.removeEventListener('online', flush);
    };
    const timer = setInterval(flush, 30000);
    window.addEventListener('hashchange', stop);
    window.addEventListener('online', flush);
    const card = view.querySelector('.fishon');
    // A big button or the list: whichever was touched last.
    card.addEventListener('change', (e) => {
      if (e.target.id === 'fo-species' && e.target.value) for (const r of card.querySelectorAll('[name=fo-sp]')) r.checked = false;
      if (e.target.name === 'fo-sp') card.querySelector('#fo-species').value = '';
    });
    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-fate]');
      if (!btn) return;
      const other = view.querySelector('#fo-species');
      const err = card.querySelector('.error');
      err.textContent = '';
      const sp = byId.get(other.value || card.querySelector('[name=fo-sp]:checked')?.value || '');
      if (!sp) {
        err.textContent = 'Choose the species first.';
        return;
      }
      // The phone's current spot (kept up to date while the page is open).
      // Fish added for an earlier day get no spot (the boat isn't there now).
      // No GPS yet: say so at once, and give it a few seconds.
      let spot = null;
      if (live) {
        spot = fix;
        if (!spot) {
          const was = btn.textContent;
          btn.textContent = 'Getting spot…';
          btn.disabled = true; // a second tap while waiting would log it twice
          err.textContent = 'Waiting for the GPS…';
          spot = await phoneSpot(5000);
          if (spot) fix = { ...spot, at: Date.now() };
          btn.textContent = was;
          btn.disabled = false;
          err.textContent = '';
        }
        if (!spot) {
          err.textContent = 'No GPS spot yet, so the fish isn\'t logged. GPS works without signal, but needs open sky (it won\'t find you indoors) and can take a minute or two after airplane mode is turned on. Tap again once the GPS line above shows your spot.';
          return;
        }
      }
      const now = live ? new Date() : new Date(`${day}T12:00:00Z`);
      saveQueue([...queued(), {
        clientId: `${state.me.id}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        speciesId: sp.id, species: sp.name, fate: btn.dataset.fate,
        lat: spot?.lat ?? '', lng: spot?.lng ?? '', landedAt: now.toISOString(), date: day,
      }]);
      celebrate(`${sp.name} ${btn.dataset.fate === 'kept' ? 'boated' : btn.dataset.fate}`, spot ? 'Spot taken. Tight lines!' : 'Tight lines!');
      // Nothing stays picked: each fish is chosen on purpose.
      for (const r of card.querySelectorAll('[name=fo-sp]')) r.checked = false;
      other.value = '';
      draw();
      flush();
    });
  },

  // The old "Log a whole trip" form: Log fish does it all now (pick the day, or no catch).
  async outing() {
    location.replace('#/fishon');
  },

  // The regional log: everyone's outings, and the season at a glance.
  async log() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const tab = ['season', 'trends'].includes(q.get('tab')) ? q.get('tab') : 'outings';
    const country = q.get('country') || '';
    const link = (changes) => {
      const p = new URLSearchParams(q);
      for (const [k, v] of Object.entries(changes)) (v ? p.set(k, v) : p.delete(k));
      return `#/log${p.size ? `?${p}` : ''}`;
    };
    // Crews have their own boat's log (My boat) beside everyone's (Regional).
    const myBoat = state.me?.teamId || null;
    const scope = myBoat && q.get('scope') !== 'regional' ? 'mine' : 'regional';
    const teamQ = scope === 'mine' ? `team=${myBoat}` : '';
    const head = html`<h1>${scope === 'mine' ? `${state.me.teamName}'s log` : 'Regional log'}</h1>
      ${myBoat ? raw(html`<div class="line-tabs" role="tablist">
        <a role="tab" href="${link({ scope: '', country: '' })}" aria-selected="${scope === 'mine'}">My boat</a>
        <a role="tab" href="${link({ scope: 'regional' })}" aria-selected="${scope === 'regional'}">Regional</a></div>`) : ''}
      <div class="seg" role="tablist">
        <a role="tab" href="${link({ tab: '' })}" aria-selected="${tab === 'outings'}">Outings</a>
        <a role="tab" href="${link({ tab: 'season' })}" aria-selected="${tab === 'season'}">Season</a>
        <a role="tab" href="${link({ tab: 'trends' })}" aria-selected="${tab === 'trends'}">Trends</a>
      </div>`;
    // Outings filters: month and species (and, on Regional, boat).
    const fMonth = q.get('month') || '';
    const fSp = q.get('sp') || '';
    const fBoat = scope === 'regional' ? q.get('boat') || '' : '';
    const listQ = new URLSearchParams({ ...(country && scope === 'regional' && { country }), ...(scope === 'mine' ? { team: myBoat } : fBoat ? { team: fBoat } : {}),
      ...(tab === 'outings' && fMonth && { month: fMonth }), ...(tab === 'outings' && fSp && { species: fSp }) });
    const { outings, countries, nextBefore, months: logMonths = [], species: logSpecies = [], boats: logBoats = [] } = await api(`/outings${listQ.size ? `?${listQ}` : ''}`);
    const chips = scope === 'mine' ? '' : html`<div class="chips log-chips">
      <a class="chip2 ${country ? '' : 'on'}" href="${link({ country: '' })}">All countries</a>
      ${countries.map((c) => raw(html`<a class="chip2 ${c === country ? 'on' : ''}" href="${link({ country: c })}">${c}</a>`))}</div>`;
    if (tab === 'trends') {
      const tq = new URLSearchParams({ ...(q.get('species') && { species: q.get('species') }), ...(country && scope === 'regional' && { country }), ...(scope === 'mine' && { team: myBoat }) });
      const tr = await api(`/outings/trends?${tq}`);
      view.innerHTML = html`${raw(head)}${raw(chips)}${raw(trendsHtml(tr, { perBoat: q.get('per') === 'boat', link, mine: scope === 'mine' }))}`;
      view.querySelector('#trend-species')?.addEventListener('change', (e) => { location.hash = link({ species: e.target.value }); });
      return;
    }
    if (tab === 'season') {
      const year = q.get('year') || '';
      const species = q.get('species') || '';
      const sq = new URLSearchParams({ ...(year && { year }), ...(country && scope === 'regional' && { country }), ...(species && { species }), ...(scope === 'mine' && { team: myBoat }) });
      const sz = await api(`/outings/season?${sq}`);
      const R = sz.report;
      const max = Math.max(...sz.months.map((m) => m.count || 0), 1);
      const span = ([lo, hi]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      // The key numbers. Counts of what was caught, never rates per trip:
      // lost fish and blank days often go unlogged, and would flatter a rate.
      const caughtAll = R.boated + R.released;
      const billfish = R.species.filter((x) => state.meta.species.find((m) => m.name === x.species)?.category === 'Billfish');
      const billfishN = billfish.reduce((n, x) => n + x.kept + x.released, 0);
      const billfishReleased = billfish.reduce((n, x) => n + x.released, 0);
      const bestMonth = sz.months.reduce((b2, m) => (m.count > (b2?.count || 0) ? m : b2), null);
      const peak = R.hours.reduce((b2, n, h) => (n > (b2?.n || 0) ? { h, n } : b2), null);
      const heaviest = R.species.filter((x) => x.heaviestKg).sort((x, y) => y.heaviestKg - x.heaviestKg)[0];
      const kpi = (value, label) => html`<div class="card s"><b>${value}</b><span>${label}</span></div>`;
      const bars = (rows) => {
        const top = Math.max(...rows.map((r) => r.fish), 1);
        return rows.map((r) => raw(html`<div class="hbar"><span>${r.name}</span><i style="width:${Math.max(4, (r.fish / top) * 100)}%"></i><b>${r.fish}</b></div>`));
      };
      const hourMax = Math.max(...R.hours, 1);
      view.innerHTML = html`${raw(head)}${raw(chips)}
        ${sz.years.length > 1 ? raw(html`<div class="chips">${sz.years.map((y) => raw(html`<a class="chip2 ${y === sz.year ? 'on' : ''}" href="${link({ year: y })}">${y}</a>`))}</div>`) : ''}
        <div class="kpis">
          ${raw(kpi(caughtAll, 'fish caught'))}${raw(kpi(billfishN, 'billfish'))}
          ${raw(kpi(billfishN ? `${Math.round((billfishReleased / billfishN) * 100)}%` : '—', 'billfish released'))}
          ${raw(kpi(R.species.filter((x) => x.kept + x.released).length, 'species'))}
          ${raw(kpi(bestMonth ? MONTHS[bestMonth.month - 1] : '—', sz.species ? `best month · ${sz.species.toLowerCase()}` : 'best month'))}
          ${raw(kpi(heaviest ? fmtWeight(heaviest.heaviestKg) : '—', heaviest ? `heaviest · ${heaviest.species.toLowerCase()}` : 'heaviest'))}
        </div>
        ${R.species.length ? raw(html`<h2>Species</h2><div class="card table-wrap"><table>
          <thead><tr><th>Species</th><th class="num">Boated</th><th class="num">Released</th><th class="num">Heaviest</th></tr></thead>
          <tbody>${R.species.map((x) => raw(html`<tr><td>${x.species}</td><td class="num">${x.kept || ''}</td><td class="num">${x.released || ''}</td>
            <td class="num">${x.heaviestKg ? fmtWeight(x.heaviestKg) : ''}</td></tr>`))}</tbody></table></div>
          ${R.lost ? raw(html`<p class="small muted">Also ${plural(R.lost, 'fish')} logged as lost.</p>`) : ''}`) : ''}
        ${sz.species ? raw(html`<h2>When: by month</h2><div class="card pad">
          <label class="season-species">${sz.species} caught, by month
            <select id="season-species">${raw(options(sz.speciesList.map((x) => [x, x]), sz.species))}</select></label>
          <div class="month-bars">${sz.months.map((m) => raw(html`<div class="mb" title="${m.count} ${sz.species}">
            <i style="height:${m.count ? Math.max(3, (m.count / max) * 100) : 0}%"></i></div>`))}</div>
          <div class="month-names">${'JFMAMJJASOND'.split('').map((l) => raw(`<span>${l}</span>`))}</div>
        </div>`) : ''}
        ${peak ? raw(html`<h2>When: time of day</h2><div class="card pad">
          <div class="hour-bars">${R.hours.slice(5, 20).map((n, i) => raw(html`<div class="mb" title="${n} fish at ${i + 5}:00"><i style="height:${n ? Math.max(3, (n / hourMax) * 100) : 0}%"></i></div>`))}</div>
          <div class="hour-names">${[5, 8, 11, 14, 17].map((h) => raw(`<span>${h}h</span>`))}</div>
          <p class="small muted">Busiest: ${peak.h}:00–${peak.h + 1}:00.</p>
        </div>`) : ''}
        ${R.areas.length ? raw(html`<h2>Where: rough areas</h2><div class="card pad">${bars(R.areas)}</div>`) : ''}
        ${R.techniques.length ? raw(html`<h2>How: techniques</h2><div class="card pad">${bars(R.techniques)}</div>`) : ''}
        <div class="card pad best-card">
          <b>Best conditions so far</b>
          ${sz.best ? raw(html`<span>${[sz.best.water && `Water ${span(sz.best.water.map((c) => toUnit('temp', c)))}${unit('temp')}`, sz.best.depth && `${span(sz.best.depth.map((m) => Math.round(toUnit('depth', m))))} ${unit('depth')}`,
            sz.best.techniques.join(' and ')].filter(Boolean).join(' · ')}</span>
            <span class="small muted">From the ${plural(sz.best.days, 'day')} with billfish caught, ${scope === 'mine' ? 'your boat' : 'all boats'}.</span>`)
            : raw('<span class="muted">Once billfish are logged, the water, depth and techniques of those days show here.</span>')}
        </div>
        ${scope === 'mine' ? raw(html`<p><a class="btn" href="#/spots?year=${sz.year}">${raw(icon('pin'))} See them on my catch map</a></p>`) : ''}
        <p class="log-buttons"><a class="btn" href="/api/outings.csv${teamQ ? `?${teamQ}` : ''}">${raw(icon('download'))} One line per trip</a>
          <a class="btn" href="/api/outings/fish.csv${teamQ ? `?${teamQ}` : ''}">${raw(icon('download'))} One row per fish</a></p>`;
      view.querySelector('#season-species')?.addEventListener('change', (e) => { location.hash = link({ species: e.target.value }); });
      return;
    }
    const tag = (n, kind) => (n ? html` <span class="pill ${kind}">${n} ${kind}</span>` : '');
    const item = (o) => html`<li data-id="${o.id}">
      <div class="log-top"><span>${fmtDate(o.date)} · ${o.boat}</span></div>
      <div class="small muted">${[o.country, [o.area, fmtDepth(o.depthM)].filter(Boolean).join(', '), fmtTemp(o.waterC), o.technique.join(', ')].filter(Boolean).join(' · ')}</div>
      <div class="log-res">${o.noCatch ? raw('<span class="muted">No catch</span>') : o.landings?.length ? o.landings.map((l) => raw(html`<div>${l.species}${l.scaleKg != null ? ` ⚖️ ${fmtWeight(l.scaleKg)}` : l.fate === 'released' && l.weightKg ? ` ~${fmtWeight(l.weightKg)}` : ''} <span class="pill ${l.fate}">${l.fate}</span></div>`)).concat(o.fish.filter((f) => f.weighedKg.length > 1).map((f) => raw(html`<div class="small">${raw(weighedLine(f))}</div>`))) : o.fish.map((f) => raw(html`<div>${f.species} ${f.released + f.kept + f.lost}${raw(tag(f.kept, 'kept'))}${raw(tag(f.released, 'released'))}${raw(tag(f.lost, 'lost'))}</div>`))}</div>
      <div class="log-actions small"><span class="muted">by ${o.loggedBy || 'a former member'}</span>
        <button type="button" class="link" data-act="copy">Copy as one line</button>
        ${state.me?.teamId && o.teamId === state.me.teamId ? raw(html`<a href="#/fishon?date=${o.date}">Open</a>`) : ''}
        ${o.canDelete ? raw('<button type="button" class="link danger" data-act="remove">Remove</button>') : ''}</div>
    </li>`;
    view.innerHTML = html`${raw(head)}
      ${state.me?.teamId ? raw(html`<p class="log-buttons"><a class="btn primary" href="#/fishon">${raw(icon('fish'))} Log fish</a></p>`) : ''}
      ${raw(chips)}
      <div class="filter-chips">
        <select class="chip-select" data-go aria-label="Month">${raw(options([[link({ month: '' }), 'All months'],
          ...logMonths.map((m) => [link({ month: m }), new Date(`${m}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })])], link({ month: fMonth })))}</select>
        <select class="chip-select" data-go aria-label="Species">${raw(options([[link({ sp: '' }), 'All species'], ...logSpecies.map((x) => [link({ sp: String(x.id) }), x.name])], link({ sp: fSp })))}</select>
        ${scope === 'regional' && logBoats.length > 1 ? raw(html`<select class="chip-select" data-go aria-label="Boat">${raw(options([[link({ boat: '' }), 'All boats'], ...logBoats.map((x) => [link({ boat: String(x.id) }), x.name])], link({ boat: fBoat })))}</select>`) : ''}
      </div>
      ${outings.length ? raw(html`<div class="card log"><ul class="list">${outings.map((o) => raw(item(o)))}</ul></div>
        ${nextBefore ? raw('<p class="center"><button type="button" id="log-more">Load more</button></p>') : ''}`)
        : raw(emptyState('fish', scope === 'mine' ? 'No trips logged for your boat yet.' : 'No outings logged yet.', scope === 'mine' && state.me?.teamId ? ['#/fishon', 'Log your first fish'] : null))}`;
    const byId = new Map(outings.map((o) => [String(o.id), o]));
    // Older trips, 30 at a time, with the same filters.
    let before = nextBefore;
    view.querySelector('#log-more')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const more = new URLSearchParams(listQ);
      more.set('before', before);
      try {
        const page = await api(`/outings?${more}`);
        for (const o of page.outings) byId.set(String(o.id), o);
        view.querySelector('.log .list').insertAdjacentHTML('beforeend', page.outings.map((o) => item(o)).join(''));
        before = page.nextBefore;
        if (!before) btn.remove();
      } catch (ex) {
        toast(ex.message);
      } finally {
        btn.disabled = false;
      }
    });
    view.querySelector('.log')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const o = byId.get(btn.closest('[data-id]').dataset.id);
      if (btn.dataset.act === 'copy') {
        try {
          await navigator.clipboard.writeText(o.line);
          toast('Copied. Paste it in WhatsApp or a spreadsheet.');
        } catch {
          prompt('Copy this line:', o.line);
        }
      }
      if (btn.dataset.act === 'remove' && confirm('Remove this outing from the log?')) {
        try {
          await api(`/outings/${o.id}`, { method: 'DELETE' });
          btn.closest('li').remove();
        } catch (ex) {
          toast(ex.message);
        }
      }
    });
  },

  // My catch map: every fish you logged with a spot, on a map, by year.
  async spots() {
    if (!state.me) return needLogin(view, 'see your catch map');
    const sq = new URLSearchParams(location.hash.split('?')[1] || '');
    // Two maps: My boat (the crew's exact spots) and Regional (10 km circles, no spots).
    const regional = sq.get('view') === 'regional' || !state.me.teamId;
    const mapTabs = html`<div class="line-tabs" role="tablist">
      ${state.me.teamId ? raw('<a role="tab" href="#/spots" aria-selected="' + !regional + '">My boat</a>') : ''}
      <a role="tab" href="#/spots?view=regional" aria-selected="${regional}">Regional</a></div>`;
    if (regional) {
      view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p><h1>Catch map${raw(info('<p>Where fish are being caught across the region, month by month. No exact spots and no boat names. Members only.</p>'))}</h1>${raw(mapTabs)}
        <div id="grid-map-box"></div>`;
      const link = (changes) => {
        const p = new URLSearchParams(sq);
        p.set('view', 'regional');
        for (const [k, v] of Object.entries(changes)) (v ? p.set(k, v) : p.delete(k));
        return `#/spots?${p}`;
      };
      await renderGridMap(view.querySelector('#grid-map-box'), sq, link);
      return;
    }
    const year = sq.get('year') || '';
    const species = sq.get('species') || '';
    const month = sq.get('month') || '';
    const [{ years, spots: allSpots }, L, { charts }] = await Promise.all([api(`/me/spots${year ? `?year=${year}` : ''}`), loadLeaflet().catch(() => null),
      state.me.teamId || state.me.isAdmin ? api('/charts').catch(() => ({ charts: [] })) : { charts: [] }]);
    // Filter by species: only the species on the map that year are offered.
    // and by month, to see where the fish were as the season went on.
    const speciesHere = [...new Set(allSpots.map((x) => x.species))].sort();
    const monthsHere = [...new Set(allSpots.filter((x) => !species || x.species === species).map((x) => Number(x.date.slice(5, 7))))].sort((a, b2) => a - b2);
    const spots = allSpots.filter((x) => (!species || x.species === species) && (!month || Number(x.date.slice(5, 7)) === Number(month)));
    const spotsLink = (y, sp, m = month) => { const p = new URLSearchParams({ ...(y && { year: y }), ...(sp && { species: sp }), ...(m && { month: m }) }); return `#/spots${p.size ? `?${p}` : ''}`; };
    const chip = (y, label) => html`<a role="tab" href="${spotsLink(y, species, '')}" aria-selected="${y === year}">${label}</a>`;
    const href = (x) => (x.kind === 'catch' ? `#/catch/${x.id}` : x.kind === 'log' ? `#/fishon?date=${x.date}` : null);
    // Weights logged at sea are estimates.
    const kg = (x) => (x.weightKg ? ` · ${x.estimate ? '~' : ''}${fmtWeight(x.weightKg)}` : '');
    const when = (x) => fmtDate(x.date);
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Catch map${raw(info(html`<p>Every fish logged with a spot: what you and your crew logged with Log fish${state.me.isCaptain ? ', your boat\'s posts' : ''}, and your own posts. Only you see this.</p>${charts.length ? raw('<p>Depth contours: zoom in to see them; switch them on and off with the layers button on the map. Depths in feet.</p>') : ''}`))}</h1>${raw(mapTabs)}
      ${years.length > 1 ? raw(html`<div class="year-tabs" role="tablist">${raw(chip('', 'All'))}${years.map((y) => raw(chip(y, y)))}</div>`) : ''}
      ${speciesHere.length > 1 || species || monthsHere.length > 1 || month ? raw(html`<div class="filter-chips">
        ${speciesHere.length > 1 || species ? raw(html`<select class="chip-select" data-go aria-label="Species">${raw(options(
          [[spotsLink(year, '', ''), 'All species'], ...speciesHere.map((sp) => [spotsLink(year, sp, ''), sp])], spotsLink(year, species, '')))}</select>`) : ''}
        ${monthsHere.length > 1 || month ? raw(html`<select class="chip-select" data-go aria-label="Month">${raw(options(
          [[spotsLink(year, species, ''), 'All months'], ...monthsHere.map((m) => [spotsLink(year, species, String(m)), MONTH_SHORT[m - 1]])], spotsLink(year, species, month)))}</select>`) : ''}
      </div>`) : ''}
      ${spots.length || charts.length ? raw(html`<div class="card catch-map" id="catch-map"></div>`) : ''}
      ${spots.length ? raw(html`<p class="small muted">${plural(spots.length, species ? species.toLowerCase() : 'catch')}${month ? ` in ${MONTH_SHORT[month - 1]}` : ''}${year ? ` ${month ? '' : 'in '}${year}` : ''}. Tap a pin for the fish.</p>
        <div class="card"><ul class="list spot-list">${spots.map((x, n) => raw(html`<li data-n="${n}">
          <b>${x.species}</b>${kg(x)}${x.released ? raw(' <span class="badge release">Released</span>') : ''}
          <div class="small muted">${when(x)}${x.angler ? ` · ${x.angler}` : ''}${x.location ? ` · ${x.location}` : ''} · ${fmtCoords(x.lat, x.lng)}
            ${href(x) ? raw(html` · <a href="${href(x)}">Open</a>`) : ''}</div></li>`))}</ul></div>`)
        : raw(emptyState('pin', `No spots yet${year ? ` in ${year}` : ''}. Fish you log at sea appear here.`, state.me?.teamId ? ['#/fishon', 'Log fish'] : null))}`;
    if (!spots.length && !charts.length) return;
    if (!L) {
      view.querySelector('#catch-map').outerHTML = '<div class="card pad empty">The map couldn\'t load just now. Your catches are listed below.</div>';
      return;
    }
    const map = L.map('catch-map', { zoomControl: true });
    addSatellite(L, map);
    // Depth charts sit over the satellite, under the pins; on unless switched off.
    if (charts.length) {
      // All the chart areas are one layer, "Depth contours".
      const contours = depthLayer(L, charts).addTo(map);
      L.control.layers(null, { 'Depth contours': contours }, { collapsed: true, position: 'topright' }).addTo(map);
    }
    if (!spots.length) {
      const c = charts[0].bounds;
      map.fitBounds([[c.south, c.west], [c.north, c.east]]);
      return;
    }
    const pins = spots.map((x) => L.circleMarker([x.lat, x.lng], spotPin(L, x.released)).addTo(map).bindPopup(html`<b>${x.species}</b>${kg(x)}${x.released ? ' · released' : ''}<br>
      ${when(x)}${x.boat ? ` · ${x.boat}` : ''}<br><span class="pop-coords">${fmtCoords(x.lat, x.lng)}</span>${href(x) ? raw(html`<br><a href="${href(x)}">${x.kind === 'log' ? 'Open the trip' : 'Open the catch'}</a>`) : ''}`));
    // The charts are screenshots: sharp up to about zoom 11, blurry past it.
    const close = charts.length ? 11 : 12;
    map.fitBounds(L.latLngBounds(spots.map((x) => [x.lat, x.lng])).pad(0.3), { maxZoom: close - 1 });
    view.querySelector('.spot-list').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-n]');
      if (!li || e.target.closest('a')) return;
      const x = spots[li.dataset.n];
      map.setView([x.lat, x.lng], close);
      pins[li.dataset.n].openPopup();
      view.querySelector('#catch-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  },
}));
