'use strict';

// ---- helpers --------------------------------------------------------------

const state = { me: null, meta: null, clubs: null, afterLogin: null, pending: 0, navActive: null };
const main = document.getElementById('view');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Tagged template that escapes interpolated values unless wrapped with raw().
const RAW = Symbol('raw');
const raw = (s) => ({ [RAW]: s });
function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const part = Array.isArray(v) ? v.map((x) => (x && x[RAW] !== undefined ? x[RAW] : esc(x))).join('')
      : v && v[RAW] !== undefined ? v[RAW] : esc(v);
    return out + part + s;
  }, '');
}

// While the server restarts (each update, for a few seconds) or is busy, the
// host answers 502-504 without the request reaching the app: safe to send again.
const RETRY_STATUS = new Set([502, 503, 504]);
const RETRY_WAITS = [1500, 3000, 6000];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch('/api' + path, init);
    } catch {
      // No answer at all (no signal, or the connection dropped). Reading is
      // safe to repeat; anything that changes something might have arrived, so
      // it's left for the person to send again.
      if (init.method === 'GET' && attempt < RETRY_WAITS.length) {
        await wait(RETRY_WAITS[attempt]);
        continue;
      }
      throw new Error(init.method === 'GET'
        ? "Can't reach the app right now. Check your signal and try again."
        : "No connection, so it wasn't sent. Check your signal and tap again.");
    }
    if (!RETRY_STATUS.has(res.status) || attempt >= RETRY_WAITS.length) break;
    await wait(RETRY_WAITS[attempt]);
  }
  if (RETRY_STATUS.has(res.status)) throw new Error('The app is updating or busy for a moment. Try again in a minute.');
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) {
    // Session expired: send them back to sign in.
    state.me = null;
    location.hash = '#/login';
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2500);
}

const kgToLb = (kg) => Math.round(kg * 2.20462);
const fmtWeight = (kg) => (kg == null ? '' : `${+kg.toFixed(1)} kg · ${kgToLb(kg)} lb`);
// Stored times look like "2026-10-28 14:05:00" (UTC); iPhones only read them with a "T".
const parseTime = (d) => new Date(d.length === 10 ? `${d}T12:00:00` : `${d.replace(' ', 'T')}${/Z|[+-]\d\d:\d\d$/.test(d) ? '' : 'Z'}`);
const fmtDate = (d) => parseTime(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
// A stored time ("2026-10-28 14:05:00", UTC) as local day and time.
const fmtWhen = (d) => parseTime(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 || word === 'fish' ? '' : word.endsWith('ch') ? 'es' : 's'}`;

function options(items, selected, placeholder) {
  return html`${placeholder ? raw(`<option value="">${esc(placeholder)}</option>`) : ''}${items.map((it) => {
    const [value, label] = Array.isArray(it) ? it : [it, it];
    return raw(`<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`);
  })}`;
}

// How recent a scale photo must be: taken at the dock, not from the past.
const SCALE_PHOTO_MAX_AGE = 15 * 60 * 1000;
// A release video comes from the camera roll, but from today's fishing.
const RELEASE_VIDEO_MAX_AGE = 24 * 60 * 60 * 1000;
// Videos go up as recorded (photos are shrunk first): about a minute at most.
const MAX_VIDEO_MB = 100;
function videoTooBig(file) {
  if (file.size <= MAX_VIDEO_MB * 1024 * 1024) return false;
  toast(`That video is too long (${Math.round(file.size / 1048576)} MB). Keep it under about a minute (${MAX_VIDEO_MB} MB).`);
  return true;
}
// Choosing a post's photo and/or video: taken now or picked from the phone (Chrome
// on newer Android phones shows no camera unless asked, hence separate choices).
const MEDIA_PREVIEWS = `<span class="photo-preview" hidden><img alt=""></span>
  <video class="video-preview" controls playsinline preload="metadata" hidden></video>`;
const MEDIA_CHOICES = `<label class="btn">Take photo<input type="file" accept="image/*" capture="environment" data-photo></label>
  <label class="btn">From photos<input type="file" accept="image/*" data-photo></label>
  <label class="btn">Record video<input type="file" accept="video/*" capture="environment" data-video></label>
  <label class="btn">Video from phone<input type="file" accept="video/*" data-video></label>`;
function wireMediaPick(root) {
  const picked = { photo: null, video: null };
  const cta = root.querySelector('[data-act=photo-menu]');
  const menu = root.querySelector('.photo-menu');
  const img = root.querySelector('.photo-preview');
  const vid = root.querySelector('.video-preview');
  const close = () => {
    menu.hidden = true;
    cta.setAttribute('aria-expanded', 'false');
  };
  cta.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    cta.setAttribute('aria-expanded', String(!menu.hidden));
  });
  menu.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const isVideo = e.target.matches('[data-video]');
    e.target.value = '';
    if (!file || (isVideo && videoTooBig(file))) return;
    // Show what's attached so it's clear.
    const [box, el] = isVideo ? [vid, vid] : [img, img.querySelector('img')];
    picked[isVideo ? 'video' : 'photo'] = file;
    URL.revokeObjectURL(el.src);
    el.src = URL.createObjectURL(file);
    box.hidden = false;
    cta.classList.add('has-media');
    close();
  });
  return {
    picked,
    // Puts the shrunk photo and the video into the form data being sent.
    async addTo(fd) {
      if (picked.photo) fd.set('photo', picked.photo);
      if (picked.video) fd.set('video', picked.video);
      return preparePhoto(fd, 'photo');
    },
    reset() {
      picked.photo = null;
      picked.video = null;
      img.hidden = true;
      vid.hidden = true;
      vid.removeAttribute('src');
      cta.classList.remove('has-media');
      close();
    },
  };
}

// Editing a post's photos and video: tap a photo to mark it for removal, add
// more (taken now or from the phone), replace or remove the video.
function photoManager(item) {
  const photos = item.photos ?? [];
  return html`<div class="stack photo-manager">
    <span class="spot-head">Photos <span class="muted small">(tap one to remove it)</span></span>
    <div class="pm-grid">${photos.map((x) => raw(html`<button type="button" class="pm-photo" data-photo-id="${x.id}" aria-pressed="false">
      <img src="${x.url}" alt=""><span class="pm-x">✕</span></button>`))}<span class="pm-new"></span></div>
    <div class="photo-menu">
      <label class="btn">${raw(icon('camera'))} Take photo<input type="file" accept="image/*" capture="environment" data-add-photo></label>
      <label class="btn">${raw(icon('upload'))} Add from photos<input type="file" accept="image/*" multiple data-add-photo></label>
    </div>
    <span class="spot-head">Video</span>
    ${item.videoUrl ? raw(html`<video class="video-preview" src="${item.videoUrl}" controls playsinline preload="metadata"></video>
      <label class="check"><input type="checkbox" name="removeVideo" value="true"> Remove the video</label>`) : ''}
    <video class="video-preview pm-video-new" controls playsinline hidden></video>
    <div class="photo-menu">
      <label class="btn">${raw(icon('video'))} Record video<input type="file" accept="video/*" capture="environment" data-set-video></label>
      <label class="btn">${raw(icon('upload'))} ${item.videoUrl ? 'Replace from phone' : 'Video from phone'}<input type="file" accept="video/*" data-set-video></label>
    </div>
  </div>`;
}
function wirePhotoManager(root) {
  const added = [];
  let video = null;
  const remove = new Set();
  root.querySelector('.pm-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('[data-photo-id]');
    if (!tile) return;
    const id = tile.dataset.photoId === 'cover' ? 'cover' : Number(tile.dataset.photoId);
    if (remove.has(id)) remove.delete(id);
    else remove.add(id);
    tile.setAttribute('aria-pressed', String(remove.has(id)));
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-add-photo]')) {
      for (const file of e.target.files) {
        added.push(file);
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.className = 'pm-added';
        root.querySelector('.pm-new').before(img);
      }
      e.target.value = '';
    }
    if (e.target.matches('[data-set-video]')) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || videoTooBig(file)) return;
      video = file;
      const el = root.querySelector('.pm-video-new');
      URL.revokeObjectURL(el.src);
      el.src = URL.createObjectURL(file);
      el.hidden = false;
    }
  });
  return {
    async addTo(fd) {
      for (const f of added) fd.append('photos', await shrinkPhoto(f));
      if (video) fd.set('video', video);
      if (remove.size) fd.set('removePhotos', JSON.stringify([...remove]));
      return fd;
    },
  };
}

// The map library (Leaflet 1.9.4, kept in public/vendor), loaded the first time a map is shown.
let leaflet = null;
function loadLeaflet() {
  leaflet ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => {
      leaflet = null;
      reject(new Error("The map couldn't load. Check your connection and try again."));
    };
    document.head.append(js);
  });
  return leaflet;
}

// Where a fish was caught, for the JHMMC feed's post box: the phone's GPS or typed
// coordinates, into hidden lat/lng fields.
const spotFields = (hint = 'optional, only you see it') => `<div class="stack spot">
  <span class="spot-head">Where you caught it <span class="muted small">(${hint})</span></span>
  <div class="spot-row"><button type="button" data-act="locate">${icon('locate')} Use my location</button>
    <span class="small muted">or type the coordinates</span></div>
  <input name="coords" autocomplete="off" inputmode="text" aria-label="Coordinates" placeholder="e.g. 6°18.63'N 10°48.44'W or 6.3105, -10.8074">
  <span class="small muted spot-status"></span>
  <input type="hidden" name="lat"><input type="hidden" name="lng">
</div>`;
function wireSpot(root) {
  const status = root.querySelector('.spot-status');
  const [lat, lng, coords] = ['lat', 'lng', 'coords'].map((n) => root.querySelector(`[name=${n}]`));
  root.querySelector('[data-act=locate]').addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'This phone or browser can\'t share its location.';
      return;
    }
    status.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition((pos) => {
      lat.value = pos.coords.latitude.toFixed(5);
      lng.value = pos.coords.longitude.toFixed(5);
      coords.value = `${lat.value}, ${lng.value}`;
      status.textContent = `${fmtCoords(pos.coords.latitude, pos.coords.longitude)} (±${Math.round(pos.coords.accuracy)} m)`;
    }, (err) => {
      status.textContent = err.code === 1
        ? 'Location is blocked. Allow it for this site in your phone settings, or type the coordinates.'
        : 'Couldn\'t get a GPS fix. Try again in the open, or type the coordinates.';
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
  coords.addEventListener('input', () => {
    const text = coords.value.trim();
    const spot = text ? parseCoords(text) : null;
    lat.value = spot ? spot.lat : '';
    lng.value = spot ? spot.lng : '';
    status.textContent = !text ? '' : spot ? `Reads as ${fmtCoords(spot.lat, spot.lng)}` : "Can't read those coordinates yet. Use N/S and E/W, or a comma between the two.";
  });
  return {
    reset() {
      lat.value = '';
      lng.value = '';
      coords.value = '';
      status.textContent = '';
    },
  };
}

// A post's media: its video (with the first photo as the still before it plays)
// and its photos; more than one swipes sideways.
function mediaHtml(item, alt = '') {
  const photos = item.photos ?? (item.photoUrl ? [{ url: item.photoUrl }] : []);
  const slides = [
    ...(item.videoUrl ? [html`<video class="catch-photo" src="${item.videoUrl}" ${photos[0] ? raw(html`poster="${photos[0].url}"`) : ''} controls playsinline preload="metadata"></video>`] : []),
    ...photos.map((x) => html`<img class="catch-photo" src="${x.url}" alt="${alt}" loading="lazy">`),
  ];
  if (slides.length < 2) return slides[0] ?? '';
  return html`<div class="gallery-wrap"><div class="gallery">${slides.map((x) => raw(x))}</div>
    <span class="gallery-count">${raw(icon('camera'))} ${slides.length}</span></div>`;
}

// Club roles and how they read.
const ROLE_OPTIONS = [['', 'Member'], ['president', 'President'], ['vice_president', 'Vice President'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']];
const roleLabel = (role) => ROLE_OPTIONS.find(([k]) => k === role)?.[1] || role;

// The registration record, one entry per fish: where it stands now, and
// everything that happened to it, in order.
const LOG_ACTIONS = {
  registered: 'Registered', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
};
const LOG_STATUS = {
  registered: 'Waiting', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
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

// JHMMC boats for the secretary's weigh sheet, grouped by weigh station.
function boatOptions(boats, mine) {
  const label = (t) => `${t.name} (${t.division === 'river' ? 'River' : 'Ocean'})`;
  const order = [...new Set([mine, ...state.meta.weighStations].filter(Boolean)), null];
  const groups = order.map((w) => [w, boats.filter((t) => (t.weighStation || null) === w)]).filter(([, list]) => list.length);
  const opts = (list) => list.map((t) => `<option value="${esc(t.id)}">${esc(label(t))}</option>`).join('');
  if (groups.length < 2) return `<option value="">Choose…</option>${opts(boats)}`;
  return `<option value="">Choose…</option>${groups.map(([w, list]) =>
    `<optgroup label="${esc(w ? (w === mine ? `${w} (your station)` : w) : 'No station set')}">${opts(list)}</optgroup>`).join('')}`;
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
    const img = await createImageBitmap(file);
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

async function refreshMe() {
  state.me = (await api('/me')).user;
}

// ---- share ----------------------------------------------------------------

function shareText(c) {
  const w = c.weightKg != null ? ` ${+c.weightKg.toFixed(1)} kg` : '';
  const how = c.released ? ' (released)' : '';
  const boat = c.teamName ? ` aboard ${c.teamName}` : '';
  return `${c.angler} landed a${w} ${c.species}${how}${boat}${c.location ? ' off ' + c.location : ''}!`;
}

async function shareCatch(c) {
  const url = `${location.origin}/#/catch/${c.id}`;
  const text = shareText(c);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'West Africa Big Game', text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copyText(`${text} ${url}`, 'Link copied');
}

// Line icons from the ICONS set further down.
// The club marlin, drawn from public/marlin.svg in the current text colour.
const MARLIN = '<svg class="marlin" viewBox="0 0 670 658"><use href="/marlin.svg#m"/></svg>';
const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Members have a profile page; anglers without an account link to their catches.
const anglerHref = (userId, name) => (userId ? `#/user/${userId}` : `#/?angler=${encodeURIComponent(name)}`);

const whatsapp = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// ---- catch card -----------------------------------------------------------

const DIVISIONS = [['ocean', 'Ocean'], ['river', 'River']];
const isJhmmc = (clubId) => clubId != null && String(clubId) === String(state.meta.homeClubId);

// Ocean / River is only asked for JHMMC boats, and their home port is their
// weigh station: switch the fields when the club picked is (or isn't) JHMMC.
function syncDivision(form) {
  const jhmmc = isJhmmc(form.clubId.value);
  for (const f of form.querySelectorAll('.division-field, .station-field')) f.hidden = !jhmmc;
  const port = form.querySelector('.homeport-field');
  if (port) port.hidden = jhmmc;
}

// 6.31°N 10.81°W, the way charts and GPS units show it.
const fmtCoords = (lat, lng) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;

// Reads a position typed from a GPS or chartplotter: decimal degrees
// ("6.3105, -10.8074", "6.3105N 10.8074W"), degrees and minutes
// ("6°18.63'N 10°48.44'W") or degrees, minutes and seconds. Returns
// { lat, lng } or null if it can't make sense of it.
function parseCoords(text) {
  const clean = String(text).toUpperCase().replace(/[°º'′’"″”]/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
  const toDegrees = (nums, hemi) => {
    if (!nums.length || nums.length > 3) return null;
    const [d, m = 0, s = 0] = nums.map(Number);
    if (m < 0 || m >= 60 || s < 0 || s >= 60) return null;
    const value = Math.abs(d) + m / 60 + s / 3600;
    return d < 0 || hemi === 'S' || hemi === 'W' ? -value : value;
  };
  // Split into two groups of numbers, each with an optional N/S/E/W before or after.
  const groups = [];
  let cur = { nums: [], hemi: null };
  const close = () => {
    if (cur.nums.length) groups.push(cur);
    cur = { nums: [], hemi: null };
  };
  for (const tok of clean.match(/-?\d+(?:\.\d+)?|[NSEW]|,|;/g) ?? []) {
    if (tok === ',' || tok === ';') close();
    else if (/[NSEW]/.test(tok)) {
      // A letter after numbers ends their group, unless the group already
      // had its letter in front ("N 6.31 W 10.81"): then it starts the next one.
      if (cur.nums.length && !cur.hemi) {
        cur.hemi = tok;
        close();
      } else {
        close();
        cur.hemi = tok;
      }
    } else cur.nums.push(tok);
  }
  close();
  // Without separators or letters, split the numbers evenly: "6 18.63 10 48.44".
  // With a degree sign, "6°18.6" is a half-typed latitude, not two positions.
  const evenSplits = /[°º]/.test(text) ? [4, 6] : [2, 4, 6];
  if (groups.length === 1 && evenSplits.includes(groups[0].nums.length) && !groups[0].hemi) {
    const n = groups[0].nums;
    groups.splice(0, 1, { nums: n.slice(0, n.length / 2), hemi: null }, { nums: n.slice(n.length / 2), hemi: null });
  }
  if (groups.length !== 2) return null;
  let [a, b] = groups;
  if (a.hemi === 'E' || a.hemi === 'W' || b.hemi === 'N' || b.hemi === 'S') [a, b] = [b, a];
  const lat = toDegrees(a.nums, a.hemi);
  const lng = toDegrees(b.nums, b.hemi);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

function spotMap(c) {
  if (c.lat == null) return '';
  const d = 0.08;
  const bbox = [c.lng - d, c.lat - d, c.lng + d, c.lat + d].join(',');
  return html`<div class="spot-map">
    <iframe title="Where it was caught" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${c.lat},${c.lng}"></iframe>
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
  const photo = c.photoUrl
    ? html`<img class="catch-photo" src="${c.photoUrl}" alt="${c.species} caught by ${c.angler}" loading="lazy">`
    : `<div class="catch-photo placeholder" aria-hidden="true">${MARLIN}</div>`;
  const details = [c.location, c.country].filter(Boolean).join(', ');
  return html`<article class="card" data-id="${c.id}">
    ${c.videoUrl || c.photos?.length > 1 ? raw(mediaHtml(c, `${c.species} caught by ${c.angler}`)) : full ? raw(photo) : raw(`<a href="#/catch/${c.id}">${photo}</a>`)}
    <div class="pad">
      <div class="catch-head">
        <h3 class="catch-title"><a href="#/catch/${c.id}">${c.species}</a></h3>
        <span class="weight">${fmtWeight(c.weightKg)}</span>
      </div>
      <p class="meta">
        <a href="${anglerHref(c.userId, c.angler)}">${c.angler}</a>
        ${c.teamName ? raw(html` · <a href="#/boat/${c.teamId}">${c.teamName}</a>`) : ''}
        ${c.clubName ? raw(html` · <a href="#/club/${c.clubId}">${c.clubName}</a>`) : ''}
        · ${fmtDate(c.caughtOn)}${details ? ' · ' + details : ''}
      </p>
      <div class="badges">
        ${raw(statusBadge(c))}
        ${c.released ? raw('<span class="badge release">Released</span>') : ''}
        ${c.tagged ? raw('<span class="badge release">Tagged</span>') : ''}
        ${c.lengthCm ? raw(html`<span class="badge">${c.lengthCm} cm</span>`) : ''}
        ${c.lineClass ? raw(html`<span class="badge">${c.lineClass} line</span>`) : ''}
      </div>
      ${full && c.weightKg && c.worldRecordKg ? raw(html`<p class="small muted">${Math.round((c.weightKg / c.worldRecordKg) * 100)}% of the IGFA all-tackle world record (${Math.round(c.worldRecordKg)} kg). <a href="#/records">See records</a></p>`) : ''}
      ${full && c.notes ? raw(html`<p class="notes">${c.notes}</p>`) : ''}
      ${full ? raw(spotMap(c)) : ''}
      ${full && (c.weighStation || c.pointsNote || c.scalePhotoUrl || c.scaleVideoUrl) ? raw(html`<div class="official">
        ${c.weighStation ? raw(html`<p>Weighed at <b>${c.weighStation}</b>${c.weightKg ? ` · ${fmtWeight(c.weightKg)}` : ''}</p>`) : ''}
        ${c.pointsNote && c.status !== 'pending_weigh' ? raw(html`<p>${c.status === 'rejected' ? 'Secretary: ' : ''}${c.pointsNote}</p>`) : ''}
        ${c.scalePhotoUrl ? raw(html`<a href="${c.scalePhotoUrl}" target="_blank" rel="noopener"><img class="scale-photo" src="${c.scalePhotoUrl}" alt="Fish on the scale" loading="lazy"></a>`) : ''}
        ${c.scaleVideoUrl ? raw(html`<video class="scale-photo" src="${c.scaleVideoUrl}" controls playsinline preload="metadata"></video>`) : ''}
      </div>`) : ''}
      <div class="actions">
        <button data-act="like" class="${c.liked ? 'liked' : ''}" aria-pressed="${c.liked}" aria-label="Like">${raw(icon('heart'))} <span>${c.likes}</span></button>
        <a class="btn" href="#/catch/${c.id}" aria-label="Comments">${raw(icon('comment'))} ${c.comments}</a>
        <button data-act="share">Share</button>
        <a class="btn" href="${whatsapp(`${shareText(c)} ${location.origin}/#/catch/${c.id}`)}" target="_blank" rel="noopener">WhatsApp</a>
        ${full && c.canEdit ? raw(html`<a class="btn" href="#/edit/${c.id}">${raw(icon('edit'))} Edit</a>`) : ''}
        ${full && c.canDelete ? raw('<button data-act="delete" class="danger">Delete</button>') : ''}
      </div>
    </div>
  </article>`;
}

// byId maps catch id (string) to catch; callers may keep adding to it.
function wireCards(root, byId) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const c = byId.get(btn.closest('[data-id]').dataset.id);
    if (btn.dataset.act === 'share') return shareCatch(c);
    if (btn.dataset.act === 'like' && !state.me) return askToSignIn('Sign in to like catches.');
    if (btn.dataset.act === 'like') {
      try {
        const r = await api(`/catches/${c.id}/like`, { method: 'POST' });
        c.liked = r.liked;
        c.likes = r.likes;
        btn.classList.toggle('liked', r.liked);
        btn.setAttribute('aria-pressed', r.liked);
        btn.querySelector('span').textContent = r.likes;
      } catch (ex) {
        toast(ex.message);
      }
    }
    if (btn.dataset.act === 'delete' && confirm('Delete this catch? This cannot be undone.')) {
      try {
        await api(`/catches/${c.id}`, { method: 'DELETE' });
        toast('Catch deleted');
        location.hash = '#/';
      } catch (ex) {
        toast(ex.message);
      }
    }
  });
}

// A paginated feed of catches with optional fixed filters.
async function renderFeed(container, query = {}) {
  let before = null;
  const list = document.createElement('div');
  list.className = 'feed';
  const more = document.createElement('button');
  more.textContent = 'Load more';
  more.className = 'more';
  more.hidden = true;
  container.replaceChildren(list, more);
  const all = new Map();
  wireCards(list, all);

  async function page() {
    const params = new URLSearchParams(Object.entries({ ...query, before: before ?? '' }).filter(([, v]) => v !== '' && v != null));
    const { catches, nextBefore } = await api('/catches?' + params);
    for (const c of catches) all.set(String(c.id), c);
    list.insertAdjacentHTML('beforeend', catches.map((c) => catchCard(c)).join(''));
    before = nextBefore;
    more.hidden = !nextBefore;
    if (!all.size) list.innerHTML = '<div class="card empty">No catches here yet.</div>';
  }
  more.addEventListener('click', page);
  await page();
}

// ---- the JHMMC feed (members only) -----------------------------------------

// Which feed a JHMMC member last chose ('club' or 'wa'); kept on this phone only.
const FEED_KEY = 'jhmmc-feed';
const feedPref = () => {
  try {
    return localStorage.getItem(FEED_KEY) === 'wa' ? 'wa' : 'club';
  } catch {
    return 'club';
  }
};
const setFeedPref = (which) => {
  try {
    localStorage.setItem(FEED_KEY, which);
  } catch {
    // Private browsing: the choice just isn't remembered.
  }
};
const FEED_NAMES = { club: 'JHMMC', wa: 'West Africa' };
// On the JHMMC side, a small JHMMC tag sits in the header on every page.
const syncClubChip = () => {
  document.getElementById('club-chip').hidden = !(state.me?.jhmmc && feedPref() === 'club');
};

// The club feed's filters, as they appear in the address (#/?show=verified&boat=3).
const CLUB_FILTERS = ['show', 'boat'];
const CLUB_SHOW = [['verified', 'Approved catches'], ['fish', 'All fish'], ['photos', 'Photos'], ['posts', "Members' posts"]];

function clubComment(postId, m) {
  return html`<div class="comment" data-cid="${m.id}">
    <a href="#/user/${m.userId}"><b>${m.author}</b></a> ${m.body}
    ${m.canDelete ? raw('<button type="button" data-act="del-comment" class="link danger small">Remove</button>') : ''}</div>`;
}

function clubItem(i) {
  const photo = mediaHtml(i);
  if (i.kind === 'verified') {
    return html`<article class="card club-item verified">
      ${i.videoUrl ? raw(photo) : i.photoUrl ? raw(html`<a href="#/catch/${i.id}">${raw(photo)}</a>`) : ''}
      <div class="pad">
        <p class="club-who"><span class="badge status ok">${raw(icon('check', 'icon tiny'))} Verified</span> <span class="muted small">${fmtWhen(i.createdAt)}</span></p>
        <h3 class="catch-title"><a href="#/catch/${i.id}">${i.species}</a>${i.released ? ' released' : ''}
          ${i.weightKg ? raw(html` <span class="weight">${fmtWeight(i.weightKg)}</span>`) : ''}</h3>
        <p class="meta"><a href="${anglerHref(i.userId, i.angler)}">${i.angler}</a>${i.teamName ? raw(html` · <a href="#/boat/${i.teamId}">${i.teamName}</a>`) : ''}
          · <b>${fmtPoints(i.points)}</b></p>
        <div class="actions"><a class="btn" href="#/catch/${i.id}">${raw(icon('heart'))} ${i.likes} · ${raw(icon('comment'))} ${i.comments}</a></div>
      </div></article>`;
  }
  return html`<article class="card club-item" data-post="${i.id}">
    <div class="pad">
      <p class="club-who"><a href="#/user/${i.userId}"><b>${i.author}</b></a>${i.teamName ? raw(html` <span class="muted small">· ${i.teamName}</span>`) : ''}
        <span class="muted small">· ${fmtWhen(i.createdAt)}</span>
        ${i.canEdit ? raw(html`<a class="small edit-link" href="#/club-edit/${i.id}">Edit</a>`) : ''}
        ${i.canDelete ? raw('<button type="button" data-act="del-post" class="link danger small">Remove</button>') : ''}</p>
      ${i.body ? raw(html`<p class="club-body">${i.body}</p>`) : ''}
    </div>
    ${raw(photo)}
    <div class="pad">
      ${i.species ? raw(html`<p class="club-fish">${raw(icon('fish'))} <b>${i.species}</b>${i.weightKg ? ` · ${fmtWeight(i.weightKg)}` : ''}${i.released ? raw(' <span class="badge release">Released</span>') : ''}</p>`) : ''}
      ${i.lat != null ? raw(html`<p class="small muted club-spot">${raw(icon('pin'))} <a href="#/spots">Spot saved on your catch map</a> (only you see it)</p>`) : ''}
      <div class="actions">
        <button type="button" data-act="like" class="${i.liked ? 'liked' : ''}" aria-pressed="${i.liked}" aria-label="Like">${raw(icon('heart'))} <span>${i.likes}</span></button>
      </div>
      <div class="club-comments">${raw(i.comments.map((m) => clubComment(i.id, m)).join(''))}</div>
      <form class="club-reply"><input name="body" maxlength="1000" placeholder="Reply…" autocomplete="off" required><button type="submit">Send</button></form>
    </div></article>`;
}

async function clubFeed(view, filters = {}) {
  const boats = (await api('/teams')).teams.filter((t) => isJhmmc(t.clubId));
  const label = {
    show: (v) => CLUB_SHOW.find(([k]) => k === v)?.[1],
    boat: (v) => boats.find((t) => String(t.id) === v)?.name,
  };
  const active = CLUB_FILTERS.filter((k) => filters[k] && label[k](filters[k]));
  const without = (key) => {
    const p = new URLSearchParams(filters);
    p.delete(key);
    return `#/${p.size ? `?${p}` : ''}`;
  };
  const box = document.createElement('div');
  box.innerHTML = html`<div class="filter-bar">
      <button type="button" class="filter-toggle${active.length ? ' on' : ''}" aria-expanded="false" aria-controls="club-filter">
        ${raw(icon('filter'))} Filter${active.length ? raw(html` <span class="tab-count">${active.length}</span>`) : ''}</button>
      ${active.map((k) => raw(html`<span class="chip">${label[k](filters[k])} <a href="${without(k)}" aria-label="Remove ${label[k](filters[k])}">✕</a></span>`))}
    </div>
    <form class="card pad filter-panel stack" id="club-filter" hidden>
      <label>Show <select name="show">${raw(options(CLUB_SHOW, filters.show, 'Everything'))}</select></label>
      <label>Boat <select name="boat">${raw(options(boats.map((t) => [t.id, t.name]), filters.boat, 'All boats'))}</select></label>
      <div class="actions"><button type="submit" class="primary">Show</button> <a class="btn" href="#/">Clear all</a></div>
    </form>
    <form class="card pad stack composer" id="club-post">
      <textarea name="body" rows="2" maxlength="2000" placeholder="What's happening on the water?"></textarea>
      <div class="photo-pick">
        ${raw(MEDIA_PREVIEWS)}
        <div class="composer-tools">
          <button type="button" class="photo-cta" data-act="photo-menu" aria-expanded="false">${raw(icon('camera'))}<span>Photo / video</span></button>
          <button type="button" data-act="add-fish" aria-expanded="false">${raw(icon('fish'))} Fish</button>
        </div>
        <div class="photo-menu" hidden>${raw(MEDIA_CHOICES)}</div>
      </div>
      <div class="stack fish-fields" hidden>
        <label>Species <select name="speciesId">${raw(speciesOptions(null, 'Choose species…'))}</select></label>
        <div class="row"><label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="Optional"></label>
          <label class="check"><input type="checkbox" name="released" value="true"> Released</label></div>
        ${raw(spotFields())}
      </div>
      <label class="check share-wa"><input type="checkbox" name="shareWa" value="true"> Also post on the West Africa feed</label>
      <p class="error"></p>
      <div><button type="submit" class="primary">Post</button></div>
    </form>
    <p class="small muted center">Only JHMMC members see this feed. Fish the secretary approves appear here too.</p>
    <div class="feed" id="club-items"></div>
    <button class="more" hidden>Load more</button>`;
  view.append(...box.childNodes);
  const panel = view.querySelector('#club-filter');
  const toggle = view.querySelector('.filter-toggle');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(panel)) if (v) p.set(k, v);
    location.hash = `#/${p.size ? `?${p}` : ''}`;
  });
  const form = view.querySelector('#club-post');
  const list = view.querySelector('#club-items');
  const moreBtn = view.querySelector('button.more');
  const items = new Map();
  let before = null;

  const media = wireMediaPick(form);
  const spot = wireSpot(form);
  const fishBtn = form.querySelector('[data-act=add-fish]');
  const fishFields = form.querySelector('.fish-fields');
  // The West Africa feed is catches: ticking it brings up the fish.
  form.shareWa.addEventListener('change', () => {
    if (form.shareWa.checked && fishFields.hidden) fishBtn.click();
  });
  fishBtn.addEventListener('click', () => {
    fishFields.hidden = !fishFields.hidden;
    fishBtn.setAttribute('aria-expanded', String(!fishFields.hidden));
    if (fishFields.hidden) fishFields.querySelectorAll('select, input[type=number]').forEach((el) => { el.value = ''; });
  });

  async function page(reset) {
    if (reset) {
      before = null;
      items.clear();
      list.innerHTML = '';
    }
    const q = new URLSearchParams({ ...(filters.show && { show: filters.show }), ...(filters.boat && { team: filters.boat }), ...(before && { before }) });
    const { items: got, nextBefore } = await api(`/club-feed${q.size ? `?${q}` : ''}`);
    for (const i of got) if (i.kind === 'post') items.set(String(i.id), i);
    list.insertAdjacentHTML('beforeend', got.map(clubItem).join(''));
    before = nextBefore;
    moreBtn.hidden = !nextBefore;
    if (!list.children.length) {
      list.innerHTML = active.length ? '<div class="card pad empty">Nothing matches these filters yet.</div>'
        : '<div class="card pad empty">Nothing yet today. Say hello to the club!</div>';
    }
  }
  moreBtn.addEventListener('click', () => page());

  bindForm(form, async () => {
    const fd = new FormData(form);
    if (fishFields.hidden) ['speciesId', 'weightKg', 'released', 'lat', 'lng'].forEach((k) => fd.delete(k));
    fd.delete('coords');
    if (form.shareWa.checked && !fd.get('speciesId')) throw new Error('Choose the species to post it on the West Africa feed.');
    if (!fd.get('body')?.trim() && !media.picked.photo && !media.picked.video && !fd.get('speciesId')) {
      throw new Error('Write something, add a photo, a video or a fish.');
    }
    const btn = form.querySelector('button[type=submit]');
    btn.textContent = 'Posting…';
    try {
      const { catchId } = await api('/club-feed', { method: 'POST', form: await media.addTo(fd) });
      if (catchId) toast('Posted here and on the West Africa feed.');
    } finally {
      btn.textContent = 'Post';
    }
    form.reset();
    media.reset();
    spot.reset();
    fishFields.hidden = true;
    fishBtn.setAttribute('aria-expanded', 'false');
    await page(true);
  });

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    const card = btn?.closest('[data-post]');
    if (!card) return;
    const id = card.dataset.post;
    try {
      if (btn.dataset.act === 'like') {
        const r = await api(`/club-feed/${id}/like`, { method: 'POST' });
        btn.classList.toggle('liked', r.liked);
        btn.setAttribute('aria-pressed', r.liked);
        btn.querySelector('span').textContent = r.likes;
      } else if (btn.dataset.act === 'del-post' && confirm('Remove this post?')) {
        await api(`/club-feed/${id}`, { method: 'DELETE' });
        card.remove();
      } else if (btn.dataset.act === 'del-comment' && confirm('Remove this comment?')) {
        const row = btn.closest('[data-cid]');
        await api(`/club-feed/${id}/comments/${row.dataset.cid}`, { method: 'DELETE' });
        row.remove();
      }
    } catch (ex) {
      toast(ex.message);
    }
  });
  list.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reply = e.target;
    const card = reply.closest('[data-post]');
    try {
      const { comment } = await api(`/club-feed/${card.dataset.post}/comments`, { method: 'POST', body: formData(reply) });
      card.querySelector('.club-comments').insertAdjacentHTML('beforeend', clubComment(card.dataset.post, comment));
      reply.reset();
    } catch (ex) {
      toast(ex.message);
    }
  });
  await page(true);
}

// Sends a visitor to sign in, then back to where they were.
function askToSignIn(msg = 'Sign in to do that.') {
  state.afterLogin = location.hash;
  toast(msg);
  location.hash = '#/login';
}

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

const HERO = `<section class="hero">
  <h1>Every big fish in West Africa, in one place</h1>
  <p>Follow the boats and anglers, see every catch, and check the leaderboard. Crews sign in to log their catches.</p>
  <a class="btn primary" href="#/register">Create an account</a> <a class="btn ghost-light" href="#/login">Sign in</a>
</section>`;

// Shown to anglers who are signed in but not on a boat, and to visitors.
function noBoatBanner() {
  if (!state.me) return HERO;
  return state.me.teamId ? '' : `<div class="card pad banner">
    <div><b>You're browsing as an individual angler.</b><br><span class="muted small">You can follow the feed, like and comment. To post catches, join a boat's crew or register your boat.</span></div>
    <a class="btn primary" href="#/crew">Get on a boat</a>
  </div>`;
}

const boardTabs = (active) => `<div class="seg three" role="tablist">
  <a role="tab" href="#/points" aria-selected="${active === 'points'}">Points</a>
  <a role="tab" href="#/leaderboard" aria-selected="${active === 'leaderboard'}">Leaderboard</a>
  <a role="tab" href="#/records" aria-selected="${active === 'records'}">Records</a>
</div>`;

// Ocean / River switch for the points pages, keeping the rest of the address.
const divisionTabs = (base, division) => `<div class="seg" role="tablist">
  ${DIVISIONS.map(([key, label]) => `<a role="tab" href="${base}${base.includes('?') ? '&' : '?'}division=${key}" aria-selected="${division === key}">${label}</a>`).join('')}
</div>`;

const fmtDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
// A tournament's days: "Sat, 14 Nov 2026" or "Sat, 14 Nov 2026 to Sun, 15 Nov 2026".
const fmtDays = (ev) => (ev.endDate && ev.endDate !== ev.date ? `${fmtDay(ev.date)} to ${fmtDay(ev.endDate)}` : fmtDay(ev.date));

// Points form for a catch waiting for the secretary.
function reviewForm(c) {
  return html`<form class="review" data-id="${c.id}">
    <p class="small"><b>Rules give ${fmtPoints(c.suggested.points)}</b> · ${c.suggested.note}
      ${c.events.length ? ` · ${c.events.map((e) => e.name).join(', ')}` : ''}</p>
    <div class="row">
      <label>Points <input name="points" type="number" step="0.1" value="${c.suggested.points}"></label>
      <label>Note <input name="note" maxlength="300" placeholder="Needed if you change the points or reject"></label>
    </div>
    <div class="actions"><button class="primary" name="decision" value="approve">Approve</button><button class="danger" name="decision" value="reject">Reject</button></div>
    <p class="error"></p>
  </form>`;
}

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => ({
  async home() {
    const filters = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    // JHMMC members have two feeds: the club's own (members only) and West Africa's.
    const member = !!state.me?.jhmmc;
    const { feed: which, ...rest } = filters;
    if (member && FEED_NAMES[which]) {
      setFeedPref(which);
      syncClubChip();
    }
    const club = member && (FEED_NAMES[which] ? which === 'club' : feedPref() === 'club')
      && Object.keys(rest).every((k) => CLUB_FILTERS.includes(k));
    if (club) {
      return clubFeed(view, rest);
    }
    delete filters.feed;
    const [clubs, { teams }] = await Promise.all([loadClubs(), api('/teams')]);
    // The filters in use, as chips that each remove one.
    const nameOf = {
      species: (v) => state.meta.species.find((x) => String(x.id) === v)?.name,
      team: (v) => teams.find((t) => String(t.id) === v)?.name,
      club: (v) => clubs.find((c) => String(c.id) === v)?.name,
      country: (v) => v,
      released: () => 'Released only',
    };
    const active = Object.keys(nameOf).filter((k) => filters[k]).map((k) => [k, nameOf[k](filters[k]) || filters[k]]);
    const without = (key) => {
      const p = new URLSearchParams(filters);
      p.delete(key);
      if (member) p.set('feed', 'wa');
      return `#/${p.size ? `?${p}` : ''}`;
    };
    view.innerHTML = html`
      ${raw(noBoatBanner())}
      <div class="filter-bar">
        <button type="button" class="filter-toggle${active.length ? ' on' : ''}" aria-expanded="false" aria-controls="filter-panel">
          ${raw(icon('filter'))} Filter${active.length ? raw(html` <span class="tab-count">${active.length}</span>`) : ''}</button>
        ${active.map(([key, label]) => raw(html`<span class="chip">${label} <a href="${without(key)}" aria-label="Remove ${label}">✕</a></span>`))}
      </div>
      <form class="card pad filter-panel stack" id="filter-panel" hidden>
        <label>Species <select name="species">${raw(speciesOptions(filters.species, 'All species'))}</select></label>
        <label>Boat <select name="team">${raw(options(teams.map((t) => [t.id, t.name]), filters.team, 'All boats'))}</select></label>
        <label>Club <select name="club">${raw(options(clubs.map((c) => [c.id, c.name]), filters.club, 'All clubs'))}</select></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, filters.country, 'All countries'))}</select></label>
        <label>Kept or released <select name="released">${raw(options([['true', 'Released only']], filters.released, 'Kept & released'))}</select></label>
        <div class="actions"><button type="submit" class="primary">Show catches</button> <button type="button" data-act="clear-filters">Clear all</button></div>
      </form>
      ${filters.angler ? raw(html`<p><span class="chip">Catches by ${filters.angler} <a href="#/" aria-label="Show everyone">✕</a></span></p>`) : ''}
      <div id="feed"></div>`;
    // All the filters sit behind one Filter button; they apply together.
    const panel = view.querySelector('#filter-panel');
    const toggle = view.querySelector('.filter-toggle');
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    panel.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = new URLSearchParams(filters.angler ? { angler: filters.angler } : {});
      if (member) p.set('feed', 'wa');
      for (const [k, v] of new FormData(panel)) if (v) p.set(k, v);
      location.hash = '#/?' + p;
    });
    panel.querySelector('[data-act=clear-filters]').addEventListener('click', () => {
      location.hash = filters.angler ? '#/?' + new URLSearchParams({ angler: filters.angler }) : member ? '#/?feed=wa' : '#/';
    });
    await renderFeed(view.querySelector('#feed'), filters);
  },

  async catch(id) {
    const { catch: c, comments } = await api(`/catches/${id}`);
    // The secretary and admin see a registration's record on its page.
    const record = c.status !== 'unofficial' && state.me?.canReview ? (await api(`/registrations/log?catch=${c.id}`)).fish : null;
    view.innerHTML = html`
      <div class="feed">${raw(catchCard(c, { full: true }))}</div>
      ${record ? raw(html`<h2>Registration history</h2><div class="card"><ul class="list log">${raw(logItems(record))}</ul></div>`) : ''}
      <h2>Comments</h2>
      <div class="card pad">
        ${comments.length ? comments.map((m) => raw(html`<div class="comment" data-cid="${m.id}">
          <a href="#/user/${m.userId}"><b>${m.author}</b></a> <span class="muted small">${fmtDate(m.createdAt)}</span>
          ${state.me && (m.userId === state.me.id || state.me.isAdmin) ? raw('<button data-act="delete-comment" class="link danger">Remove</button>') : ''}
          <div>${m.body}</div></div>`)) : raw('<p class="muted">No comments yet.</p>')}
        ${state.me ? raw(`<form class="stack" id="comment">
          <textarea name="body" required maxlength="1000" placeholder="Congratulate the angler…"></textarea>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post comment</button></div>
        </form>`) : raw('<p><a href="#/login" data-return>Sign in</a> to comment.</p>')}
      </div>`;
    wireCards(view.querySelector('.feed'), new Map([[String(c.id), c]]));
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act=delete-comment]');
      if (!btn || !confirm('Remove this comment?')) return;
      try {
        await api(`/catches/${id}/comments/${btn.closest('[data-cid]').dataset.cid}`, { method: 'DELETE' });
        route();
      } catch (ex) {
        toast(ex.message);
      }
    });
    const form = view.querySelector('#comment');
    if (form) bindForm(form, async () => {
      await api(`/catches/${id}/comments`, { method: 'POST', body: formData(form) });
      route();
    });
  },

  async new() {
    if (!state.me) return needLogin(view, 'post a catch');
    if (!state.me.teamId) {
      view.innerHTML = html`<h1>Post a catch</h1>${raw(noBoatBanner())}`;
      return;
    }
    const { team } = await api(`/teams/${state.me.teamId}`);
    const jhmmc = isJhmmc(team.clubId);
    const crew = team.members;
    const fishFields = html`<div class="row">
          <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="optional"></label>
          <label>Length (cm) <input name="lengthCm" type="number" step="1" min="0" inputmode="numeric" placeholder="optional"></label>
        </div>
        <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, null, 'Not recorded'))}</select></label>
        <div class="row">
          <label class="check"><input type="checkbox" name="released"> Released alive</label>
          <label class="check"><input type="checkbox" name="tagged"> Tagged</label>
        </div>`;
    view.innerHTML = html`<h1>Post a catch</h1>
      <p class="muted">For <b>${team.name}</b>${team.clubName ? ` · ${team.clubName}` : ''}.
        This goes on the West Africa feed. A photo or video and the species are enough; add the weight and details to show it off.
        ${jhmmc ? 'For JHMMC points the captain still registers the fish at the weigh station.' : ''}</p>
      <form class="card pad stack" id="f">
        <div class="photo-pick">
          ${raw(MEDIA_PREVIEWS)}
          <button type="button" class="photo-cta" data-act="photo-menu" aria-expanded="false">${raw(icon('camera'))}<span>Add a photo or video</span></button>
          <div class="photo-menu" hidden>${raw(MEDIA_CHOICES)}</div>
        </div>
        <label>Species <select name="speciesId" required>${raw(speciesOptions(null, 'Choose species…'))}</select></label>
        <label>Angler <select name="anglerId">${raw(options([...crew.map((m) => [m.id, m.id === state.me.id ? `${m.name} (me)` : m.name]), ['other', 'Guest (type a name)']], state.me.id))}</select></label>
        <label id="angler-name" hidden>Angler's name <input name="anglerName" maxlength="80" autocomplete="off" placeholder="e.g. a guest or visiting angler"></label>
        ${raw(fishFields)}
        <label>Caption <textarea name="notes" maxlength="2000" rows="2" placeholder="Fish on! Lure, crew, conditions…"></textarea></label>
        <div class="stack spot">
          <label>Where <span class="muted small">(optional)</span><input name="location" maxlength="120" placeholder="e.g. Banana Islands, off Mesurado"></label>
          <div class="spot-row">
            <button type="button" id="locate">${raw(icon('locate'))} Use my location</button>
            <span class="small muted">or type the coordinates</span>
          </div>
          <label class="sr-only" for="coords">Coordinates</label>
          <input id="coords" name="coords" autocomplete="off" inputmode="text" placeholder="e.g. 6°18.63'N 10°48.44'W or 6.3105, -10.8074">
          <span class="small muted" id="spot-status"></span>
          <input type="hidden" name="lat"><input type="hidden" name="lng">
          <label class="check" id="spot-share" hidden><input type="checkbox" name="spotPublic"> Show the exact spot to everyone (otherwise only your crew sees it)</label>
        </div>
        <div class="row">
          <label>Date <span class="muted small">(today if empty)</span><input name="caughtOn" type="date" max="${today()}"></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, team.country || state.me.country, 'Choose…'))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Post</button></div>
      </form>`;
    const form = view.querySelector('#f');
    const nameBox = view.querySelector('#angler-name');
    form.anglerId.addEventListener('change', () => {
      nameBox.hidden = form.anglerId.value !== 'other';
      form.anglerName.required = !nameBox.hidden;
      if (!nameBox.hidden) form.anglerName.focus();
    });
    // Phone GPS works at sea without signal; the post uploads when there's a connection.
    view.querySelector('#locate').addEventListener('click', () => {
      const status = view.querySelector('#spot-status');
      if (!navigator.geolocation) {
        status.textContent = 'This phone or browser can\'t share its location.';
        return;
      }
      status.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition((pos) => {
        form.lat.value = pos.coords.latitude.toFixed(5);
        form.lng.value = pos.coords.longitude.toFixed(5);
        form.coords.value = `${form.lat.value}, ${form.lng.value}`;
        status.textContent = `${fmtCoords(pos.coords.latitude, pos.coords.longitude)} (±${Math.round(pos.coords.accuracy)} m)`;
        view.querySelector('#spot-share').hidden = false;
      }, (err) => {
        status.textContent = err.code === 1
          ? 'Location is blocked. Allow it for this site in your phone settings, or type the place instead.'
          : 'Couldn\'t get a GPS fix. Try again in the open, or type the place instead.';
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
    // Typed coordinates: read them as you type and say what was understood.
    form.coords.addEventListener('input', () => {
      const status = view.querySelector('#spot-status');
      const text = form.coords.value.trim();
      const spot = text ? parseCoords(text) : null;
      form.lat.value = spot ? spot.lat : '';
      form.lng.value = spot ? spot.lng : '';
      view.querySelector('#spot-share').hidden = !spot;
      status.textContent = !text ? '' : spot ? `Reads as ${fmtCoords(spot.lat, spot.lng)}` : "Can't read those coordinates yet. Use N/S and E/W, or a comma between the two.";
    });
    const media = wireMediaPick(form);
    bindForm(form, async () => {
      const btn = form.querySelector('button[type=submit]');
      btn.textContent = 'Posting…';
      try {
        const fd = await media.addTo(new FormData(form));
        const { catch: c } = await api('/catches', { method: 'POST', form: fd });
        toast('Posted. Tight lines!');
        location.hash = `#/catch/${c.id}`;
      } finally {
        btn.textContent = 'Post';
      }
    });
  },

  // Join a crew with a code, register a boat, or carry on as an individual.
  async crew() {
    if (!state.me) return needLogin(view, 'join or register a boat');
    if (state.me.teamId) {
      location.hash = `#/boat/${state.me.teamId}`;
      return;
    }
    const clubs = await loadClubs(true);
    view.innerHTML = html`<h1>Get on a boat</h1>
      <p class="muted">Catches are logged by boat crews. Join your boat with the invite code from your captain, or register your boat and become its captain.</p>
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
            <label class="homeport-field">Home port <input name="homePort" maxlength="80" placeholder="e.g. Dakar"></label>
            <label class="station-field" hidden>Home port (weigh station) <select name="weighStation">${raw(options(state.meta.weighStations, null, 'Choose…'))}</select></label>
            <label>Country <select name="country">${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
          </div>
          <div class="row">
            <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), null, 'No club'))}</select></label>
            <label class="division-field" hidden>Registered for <select name="division">${raw(options(DIVISIONS, 'ocean'))}</select></label>
          </div>
          <p class="error"></p>
          <div><button type="submit" class="primary">Register boat</button></div>
        </form>
      </div>
      <p class="small muted">Club not listed? <a href="#/clubs">Register it</a> first. No boat? <a href="#/">Continue to the feed</a>; you can join a crew any time.</p>`;
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
    const inviteMsg = `Join our boat ${team.name} on the West Africa Big Game app: sign up at ${location.origin} then enter invite code ${team.joinCode}`;
    const spec = [team.lengthFt ? `${+team.lengthFt}'` : '', team.make].filter(Boolean).join(' ');
    const division = isJhmmc(team.clubId) ? (team.division === 'river' ? 'River boat' : 'Ocean boat') : '';
    const station = isJhmmc(team.clubId) && team.weighStation ? `Weighs at ${team.weighStation}` : '';
    const facts = [division, station, spec, isJhmmc(team.clubId) ? '' : team.homePort, team.country].filter(Boolean).join(' · ');
    view.innerHTML = html`${team.photoUrl ? raw(html`<img class="cover" src="${team.photoUrl}" alt="${team.name}">`) : ''}
      <h1>${team.name}</h1>
      <p class="muted">${facts}${team.clubName ? raw(html`${facts ? ' · ' : ''}<a href="#/club/${team.clubId}">${team.clubName}</a>`) : ''}</p>
      ${team.isMember || team.canManage ? raw(html`<div class="card pad invite">
        <div><div class="muted small">Crew invite code</div><div class="code">${team.joinCode}</div></div>
        <div class="actions">
          <button data-act="copy-code">Copy code</button>
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(inviteMsg)}">Invite on WhatsApp</a>
          ${team.canManage ? raw('<button data-act="new-code">New code</button>') : ''}
        </div>
      </div>`) : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
      </div>
      <h2>Crew (${team.members.length})</h2>
      <div class="card"><ul class="list">${team.members.map((m) => raw(html`<li class="member" data-uid="${m.id}">
        <span><a href="#/user/${m.id}">${m.name}</a> ${m.id === team.captainId ? raw('<span class="badge">Captain</span>') : ''}
          <span class="muted small">· ${plural(m.catches, 'catch')}</span></span>
        ${team.canManage && m.id !== state.me.id ? raw(`<span class="actions"><button data-act="make-captain">Make captain</button><button data-act="remove" class="danger">Remove</button></span>`) : ''}
      </li>`))}${team.members.length ? '' : raw('<li class="muted">No crew yet.</li>')}</ul></div>
      ${team.canManage && team.guests.length ? raw(html`<h2>Guest anglers</h2>
      <p class="small muted">Catches logged under a typed name. If one of them joins the crew, move their catches to their account.</p>
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
        <label>Boat photo <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <div class="row">
          <label class="homeport-field" ${isJhmmc(team.clubId) ? 'hidden' : ''}>Home port <input name="homePort" maxlength="80" value="${team.homePort || ''}"></label>
          <label class="station-field" ${isJhmmc(team.clubId) ? '' : 'hidden'}>Home port (weigh station) <select name="weighStation">${raw(options(state.meta.weighStations, team.weighStation, 'Choose…'))}</select></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, team.country, 'Choose…'))}</select></label>
        </div>
        <div class="row">
          <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), team.clubId, 'No club'))}</select></label>
          <label class="division-field" ${isJhmmc(team.clubId) ? '' : 'hidden'}>Registered for <select name="division">${raw(options(DIVISIONS, team.division))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>`) : ''}
      ${team.isMember ? raw('<p><button data-act="leave" class="danger">Leave this boat</button></p>') : ''}
      ${isJhmmc(team.clubId) ? raw(html`<h2>JHMMC registrations</h2>
      <p class="small muted">Fish the captain registered at the weigh station for JHMMC points.</p>
      <div class="card"><ul class="list" id="regs"><li class="muted">Loading…</li></ul></div>`) : ''}
      <h2>Posts</h2>
      <div id="feed"></div>`;
    if (isJhmmc(team.clubId)) {
      api(`/catches?team=${team.id}&official=1&limit=50`).then(({ catches }) => {
        view.querySelector('#regs').innerHTML = catches.length ? catches.map((c) => html`<li>
          <a href="#/catch/${c.id}"><b>${c.species}</b></a> · ${c.angler} ${raw(statusBadge(c))}
          <div class="muted small">${fmtDay(c.caughtOn)} · ${c.released ? 'released' : fmtWeight(c.weightKg)}</div></li>`).join('')
          : '<li class="muted">No registrations yet.</li>';
      }).catch(() => {});
    }

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
    await renderFeed(view.querySelector('#feed'), { team: team.id });
  },

  async clubs() {
    const clubs = await loadClubs(true);
    view.innerHTML = html`<h1>Clubs</h1>
      <div class="card"><ul class="list">
        ${clubs.length ? clubs.map((c) => raw(html`<li>
          <a href="#/club/${c.id}"><b>${c.name}</b></a>
          <div class="muted small">${[c.city, c.country].filter(Boolean).join(', ')} · ${plural(c.teams, 'boat')} · ${plural(c.catches, 'catch')}</div>
        </li>`)) : raw('<li class="muted">No clubs yet — register yours below.</li>')}
      </ul></div>
      <h2>Register a club</h2>
      ${state.me ? raw(html`<form class="card pad stack" id="f">
        <label>Club name <input name="name" required maxlength="100"></label>
        <div class="row">
          <label>Country <select name="country" required>${raw(options(state.meta.countries, state.me?.country, 'Choose…'))}</select></label>
          <label>Town / harbour <input name="city" maxlength="80"></label>
        </div>
        <label>About <textarea name="description" maxlength="1000"></textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create club</button></div>
      </form>`) : raw('<p><a href="#/login" data-return>Sign in</a> to register a club.</p>')}`;
    const form = view.querySelector('#f');
    if (form) bindForm(form, async () => {
      const { club } = await api('/clubs', { method: 'POST', body: formData(form) });
      state.clubs = null;
      location.hash = `#/club/${club.id}`;
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
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
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

  // Official JHMMC standings from approved catches.
  async points() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const division = q.get('division') === 'river' ? 'river' : 'ocean';
    // Two trophies: overall points (every day) and tournament points only.
    const scope = q.get('scope') === 'tournaments' ? 'tournaments' : 'overall';
    const { boats, anglers, tournaments, season, pending } = await api(`/points?division=${division}&scope=${scope}`);
    const empty = (cols, text) => raw(`<tr><td colspan="${cols}" class="muted">${text}</td></tr>`);
    const scopeTab = (key, label) => html`<a role="tab" href="#/points?scope=${key}&division=${division}" aria-selected="${scope === key}">${label}</a>`;
    view.innerHTML = html`${raw(boardTabs('points'))}
      <div class="seg scope" role="tablist">${raw(scopeTab('overall', 'Overall'))}${raw(scopeTab('tournaments', 'Tournaments'))}</div>
      ${raw(divisionTabs(`#/points?scope=${scope}`, division))}
      <p class="small muted">${scope === 'tournaments'
        ? `Tournament trophy: points from fish caught during the season's tournaments only, all tournaments added up.`
        : `Overall trophy: points from every fishing day of the JHMMC season, ${fmtDay(season.start)} to ${fmtDay(season.end)}.`}
        Fish registered by captains at the weigh station and approved by the secretary.
        ${pending ? `${plural(pending, 'registration')} waiting for the secretary.` : ''} <a href="#/scoring">How points work</a></p>
      ${boats.length ? raw(html`<h2>${scope === 'tournaments' ? 'Tournament points by boat' : 'Overall points by boat'}</h2>
      <section class="card pad bars" aria-label="${scope === 'tournaments' ? 'Tournament' : 'Overall'} points for the top ${Math.min(boats.length, TOP_BARS)} ${division} boats">${raw(pointsBars(boats.slice(0, TOP_BARS)))}</section>`) : ''}
      <h2>Boats</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Boat</th><th class="num">Fish</th><th class="num">Points</th></tr></thead>
        <tbody>${boats.length ? boats.map((b, i) => raw(html`<tr><td>${i + 1}</td><td><a href="#/boat/${b.teamId}">${b.teamName}</a></td>
          <td class="num">${b.catches}</td><td class="num"><b>${b.points}</b></td></tr>`)) : empty(4, scope === 'tournaments' ? 'No approved tournament fish yet this season.' : 'No approved catches yet this season.')}</tbody>
      </table></div>
      <h2>Tournaments</h2>
      <div class="card"><ul class="list">${tournaments.length ? tournaments.map((t) => raw(html`<li>
        <a href="#/tournament/${t.id}?division=${division}"><b>${t.name}</b></a>
        <div class="muted small">${fmtDays(t)}${t.winner ? ` · Winner: ${t.winner.teamName}, ${t.winner.points} pts` : ' · No approved results yet'}</div>
      </li>`)) : raw('<li class="muted">No tournaments on the calendar yet.</li>')}</ul></div>
      <h2>Anglers</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Angler</th><th class="num">Fish</th><th class="num">Points</th></tr></thead>
        <tbody>${anglers.length ? anglers.map((a, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="${anglerHref(a.userId, a.angler)}">${a.angler}</a><div class="muted small">${a.teamName}</div></td>
          <td class="num">${a.catches}</td><td class="num">${a.points}</td></tr>`)) : empty(4, 'Nothing yet.')}</tbody>
      </table></div>`;
  },

  async tournament(id) {
    const division = new URLSearchParams(location.hash.split('?')[1] || '').get('division') === 'river' ? 'river' : 'ocean';
    const { tournament, results, entries: allEntries } = await api(`/tournaments/${id}?division=${division}`);
    // Each tab lists only its own division's boats.
    const entries = allEntries.filter((e) => e.division === division);
    const side = division === 'river' ? 'River' : 'Ocean';
    view.innerHTML = html`<p class="back"><a href="#/points?division=${division}">‹ Points</a></p>
      <h1>${tournament.name}</h1>
      <p class="muted">${fmtDays(tournament)}</p>
      ${raw(divisionTabs(`#/tournament/${id}`, division))}
      ${results.length ? results.map((b, i) => raw(html`<section class="card pad result">
        <div class="catch-head"><h3 class="catch-title">${i + 1}. <a href="#/boat/${b.teamId}">${b.teamName}</a></h3><span class="weight">${fmtPoints(b.points)}</span></div>
        <ul class="list compact">${b.catches.map((c) => raw(html`<li><a href="#/catch/${c.id}">${c.species}</a>
          ${c.weightKg ? ` · ${fmtWeight(c.weightKg)}` : c.released ? ' · released' : ''} · ${c.angler}<span class="num-right">${fmtPoints(c.points)}</span></li>`))}</ul>
      </section>`)) : raw(html`<div class="card pad empty">${entries.length ? 'No approved results for this tournament yet.' : 'No boats entered yet.'}</div>`)}
      <h2>${side} boats entered (${entries.length})</h2>
      <p class="small muted">Only entered boats compete. Boats fishing on these days without entering score for the season only.</p>
      ${state.me?.canHandleMoney ? raw(html`<p><a class="btn" href="#/sheet/${id}">Open the registration sheet</a></p>`) : ''}
      ${raw(html`<div class="card"><ul class="list">${entries.length ? entries.map((e) => raw(html`<li><a href="#/boat/${e.teamId}">${e.teamName}</a></li>`))
          : raw(html`<li class="muted">No ${side} boats entered yet.</li>`)}</ul></div>`)}`;
  },

  // Points per kg for each species; the secretary can edit it.
  async scoring() {
    const editable = !!state.me?.canReview;
    const meta = await api('/meta');
    state.meta = meta;
    view.innerHTML = html`<p class="back"><a href="#/points">‹ Points</a></p>
      <h1>How points work</h1>
      <div class="card pad rulebook">
        <ul>
          <li><b>Season points:</b> every fishing day scores. A captain can only register fish <b>on the day they are brought in</b>, with a photo of each fish on the scale taken there and then.</li>
          <li><b>Tournament points:</b> each tournament has its own results from its days only, with its own winner. Those fish count for the season too.</li>
          <li>Only fish <b>registered by the boat's captain</b> at the weigh station count, once the secretary approves them. Posts on the feed never count.</li>
          <li>A kept fish scores its <b>weight in kg × the points for its species</b>.</li>
          <li>A <b>released marlin scores 500</b>. A marlin under 100 kg that is kept scores <b>minus 500</b>, whatever it weighs.</li>
          <li>A <b>released sailfish</b> scores as a 25 kg sailfish.</li>
          <li>Fish under <b>2 kg (ocean)</b> or <b>1 kg (river)</b> don't count. Ocean and river boats have separate standings.</li>
        </ul>
        <p class="small muted">The secretary can change a catch's points with a note, as on the paper form.</p>
      </div>
      <h2>Points per kg</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Points per kg</th></tr></thead>
        <tbody>${meta.species.map((x) => raw(html`<tr><td>${x.name}</td><td class="num">${editable
          ? raw(html`<input class="ppk" data-id="${x.id}" type="number" min="0" max="100" step="0.5" value="${x.pointsPerKg}" aria-label="Points per kg for ${x.name}">`)
          : x.pointsPerKg}</td></tr>`))}</tbody>
      </table></div>
      ${editable ? raw('<p class="small muted">Changes save as soon as you leave a box. They apply to catches approved from now on.</p>') : ''}`;
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

  // The digital JHMMC Fish Registration Form. A captain registers their own
  // boat's fish for today; the secretary any JHMMC boat, any earlier day.
  // One boat and day, as many fish as it brought in, submitted together.
  async weigh() {
    if (!state.me?.canWeigh) return needLogin(view, 'register fish (captains of JHMMC boats)');
    const [{ toReview }, { teams }, { events }] = await Promise.all([api('/officials/queue'), api('/teams'), api('/events')]);
    // Fish on a tournament day count for the season and for that tournament.
    const onNow = events.find((e) => e.kind === 'tournament' && e.date <= today() && today() <= e.endDate);
    const official = state.me.canReview;
    // Fish count for today's tournament only if the boat is entered in it.
    const entryNote = (teamId) => (!teamId ? 'choose the boat to see if it is entered'
      : onNow.entries.includes(Number(teamId)) ? "entered: today's fish also count for this tournament"
        : 'not entered: fish count for the season only');
    const mine = official ? toReview.filter((c) => c.loggedBy === state.me.id) : toReview;
    const jhmmcBoats = teams.filter((t) => isJhmmc(t.clubId));
    // A captain's own boat, with its weigh station (its home port).
    const own = official ? null : jhmmcBoats.find((t) => t.id === state.me.teamId);
    let crew = own ? (await api(`/teams/${own.id}`)).team.members : [];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Register fish</h1>
      <p class="small muted">One boat's fish for the day, like the paper registration form. Registrations go to the secretary for points and don't appear on the feed.
        Every fish weighed needs a photo of it hanging on the scale (rule 8).</p>
      ${onNow ? raw(html`<p class="tournament-now">${raw(icon('trophy'))} <b>${onNow.name}</b> · ${fmtDays(onNow)} · <span id="entry-note">${entryNote(own?.id)}</span></p>`) : ''}
      <form class="card pad stack" id="sheet">
        <div class="row">
          ${own ? raw(html`<p class="station-fixed">Boat: <b>${own.name}</b><input type="hidden" name="teamId" value="${own.id}"></p>`)
            : raw(html`<label>Boat <select name="teamId" required>${raw(boatOptions(jhmmcBoats, null))}</select></label>`)}
          ${official
            ? raw(html`<label>Date <input name="caughtOn" type="date" required value="${today()}" max="${today()}"></label>`)
            : raw(html`<p class="station-fixed">Date: <b>${fmtDay(today())}</b> (today)<input type="hidden" name="caughtOn" value="${today()}"></p>`)}
        </div>
        ${own?.weighStation ? raw(html`<p class="station-fixed">Weigh station: <b>${own.weighStation}</b></p>`)
          : raw(html`<label>Weigh station <select name="weighStation" required>${raw(options(state.meta.weighStations, null, 'Choose…'))}</select></label>`)}
        <div id="fish-list" class="stack"></div>
        <div><button type="button" id="add-fish">+ Add a fish</button></div>
        <div class="sheet-totals" id="sheet-total">
          <div><span>Total weight</span><b id="total-weight">0 kg</b></div>
          <div><span>Total points</span><b id="total-points">0 pts</b></div>
        </div>
        ${official ? '' : raw(html`<label class="check declare"><input type="checkbox" name="declared" value="yes" required>
          <span>I declare these fish were caught today by the anglers named, under the club rules, and weighed on this station's scale.
          A false registration disqualifies the boat (<a href="#/rules?section=app-registrations">rule</a>).</span></label>`)}
        <p class="small muted location-note">${raw(icon('locate'))} Your phone's location is taken when you send, to show where the fish were registered. Allow location when the phone asks.</p>
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
    const anglerOptions = (selected) => options([...crew.map((m) => [m.id, m.name]), ['other', 'Guest (type a name)']], selected, crew.length ? 'Choose…' : 'Choose the boat first');
    const fishRow = () => html`<fieldset class="fish card pad">
      <legend><b class="fish-no"></b> <button type="button" class="link danger" data-act="remove-fish">Remove</button></legend>
      <div class="row">
        <label>Species <select name="speciesId" required>${raw(speciesOptions(null, 'Choose…'))}</select></label>
        <label>Angler <select name="anglerId" required>${raw(anglerOptions())}</select></label>
      </div>
      <label class="guest-name" hidden>Angler's name <input name="anglerName" maxlength="80" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="released"> Released (no weight; needs a video of the release)</label>
      <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal"></label>
      <div class="points-field">
        <span class="points-label">Points (automatic)</span>
        <p class="points-preview" aria-live="polite"></p>
      </div>
      <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, null, 'Not recorded'))}</select></label>
      <div class="scale-pick">
        <span class="scale-label" data-kept="On the scale: a photo, and a video if you like" data-released="Video of the release (required)">On the scale: a photo, and a video if you like</span>
        <img class="scale-preview" alt="Fish on the scale" hidden>
        <video class="scale-video-preview" controls playsinline preload="metadata" hidden></video>
        <div class="scale-buttons">
          <label class="btn scale-button">${raw(icon('camera'))} <span>Take photo</span><input type="file" accept="image/*" capture="environment" data-scale></label>
          <label class="btn scale-video-button">${raw(icon('video'))} <span>Record video</span><input type="file" accept="video/*" capture="environment" data-scale-video></label>
          <label class="btn roll-video-button">${raw(icon('upload'))} <span>From camera roll</span><input type="file" accept="video/*" data-release-video></label>
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
      const boat = jhmmcBoats.find((t) => String(t.id) === sheet.teamId.value);
      if (boat?.weighStation && sheet.weighStation) sheet.weighStation.value = boat.weighStation;
      if (onNow) view.querySelector('#entry-note').textContent = entryNote(boat?.id);
      crew = boat ? (await api(`/teams/${boat.id}`)).team.members : [];
      for (const sel of list.querySelectorAll('[name=anglerId]')) sel.innerHTML = anglerOptions(sel.value);
    });
    bindForm(sheet, async () => {
      const fd = new FormData();
      fd.set('teamId', sheet.teamId.value);
      fd.set('caughtOn', sheet.caughtOn.value);
      if (sheet.weighStation) fd.set('weighStation', sheet.weighStation.value);
      if (sheet.declared?.checked) fd.set('declared', 'yes');
      // Where the phone is: required from everyone.
      const btn = view.querySelector('#submit-sheet');
      const label = btn.textContent;
      btn.textContent = 'Getting your location…';
      const spot = await phoneSpot(15000);
      btn.textContent = label;
      if (!spot) {
        throw new Error("Your phone's location is needed to register fish. Turn on location (GPS) and allow it for this site in the browser's settings, then send again.");
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
        if (get('released').checked && !video) throw new Error(`Fish ${i + 1}: add the video of the release.`);
        if (video) fd.set(`scalevideo_${i}`, video);
      }
      fd.set('fish', JSON.stringify(fish));
      const { catches } = await api('/weigh/sheet', { method: 'POST', form: fd });
      toast(`${plural(catches.length, 'fish')} registered. Sent to the secretary.`);
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
    // Every station always shows, so the secretary sees where nothing is waiting too.
    const stations = [...state.meta.weighStations, ...(toReview.some((c) => !c.weighStation) ? [NONE] : [])];
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
      <div class="card pad notify" id="notify"></div>
      ${raw(html`<nav class="station-tabs" aria-label="Weigh stations">
        ${raw(tab('All', '#/review', toReview.length, !stations.includes(pick)))}
        ${stations.map((w) => raw(tab(w, `#/review?station=${encodeURIComponent(w)}`, count(w), pick === w)))}
      </nav>`)}
      <p class="small muted">${plural(toReview.length, 'registration')} to check. Approving gives the points shown; change them with a note if needed.</p>
      ${shown.map((w) => raw(html`<section class="station" data-station="${w}">
        <h2 class="station-head">${w} <span class="muted small" data-left>${count(w) ? plural(count(w), 'fish') : 'nothing waiting'}</span></h2>
        ${sheetsAt(w).map((g) => raw(html`<section class="sheet">
        <h3>${g.boat} <span class="muted small">· ${g.division === 'river' ? 'River' : 'Ocean'} · ${fmtDay(g.date)}</span></h3>
        ${g.catches.map((c) => raw(html`<article class="card pad review-item">
          <div class="catch-head"><h3 class="catch-title"><a href="#/catch/${c.id}">${c.species}</a></h3>
            <span class="weight">${c.weightKg ? fmtWeight(c.weightKg) : c.released ? 'Released' : ''}</span></div>
          <p class="meta">${c.angler}${c.lineClass ? ` · ${c.lineClass} line` : ''}</p>
          <div class="thumbs">
            ${c.scalePhotoUrl ? raw(html`<a href="${c.scalePhotoUrl}" target="_blank" rel="noopener"><img src="${c.scalePhotoUrl}" alt="On the scale"></a>`) : ''}
            ${c.scaleVideoUrl ? raw(html`<video src="${c.scaleVideoUrl}" controls playsinline preload="metadata"></video>`) : ''}
            ${c.photoUrl ? raw(html`<a href="${c.photoUrl}" target="_blank" rel="noopener"><img src="${c.photoUrl}" alt="Catch photo"></a>`) : ''}
            ${!c.scalePhotoUrl && !c.photoUrl ? raw('<span class="small muted">No photo</span>') : ''}
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
        await api(`/catches/${form.dataset.id}/review`, { method: 'POST', body: { ...formData(form), decision: form.dataset.decision } });
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
      <p class="small muted">Every fishing day scores. Tournaments listed here get their own results page and winner.</p>
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
      ${editable ? raw(html`<h2>Add a tournament</h2>
      <form class="card pad stack" id="event">
        <input type="hidden" name="kind" value="tournament">
        <div class="row">
          <label>First day <input name="date" type="date" required></label>
          <label>Last day <input name="endDate" type="date"></label>
        </div>
        <p class="small muted">Leave the last day empty for a one-day tournament. Fish on every day of it count towards its results.</p>
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

  async leaderboard() {
    const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const { records, teams, anglers, clubs } = await api('/leaderboard?' + new URLSearchParams(q));
    const year = new Date().getFullYear();
    const years = Array.from({ length: 6 }, (_, i) => String(year - i));
    const nothing = (cols) => raw(`<tr><td colspan="${cols}" class="muted">Nothing yet.</td></tr>`);
    view.innerHTML = html`${raw(boardTabs('leaderboard'))}
      <div class="filters">
        <select name="year" aria-label="Season">${raw(options(years, q.year, 'All time'))}</select>
        <select name="country" aria-label="Country">${raw(options(state.meta.countries, q.country, 'All countries'))}</select>
      </div>
      <h2>Heaviest by species</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Weight</th><th>Angler</th><th>Boat</th></tr></thead>
        <tbody>${records.length ? records.map((r) => raw(html`<tr>
          <td><a href="#/catch/${r.id}">${r.species}</a></td><td class="num">${Math.round(r.weightKg * 10) / 10} kg</td>
          <td><a href="${anglerHref(r.userId, r.angler)}">${r.angler}</a></td><td>${r.teamId ? raw(html`<a href="#/boat/${r.teamId}">${r.teamName}</a>`) : '—'}</td></tr>`)) : nothing(4)}</tbody>
      </table></div>
      <h2>Top boats</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Boat</th><th class="num">Billfish</th><th class="num">Catches</th><th class="num">Released</th></tr></thead>
        <tbody>${teams.length ? teams.map((t, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="#/boat/${t.teamId}">${t.teamName}</a><div class="muted small">${t.clubName || ''}</div></td>
          <td class="num">${t.billfish}</td><td class="num">${t.catches}</td><td class="num">${t.released}</td></tr>`)) : nothing(5)}</tbody>
      </table></div>
      <h2>Top anglers</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Angler</th><th class="num">Billfish</th><th class="num">Catches</th><th class="num">Released</th></tr></thead>
        <tbody>${anglers.length ? anglers.map((a, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="${anglerHref(a.userId, a.angler)}">${a.angler}</a><div class="muted small">${a.teamName || ''}</div></td>
          <td class="num">${a.billfish}</td><td class="num">${a.catches}</td><td class="num">${a.released}</td></tr>`)) : nothing(5)}</tbody>
      </table></div>
      <h2>Top clubs</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Club</th><th class="num">Catches</th><th class="num">Released</th><th class="num">Total kg</th></tr></thead>
        <tbody>${clubs.length ? clubs.map((c, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="#/club/${c.clubId}">${c.clubName}</a><div class="muted small">${c.country}</div></td>
          <td class="num">${c.catches}</td><td class="num">${c.released}</td><td class="num">${c.totalKg}</td></tr>`)) : nothing(5)}</tbody>
      </table></div>`;
    view.querySelector('.filters').addEventListener('change', (e) => {
      const p = new URLSearchParams(q);
      if (e.target.value) p.set(e.target.name, e.target.value);
      else p.delete(e.target.name);
      location.hash = '#/leaderboard?' + p;
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
        <label>Species <select name="speciesId" required>${raw(speciesOptions(String(c.speciesId), 'Choose species…'))}</select></label>
        <div class="row">
          <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="optional" value="${c.weightKg ?? ''}"></label>
          <label>Length (cm) <input name="lengthCm" type="number" step="1" min="0" inputmode="numeric" placeholder="optional" value="${c.lengthCm ?? ''}"></label>
        </div>
        <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, c.lineClass, 'Not recorded'))}</select></label>
        <div class="row">
          <label class="check"><input type="checkbox" name="released" ${c.released ? 'checked' : ''}> Released alive</label>
          <label class="check"><input type="checkbox" name="tagged" ${c.tagged ? 'checked' : ''}> Tagged</label>
        </div>
        <label>Caption <textarea name="notes" maxlength="2000" rows="2">${c.notes || ''}</textarea></label>
        <label>Place <span class="muted small">(optional)</span><input name="location" maxlength="120" value="${c.location || ''}" placeholder="e.g. Banana Islands, off Mesurado"></label>
        ${raw(spotFields('optional'))}
        <label class="check"><input type="checkbox" name="spotPublic" ${c.spotPublic ? 'checked' : ''}> Show the exact spot to everyone (otherwise only your crew sees it)</label>
        <div class="row">
          <label>Date <input name="caughtOn" type="date" max="${today()}" value="${c.caughtOn}"></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, c.country, 'Choose…'))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save changes</button></div>
      </form>`;
    const form = view.querySelector('#f');
    wireSpot(form);
    if (c.lat != null) {
      form.lat.value = c.lat;
      form.lng.value = c.lng;
      form.coords.value = `${c.lat}, ${c.lng}`;
    }
    const pm = wirePhotoManager(form);
    bindForm(form, async () => {
      const btn = form.querySelector('button[type=submit]');
      btn.textContent = 'Saving…';
      try {
        const fd = new FormData(form);
        for (const k of ['released', 'tagged', 'spotPublic']) fd.set(k, form[k].checked ? 'on' : '');
        fd.delete('coords');
        await api(`/catches/${c.id}`, { method: 'PATCH', form: await pm.addTo(fd) });
        toast('Saved.');
        location.hash = `#/catch/${c.id}`;
      } finally {
        btn.textContent = 'Save changes';
      }
    });
  },

  // Edit your own JHMMC feed post.
  async 'club-edit'(id) {
    if (!state.me?.jhmmc) return needLogin(view, 'edit a JHMMC feed post (JHMMC members)');
    let item = null;
    for (let before = null; !item; ) {
      const q = before ? `?before=${encodeURIComponent(before)}` : '';
      const pageOf = await api(`/club-feed${q}`);
      item = pageOf.items.find((i) => i.kind === 'post' && String(i.id) === String(id));
      if (!pageOf.nextBefore) break;
      before = pageOf.nextBefore;
    }
    if (!item?.canEdit) {
      view.innerHTML = '<div class="card pad empty">Only whoever posted it can edit this post.</div>';
      return;
    }
    const speciesId = state.meta.species.find((x) => x.name === item.species)?.id;
    view.innerHTML = html`<p class="back"><a href="#/?feed=club">‹ JHMMC feed</a></p>
      <h1>Edit post</h1>
      <form class="card pad stack" id="f">
        <label>Your post <textarea name="body" rows="3" maxlength="2000">${item.body || ''}</textarea></label>
        ${raw(photoManager(item))}
        <label>Fish <select name="speciesId">${raw(speciesOptions(speciesId ? String(speciesId) : '', 'No fish'))}</select></label>
        <div class="row"><label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="Optional" value="${item.weightKg ?? ''}"></label>
          <label class="check"><input type="checkbox" name="released" ${item.released ? 'checked' : ''}> Released</label></div>
        ${raw(spotFields())}
        <p class="small muted">Changes here don't change a copy posted on the West Africa feed; edit that one there.</p>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save changes</button></div>
      </form>`;
    const form = view.querySelector('#f');
    wireSpot(form);
    if (item.lat != null) {
      form.lat.value = item.lat;
      form.lng.value = item.lng;
      form.coords.value = `${item.lat}, ${item.lng}`;
    }
    const pm = wirePhotoManager(form);
    bindForm(form, async () => {
      const btn = form.querySelector('button[type=submit]');
      btn.textContent = 'Saving…';
      try {
        const fd = new FormData(form);
        fd.set('released', form.released.checked ? 'true' : '');
        fd.delete('coords');
        await api(`/club-feed/${item.id}`, { method: 'PATCH', form: await pm.addTo(fd) });
        toast('Saved.');
        location.hash = '#/?feed=club';
      } finally {
        btn.textContent = 'Save changes';
      }
    });
  },

  // My catch map: every fish you logged with a spot, on a map, by year.
  async spots() {
    if (!state.me) return needLogin(view, 'see your catch map');
    const year = new URLSearchParams(location.hash.split('?')[1] || '').get('year') || '';
    const [{ years, spots }, L] = await Promise.all([api(`/me/spots${year ? `?year=${year}` : ''}`), loadLeaflet().catch(() => null)]);
    const chip = (y, label) => html`<a role="tab" href="#/spots${y ? `?year=${y}` : ''}" aria-selected="${y === year}">${label}</a>`;
    const href = (x) => (x.kind === 'catch' ? `#/catch/${x.id}` : null);
    const when = (x) => fmtDate(x.date);
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>My catch map</h1>
      <p class="small muted">Every fish you logged with a spot${state.me.isCaptain ? ', and your boat\'s' : ''}: from your West Africa posts and your JHMMC feed posts. Only you see this.</p>
      ${years.length > 1 ? raw(html`<div class="year-tabs" role="tablist">${raw(chip('', 'All'))}${years.map((y) => raw(chip(y, y)))}</div>`) : ''}
      ${spots.length ? raw(html`<div class="card catch-map" id="catch-map"></div>
        <p class="small muted">${plural(spots.length, 'catch')}${year ? ` in ${year}` : ''}. Tap a pin for the fish.</p>
        <div class="card"><ul class="list spot-list">${spots.map((x, n) => raw(html`<li data-n="${n}">
          <b>${x.species}</b>${x.weightKg ? ` · ${fmtWeight(x.weightKg)}` : ''}${x.released ? raw(' <span class="badge release">Released</span>') : ''}
          <div class="small muted">${when(x)}${x.angler ? ` · ${x.angler}` : ''}${x.location ? ` · ${x.location}` : ''} · ${fmtCoords(x.lat, x.lng)}
            ${href(x) ? raw(html` · <a href="${href(x)}">Open</a>`) : ''}</div></li>`))}</ul></div>`)
        : raw(`<div class="card pad empty">No spots yet${year ? ` in ${year}` : ''}. Add <b>Where you caught it</b> when you post a fish (Use my location), and it appears here.</div>`)}`;
    if (!spots.length) return;
    if (!L) {
      view.querySelector('#catch-map').outerHTML = '<div class="card pad empty">The map couldn\'t load just now. Your catches are listed below.</div>';
      return;
    }
    const map = L.map('catch-map', { zoomControl: true });
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, attribution: 'Imagery © Esri' });
    satellite.addTo(map);
    L.control.layers({ Satellite: satellite, Map: streets }).addTo(map);
    const pins = spots.map((x) => L.circleMarker([x.lat, x.lng], {
      radius: 8, weight: 2, color: '#ffffff', fillColor: x.released ? '#3fcf8e' : '#2f7cf6', fillOpacity: 1,
    }).addTo(map).bindPopup(html`<b>${x.species}</b>${x.weightKg ? ` · ${fmtWeight(x.weightKg)}` : ''}${x.released ? ' · released' : ''}<br>
      ${when(x)}${x.boat ? ` · ${x.boat}` : ''}${href(x) ? raw(html`<br><a href="${href(x)}">Open the catch</a>`) : ''}`));
    map.fitBounds(L.latLngBounds(spots.map((x) => [x.lat, x.lng])).pad(0.3), { maxZoom: 12 });
    view.querySelector('.spot-list').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-n]');
      if (!li || e.target.closest('a')) return;
      const x = spots[li.dataset.n];
      map.setView([x.lat, x.lng], 12);
      pins[li.dataset.n].openPopup();
      view.querySelector('#catch-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        'Open <b>Big Game</b> from your home screen (notifications only work there).']
      : samsung
        ? ['Tap the <b>menu</b> (☰) at the bottom right.', 'Tap <b>Add page to</b>, then <b>Home screen</b>.', 'Tap <b>Add</b>.']
        : ['Tap the browser\'s <b>menu</b> (⋮) at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b>.'];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <div class="install-head"><img src="/icon-192.png" alt="" width="72" height="72"><div><h1>Install the app</h1>
        <p class="muted">West Africa Big Game on your home screen: it opens full screen like any other app, even without signal (catches and points load when there's a connection).</p></div></div>
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
    const item = (href, iconName, label, sub = '', count = 0) => `<a class="menu-item" href="${href}">
      <span class="mi-icon">${icon(iconName)}</span>
      <span class="mi-text"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
      ${count ? `<span class="count-badge" aria-hidden="true">${count}</span>` : ''}
      <span class="mi-go" aria-hidden="true">›</span></a>`;
    view.innerHTML = html`<div class="page-head"><h1 class="center">More</h1>${raw(themeButton())}</div>
      ${me ? raw(html`<div class="card pad me-card">
          ${me.photoUrl ? raw(html`<img src="${me.photoUrl}" alt="">`) : raw(`<span class="me-ph">${icon('user')}</span>`)}
          <div class="me-who"><b>${me.displayName}</b><div class="muted small">${me.teamName ? `${me.teamName}${me.isCaptain ? ' · Captain' : ''}` : 'Individual angler'}</div></div>
          ${me.jhmmc ? raw(html`<a class="btn feed-switch" href="#/?feed=${feedPref() === 'club' ? 'wa' : 'club'}" aria-label="Switch to the ${FEED_NAMES[feedPref() === 'club' ? 'wa' : 'club']} feed">${raw(icon('switch', 'icon small'))}
            ${FEED_NAMES[feedPref() === 'club' ? 'wa' : 'club']}</a>`) : ''}
        </div>
        ${me.jhmmc ? raw(html`<p class="small muted feed-now">You're on the ${FEED_NAMES[feedPref()]} feed. Tip: double-tap More to switch.</p>`) : ''}`)
        : raw(`<div class="card pad"><p style="margin-top:0">Sign in to log catches with your boat, like and comment.</p>
          <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Create account</a></div>`)}
      ${isInstalled() ? '' : raw(`<div class="card pad install-card">
        <img src="/icon-192.png" alt="" width="48" height="48">
        <div><b>Get the app</b><span class="small muted">On your home screen, opens like any other app</span></div>
        <button type="button" class="primary" data-install>${icon('download')} Install</button>
      </div>`)}
      ${me ? raw(`<h2>You</h2><div class="card menu">
        ${item(`#/user/${me.id}`, 'dashboard', 'My dashboard', 'Your catches, releases and heaviest fish')}
        ${me.teamId ? item(`#/boat/${me.teamId}`, 'boat', 'My boat', me.teamName) : item('#/crew', 'boat', 'Get on a boat', 'Join a crew or register your boat')}
        ${item('#/spots', 'pin', 'My catch map', 'Every catch you logged with a spot, and where')}
        ${item('#/profile', 'edit', 'Edit profile', 'Name, country, photo')}
      </div>`) : ''}
      ${me?.canWeigh ? raw(`<h2>${me.canReview ? 'JHMMC officials' : 'JHMMC points'}</h2><div class="card menu">
        ${item('#/weigh', 'weight', 'Register fish', me.canReview ? 'For any JHMMC boat' : `Today's fish for ${me.teamName}${me.weighStation ? ` at ${me.weighStation}` : ''}`)}
        ${item('#/tournaments', 'trophy', me.canReview ? 'Tournaments' : 'Tournament entry', me.canReview ? "Who's in, anglers, members and guests" : 'Enter your boat and anglers')}
        ${me.canReview ? '' : item('#/pending', 'eye', 'Pending registrations', "Every boat's fish waiting for the secretary; dispute within 24 hours")}
        ${me.canApprove ? item('#/review', 'review', 'Review catches', state.pending ? `${plural(state.pending, 'registration')} waiting` : 'Check and approve points', state.pending) : ''}
        ${me.canReview ? item('#/history', 'history', 'Registration history', 'Every registration, withdrawal, dispute and decision') : ''}
        ${me.canReview ? item('#/club-members', 'participants', 'Club members', 'Who has paid their JHMMC membership this season') : ''}
        ${me.canReview ? item('#/calendar', 'calendar', 'Season calendar', 'Season dates and tournaments') : ''}
        ${me.canReview ? item('#/scoring', 'calculator', 'Scoring table', 'Points per kg for each species') : ''}
      </div>`) : ''}
      ${me?.canHandleMoney && !me.canReview ? raw(`<h2>JHMMC treasurer</h2><div class="card menu">
        ${item('#/club-members', 'participants', 'Club members', 'Who has paid their JHMMC membership this season')}
        ${item('#/tournaments', 'trophy', 'Tournaments', 'Temporary memberships to collect')}
      </div>`) : ''}
      ${me?.isAdmin ? raw(`<h2>Platform admin</h2><p class="small muted section-note">West Africa Big Game: every club, boat and member.</p><div class="card menu">
        ${item('#/members', 'key', 'Members', 'Who belongs to JHMMC, password reset links')}
        ${item('#/admin-boats', 'boat', 'Boats', 'Weigh station, Ocean or River, and every boat\'s details')}
      </div>`) : ''}
      <h2>Rules</h2>
      <div class="card menu">
        ${raw(item('#/rules?book=jhmmc', 'rules', 'JHMMC rules', '2026-2027 season'))}
        ${raw(item('#/rules?book=igfa', 'scale', 'IGFA rules', 'International Angling Rules summary'))}
        ${raw(item('#/scoring', 'calculator', 'How points work', 'Points per kg for each species'))}
        ${raw(item('#/calendar', 'calendar', 'Season calendar', 'Tournaments'))}
      </div>
      <h2>Records &amp; clubs</h2>
      <div class="card menu">
        ${raw(item('#/records?club=igfa', 'trophy', 'IGFA world records'))}
        ${raw(item('#/records', 'medal', 'Club records'))}
        ${raw(item('#/clubs', 'clubs', 'Clubs'))}
        ${raw(item('#/participants?tab=boats', 'boat', 'All boats'))}
      </div>
      ${me ? raw('<p class="center"><button id="logout">Sign out</button></p>') : ''}`;
    view.querySelector('#logout')?.addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' });
      state.me = null;
      state.clubs = null;
      location.hash = '#/';
    });
  },

  // Admin only: every account, with a one-time password reset link to pass on.
  // Admin: every boat. JHMMC boats get their weigh station (their home port)
  // and Ocean or River here; the rest of a boat's details are on its page.
  async 'admin-boats'() {
    if (!state.me?.isAdmin) {
      view.innerHTML = '<div class="card pad empty">Only the club admin can see this page.</div>';
      return;
    }
    const { teams } = await api('/teams');
    const jhmmc = teams.filter((t) => isJhmmc(t.clubId));
    const others = teams.filter((t) => !isJhmmc(t.clubId));
    const find = (t) => `${t.name} ${t.clubName || ''} ${t.weighStation || t.homePort || ''}`.toLowerCase();
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Boats (${teams.length})</h1>
      <p class="small muted">Set each JHMMC boat's weigh station, which is also its home port, and whether it fishes Ocean or River. Changes save straight away. Tap a boat to change anything else: name, photo, club, captain or crew.</p>
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
      <h1>Pending registrations</h1>
      <p class="small muted">Fish every JHMMC boat has registered that the secretary hasn't decided on yet. If something looks wrong,
        dispute it within 24 hours with a reason; the secretary sees it before approving. <a href="#/rules?section=app-registrations">The rule</a></p>
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
      </article>`))}</div>`) : raw('<div class="card pad empty">Nothing is waiting for the secretary.</div>')}`;
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
      <h1>Registration history</h1>
      <p class="small muted">Every JHMMC registration, one entry per fish with where it stands now, and underneath everything that happened to it: who registered, disputed, approved, rejected or withdrew it, when, and where the captain's phone was. Nothing here can be changed.</p>
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
  async tournaments() {
    if (!state.me?.canWeigh && !state.me?.canHandleMoney) return needLogin(view, 'enter tournaments (captains of JHMMC boats)');
    const official = state.me.canHandleMoney;
    const { tournaments, fee } = await api('/tournaments');
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>${official ? 'Tournaments' : 'Tournament entry'}</h1>
      <p class="small muted">${official
        ? `Open a tournament for its registration sheet: who's in, the anglers on each boat, and the temporary memberships non-members pay (USD ${fee} each).`
        : `Enter your boat and say who's fishing on it. Anglers who aren't JHMMC members pay a USD ${fee} temporary membership before the tournament day.`}</p>
      ${tournaments.length ? raw(html`<div class="card menu">${tournaments.map((t) => raw(html`<a class="menu-item" href="#/${official ? 'sheet' : 'enter'}/${t.id}">
        <span class="mi-icon">${raw(icon('trophy'))}</span>
        <span class="mi-text"><b>${t.name}</b><span>${fmtDays(t)}${t.open ? '' : ' · over'}</span>
          <span>${official ? `${plural(t.boats, 'boat')} · ${plural(t.anglers, 'angler')} · ${t.guests} non-member${t.guests === 1 ? '' : 's'}${t.unpaid ? ` · ${t.unpaid} unpaid` : ''}`
            : t.mine ? 'Your boat is entered' : t.open ? 'Not entered yet' : 'You did not enter'}</span></span>
        ${t.mine && !official ? raw(`<span class="badge new">In</span>`) : ''}
        <span class="mi-go" aria-hidden="true">›</span></a>`))}</div>`)
        : raw(html`<div class="card pad empty">No tournaments on the calendar this season yet.${official ? raw(' <a href="#/calendar">Add one</a>') : ''}</div>`)}`;
  },

  // A captain enters their boat in a tournament with the anglers fishing on it.
  async enter(id) {
    if (!state.me?.canWeigh) return needLogin(view, 'enter tournaments (captains of JHMMC boats)');
    const { tournament, team, crew, named, entered, anglers, open, fee } = await api(`/tournaments/${id}/my-entry`);
    view.innerHTML = html`<p class="back"><a href="#/tournaments">‹ Tournaments</a></p>
      <h1>${tournament.name}</h1>
      <p class="muted">${fmtDays(tournament)} · <b>${team.name}</b> · ${team.division === 'river' ? 'River' : 'Ocean'}${team.station ? ` · ${team.station}` : ''}</p>
      <p class="tournament-now">${raw(icon(entered ? 'check' : 'trophy'))} ${entered ? 'Your boat is entered.' : 'Your boat is not entered yet.'}</p>
      ${open ? raw(html`<form class="card pad stack" id="entry">
        <h2>Anglers on ${team.name}</h2>
        <p class="small muted">Tick your crew who are fishing and add anyone else as a guest. Only people the secretary has marked as paid JHMMC members count as members; everyone else, guests included, pays a USD ${fee} temporary membership before the tournament day.</p>
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
    view.innerHTML = html`<p class="back"><a href="#/tournaments">‹ Tournaments</a></p>
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
        ${manage ? raw('<button type="button" data-act="put-in">Put in</button>') : ''}</li>`)) : raw('<li class="muted">Every JHMMC boat is in.</li>')}</ul></div>`;
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
        await put(btn.closest('[data-team]').dataset.team, { entered: true });
        toast('In');
        route();
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
    const [{ season, people, named }, { teams }] = await Promise.all([api('/club-members'), api('/teams')]);
    const label = `${season.start.slice(0, 4)}–${season.end.slice(2, 4)}`;
    const paid = people.filter((p) => p.paid).length;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Club members</h1>
      <p class="small muted">Tick everyone who has paid their JHMMC membership for the ${label} season (${fmtDay(season.start)} to ${fmtDay(season.end)}).
        In tournaments, anyone who isn't ticked here counts as a non-member and pays the temporary membership.</p>
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
        <label class="check"><input type="checkbox" ${p.paid ? 'checked' : ''}> Paid ${label}</label>
      </li>`))}</ul></div>
      <h2>Members without an account</h2>
      <p class="small muted">Children and anyone else who doesn't use the app. Give them their boat so its captain can pick them for tournaments.</p>
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
    if (!state.me?.isAdmin) {
      view.innerHTML = '<div class="card pad empty">Only the club admin can see this page.</div>';
      return;
    }
    const { users } = await api('/admin/users');
    const inClub = users.filter((u) => u.jhmmc).length;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Members (${users.length})</h1>
      <p class="small muted">Tick who belongs to JHMMC (${inClub} of ${users.length}); the secretary then marks which of them have paid this season. Roles such as Secretary are set on the Club members page. Captains of JHMMC boats register their own boat's fish. When a member forgets their password, check the request came from their sign-up email, then make a reset link and send it to them. It works once and expires after 24 hours; they choose the new password themselves.</p>
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by name, email or boat" aria-label="Search members" autocomplete="off"></label>
      <div class="card"><ul class="list">${users.map((u) => raw(html`<li class="member-row" data-id="${u.id}" data-find="${`${u.name} ${u.nickname || ''} ${u.email} ${u.teamName || ''}`.toLowerCase()}">
        <div><b>${u.name}</b>${u.nickname ? raw(html` <span class="muted">“${u.nickname}”</span>`) : ''}<div class="muted small">${u.email}${u.teamName ? ` · ${u.teamName}` : ''}</div></div>
        <button data-act="reset-link">Create reset link</button>
        <div class="role">
          <label class="check"><input type="checkbox" data-act="jhmmc" ${u.jhmmc ? 'checked' : ''} ${u.isAdmin ? 'disabled' : ''}> JHMMC member</label>
          ${u.isAdmin ? raw('<span class="badge new">Admin</span>') : u.role ? raw(html`<span class="badge">${roleLabel(u.role)}</span>`) : ''}
        </div>
        <div class="reset-out" hidden></div>
        ${u.id === state.me.id ? '' : raw('<div class="delete-user"><button data-act="delete-user" class="link danger">Delete account</button></div>')}
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
          const { role } = await api(`/admin/users/${row.dataset.id}`, { method: 'PATCH', body: { jhmmc: box.checked } });
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
      if (btn.dataset.act === 'delete-user') {
        const name = row.querySelector('b').textContent;
        if (!confirm(`Delete ${name}'s account? This can't be undone.\n\nTheir catches stay on the app under their name; their comments and likes are removed.`)) return;
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
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(`Hello ${name}, here is your link to set a new password for the West Africa Big Game app. It works once, within ${hours} hours: ${link}`)}">Send on WhatsApp</a></div>`;
        out.hidden = false;
        out.querySelector('input').select();
      } catch (ex) {
        toast(ex.message);
      }
    });
  },

  // The JHMMC season rules and a summary of the IGFA angling rules.
  async rules() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const which = q.get('book') === 'igfa' ? 'igfa' : 'jhmmc';
    const book = window.RULES[which];
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <div class="seg" role="tablist">
        <a role="tab" href="#/rules?book=jhmmc" aria-selected="${which === 'jhmmc'}">JHMMC rules</a>
        <a role="tab" href="#/rules?book=igfa" aria-selected="${which === 'igfa'}">IGFA rules</a>
      </div>
      <article class="card pad rulebook">
        <h1>${book.title}</h1>
        ${book.pdf ? raw(html`<p><a class="btn" href="${book.pdf}" target="_blank" rel="noopener">Download the official PDF</a></p>`) : ''}
        ${raw(book.html)}
        ${book.url ? raw(html`<p><a class="btn primary" href="${book.url}" target="_blank" rel="noopener">Read the full IGFA rules</a></p>`) : ''}
      </article>`;
    // A link can open the rules at one section (?section=...).
    if (q.get('section')) view.querySelector(`#${CSS.escape(q.get('section'))}`)?.scrollIntoView();
  },

  // One page, many record books: IGFA's world records, or any club's own.
  async records() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const clubs = await loadClubs();
    // The home club comes first after IGFA, then the rest by name.
    const home = state.meta.homeClub.toLowerCase();
    const books = [...clubs].sort((a, b) => (b.name.toLowerCase() === home) - (a.name.toLowerCase() === home) || a.name.localeCompare(b.name));
    // Anglers whose boat is in a club open on their club's book; others on IGFA.
    const homeId = books.find((c) => c.name.toLowerCase() === home)?.id;
    const book = q.get('club') || String(state.me?.clubId || homeId || 'igfa');
    const isIgfa = book === 'igfa';
    const { species, lineRecords, checked, igfaUrl, club, book: recordBook } = await api('/records' + (isIgfa ? '' : `?club=${encodeURIComponent(book)}`));
    const kg = (n) => `${(Math.round(n * 10) / 10).toLocaleString()} kg`;
    const lb = (n) => `${Math.round(n * 2.20462).toLocaleString()} lb`;
    const pct = (s) => Math.round((s.best.weightKg / s.igfa.kg) * 100);
    const picker = html`<label class="club-pick">Records for
      <select id="club-pick">${raw(options([['igfa', 'IGFA world records'], ...books.map((c) => [c.id, c.name])], isIgfa ? 'igfa' : club.id))}</select>
    </label>`;

    let body;
    if (isIgfa) {
      const month = new Date(checked + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      body = html`<h2>IGFA all-tackle world records</h2>
        <p class="small muted">The heaviest fish of each species ever accepted by the International Game Fish Association. Checked ${month}; <a href="${igfaUrl}" target="_blank" rel="noopener">IGFA's search</a> has the official, current list and every line-class record.</p>
        <div class="records">${species.map((s) => raw(html`<article class="card pad record">
          <div class="record-head"><b>${s.name}</b>${s.igfa?.african ? raw('<span class="badge release">Caught in Africa</span>') : ''}</div>
          ${s.igfa ? raw(html`<div><span class="wr-lb">${s.igfa.display}</span> <span class="muted">${kg(s.igfa.kg)}</span></div>
            <div class="small muted">${s.igfa.angler} · ${s.igfa.place} · ${s.igfa.date.slice(0, 4)}${s.igfa.note ? ` · ${s.igfa.note}` : ''}</div>`)
            : raw(html`<div class="small muted">No confirmed all-tackle record here. <a href="${igfaUrl}" target="_blank" rel="noopener">Look it up on IGFA</a></div>`)}
        </article>`))}</div>`;
    } else if (recordBook) {
      // JHMMC: the club's own record book, with approved app fish ranked in.
      const when = (r) => (r.caughtOn ? fmtDate(r.caughtOn) : r.year || 'date not recorded');
      const who = (r) => (r.fromApp ? raw(html`<a href="${anglerHref(r.userId, r.angler)}">${r.angler}</a>`) : r.angler);
      const boat = (r) => (r.teamId ? raw(html`<a href="#/boat/${r.teamId}">${r.boat}</a>`) : r.boat || '—');
      const isNew = (r) => (r.fromApp ? raw('<span class="badge new">New</span>') : '');
      body = html`<h2>${club.name} record book</h2>
        <p class="small muted">The club's records as at ${fmtDay(recordBook.asAt)}, with fish approved in the app ranked in among them (marked New).
          <a href="${recordBook.pdf}" target="_blank" rel="noopener">Download the record book (PDF)</a></p>
        <div class="records">${recordBook.groups.map((g) => {
          const [top, ...rest] = g.records;
          return raw(html`<article class="card pad record">
            <div class="record-head"><b>${g.title}</b>${top.lineClass ? raw(html`<span class="badge">${top.lineClass} line</span>`) : ''}${isNew(top)}</div>
            <div>${top.fromApp ? raw(html`<a class="wr-lb" href="#/catch/${top.catchId}">${lb(top.weightKg)}</a>`) : raw(html`<span class="wr-lb">${lb(top.weightKg)}</span>`)}
              <span class="muted">${kg(top.weightKg)}</span></div>
            <div class="small muted">${who(top)} · ${boat(top)} · ${when(top)}</div>
            ${rest.length ? raw(html`<ol class="book-list">${rest.map((r, i) => raw(html`<li>
              <span class="rank">${i + 2}</span>
              <span>${who(r)} ${isNew(r)}<span class="muted small">${boat(r)}${r.lineClass ? ` · ${r.lineClass}` : ''} · ${when(r)}</span></span>
              <span class="num">${r.fromApp ? raw(html`<a href="#/catch/${r.catchId}">${kg(r.weightKg)}</a>`) : kg(r.weightKg)}</span>
            </li>`))}</ol>`) : ''}
          </article>`);
        })}</div>
        <h2>${club.name} records by line class</h2>
        <div class="card table-wrap"><table>
          <thead><tr><th>Species</th><th>Line</th><th class="num">Weight</th><th>Angler</th><th>Boat</th></tr></thead>
          <tbody>${recordBook.lineRecords.map((r) => raw(html`<tr>
            <td>${r.group} ${isNew(r)}</td><td class="nw">${r.lineClass}</td>
            <td class="num">${r.fromApp ? raw(html`<a href="#/catch/${r.catchId}">${kg(r.weightKg)}</a>`) : kg(r.weightKg)}<div class="muted small">${lb(r.weightKg)}</div></td>
            <td>${who(r)}<div class="muted small">${when(r)}</div></td><td>${boat(r)}</td>
          </tr>`))}</tbody>
        </table></div>`;
    } else {
      const held = species.filter((s) => s.best);
      const open = species.filter((s) => !s.best);
      body = html`<h2>${club.name} club records</h2>
        <p class="small muted">The heaviest weighed fish of each species logged by ${club.name} boats.</p>
        ${held.length ? raw(html`<div class="records">${held.map((s) => raw(html`<article class="card pad record">
          <div class="record-head"><b>${s.name}</b>${s.best.lineClass ? raw(html`<span class="badge">${s.best.lineClass} line</span>`) : ''}</div>
          <div><a class="wr-lb" href="#/catch/${s.best.catchId}">${lb(s.best.weightKg)}</a> <span class="muted">${kg(s.best.weightKg)}</span></div>
          <div class="small muted"><a href="${anglerHref(s.best.userId, s.best.angler)}">${s.best.angler}</a>${s.best.teamName ? ` · ${s.best.teamName}` : ''} · ${fmtDate(s.best.caughtOn)}</div>
          ${s.igfa ? raw(html`<div class="ours"><div class="bar blue" title="Share of the IGFA world record"><i style="width:${Math.min(100, Math.max(2, pct(s)))}%"></i></div>
            <span class="small muted">${pct(s)}% of the IGFA world record (${s.igfa.display})</span></div>`) : ''}
        </article>`))}</div>`) : raw(html`<div class="card pad empty">No weighed catches from ${club.name} boats yet. The first one logged sets the club record.</div>`)}
        ${held.length && open.length ? raw(html`<p class="small muted">Still open: ${open.map((s) => s.name).join(', ')}.</p>`) : ''}
        <h2>${club.name} records by line class</h2>
        <div class="card table-wrap"><table>
          <thead><tr><th>Species</th><th>Line</th><th class="num">Weight</th><th>Angler</th><th>Boat</th></tr></thead>
          <tbody>${lineRecords.length ? lineRecords.map((r) => raw(html`<tr>
            <td>${r.species}</td><td class="nw">${r.lineClass}</td>
            <td class="num"><a href="#/catch/${r.catchId}">${lb(r.weightKg)}</a><div class="muted small">${kg(r.weightKg)}</div></td>
            <td><a href="${anglerHref(r.userId, r.angler)}">${r.angler}</a></td><td>${r.teamId ? raw(html`<a href="#/boat/${r.teamId}">${r.teamName}</a>`) : '—'}</td>
          </tr>`)) : raw('<tr><td colspan="5" class="muted">No weighed catches with a line class yet. Pick the line class when logging a catch to set a record.</td></tr>')}</tbody>
        </table></div>`;
    }
    view.innerHTML = html`${raw(boardTabs('records'))}${raw(picker)}${raw(body)}`;
    view.querySelector('#club-pick').addEventListener('change', (e) => {
      location.hash = `#/records?club=${e.target.value}`;
    });
  },

  async user(id) {
    const { user, stats } = await api(`/users/${id}`);
    view.innerHTML = html`${user.photoUrl ? raw(html`<img class="avatar" src="${user.photoUrl}" alt="">`) : ''}<h1>${user.name}</h1>
      ${user.fullName !== user.name ? raw(html`<p class="full-name">${user.fullName}</p>`) : ''}
      <p class="muted">${user.teamName ? raw(html`<a href="#/boat/${user.teamId}">${user.teamName}</a> · `) : 'Individual angler · '}${user.country || ''}</p>
      ${user.bio ? raw(html`<p>${user.bio}</p>`) : ''}
      ${state.me?.id === user.id ? raw('<a class="btn" href="#/profile">Edit profile</a>') : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
      </div>
      <div id="feed"></div>`;
    await renderFeed(view.querySelector('#feed'), { user: user.id });
  },

  async profile() {
    if (!state.me) return needLogin(view, 'see your profile');
    const me = state.me;
    view.innerHTML = html`<h1>Your profile</h1>
      <p>${me.teamId ? raw(html`Crew of <a href="#/boat/${me.teamId}">${me.teamName}</a>${me.isCaptain ? ' (captain)' : ''}`) : raw('Individual angler · <a href="#/crew">Get on a boat</a>')}</p>
      <form class="card pad stack" id="f">
        <div class="row">
          <label>First name <input name="firstName" required maxlength="40" autocomplete="given-name" value="${me.firstName || ''}"></label>
          <label>Last name <input name="lastName" required maxlength="40" autocomplete="family-name" value="${me.lastName || ''}"></label>
        </div>
        <p class="small muted">Your full name is shown on your profile.</p>
        <label>Nickname (optional) <input name="nickname" maxlength="40" placeholder="e.g. Big Mo" value="${me.nickname || ''}">
          <span class="small muted">What everyone else sees: the feed, Participants, leaderboards. Leave it empty to show your full name.</span></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, me.country, 'Choose…'))}</select></label>
        <label>About you <textarea name="bio" maxlength="500">${me.bio || ''}</textarea></label>
        <label>Your photo <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>
      <h2>Change password</h2>
      <form class="card pad stack" id="pw">
        <label>Current password <input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <p class="error"></p>
        <div><button type="submit">Change password</button></div>
      </form>
      <p><a href="#/more">‹ Back to More</a></p>`;
    const pw = view.querySelector('#pw');
    bindForm(pw, async () => {
      await api('/me/password', { method: 'POST', body: formData(pw) });
      pw.reset();
      toast('Password changed. Other devices have been signed out.');
    });
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const { photo, ...fields } = formData(form);
      let { user } = await api('/me', { method: 'PATCH', body: fields });
      if (photo?.size) {
        const fd = new FormData();
        fd.set('photo', await shrinkPhoto(photo));
        ({ user } = await api('/me/photo', { method: 'POST', form: fd }));
      }
      state.me = user;
      toast('Profile saved');
      location.hash = `#/user/${user.id}`;
    });
  },

  async login() {
    view.innerHTML = html`<h1>Sign in</h1>
      <form class="card pad stack" id="f">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Sign in</button></div>
      </form>
      <p><a href="#/forgot">Forgot your password?</a></p>
      <p>New here? <a href="#/register">Create an account</a>.</p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      state.me = (await api('/auth/login', { method: 'POST', body: formData(form) })).user;
      location.hash = state.afterLogin || '#/';
      state.afterLogin = null;
    });
  },

  async forgot() {
    if (!state.meta.emailEnabled) {
      // No email sending yet: the admin makes reset links by hand.
      const admin = state.meta.adminEmail;
      const mail = admin && `mailto:${admin}?subject=${encodeURIComponent('Password reset - West Africa Big Game')}&body=${encodeURIComponent('Hello, I forgot my password. My account email is: ')}`;
      view.innerHTML = html`<h1>Forgot your password?</h1>
        <div class="card pad stack">
          ${admin ? raw(html`<p style="margin:0">Email the club admin from the address you signed up with, and they'll send you a link to choose a new password.</p>
            <p class="admin-mail" style="margin:0"><b>${admin}</b></p>
            <div class="actions" style="margin:0"><a class="btn primary" href="${mail}">Write the email</a> <button id="copy-admin">Copy address</button></div>`)
            : raw('<p style="margin:0">Ask your club admin to send you a password reset link.</p>')}
        </div>
        <p><a href="#/login">Back to sign in</a></p>`;
      view.querySelector('#copy-admin')?.addEventListener('click', () => copyText(admin, 'Address copied'));
      return;
    }
    view.innerHTML = html`<h1>Reset your password</h1>
      <p class="muted">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
      <form class="card pad stack" id="f">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Send reset link</button></div>
      </form>
      <p><a href="#/login">Back to sign in</a></p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const { message } = await api('/auth/forgot', { method: 'POST', body: formData(form) });
      view.querySelector('#f').outerHTML = html`<div class="card pad"><p style="margin:0">${message}</p></div>`;
    });
  },

  async reset() {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
    view.innerHTML = html`<h1>Choose a new password</h1>
      <form class="card pad stack" id="f">
        <label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Type it again <input name="again" type="password" required minlength="8" autocomplete="new-password"></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save password</button></div>
      </form>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const { password, again } = formData(form);
      if (password !== again) throw new Error("The two passwords don't match.");
      state.me = (await api('/auth/reset', { method: 'POST', body: { token, password } })).user;
      toast('Password saved. You are signed in.');
      location.hash = '#/';
    });
  },

  async register() {
    view.innerHTML = html`<h1>Create your account</h1>
      <p class="muted">Every angler signs in with their own account. After this you can join your boat's crew, register a boat, or just follow the feed.</p>
      <form class="card pad stack" id="f">
        <div class="row">
          <label>First name <input name="firstName" required maxlength="40" autocomplete="given-name"></label>
          <label>Last name <input name="lastName" required maxlength="40" autocomplete="family-name"></label>
        </div>
        <p class="small muted">Your full name is shown on your profile.</p>
        <label>Nickname (optional) <input name="nickname" maxlength="40" placeholder="e.g. Big Mo">
          <span class="small muted">What everyone else sees: the feed, Participants, leaderboards. Leave it empty to show your full name.</span></label>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, null, 'Choose…'))}</select></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create account</button></div>
      </form>
      <p>Already a member? <a href="#/login">Sign in</a>.</p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      state.me = (await api('/auth/register', { method: 'POST', body: formData(form) })).user;
      toast('Welcome aboard!');
      location.hash = '#/crew';
    });
  },
});

// ---- router ---------------------------------------------------------------

// Icons from Lucide (lucide.dev, ISC licence), 24px grid, drawn with currentColor.
const ICONS = {
  feed: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  leaderboard: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  participants: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  clubs: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
  catch: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  weight: '<circle cx="12" cy="5" r="3"/><path d="M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z"/>',
  review: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  fish: '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  switch: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  brush: '<path d="m11 10 3 3"/><path d="M6.5 21A3.5 3.5 0 1 0 3 17.5a2.62 2.62 0 0 1-.708 1.792A1 1 0 0 0 3 21z"/><path d="M9.969 17.031 21.378 5.624a1 1 0 0 0-3.002-3.002L6.967 14.031"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  comment: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  boat: '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  rules: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  medal: '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
};

// Bar graph of season points, one bar per boat. Bars grow from zero, so a
// boat below zero (a small marlin kept) points left. The value sits at the
// bar's end; hovering shows the fish count too.
const TOP_BARS = 10;
function pointsBars(boats) {
  const lo = Math.min(0, ...boats.map((b) => b.points));
  const hi = Math.max(0, ...boats.map((b) => b.points));
  // Room at either end for the value label.
  const left = lo < 0 ? 16 : 0;
  const right = hi > 0 ? 16 : 0;
  const scale = (v) => left + ((v - lo) / (hi - lo || 1)) * (100 - left - right);
  const zero = scale(0);
  return boats.map((b) => {
    const end = scale(b.points);
    const neg = b.points < 0;
    const [from, to] = neg ? [end, zero] : [zero, end];
    return html`<a class="bar-row" href="#/boat/${b.teamId}" title="${b.teamName}: ${b.points} points from ${plural(b.catches, 'fish')}">
      <span class="bar-name">${b.teamName}</span>
      <span class="bar-track" style="--zero:${zero}%">
        <span class="bar${neg ? ' neg' : ''}" style="left:${from}%;width:${Math.max(to - from, 0.5)}%"></span>
        <span class="bar-value${neg ? ' neg' : ''}" style="${neg ? `right:${100 - from}%` : `left:${to}%`}">${b.points}</span>
      </span></a>`;
  }).join('');
}

// ---- review badge & phone notifications ----------------------------------

// How many registrations wait for the secretary: shown on the More tab, the
// Review catches menu item and the browser tab's title.
async function refreshPending() {
  const before = state.pending;
  try {
    state.pending = state.me?.canApprove ? (await api('/officials/pending')).count : 0;
  } catch {
    return;
  }
  document.title = `${state.pending ? `(${state.pending}) ` : ''}West Africa Big Game`;
  if (state.pending !== before) renderNav();
}
setInterval(() => { if (document.visibilityState === 'visible') refreshPending(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPending(); });

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function pushKey(base64) {
  const raw = atob((base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushSubscription() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

// The "notifications on this phone" switch on the Review page.
async function renderNotify(el) {
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushSupported()) {
    el.innerHTML = iphone && !installed
      ? `<p><b>Get a notification when fish are registered.</b></p><p class="small muted">On iPhone, first add this app to your Home Screen: tap the Share button, then <b>Add to Home Screen</b>. Open the app from the Home Screen and come back to this page.</p>`
      : '<p class="small muted">This browser can\'t show notifications. Chrome on Android, or the app added to an iPhone Home Screen, can.</p>';
    return;
  }
  if (Notification.permission === 'denied') {
    el.innerHTML = '<p class="small muted">Notifications are blocked for this site. Allow them in your browser\'s site settings, then come back here.</p>';
    return;
  }
  const { reg, sub } = await pushSubscription();
  // Re-send a live subscription, in case the server forgot it.
  if (sub) api('/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
  el.innerHTML = sub
    ? `<p class="small muted">${icon('check')} Notifications on for this phone · <button class="link" data-act="push-off">Turn off</button></p>`
    : `<div class="notify-row"><span><b>Get a notification</b> on this phone when a captain registers fish.</span><button class="primary" data-act="push-on">Turn on notifications</button></div>`;
  // Once on, it's a quiet line rather than a card.
  el.classList.toggle('card', !sub);
  el.classList.toggle('pad', !sub);
  el.classList.toggle('notify-on', !!sub);
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    btn.disabled = true;
    try {
      if (btn.dataset.act === 'push-on') {
        if ((await Notification.requestPermission()) !== 'granted') {
          toast('Notifications were not allowed.');
        } else {
          const { publicKey } = await api('/push/key');
          const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey(publicKey) });
          await api('/push/subscribe', { method: 'POST', body: fresh.toJSON() });
          toast('Notifications are on');
        }
      } else {
        await api('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
        toast('Notifications are off');
      }
    } catch (ex) {
      toast(ex.message || 'Could not change notifications.');
    }
    renderNotify(el);
  };
}

function renderNav(active = state.navActive) {
  state.navActive = active;
  syncClubChip();
  const links = [
    ['#/', 'Feed', 'home', 'feed'],
    ['#/points', 'Leaderboard', 'points', 'leaderboard'],
  ];
  if (state.me?.teamId) links.push(['#/new', 'Post', 'new', 'catch', 'cta']);
  links.push(['#/participants', 'Participants', 'participants', 'participants']);
  links.push(['#/more', 'More', 'more', 'more']);
  const current = {
    boat: 'participants', user: 'participants', records: 'points', leaderboard: 'points', tournament: 'points', scoring: 'points',
    rules: 'more', install: 'more', spots: 'more', clubs: 'more', club: 'more', profile: 'more', crew: 'more', login: 'more', register: 'more', forgot: 'more', reset: 'more', members: 'more', 'admin-boats': 'more', tournaments: 'more', enter: 'more', sheet: 'more', 'club-members': 'more', pending: 'more', history: 'more', weigh: 'more', review: 'more', calendar: 'more',
  }[active] || active;
  // Signed in, More shows your photo (or initials), like a profile tab.
  const me = state.me;
  const avatar = me && (me.photoUrl ? `<img class="nav-avatar" src="${esc(me.photoUrl)}" alt="">`
    : `<span class="nav-avatar initials">${esc(((me.firstName || me.name)[0] + (me.lastName?.[0] || '')).toUpperCase())}</span>`);
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, icon, cls]) => `<a href="${href}" class="${cls || ''}"${key === current ? ' aria-current="page"' : ''}${key === 'more' ? ' data-nav="more"' : ''}>
      <span class="nav-icon">${key === 'more' && avatar ? avatar : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`}${key === 'more' && state.pending
        ? `<span class="count-badge" aria-label="${state.pending} to review">${state.pending > 99 ? '99+' : state.pending}</span>` : ''}</span><span>${label}</span></a>`)
    .join('');
}

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', arg] = path.split('/');
  const view = document.createElement('div');
  const pages = pagesFor(view);
  let page = Object.hasOwn(pages, name) ? name : 'home';
  if (state.me && (page === 'login' || page === 'register')) page = 'home';
  renderNav(page);
  refreshPending();
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await pages[page](arg);
  } catch (ex) {
    view.innerHTML = html`<div class="card pad empty"><p>${ex.message}</p><a href="#/">Back to the feed</a></div>`;
  }
}

// Auto, light or dark: chosen with the brush on More. Auto follows the phone's own
// setting (light if it has none) and is where everyone starts.
const THEME_COLORS = { dark: '#1d1e21', light: '#f3f8fc' };
// A new key: choices saved before Auto existed (under 'theme') no longer count.
const THEME_KEY = 'appearance';
try {
  localStorage.removeItem('theme');
} catch {
  // Nothing saved, nothing to clear.
}
const phoneDark = matchMedia('(prefers-color-scheme: dark)');
const themeChoice = () => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
};
function applyTheme(choice = themeChoice()) {
  const theme = choice === 'auto' ? (phoneDark.matches ? 'dark' : 'light') : choice;
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[theme]);
  // Light is "only light" so a browser's own dark mode (Samsung Internet) leaves it light.
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', theme === 'light' ? 'only light' : 'dark');
}
applyTheme();
// Following the phone: change when the phone does.
phoneDark.addEventListener('change', () => {
  if (themeChoice() === 'auto') applyTheme('auto');
});
const themeButton = () => {
  const now = themeChoice();
  const choice = (value, iconName, label) => `<button type="button" role="menuitemradio" data-theme-choice="${value}" aria-checked="${now === value}">
    ${icon(iconName)} ${label}${now === value ? `<span class="tick">${icon('check')}</span>` : ''}</button>`;
  return `<div class="theme-pick">
    <button type="button" class="theme-btn" aria-label="Appearance: auto (the phone's setting), light or dark" aria-haspopup="true" aria-expanded="false">${icon('brush')}</button>
    <div class="theme-menu" role="menu" hidden>${choice('auto', 'settings', 'Auto')}${choice('light', 'sun', 'Light')}${choice('dark', 'moon', 'Dark')}</div></div>`;
};
// The brush on More opens the choice; a tap anywhere else closes it.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.theme-pick');
  for (const open of document.querySelectorAll('.theme-pick')) {
    if (open !== pick) {
      open.querySelector('.theme-menu').hidden = true;
      open.querySelector('.theme-btn').setAttribute('aria-expanded', 'false');
    }
  }
  if (!pick) return;
  const choice = e.target.closest('[data-theme-choice]');
  if (!choice) {
    const menu = pick.querySelector('.theme-menu');
    menu.hidden = !menu.hidden;
    pick.querySelector('.theme-btn').setAttribute('aria-expanded', String(!menu.hidden));
    return;
  }
  const value = choice.dataset.themeChoice;
  try {
    if (value === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  applyTheme(value);
  pick.outerHTML = themeButton();
});

// ---- installing the app (a PWA) ----------------------------------------------

// The service worker makes the app installable and lets it open without signal.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Chrome, Edge and Samsung Internet offer their own install prompt; it's kept
// for the Install button on More. iPhones are shown how instead.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  document.querySelector('[data-install-ready]')?.removeAttribute('hidden');
});
// The Install button on More: the browser's own install where it offers one,
// otherwise the steps for this phone.
async function installApp() {
  if (!installPrompt) {
    location.hash = '#/install';
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') document.querySelector('.install-card')?.remove();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-install]')) installApp();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  document.querySelector('.install-card')?.remove();
  toast('Installed. Open West Africa Big Game from your home screen.');
});
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Like Instagram's profile tab: a JHMMC member double-taps More to switch feeds.
let lastMoreTap = 0;
document.getElementById('nav').addEventListener('click', (e) => {
  if (!e.target.closest('[data-nav=more]') || !state.me?.jhmmc) return;
  const now = Date.now();
  if (now - lastMoreTap < 400) {
    e.preventDefault();
    lastMoreTap = 0;
    const next = feedPref() === 'club' ? 'wa' : 'club';
    location.hash = `#/?feed=${next}`;
    toast(`${FEED_NAMES[next]} feed`);
    return;
  }
  lastMoreTap = now;
});

// "Sign in" links inside a page come back to that page afterwards.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-return]')) state.afterLogin = location.hash;
});

(async function init() {
  [state.meta] = await Promise.all([api('/meta'), refreshMe()]);
  window.addEventListener('hashchange', route);
  route();
})();
