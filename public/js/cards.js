// Africa Sportfishing, part of the app (public/js/cards.js): Sharing, icons, the catch card, the feed, trophy walls and small shared pieces.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// ---- share ----------------------------------------------------------------

function shareText(c) {
  const w = c.weightKg != null ? ` ${+c.weightKg.toFixed(1)} kg` : '';
  const how = c.released ? ' (released)' : '';
  const boat = c.teamName ? ` aboard ${c.teamName}` : '';
  if (!c.species || c.noAngler) return `${c.species ? `A ${c.species}` : c.angler}${boat} on Africa Sportfishing`;
  return `${c.angler} landed a${w} ${c.species}${how}${boat}${c.location ? ' off ' + c.location : ''}!`;
}

async function shareCatch(c) {
  const url = `${location.origin}/#/catch/${c.id}`;
  const text = shareText(c);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Africa Sportfishing', text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copyText(`${text} ${url}`, 'Link copied');
}

// Line icons from the ICONS set further down.
// The logo, where a fish or a boat has no photo yet.
const MARLIN = '<img class="marlin logo-ph" src="/logo-mark.png" alt="">';
// The fish is the logo's own marlin, drawn in the text colour (a mask), so it matches everywhere.
const icon = (name, cls = 'icon') => (name === 'fish' ? `<span class="${cls} fish-mark" aria-hidden="true"></span>`
  : `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`);

// A small ⓘ that opens an explanation in a sheet, so screens keep only what's needed.
// body is HTML (already escaped, e.g. from html``).
const info = (body, label = 'How this works') => `<button type="button" class="info-btn" aria-label="${esc(label)}">`
  + '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/></svg>'
  + `</button><template class="info-body">${body}</template>`;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.info-btn');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  let dlg = document.getElementById('info-sheet');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'info-sheet';
    dlg.innerHTML = '<div class="info-sheet-body"></div><button type="button" class="primary">OK</button>';
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg || ev.target.matches('button.primary') || ev.target.closest('a')) dlg.close(); });
    document.body.append(dlg);
  }
  dlg.querySelector('.info-sheet-body').replaceChildren(btn.nextElementSibling.content.cloneNode(true));
  dlg.showModal();
});

// Members have a profile page; anglers without an account link to their catches.
// An angler with an account has a page; one typed in at the weigh-in (a guest) has one by name.
const anglerHref = (userId, name) => (userId ? `#/user/${userId}` : `#/guest?name=${encodeURIComponent(name)}`);

const whatsapp = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
// Sending a message (an invite, a reset link): the phone's own share menu, so people
// pick WhatsApp or WhatsApp Business (or Messages, email…); a WhatsApp link always
// opens just one of them. Where there's no share menu (a computer), WhatsApp.
async function shareMessage(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  window.open(whatsapp(text), '_blank', 'noopener');
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-share-text]');
  if (!btn) return;
  e.preventDefault();
  shareMessage(btn.dataset.shareText);
});

// ---- catch card -----------------------------------------------------------

const DIVISIONS = [['ocean', 'Ocean'], ['river', 'River']];
const isJhmmc = (clubId) => clubId != null && String(clubId) === String(state.meta.homeClubId);

// Every boat is Ocean or River. A JHMMC boat's home port is one of the JHMMC
// weigh stations; other boats type their own: switch with the club picked.
function syncDivision(form) {
  const jhmmc = isJhmmc(form.clubId.value);
  for (const f of form.querySelectorAll('.station-field')) f.hidden = !jhmmc;
  const port = form.querySelector('.homeport-field');
  if (port) port.hidden = jhmmc;
}

// N 06° 18.630' W 010° 48.444': degrees and decimal minutes, the way Garmin
// and other plotters show it, so a spot can be typed straight into one.
const dm = (v, width) => {
  const a = Math.abs(v);
  let deg = Math.floor(a);
  let min = Math.round((a - deg) * 60 * 1000) / 1000;
  if (min >= 60) { deg += 1; min = 0; }
  return `${String(deg).padStart(width, '0')}° ${min.toFixed(3).padStart(6, '0')}'`;
};
const fmtCoords = (lat, lng) => `${lat >= 0 ? 'N' : 'S'} ${dm(lat, 2)} ${lng >= 0 ? 'E' : 'W'} ${dm(lng, 3)}`;

function spotMap(c) {
  if (c.lat == null) return '';
  // Drawn on satellite imagery by drawSpotMaps once the page is showing.
  return html`<div class="spot-map">
    <div class="spot-map-view" data-lat="${c.lat}" data-lng="${c.lng}" data-released="${c.released}" role="img" aria-label="Where it was caught"></div>
    <p class="small">${raw(icon('pin'))} ${fmtCoords(c.lat, c.lng)} · <a href="https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}" target="_blank" rel="noopener">Open in maps</a>
      ${c.spotPublic ? '' : raw('<span class="muted"> · Only your crew can see this spot</span>')}</p>
  </div>`;
}

const fmtPoints = (p) => `${Number.isInteger(p) ? p : p.toFixed(1)} pts`;

// Where a catch is in the official process: weigh-in, secretary, decision.
function statusBadge(c) {
  if (c.status === 'unofficial') return '';
  if (c.status === 'approved') return `<span class="badge status ok">${esc(fmtPoints(c.points))}</span>`;
  if (c.status === 'rejected') return '<span class="badge status no">Not counted</span>';
  if (c.status === 'pending_weigh') return '<span class="badge status wait">Waiting for weigh-in</span>';
  if (c.points != null) return `<span class="badge status wait">${esc(fmtPoints(c.points))} · awaiting approval</span>`;
  return '<span class="badge status wait">Waiting for the secretary</span>';
}

function catchCard(c, { full = false } = {}) {
  // A post without a species (the crew, the sunset) goes by who posted it.
  const alt = c.species && !c.noAngler ? `${c.species} caught by ${c.angler}` : `Posted by ${c.angler}`;
  const photo = c.photoUrl
    ? html`<img class="catch-photo" src="${c.photoUrl}" alt="${alt}" loading="lazy">`
    : `<div class="catch-photo placeholder" aria-hidden="true">${MARLIN}</div>`;
  const details = [c.location, c.country].filter(Boolean).join(', ');
  return html`<article class="card" data-id="${c.id}">
    ${c.videoUrl || c.photos?.length > 1 ? raw(mediaHtml(c, alt)) : full ? raw(photo) : raw(`<a href="#/catch/${c.id}">${photo}</a>`)}
    <div class="pad">
      <div class="catch-head">
        <h3 class="catch-title"><a href="#/catch/${c.id}">${c.species || c.angler}</a></h3>
        <span class="weight">${fmtWeight(c.weightKg)}</span>
      </div>
      <p class="meta">
        ${c.species ? raw(html`<a href="${anglerHref(c.userId, c.angler)}">${c.angler}</a> · `) : ''}${c.teamName ? raw(html`<a href="#/boat/${c.teamId}">${c.teamName}</a> · `) : ''}
        ${c.clubName ? raw(html`<a href="#/club/${c.clubId}">${c.clubName}</a> · `) : ''}${fmtDate(c.caughtOn)}${details ? ' · ' + details : ''}
      </p>
      <div class="badges">
        ${raw(statusBadge(c))}
        ${c.released ? raw('<span class="badge release">Released</span>') : ''}
        ${c.tagged ? raw('<span class="badge release">Tagged</span>') : ''}
        ${c.lengthCm ? raw(html`<span class="badge">${c.lengthCm} cm</span>`) : ''}
        ${c.lineClass ? raw(html`<span class="badge">${c.lineClass} line</span>`) : ''}
      </div>
      ${full && c.weightKg && c.worldRecordKg ? raw(html`<p class="small muted">${Math.round((c.weightKg / c.worldRecordKg) * 100)}% of the IGFA all-tackle world record (${Math.round(c.worldRecordKg)} kg). <a href="#/records">See records</a></p>`) : ''}
      ${c.notes ? raw(html`<p class="notes${full ? '' : ' clamp'}">${c.notes}</p>`) : ''}
      ${full ? raw(spotMap(c)) : ''}
      ${full && (c.weighStation || c.pointsNote || (c.scaleVideoUrl && !c.released)) ? raw(html`<div class="official">
        ${c.weighStation ? raw(html`<p>Weighed at <b>${c.weighStation}</b>${c.weightKg ? ` · ${fmtWeight(c.weightKg)}` : ''}</p>`) : ''}
        ${c.weighRole ? raw(`<p class="weigher small">${weigherBadge(c)}</p>`) : ''}
        ${c.pointsNote && c.status !== 'pending_weigh' ? raw(html`<p>${c.status === 'rejected' ? 'Secretary: ' : ''}${c.pointsNote}</p>`) : ''}
        ${c.scaleVideoUrl && !c.released ? raw(html`<p class="small muted">Weigh station video</p>`) : ''}
        ${c.scaleVideoUrl && !c.released ? raw(html`<video class="scale-photo" src="${c.scaleVideoUrl}" controls playsinline preload="metadata"></video>`) : ''}
      </div>`) : ''}
      <div class="actions">
        <button data-act="share">${raw(icon('share'))} Share</button>
        ${full && c.canEdit ? raw(html`<a class="btn" href="#/edit/${c.id}">${raw(icon('edit'))} Edit</a>`) : ''}
        ${full && c.canAddPhoto ? raw(html`<label class="btn">${raw(icon('camera'))} ${c.ownPhoto ? 'Change your photo' : 'Add your photo'}<input type="file" accept="image/*" hidden data-add-photo="${c.id}"></label>`) : ''}
        ${full && c.canDelete ? raw('<button data-act="delete" class="danger">Delete</button>') : ''}
        ${full && c.ownPhoto ? raw(reportBtn('catch', c.id, { userId: c.userId, name: c.angler, label: 'Report photo' })) : ''}
      </div>
      ${full && ['pending_review', 'approved'].includes(c.status) && state.me?.canApprove ? raw(html`<details class="secretary-box" data-fix>
        <summary><b>Secretary: fix species, angler or photo</b></summary>
        <form class="stack" data-fix-form>
          <label>Species <select name="speciesId">${raw(speciesOptions(c.speciesId))}</select></label>
          <label>Angler <select name="anglerId"><option value="">${c.anglerFullName || c.angler} (as now)</option></select></label>
          <label data-fix-name hidden>Angler's name <input name="anglerName" maxlength="80"></label>
          <label>New weigh-station photo <input type="file" name="scalePhoto" accept="image/*"></label>
          <label>Note <input name="note" maxlength="300" placeholder="What was wrong" required></label>
          <p class="small muted">The crew is notified with your note.</p>
          <div><button type="submit" class="primary">Save the correction</button></div>
        </form>
      </details>`) : ''}
      ${full && c.status === 'rejected' && state.me?.canApprove ? raw(html`<form class="secretary-box stack" data-secretary>
        <h3>Secretary</h3>
        <p class="small muted">Not counted. The crew is notified with your note.</p>
        <label>Note <input name="note" maxlength="300" placeholder="Why it now counts"></label>
        <div class="row-buttons"><button type="button" class="primary" data-act="reapprove">Approve again</button></div>
      </form>`) : ''}
      ${full && c.status === 'approved' && state.me?.canApprove ? raw(html`<form class="secretary-box stack" data-secretary ${raw(rescoreAttrs(c))}>
        <h3>Secretary</h3>
        <p class="small" data-rules><b>Rules give ${fmtPoints(c.points)}</b></p>
        <p class="small muted">A correction needs a note; the crew is notified.</p>
        ${c.released ? '' : raw(html`<label>Weight (${unit('weight')}) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" value="${toUnit('weight', c.weightKg)}"></label>`)}
        <label>Note <input name="note" maxlength="300" placeholder="Why"></label>
        <div class="row-buttons">${c.released ? '' : raw('<button type="button" data-act="repoint">Correct weight</button>')}
          <button type="button" data-act="uncount" class="danger">Not counted</button></div>
      </form>`) : ''}
    </div>
  </article>`;
}

// A weighed fish's photo for the feed, added or changed later by the angler or crew.
document.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-add-photo]');
  const file = input?.files?.[0];
  if (!file) return;
  const label = input.closest('label');
  try {
    label.classList.add('busy');
    const fd = new FormData();
    fd.set('photo', await shrinkPhoto(file));
    await api(`/catches/${input.dataset.addPhoto}/photo`, { method: 'POST', form: fd });
    toast('Photo saved.');
    route();
  } catch (err) {
    toast(err.message);
    label.classList.remove('busy');
  }
});

// The secretary's correction of a registration: the boat's crew to choose from, then save.
document.addEventListener('toggle', async (e) => {
  const box = e.target.closest?.('[data-fix]');
  if (!box?.open || box.dataset.loaded) return;
  box.dataset.loaded = '1';
  const id = box.closest('[data-id]').dataset.id;
  const { catch: c } = await api(`/catches/${id}`);
  const members = c.teamId ? (await api(`/teams/${c.teamId}`)).team.members : [];
  box.querySelector('[name=anglerId]').insertAdjacentHTML('beforeend',
    members.map((m) => html`<option value="${m.id}">${m.name}</option>`).join('') + '<option value="other">Someone else (type the name)</option>');
}, true);
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-fix-form] [name=anglerId]')) e.target.form.querySelector('[data-fix-name]').hidden = e.target.value !== 'other';
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-fix-form]');
  if (!form) return;
  e.preventDefault();
  const id = form.closest('[data-id]').dataset.id;
  const fd = new FormData(form);
  const photo = fd.get('scalePhoto');
  if (photo?.size) fd.set('scalePhoto', await shrinkPhoto(photo));
  else fd.delete('scalePhoto');
  try {
    await api(`/catches/${id}/correct`, { method: 'POST', form: fd });
    toast('Corrected. The crew is told.');
    route();
  } catch (err) {
    toast(err.message);
  }
});

// byId maps catch id (string) to catch; callers may keep adding to it.
function wireCards(root, byId) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const c = byId.get(btn.closest('[data-id]').dataset.id);
    if (btn.dataset.act === 'share') return shareCatch(c);
    if (btn.dataset.act === 'reapprove') {
      const note = btn.closest('[data-secretary]').querySelector('[name=note]').value.trim();
      if (!note) return toast('Say why it now counts.');
      try {
        const { catch: fresh } = await api(`/catches/${c.id}/review`, { method: 'POST', body: { decision: 'approve', note } });
        toast(`Approved again: ${fmtPoints(fresh.points)}.`);
        route();
      } catch (ex) {
        toast(ex.message);
      }
      return;
    }
    if (btn.dataset.act === 'repoint' || btn.dataset.act === 'uncount') {
      const box = btn.closest('[data-secretary]');
      const note = box.querySelector('[name=note]').value.trim();
      if (!note) return toast(btn.dataset.act === 'uncount' ? 'Give the reason it isn\'t counted.' : 'Add a note explaining the corrected weight.');
      if (btn.dataset.act === 'uncount' && !confirm('Take this fish off the points? The crew is told why.')) return;
      try {
        const { catch: fresh } = await api(`/catches/${c.id}/review`, { method: 'POST', body: btn.dataset.act === 'uncount'
          ? { decision: 'reject', note } : { decision: 'weight', weightKg: fromUnit('weight', box.querySelector('[name=weightKg]').value), note } });
        toast(btn.dataset.act === 'uncount' ? 'Taken off the points.' : `Weight corrected: ${fmtPoints(fresh.points)}.`);
        Object.assign(c, fresh);
        route();
      } catch (ex) {
        toast(ex.message);
      }
      return;
    }
    // The secretary deleting a registration gives a reason: it stays on record.
    const official = c.status !== 'unofficial' && state.me?.canReview;
    const reason = btn.dataset.act === 'delete' && official ? prompt('Delete this fish? It comes off the points and the log. Why? (kept in the record, and the crew is told)') : '';
    if (btn.dataset.act === 'delete' && official && !reason?.trim()) return;
    if (btn.dataset.act === 'delete' && (official || confirm('Delete this catch? This cannot be undone.'))) {
      try {
        await api(`/catches/${c.id}`, { method: 'DELETE', body: official ? { reason: reason.trim() } : undefined });
        toast('Catch deleted');
        location.hash = '#/feed';
      } catch (ex) {
        toast(ex.message);
      }
    }
  });
}

// A paginated feed of catches with optional fixed filters.
// The feed fills itself: fish approved at the weigh-in and fish logged at sea,
// under the boat's name and photo. Never a spot.
// "an" before a vowel sound, also "an 8 kg", "an 11 kg", "an 18 kg", "an 80 kg".
const withArticle = (word) => `${/^([aeiou]|8|11(?!\d)|18(?!\d)|11\.|18\.)/i.test(word) ? 'an' : 'a'} ${word}`;
function feedLine(x) {
  const fish = (x.species || '').toLowerCase();
  if (x.kind === 'weighin' && x.single && x.fish[0]) {
    // One fish, on a boat's or angler's own page.
    const f = x.fish[0];
    const who = f.angler || x.boat || 'A boat';
    return f.weightKg ? `${who} weighed ${withArticle(`${fmtWeight(f.weightKg)} ${f.species.toLowerCase()}`)}.` : `${who} released ${withArticle(f.species.toLowerCase())}.`;
  }
  if (x.kind === 'weighin') return `${x.boat || 'A boat'} weighed in ${plural(x.fish.length, 'fish')}.`;
  const boat = x.boat || 'A boat';
  return { released: `${boat} released ${withArticle(fish)}.`, kept: `${boat} boated ${withArticle(fish)}.`, lost: `${boat} lost ${withArticle(fish)}.` }[x.fate];
}
// A fish logged at sea without a photo: a short card (who, what, when), so photo posts stand out.
const feedRow = (x) => html`<article class="feed-row">
  <a class="feed-row-boat" href="${x.teamId ? `#/boat/${x.teamId}` : '#/participants?tab=boats'}">${x.boatPhotoUrl ? raw(html`<img src="${x.boatPhotoUrl}" alt="" loading="lazy">`) : raw(`<span class="feed-ph">${icon('fish')}</span>`)}</a>
  <span class="feed-row-text">${feedLine(x)}</span>
  <span class="pill ${x.fate}">${x.fate === 'released' ? 'Released' : x.fate === 'kept' ? 'Boated' : 'Lost'}</span>
  <span class="small muted feed-row-time">${fmtWhen(x.at)}</span>
</article>`;
const feedItem = (x) => (x.kind === 'log' && !x.photoUrl ? feedRow(x) : x.kind === 'announcement' ? html`<article class="feed-item announcement" data-ann="${x.id}">
  <div class="feed-head">
    <span class="feed-boat"><img src="/jhmmc-logo.png" alt="" class="club-mark"><b>JHMMC</b></span>
    <span class="small muted">${fmtWhen(x.at)}</span>
  </div>
  <h3 class="ann-title">${x.title}</h3>
  ${x.body ? raw(html`<p class="ann-body">${x.body}</p>`) : ''}
  <div class="ann-foot"><span class="pill ann">Announcement</span><span class="small muted">${x.angler || ''}</span>
    ${x.canDelete ? raw('<button type="button" class="link danger small" data-act="drop-ann">Remove</button>') : raw(reportBtn('announcement', x.id, { userId: x.userId, name: x.angler }))}</div>
</article>` : html`<article class="feed-item">
  <div class="feed-head">
    <a class="feed-boat" href="${x.teamId ? `#/boat/${x.teamId}` : '#/participants?tab=boats'}">
      ${x.boatPhotoUrl ? raw(html`<img src="${x.boatPhotoUrl}" alt="" loading="lazy">`) : raw(`<span class="feed-ph">${icon('fish')}</span>`)}
      <b>${x.boat || 'A boat'}</b></a>
    <span class="small muted">${fmtWhen(x.at)}</span>
  </div>
  <p class="feed-line">${feedLine(x)}</p>
  ${x.kind === 'log' && x.photoUrl ? raw(html`<div class="feed-gallery"><div class="photo-link"><img class="catch-photo" src="${x.photoUrl}" alt="${x.species}" loading="lazy"><span class="photo-cap"><b>${x.species}</b>${x.fate === 'released' ? 'Released' : x.fate === 'kept' ? 'Boated' : 'Lost'}</span></div></div>`) : ''}
  ${x.kind === 'weighin' && x.fish.some((f) => f.photos.length || f.videoUrl) ? raw(feedGallery(x.fish.flatMap((f) => [
    ...f.photos.map((url, i) => html`<a class="photo-link" href="#/catch/${f.id}"><img class="catch-photo" src="${url}" alt="${f.species}${i === f.photos.length - 1 ? ' at the weigh station' : ''}" loading="lazy">
      <span class="photo-cap"><b>${f.species}</b>${[f.weightKg ? fmtWeight(f.weightKg) : f.released ? 'Released' : '', f.angler || '', f.points != null ? fmtPoints(f.points) : ''].filter(Boolean).join(' · ')}</span></a>`),
    ...(f.videoUrl ? [html`<video class="catch-photo" src="${f.videoUrl}" controls playsinline preload="metadata" aria-label="${f.species} released"></video>`] : []),
  ]))) : ''}
  ${x.kind === 'weighin' ? raw(html`<ul class="weighin-fish" ${x.fish.length === 1 && x.fish[0].photos.length ? raw('hidden') : ''}>${x.fish.map((f) => raw(html`<li><a href="#/catch/${f.id}">
    <span><b>${f.species}</b> · ${f.angler || 'the crew'}</span>
    <span>${f.weightKg ? fmtWeight(f.weightKg) : f.released ? 'released' : ''}${f.points != null ? raw(html` <small class="muted">${fmtPoints(f.points)}</small>`) : ''}</span></a></li>`))}
    ${x.single ? '' : raw(html`<li class="weighin-total"><span>Total</span><span>${fmtWeight(x.fish.reduce((n, f) => n + (f.weightKg || 0), 0))} · ${fmtPoints(x.points)}</span></li>`)}</ul>
    ${state.me?.teamId && state.me.teamId === x.teamId && x.fish.some((f) => !f.ownPhoto) ? raw(html`<div class="add-photos">
      <span class="small muted">Your crew's fish: add your own photo. It shows first, then the weigh station's.</span>
      ${x.fish.filter((f) => !f.ownPhoto).map((f) => raw(html`<label class="btn small">${raw(icon('camera'))} ${f.species}${f.weightKg ? ` ${fmtWeight(f.weightKg)}` : ''}<input type="file" accept="image/*" hidden data-add-photo="${f.id}"></label>`))}
    </div>`) : ''}
    ${x.day !== today() ? raw(html`<span class="small muted">Caught ${fmtDate(x.day)}</span>`) : ''}`) : ''}
  <div class="feed-foot"><span class="pill ${x.kind === 'weighin' ? 'kept' : x.fate}">${x.kind === 'weighin' ? 'Weigh-in' : x.fate === 'released' ? 'Released' : x.fate === 'kept' ? 'Boated' : 'Lost'}</span>
    ${x.kind === 'log' && x.photoUrl ? raw(reportBtn('log', x.id, { userId: x.userId, name: x.boat })) : ''}
    ${x.kind === 'weighin' && x.fish.some((f) => f.ownPhoto) ? raw(reportBtn('catch', x.fish.find((f) => f.ownPhoto).id, { name: x.boat })) : ''}</div>
</article>`);
// Several of a species weighed the same day: their weights together, heaviest first.
const weighedLine = (f) => html`⚖️ <b>${f.weighedKg.length} ${f.species.toLowerCase()}</b> weighed: ${f.weighedKg.map((kg) => fmtWeight(kg)).join(', ')} · ${fmtWeight(f.weighedKg.reduce((a, b) => a + b, 0))} in all`;

// A boat's or angler's page: their fish to show off. Highlights, the biggest
// fish, species chips and Newest/Biggest, and a photo grid; tap a fish for its page.
async function renderTrophies(box, query) {
  const { fish, stats, biggest } = await api(`/trophies?${new URLSearchParams(query)}`);
  let species = '';
  let sort = 'newest';
  const counts = new Map();
  for (const f of fish) counts.set(f.species, (counts.get(f.species) || 0) + 1);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]);
  const place = stats.place ? ` · ${ordinal(stats.place)}` : '';
  // A fish logged at sea shows as the log has it, Boated or Released; no points (it wasn't weighed).
  const tile = (f) => f.logged ? html`<div class="trophy">
    <a href="${f.photoUrl}" target="_blank" rel="noopener" aria-label="${f.species}, ${f.released ? 'released' : 'boated'}, logged at sea">
      <img src="${f.photoUrl}" alt="" loading="lazy">
      <span class="tag ${f.released ? '' : 'boated'}">${f.released ? 'Released' : 'Boated'}</span>
      <span class="cap"><b>${f.species}</b>${f.estimateKg ? `~${fmtWeight(f.estimateKg)} est. · ` : ''}${fmtDate(f.caughtOn)}</span></a>
  </div>` : html`<div class="trophy">
    <a href="#/catch/${f.id}" aria-label="${f.species}${f.weightKg ? `, ${fmtWeight(f.weightKg)}` : f.released ? ', released' : ''}">
      ${f.photoUrl ? raw(html`<img src="${f.photoUrl}" alt="" loading="lazy">`) : raw(`<span class="ph">${MARLIN}</span>`)}
      <span class="tag weighed">${f.released ? 'Released' : 'Weighed'}</span>
      <span class="cap"><b>${f.species}</b>${f.released ? fmtPoints(f.points) : `${fmtWeight(f.weightKg)} · ${fmtPoints(f.points)}`}</span></a>
    ${f.canAddPhoto && !f.ownPhoto ? raw(html`<label class="trophy-add" aria-label="Add your photo of the ${f.species}">${raw(icon('camera'))}<input type="file" accept="image/*" hidden data-add-photo="${f.id}"></label>`) : ''}
  </div>`;
  function draw() {
    const shown = fish.filter((f) => !species || f.species === species);
    if (sort === 'biggest') shown.sort((a, b) => (b.weightKg ?? -1) - (a.weightKg ?? -1) || (b.points ?? 0) - (a.points ?? 0));
    box.innerHTML = html`<div class="trophy-stats">
        <div class="card"><b>${stats.weighed}</b><span>fish weighed</span></div>
        ${query.team ? raw(html`<div class="card"><b>${stats.logged}</b><span>fish logged</span></div>`) : ''}
        <div class="card"><b>${stats.releases}</b><span>releases</span></div>
        <div class="card"><b>${fmtPoints(stats.points).replace(' pts', '')}</b><span>${stats.board === 'jhmmc' ? 'JHMMC Season' : 'season points'}${place}</span></div>
      </div>
      ${biggest ? raw(html`<a class="card trophy-best" href="#/catch/${biggest.id}">
        ${biggest.photoUrl ? raw(html`<img src="${biggest.photoUrl}" alt="">`) : raw(`<span class="ph">${MARLIN}</span>`)}
        <span><span class="small muted">Biggest fish</span><b>${biggest.species} · ${fmtWeight(biggest.weightKg)}</b>
        <span class="small muted">${biggest.angler || biggest.teamName || ''} · ${fmtDate(biggest.caughtOn)}</span></span></a>`) : ''}
      ${fish.length ? raw(html`<div class="trophy-chips" role="group" aria-label="Species">
          <button type="button" class="${species ? '' : 'on'}" data-species="">All ${fish.length}</button>
          ${kinds.map(([k, n]) => raw(html`<button type="button" class="${species === k ? 'on' : ''}" data-species="${k}">${k} ${n}</button>`))}
        </div>
        <div class="trophy-chips" role="group" aria-label="Order">
          <button type="button" class="${sort === 'newest' ? 'on' : ''}" data-sort="newest">Newest</button>
          <button type="button" class="${sort === 'biggest' ? 'on' : ''}" data-sort="biggest">Biggest</button>
        </div>
        <div class="trophy-grid">${shown.map((f) => raw(tile(f)))}</div>`)
        : raw(emptyState('fish', 'No fish yet. Weigh-ins show here once the secretary approves them.', state.me?.teamId ? ['#/fishon', 'Log your first fish'] : null))}`;
  }
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-species], [data-sort]');
    if (!b) return;
    if (b.dataset.sort) sort = b.dataset.sort;
    else species = b.dataset.species;
    draw();
  });
  draw();
}
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;

// A weigh-in post's pictures, swiped sideways: each fish's weigh station
// photo, then the crew's own.
function feedGallery(slides) {
  if (slides.length < 2) return html`<div class="feed-gallery">${raw(slides[0])}</div>`;
  return html`<div class="gallery-wrap feed-gallery"><div class="gallery">${slides.map((x) => raw(x))}</div>
    <span class="gallery-count">${raw(icon('camera'))} ${slides.length}</span></div>`;
}
async function renderFeed(container, query = {}) {
  let before = null;
  const list = document.createElement('div');
  list.className = 'card feed-list';
  const more = document.createElement('button');
  more.textContent = 'Load more';
  more.className = 'more';
  more.hidden = true;
  container.replaceChildren(list, more);
  let shown = 0;
  // The first page of each feed is kept on the phone: without signal the last
  // one seen shows, with a note, instead of an empty page.
  const keepKey = 'kept-feed:' + JSON.stringify(query);
  async function page() {
    const params = new URLSearchParams(Object.entries({ ...query, before: before ?? '' }).filter(([, v]) => v !== '' && v != null));
    let got;
    try {
      got = await api('/feed?' + params, { once: !before && !navigator.onLine });
      if (!before) keep(keepKey, { at: new Date().toISOString(), ...got });
    } catch (err) {
      if (err.status) throw err;
      const old = !before && kept(keepKey);
      if (!old) {
        if (before) return toast(err.message);
        list.innerHTML = html`<div class="pad empty muted"><p>No signal, so the feed can't load.</p><p><a href="#/fishon">Log fish</a> still works: fish wait on the phone and send themselves when the signal's back.</p></div>`;
        return;
      }
      list.insertAdjacentHTML('beforebegin', html`<p class="offline-note small">No signal: this is the feed as it was ${fmtWhen(old.at)}. Log fish still works.</p>`);
      got = { items: old.items, nextBefore: null };
    }
    const { items, nextBefore } = got;
    list.insertAdjacentHTML('beforeend', items.map(feedItem).join(''));
    shown += items.length;
    before = nextBefore;
    more.hidden = !nextBefore;
    if (!shown) list.innerHTML = '<div class="pad empty muted">Nothing here yet. Fish show up as boats log them and weigh them in.</div>';
  }
  more.addEventListener('click', page);
  list.addEventListener('click', async (e) => {
    const drop = e.target.closest('[data-act=drop-ann]');
    if (!drop || !confirm('Remove this announcement?')) return;
    const item = drop.closest('[data-ann]');
    try {
      await api(`/announcements/${item.dataset.ann}`, { method: 'DELETE' });
      item.remove();
    } catch (err) {
      toast(err.message);
    }
  });
  await page();
}

// JHMMC members carry the club's logo in the header, on every page.
const syncHeader = () => {
  document.getElementById('club-chip').hidden = !state.me?.jhmmc;
};

function needLogin(view, what) {
  // Signed in already: it's a matter of role, not of signing in.
  if (state.me) {
    const [, action, who] = what.match(/^(.*) \((.*)\)$/) || [];
    view.innerHTML = html`<div class="card pad empty"><p>${who ? `Only ${who} can ${action}.` : `You can't ${what}.`}</p></div>`;
    return;
  }
  state.afterLogin = location.hash;
  view.innerHTML = html`<div class="card pad empty">
    <p>Sign in to ${what}.</p>
    <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Create an account</a>
  </div>`;
}

// The first thing a visitor sees: navy, the logo's marlin, one line, two buttons.
const HERO = `<section class="hero welcome">
  <img class="welcome-mark" src="/logo-mark.png" alt="">
  <p class="welcome-eyebrow">Tight lines</p>
  <h1>Your season starts here</h1>
  <p>Log fish at sea, weigh in at the station and climb the leaderboard.</p>
  <div class="welcome-buttons"><a class="btn primary" href="#/register">Create an account</a><a class="btn" href="#/login">Sign in</a></div>
</section>`;

// Shown to anglers who are signed in but not on a boat, and to visitors.
function noBoatBanner() {
  if (!state.me) return HERO;
  // Officers (the secretary often has no boat) aren't asked to join one.
  return state.me.teamId || state.me.canReview || state.me.canHandleMoney ? '' : `<div class="card pad banner">
    <div><b>You're browsing as an individual angler.</b><br><span class="muted small">You can follow the feed and the leaderboard. To log fish, join a boat's crew or register your boat.</span></div>
    <a class="btn primary" href="#/crew">Get on a boat</a>
  </div>`;
}

// Ocean / River switch for the points pages, keeping the rest of the address.
const divisionTabs = (base, division) => `<div class="seg" role="tablist">
  ${DIVISIONS.map(([key, label]) => `<a role="tab" href="${base}${base.includes('?') ? '&' : '?'}division=${key}" aria-selected="${division === key}">${label}</a>`).join('')}
</div>`;

const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
// A tournament's days: "Sat, 14 Nov 2026" or "Sat, 14 Nov 2026 to Sun, 15 Nov 2026".
const fmtDays = (ev) => (ev.endDate && ev.endDate !== ev.date ? `${fmtDay(ev.date)} to ${fmtDay(ev.endDate)}` : fmtDay(ev.date));

// A corrected weight shows its points as it's typed: the same rules as the server.
const rescoreAttrs = (c) => html`data-rescore data-species-id="${c.speciesId}" data-division="${c.division || 'ocean'}"`;
document.addEventListener('input', (e) => {
  const form = e.target.matches('[name=weightKg]') && e.target.closest('[data-rescore]');
  if (!form) return;
  const sp = state.meta.species.find((x) => String(x.id) === form.dataset.speciesId);
  const kg = Number(fromUnit('weight', e.target.value));
  const out = form.querySelector('[data-rules]');
  if (!sp || !out || !(kg > 0)) return;
  const r = scoring.scoreCatch({ species: sp.name, pointsPerKg: sp.pointsPerKg, weightKg: kg, released: false, division: form.dataset.division });
  out.innerHTML = html`<b>Rules give ${fmtPoints(r.points)}</b> · ${r.note}`;
});

// A reminder wherever an officer changes something: who hears about it, and that it's on record.
const recordedNote = (what) => html`<p class="card pad record-note small">${raw(icon('history'))} <span>${what} Recorded in the <a href="#/activity">Activity log</a>.</span></p>`;

// Points form for a catch waiting for the secretary.
function reviewForm(c) {
  return html`<form class="review" data-id="${c.id}" ${raw(rescoreAttrs(c))}>
    <p class="small"><span data-rules><b>Rules give ${fmtPoints(c.suggested.points)}</b> · ${c.suggested.note}</span>
      ${c.events.length ? ` · ${c.events.map((e) => e.name).join(', ')}` : ''}</p>
    <div class="row">
      ${c.released ? '' : raw(html`<label>Weight (${unit('weight')}) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" value="${toUnit('weight', c.weightKg)}"></label>`)}
      <label>Note <input name="note" maxlength="300" placeholder="Needed if you correct the weight or reject"></label>
    </div>
    <div class="actions"><button class="primary" name="decision" value="approve">Approve</button><button class="danger" name="decision" value="reject">Reject</button></div>
    <p class="error"></p>
  </form>`;
}
