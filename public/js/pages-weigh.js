// Africa Sportfishing, part of the app (public/js/pages-weigh.js): Weigh-ins, the secretary's review, the season calendar, editing a post.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // The digital JHMMC Fish Registration Form. A captain registers their own
  // boat's fish for today; the secretary any JHMMC boat, any earlier day.
  // One boat and day, as many fish as it brought in, submitted together.
  async weigh() {
    if (!state.me?.canWeigh) return needLogin(view, 'do the weigh-in (boat captains)');
    const [{ toReview }, { teams }, { events }] = await Promise.all([api('/officials/queue'), api('/teams'), api('/events')]);
    // Fish on a tournament day count for the season and for that tournament.
    const onNow = events.find((e) => e.kind === 'tournament' && e.date <= today() && today() <= e.endDate);
    // The secretary enters a weigh-in for any boat and any day (a paper form, say).
    const official = state.me.canApprove;
    // Fish count for today's tournament only if the boat is entered in it.
    const entryNote = (teamId) => (!teamId ? 'choose the boat to see if it is entered'
      : onNow.entries.includes(Number(teamId)) ? "entered: today's fish also count for this tournament"
        : 'not entered: fish count for the season only');
    const mine = official ? toReview.filter((c) => c.loggedBy === state.me.id) : toReview;
    // A weighmaster weighs boat after boat: the ones he's sent today get a tick.
    const weighedToday = new Set(mine.filter((c) => c.caughtOn === today()).map((c) => c.teamId));
    // Every boat weighed in through JHMMC (for now all of them): JHMMC boats at a
    // JHMMC weigh station, the rest at their home port.
    const jhmmcBoats = teams.filter((t) => t.throughJhmmc);
    // A weighmaster weighs any JHMMC boat at his station; a captain only his own boat.
    const wm = !official && state.me.weighmasterAt;
    const own = official || wm ? null : jhmmcBoats.find((t) => t.id === state.me.teamId);
    // The boat you're on: weighing it is its own weigh-in (no weighmaster), with a reason picked from the list.
    const myBoat = jhmmcBoats.find((t) => t.id === state.me.teamId && (state.me.isCaptain || wm) && isJhmmc(t.clubId));
    // A weighmaster weighs the boats registered at his station (and, as captain, his own).
    const wmBoats = wm ? jhmmcBoats.filter((t) => t.weighStation === wm || (state.me.isCaptain && t.id === myBoat?.id)) : [];
    const atHomePort = (t) => t && !isJhmmc(t.clubId);
    let crew = own ? (await api(`/teams/${own.id}`)).team.members : [];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Weigh-in${raw(info('<p>At the weigh station, for points. Fish logged at sea with Log fish don\'t score until they\'re weighed in here.</p><p>One boat\'s fish for the day, like the paper registration form. It goes to the secretary for points.</p><p>Every fish needs a photo or video of it hanging on the scale, the weight readable (rule 8). Your phone\'s location is taken when you send, to show where the fish were registered.</p>'))}</h1>
      ${onNow && (official || !atHomePort(own)) ? raw(html`<p class="tournament-now">${raw(icon('trophy'))} <b>${onNow.name}</b> · ${fmtDays(onNow)} · <span id="entry-note">${entryNote(own?.id)}</span></p>`) : ''}
      ${wm ? raw(html`<div class="card pad wm-boats"><p class="small"><b>Weighmaster at ${wm}.</b> Tap the boat you're weighing.</p>
        <div class="wm-boat-chips">${wmBoats.map((t) => raw(html`<button type="button" class="chip" data-boat="${t.id}">${t.name}${myBoat?.id === t.id ? ' (yours)' : ''}${weighedToday.has(t.id) ? ' ✓' : ''}</button>`))}</div>
        ${weighedToday.size ? raw(html`<p class="small muted">Weighed today: ${[...weighedToday].map((id) => jhmmcBoats.find((t) => t.id === id)?.name).filter(Boolean).join(', ')}.</p>`) : ''}
        </div>`) : ''}
      <form class="card pad stack" id="sheet">
        <div class="row">
          ${own ? raw(html`<p class="station-fixed">Boat: <b>${own.name}</b><input type="hidden" name="teamId" value="${own.id}"></p>`)
            : raw(html`<label>Boat <select name="teamId" required>${raw(boatOptions(wm ? wmBoats : jhmmcBoats, wm || null))}</select></label>`)}
          ${official
            ? raw(html`<label>Date <input name="caughtOn" type="date" required value="${today()}" max="${today()}"></label>`)
            : raw(html`<p class="station-fixed">Date: <b>${fmtDay(today())}</b> (today)<input type="hidden" name="caughtOn" value="${today()}"></p>`)}
        </div>
        ${wm ? raw(html`<p class="station-fixed">Weigh station: <b>${wm}</b> (you're its weighmaster)</p>`)
          : atHomePort(own) ? raw(html`<p class="station-fixed">Weigh station: <b>${own.homePort || (own.country ? `${own.country} weigh station` : 'your boat\'s weigh station')}</b></p>`)
          : own?.weighStation ? raw(html`<p class="station-fixed">Weigh station: <b>${own.weighStation}</b></p>`)
          : raw(html`<label id="station-pick">Weigh station <select name="weighStation" required>${raw(options(state.meta.weighStations, null, 'Choose…'))}</select></label>
            <p class="station-fixed" id="home-port" hidden></p>`)}
        <fieldset class="card pad no-weighmaster" hidden>
          <legend><b>No weighmaster?</b>${raw(info('<p>Under the club rules, every fish is weighed by the station\'s weighmaster. If there isn\'t one at the station, you may weigh your own boat\'s fish: tick below so the secretary knows.</p>'))}</legend>
          <label class="check"><input type="checkbox" name="noWeighmaster" value="absent"> There was no weighmaster at the station</label>
        </fieldset>
        <div id="fish-list" class="stack"></div>
        <div><button type="button" id="add-fish">+ Add a fish</button></div>
        <div class="sheet-totals" id="sheet-total">
          <div><span>Total weight</span><b id="total-weight">0 kg</b></div>
          <div><span>Total points</span><b id="total-points">0 pts</b></div>
        </div>
        ${official ? '' : raw(html`<label class="check declare"><input type="checkbox" name="declared" value="yes" required>
          <span>I declare these fish were caught today by the anglers named, under the club rules, and weighed on this scale.
          A false registration disqualifies the boat (<a href="#/rules?section=app-registrations">rule</a>).</span></label>`)}
        <p class="error"></p>
        <div><button type="submit" class="primary" id="submit-sheet">Submit</button></div>
      </form>
      <h2>Waiting for the secretary (${mine.length})</h2>
      <div class="card"><ul class="list">${mine.length ? mine.map((c) => raw(html`<li>
        <a href="#/catch/${c.id}"><b>${c.species}</b></a> · ${c.teamName} · ${c.angler}
        <div class="muted small">${fmtDay(c.caughtOn)} · ${c.released ? 'released' : fmtWeight(c.weightKg)}${c.weighStation ? ` · ${c.weighStation}` : ''}${c.points != null ? ` · ${fmtPoints(c.points)}` : ''}</div>
      </li>`)) : raw('<li class="muted">Nothing waiting.</li>')}</ul></div>`;

    const sheet = view.querySelector('#sheet');
    const list = view.querySelector('#fish-list');
    // Weighing your own boat (no weighmaster): the reason is asked for.
    const syncReason = () => {
      const box = view.querySelector('.no-weighmaster');
      // ...unless you're the weighmaster at its station: then it's simply your weigh-in.
      const ownBoat = !!myBoat && String(sheet.teamId.value) === String(myBoat.id) && !(wm && myBoat.weighStation === wm);
      box.hidden = !ownBoat;
      sheet.noWeighmaster.required = ownBoat;
    };
    sheet.addEventListener('change', syncReason);
    // A species button picks it in the list (which works out the points); the list lights up the button.
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('.wq');
      if (!b) return;
      const sel = b.closest('fieldset').querySelector('select[name=speciesId]');
      sel.value = b.dataset.sp;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    sheet.addEventListener('change', (e) => {
      if (e.target.name !== 'speciesId') return;
      for (const b of e.target.closest('fieldset').querySelectorAll('.wq')) b.classList.toggle('on', b.dataset.sp === e.target.value);
    });
    const anglerOptions = (selected) => options([...crew.map((m) => [m.id, m.name]), ['other', 'Guest (type a name)']], selected, crew.length ? 'Choose…' : 'Choose the boat first');
    // Big buttons for the fish weighed most, by the boat's division (Ocean or River),
    // like Log fish; the list under them has every species.
    const WEIGH_QUICK = {
      ocean: ['Blue marlin', 'Sailfish', 'Yellowfin tuna', 'Dorado', 'Wahoo', 'Bonito'],
      river: ['Barracuda', 'Grouper', 'Butter nose', 'Crevalle', 'Snapper', 'Grunter'],
    };
    const boatDivision = () => (teams.find((t) => String(t.id) === String(sheet?.teamId?.value))?.division === 'river' ? 'river' : 'ocean');
    const quickButtons = () => WEIGH_QUICK[boatDivision()].map((n) => state.meta.species.find((x) => x.name === n)).filter(Boolean)
      .map((x) => html`<button type="button" class="wq" data-sp="${x.id}">${x.name}</button>`).join('');
    const fishRow = () => html`<fieldset class="fish card pad">
      <legend><b class="fish-no"></b> <button type="button" class="link danger" data-act="remove-fish">Remove</button></legend>
      <div class="weigh-quick">${raw(quickButtons())}</div>
      <div class="row">
        <label>Species <select name="speciesId" required>${raw(speciesOptions(null, 'Choose…'))}</select></label>
        <label>Angler <select name="anglerId" required>${raw(anglerOptions())}</select></label>
      </div>
      <label class="guest-name" hidden>Angler's name <input name="anglerName" maxlength="80" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="released"> Released (no weight; a photo of the release)</label>
      <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal"></label>
      <div class="points-field">
        <span class="points-label">Points (automatic)</span>
        <p class="points-preview" aria-live="polite"></p>
      </div>
      <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, null, 'Not recorded'))}</select></label>
      <div class="scale-pick">
        <span class="scale-label" data-kept="Photo on the scale (required); a video is optional" data-released="Photo of the release (required); a video is optional">Photo on the scale (required); a video is optional</span>
        <span class="small muted scale-hint">The whole fish hanging, and the weight readable. A short video from the fish to the scale works best.</span>
        <span class="small muted">Only the secretary, your crew and JHMMC captains see it.</span>
        <img class="scale-preview" alt="Fish on the scale" hidden>
        <video class="scale-video-preview" controls playsinline preload="metadata" hidden></video>
        <div class="scale-buttons">
          <label class="btn scale-button">${raw(icon('camera'))} <span>Take photo</span><input type="file" accept="image/*" capture="environment" data-scale></label>
          <label class="btn scale-video-button">${raw(icon('video'))} <span>Record video</span><input type="file" accept="video/*" capture="environment" data-scale-video></label>
          <label class="btn roll-photo-button">${raw(icon('upload'))} <span>Photo from camera roll</span><input type="file" accept="image/*" data-release-photo></label>
          <label class="btn roll-video-button">${raw(icon('upload'))} <span>Video from camera roll</span><input type="file" accept="video/*" data-release-video></label>
        </div>
      </div>
    </fieldset>`;
    // Points for each fish, worked out with the club's rules as the weight is typed.
    const updatePoints = () => {
      const team = teams.find((t) => String(t.id) === sheet.teamId.value);
      let total = 0;
      let totalKg = 0;
      for (const row of list.querySelectorAll('.fish')) {
        const out = row.querySelector('.points-preview');
        const sp = state.meta.species.find((x) => String(x.id) === row.querySelector('[name=speciesId]').value);
        const weight = row.querySelector('[name=weightKg]').value;
        const released = row.querySelector('[name=released]').checked;
        if (!released && weight !== '' && Number(weight) > 0) totalKg += Number(weight);
        if (!sp || (!released && weight === '')) {
          out.textContent = 'Enter the species and weight.';
          out.className = 'points-preview muted';
          continue;
        }
        const r = scoring.scoreCatch({
          species: sp.name, pointsPerKg: sp.pointsPerKg, weightKg: weight === '' ? null : Number(weight),
          released, division: team?.division || 'ocean',
        });
        out.innerHTML = html`<b>${fmtPoints(r.points)}</b> · ${r.note}`;
        out.className = `points-preview ${r.points > 0 ? 'good' : r.points < 0 ? 'bad' : 'muted'}`;
        total += r.points;
      }
      view.querySelector('#total-weight').innerHTML = html`${Math.round(totalKg * 10) / 10} kg <small>${kgToLb(totalKg)} lb</small>`;
      view.querySelector('#total-points').textContent = fmtPoints(Math.round(total * 10) / 10);
    };
    list.addEventListener('input', updatePoints);
    sheet.addEventListener('change', updatePoints);

    const renumber = () => {
      const rows = list.querySelectorAll('.fish');
      rows.forEach((row, i) => {
        row.querySelector('.fish-no').textContent = `Fish ${i + 1}`;
        row.querySelector('[data-act=remove-fish]').hidden = rows.length === 1;
      });
      view.querySelector('#submit-sheet').textContent = `Submit ${plural(rows.length, 'fish')}`;
    };
    const addFish = () => {
      list.insertAdjacentHTML('beforeend', fishRow());
      renumber();
      updatePoints();
    };
    addFish();
    syncReason();
    view.querySelector('.wm-boats')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-boat]');
      if (!chip) return;
      sheet.teamId.value = chip.dataset.boat;
      sheet.teamId.dispatchEvent(new Event('change', { bubbles: true }));
      sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    view.querySelector('#add-fish').addEventListener('click', () => {
      addFish();
      list.lastElementChild.querySelector('[name=speciesId]').focus();
    });
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-act=remove-fish]')) {
        e.target.closest('.fish').remove();
        renumber();
        updatePoints();
      }
    });
    // The scale photo is taken with the camera there and then, never picked
    // from old photos. Browsers that ignore the camera request (computers,
    // some phones) open a file picker, so photos older than a few minutes are
    // refused too.
    const scalePhotos = new WeakMap();
    // A video of the fish on the scale is optional, and also taken there and then.
    const scaleVideos = new WeakMap();
    list.addEventListener('change', (e) => {
      // A released fish: the photo gives way to the release video, which may come
      // from the camera roll (the release happened out at sea).
      if (e.target.name === 'released') {
        const row = e.target.closest('.fish');
        row.classList.toggle('is-released', e.target.checked);
        const label = row.querySelector('.scale-label');
        label.textContent = e.target.checked ? label.dataset.released : label.dataset.kept;
      }
      if (e.target.matches('[data-scale-video], [data-release-video]')) {
        const row = e.target.closest('.fish');
        const file = e.target.files[0];
        const fromRoll = e.target.matches('[data-release-video]');
        e.target.value = '';
        if (!file) return;
        if (!fromRoll && Date.now() - file.lastModified > SCALE_PHOTO_MAX_AGE) {
          toast('Record the video now, with the fish on the scale. Older videos can\'t be used.');
          return;
        }
        if (fromRoll && Date.now() - file.lastModified > RELEASE_VIDEO_MAX_AGE) {
          toast("That video is more than a day old. Choose today's video of the release.");
          return;
        }
        if (videoTooBig(file)) return;
        scaleVideos.set(row, file);
        const vid = row.querySelector('.scale-video-preview');
        URL.revokeObjectURL(vid.src);
        vid.src = URL.createObjectURL(file);
        vid.hidden = false;
        row.querySelector('.scale-video-button span').textContent = 'Record again';
        row.querySelector('.roll-video-button span').textContent = 'Choose another';
        return;
      }
      // A release's photo was taken out at sea: from the camera roll, today's.
      if (e.target.matches('[data-release-photo]')) {
        const row = e.target.closest('.fish');
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (Date.now() - file.lastModified > RELEASE_VIDEO_MAX_AGE) {
          toast("That photo is more than a day old. Choose today's photo of the release.");
          return;
        }
        scalePhotos.set(row, file);
        const img = row.querySelector('.scale-preview');
        URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(file);
        img.hidden = false;
        row.querySelector('.roll-photo-button span').textContent = 'Choose another photo';
        return;
      }
      if (e.target.matches('[data-scale]')) {
        const row = e.target.closest('.fish');
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (Date.now() - file.lastModified > SCALE_PHOTO_MAX_AGE) {
          toast('Take the photo now, with the fish on the scale. Older photos can\'t be used.');
          return;
        }
        scalePhotos.set(row, file);
        const img = row.querySelector('.scale-preview');
        URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(file);
        img.hidden = false;
        row.querySelector('.scale-button span').textContent = 'Retake photo';
        return;
      }
      if (e.target.name === 'anglerId') e.target.closest('.fish').querySelector('.guest-name').hidden = e.target.value !== 'other';
    });
    // The secretary picks the boat: the angler lists and weigh station follow it.
    sheet.teamId.addEventListener('change', async () => {
      // An Ocean boat's fish or a River boat's: the big buttons follow.
      for (const box of sheet.querySelectorAll('.weigh-quick')) {
        const picked = box.closest('fieldset').querySelector('select[name=speciesId]').value;
        box.innerHTML = quickButtons();
        for (const b of box.querySelectorAll('.wq')) b.classList.toggle('on', b.dataset.sp === picked);
      }
      const boat = jhmmcBoats.find((t) => String(t.id) === sheet.teamId.value);
      if (boat?.weighStation && sheet.weighStation) sheet.weighStation.value = boat.weighStation;
      // A boat outside JHMMC is weighed at its home port: no station to choose.
      const pick = view.querySelector('#station-pick');
      if (pick) {
        const home = atHomePort(boat);
        pick.hidden = home;
        sheet.weighStation.required = !home;
        const note = view.querySelector('#home-port');
        note.hidden = !home;
        note.textContent = home ? `Weigh station: ${boat.homePort || (boat.country ? `${boat.country} weigh station` : 'not set')}` : '';
      }
      if (onNow) view.querySelector('#entry-note').textContent = entryNote(boat?.id);
      crew = boat ? (await api(`/teams/${boat.id}`)).team.members : [];
      for (const sel of list.querySelectorAll('[name=anglerId]')) sel.innerHTML = anglerOptions(sel.value);
    });
    // A captain (weighmaster at his station) starts on his own boat, and can pick another;
    // after sending one boat, the next is his to pick.
    const nextBoat = state.weighNext;
    state.weighNext = false;
    if (wm && myBoat && !nextBoat && sheet.teamId.tagName === 'SELECT') {
      sheet.teamId.value = String(myBoat.id);
      sheet.teamId.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (wm) {
      const markChip = () => { for (const c of view.querySelectorAll('[data-boat]')) c.classList.toggle('on', c.dataset.boat === sheet.teamId.value); };
      sheet.teamId.addEventListener('change', markChip);
      markChip();
    }
    bindForm(sheet, async () => {
      const fd = new FormData();
      fd.set('teamId', sheet.teamId.value);
      fd.set('caughtOn', sheet.caughtOn.value);
      if (sheet.weighStation) fd.set('weighStation', sheet.weighStation.value);
      if (sheet.declared?.checked) fd.set('declared', 'yes');
      if (!view.querySelector('.no-weighmaster').hidden) {
        if (sheet.noWeighmaster.checked) fd.set('noWeighmaster', 'absent');
      }
      // Where the phone is: required from everyone.
      const btn = view.querySelector('#submit-sheet');
      const label = btn.textContent;
      btn.textContent = 'Getting your location…';
      const spot = await phoneSpot(15000);
      btn.textContent = label;
      if (!spot) {
        throw new Error("Your phone's location is needed for the weigh-in. Turn on location (GPS) and allow it for this site in the browser's settings, then send again.");
      }
      fd.set('deviceLat', spot.lat);
      fd.set('deviceLng', spot.lng);
      const fish = [];
      for (const [i, row] of [...list.querySelectorAll('.fish')].entries()) {
        const get = (name) => row.querySelector(`[name=${name}]`);
        fish.push({
          speciesId: get('speciesId').value, anglerId: get('anglerId').value, anglerName: get('anglerName').value,
          weightKg: get('weightKg').value, lineClass: get('lineClass').value, released: get('released').checked ? 'on' : '',
        });
        const photo = scalePhotos.get(row);
        if (photo) fd.set(`scale_${i}`, await shrinkPhoto(photo));
        const video = scaleVideos.get(row);
        // A photo for every fish (it's the picture on the feed and the profiles); a video is optional.
        if (!photo) throw new Error(`Fish ${i + 1}: add a photo ${get('released').checked ? 'of the release' : 'of the fish on the scale'}.`);
        if (video) fd.set(`scalevideo_${i}`, video);
      }
      fd.set('fish', JSON.stringify(fish));
      const { catches } = await api('/weigh/sheet', { method: 'POST', form: fd });
      toast(`${plural(catches.length, 'fish')} registered. Sent to the secretary.${wm ? ' Pick the next boat.' : ''}`);
      if (wm) state.weighNext = true;
      route();
    });
  },

  // Secretary: check each weighed or released catch and approve its points.
  async review() {
    if (!state.me?.canApprove) return needLogin(view, 'review catches (the secretary)');
    const { toReview } = await api('/officials/queue');
    // Split by weigh station, then grouped by day and boat like the paper forms.
    const NONE = 'No station';
    const stationOf = (c) => c.weighStation || NONE;
    // Every JHMMC station always shows, so the secretary sees where nothing is waiting too;
    // then any other place a fish was weighed (a boat outside JHMMC weighs at its home port).
    const others = [...new Set(toReview.map((c) => c.weighStation).filter((w) => w && !state.meta.weighStations.includes(w)))].sort();
    const stations = [...state.meta.weighStations, ...others, ...(toReview.some((c) => !c.weighStation) ? [NONE] : [])];
    const pick = new URLSearchParams(location.hash.split('?')[1] || '').get('station');
    const shown = stations.includes(pick) ? [pick] : stations;
    const count = (w) => toReview.filter((c) => stationOf(c) === w).length;
    const sheetsAt = (w) => {
      const groups = new Map();
      for (const c of toReview.filter((x) => stationOf(x) === w)) {
        const key = `${c.caughtOn}|${c.teamId}`;
        if (!groups.has(key)) groups.set(key, { date: c.caughtOn, boat: c.teamName, division: c.division, catches: [] });
        groups.get(key).catches.push(c);
      }
      return [...groups.values()];
    };
    const tab = (label, href, n, on) => html`<a href="${href}" class="station-tab${n ? '' : ' none'}" ${on ? raw('aria-current="page"') : ''} data-count-for="${label}">${label} <span class="tab-count">${n}</span></a>`;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Review catches</h1>
      ${raw(recordedNote('Approving, rejecting or correcting a fish notifies the crew that registered it, with your note.'))}
      <div class="card pad notify" id="notify"></div>
      ${raw(html`<nav class="station-tabs" aria-label="Weigh stations">
        ${raw(tab('All', '#/review', toReview.length, !stations.includes(pick)))}
        ${stations.map((w) => raw(tab(w, `#/review?station=${encodeURIComponent(w)}`, count(w), pick === w)))}
      </nav>`)}
      <p class="small muted">${plural(toReview.length, 'registration')} to check.</p>
      ${shown.map((w) => raw(html`<section class="station" data-station="${w}">
        <h2 class="station-head">${w} <span class="muted small" data-left>${count(w) ? plural(count(w), 'fish') : 'nothing waiting'}</span></h2>
        ${sheetsAt(w).map((g) => raw(html`<section class="sheet">
        <h3>${g.boat} <span class="muted small">· ${g.division === 'river' ? 'River' : 'Ocean'} · ${fmtDay(g.date)}</span></h3>
        ${g.catches.map((c) => raw(html`<article class="card pad review-item">
          <div class="catch-head"><h3 class="catch-title"><a href="#/catch/${c.id}">${c.species}</a></h3>
            <span class="weight">${c.weightKg ? fmtWeight(c.weightKg) : c.released ? 'Released' : ''}</span></div>
          <p class="meta">${c.anglerFullName || c.angler}${c.lineClass ? ` · ${c.lineClass} line` : ''}</p>
          ${c.weighRole ? raw(`<p class="weigher">${weigherBadge(c)}</p>`) : ''}
          <div class="thumbs">
            ${c.scalePhotoUrl ? raw(html`<a href="${c.scalePhotoUrl}" target="_blank" rel="noopener"><img src="${c.scalePhotoUrl}" alt="On the scale"></a>`) : ''}
            ${c.scaleVideoUrl ? raw(html`<video src="${c.scaleVideoUrl}" controls playsinline preload="metadata"></video>`) : ''}
            ${!c.scalePhotoUrl && !c.scaleVideoUrl ? raw('<span class="small muted">No weigh station photo or video</span>') : ''}
          </div>
          ${c.disputes.length ? raw(html`<div class="disputes">
            <p><b>${raw(icon('flag'))} Disputed</b>: approving needs a note on how it was settled.</p>
            ${c.disputes.map((d) => raw(html`<p class="small"><b>${d.author}</b>${d.boat ? ` (${d.boat})` : ''}, ${fmtWhen(d.createdAt)}: ${d.reason}</p>`))}
          </div>`) : ''}
          <p class="small muted">Registered ${fmtWhen(c.createdAt)}.
            ${Date.parse(c.disputeUntil) > Date.now() ? `Other captains can dispute it until ${new Date(c.disputeUntil).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : 'Disputes are closed.'}</p>
          ${raw(reviewForm(c))}
        </article>`))}
      </section>`))}
      </section>`))}`;
    // After a decision, the station tabs and headings count down.
    const recount = (station) => {
      const left = view.querySelectorAll(`.station[data-station="${CSS.escape(station)}"] .review-item`).length;
      const head = view.querySelector(`.station[data-station="${CSS.escape(station)}"] [data-left]`);
      if (head) head.textContent = left ? plural(left, 'fish') : 'nothing waiting';
      const chip = view.querySelector(`.station-tab[data-count-for="${CSS.escape(station)}"] .tab-count`);
      if (chip) chip.textContent = Number(chip.textContent) - 1;
      const allChip = view.querySelector('.station-tab[data-count-for="All"] .tab-count');
      if (allChip) allChip.textContent = Number(allChip.textContent) - 1;
      for (const sheet of view.querySelectorAll('.sheet')) if (!sheet.querySelector('.review-item')) sheet.remove();
    };
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('form.review button[name=decision]');
      if (btn) btn.form.dataset.decision = btn.value;
    });
    view.addEventListener('submit', async (e) => {
      const form = e.target.closest('form.review');
      if (!form) return;
      e.preventDefault();
      const err = form.querySelector('.error');
      err.textContent = '';
      try {
        const body = { ...formData(form), decision: form.dataset.decision };
        if (body.weightKg !== undefined) body.weightKg = fromUnit('weight', body.weightKg);
        await api(`/catches/${form.dataset.id}/review`, { method: 'POST', body });
        const station = form.closest('.station').dataset.station;
        form.closest('.review-item').remove();
        recount(station);
        refreshPending();
        toast(form.dataset.decision === 'approve' ? 'Approved' : 'Rejected');
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
    renderNotify(view.querySelector('#notify'));
  },

  // Secretary: season dates and tournaments.
  async calendar() {
    const { season, events } = await api('/events');
    const editable = !!state.me?.canReview;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Season calendar</h1>
      ${editable ? raw(recordedNote('Changing the season dates is announced to everyone in the feed.')) : ''}
      ${editable ? raw(html`<form class="card pad stack" id="season">
        <div class="row">
          <label>Season starts <input name="start" type="date" required value="${season.start}"></label>
          <label>Season ends <input name="end" type="date" required value="${season.end}"></label>
        </div>
        <p class="error"></p><div><button type="submit">Save season dates</button></div>
      </form>`) : raw(html`<p>Season: ${fmtDay(season.start)} to ${fmtDay(season.end)}</p>`)}
      <h2>Tournaments</h2>
      <div class="card"><ul class="list">${events.length ? events.map((ev) => raw(html`<li class="member" data-id="${ev.id}">
        <span><b>${ev.name}</b> <span class="badge">${ev.kind === 'tournament' ? 'Tournament' : 'Holiday'}</span><div class="muted small">${fmtDays(ev)}</div>
          ${ev.kind === 'tournament' ? raw(html`<div class="small"><a href="#/tournament/${ev.id}">${plural(ev.entries.length, 'boat')} entered${editable ? ' · manage entries' : ''}</a></div>`) : ''}</span>
        ${editable ? raw('<button data-act="delete-event" class="danger">Remove</button>') : ''}
      </li>`)) : raw('<li class="muted">Nothing added yet.</li>')}</ul></div>
      ${editable ? raw(html`<h2 id="add-tournament">Add a tournament</h2>
      <form class="card pad stack" id="event">
        <input type="hidden" name="kind" value="tournament">
        <div class="row">
          <label>First day <input name="date" type="date" required></label>
          <label>Last day <input name="endDate" type="date"></label>
        </div>
        <p class="small muted">Leave the last day empty for a one-day tournament.</p>
        <label>Name <input name="name" required maxlength="80" placeholder="e.g. November Cup"></label>
        <p class="error"></p><div><button type="submit" class="primary">Add to calendar</button></div>
      </form>`) : ''}`;
    if (!editable) return;
    const seasonForm = view.querySelector('#season');
    bindForm(seasonForm, async () => {
      await api('/settings/season', { method: 'PATCH', body: formData(seasonForm) });
      toast('Season dates saved');
      route();
    });
    const eventForm = view.querySelector('#event');
    // From Tournament sheets → New tournament: straight to the form.
    if (eventForm && new URLSearchParams(location.hash.split('?')[1] || '').get('new') === '1') {
      setTimeout(() => {
        view.querySelector('#add-tournament').scrollIntoView({ block: 'start' });
        eventForm.querySelector('input[name=name], input[type=date]')?.focus();
      }, 50);
    }
    eventForm.date.addEventListener('change', () => { eventForm.endDate.min = eventForm.date.value; });
    bindForm(eventForm, async () => {
      await api('/events', { method: 'POST', body: formData(eventForm) });
      toast('Added');
      route();
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act=delete-event]');
      if (!btn || !confirm('Remove this tournament from the calendar? Its fish still count in the season.')) return;
      await api(`/events/${btn.closest('[data-id]').dataset.id}`, { method: 'DELETE' });
      route();
    });
  },

  // The menu behind the last tab: your dashboard, rules, clubs, account.
  // Edit a West Africa post: add the weight, more photos, the spot... once back on land.
  async edit(id) {
    if (!state.me) return needLogin(view, 'edit a post');
    const { catch: c } = await api(`/catches/${id}`);
    if (!c.canEdit) {
      view.innerHTML = '<div class="card pad empty">Only the angler, whoever logged it or the boat captain can edit this post.</div>';
      return;
    }
    view.innerHTML = html`<p class="back"><a href="#/catch/${c.id}">‹ Back to the catch</a></p>
      <h1>Edit post</h1>
      <form class="card pad stack" id="f">
        ${raw(photoManager(c))}
        <label>Caption <textarea name="notes" maxlength="2000" rows="3">${c.notes || ''}</textarea></label>
        <label>Species <select name="speciesId">${raw(speciesOptions(c.speciesId ?? '', 'Optional'))}</select></label>
        <div class="row">
          <label>Weight (${unit('weight')}) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="optional" value="${toUnit('weight', c.weightKg)}"></label>
          <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, c.lineClass, 'Optional'))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save changes</button></div>
      </form>`;
    const form = view.querySelector('#f');
    const pm = wirePhotoManager(form);
    bindForm(form, async () => {
      const btn = form.querySelector('button[type=submit]');
      btn.textContent = 'Saving…';
      try {
        const fd = new FormData(form);
        fd.set('weightKg', fromUnit('weight', fd.get('weightKg')));
        await api(`/catches/${c.id}`, { method: 'PATCH', form: await pm.addTo(fd) });
        toast('Saved.');
        location.hash = `#/catch/${c.id}`;
      } finally {
        btn.textContent = 'Save changes';
      }
    });
  },
}));
