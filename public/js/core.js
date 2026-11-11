// Africa Sportfishing, part of the app (public/js/core.js): Helpers: templates, the server, toasts, units, dates and clocks, photos, the map library loader.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

// ---- helpers --------------------------------------------------------------

const state = { me: null, meta: null, clubs: null, afterLogin: null, pending: 0, navActive: null };
const main = document.getElementById('view');

// ---- the Android app (Google Play) ----------------------------------------
// There the site runs in a native shell (Capacitor). Android's own location takes the
// browser's place: it asks with the phone's Allow dialog and, when the phone's location
// is off, offers to turn it on right there. Notifications come through Firebase (main.js).
const NATIVE = !!(window.Capacitor?.isNativePlatform?.() && window.Capacitor.nativePromise);
const IOS_APP = NATIVE && window.Capacitor.getPlatform?.() === 'ios';
// Where the phone's own switches are, for a permission said no to.
const appSettings = (what) => (IOS_APP ? `Settings → Africa Sportfishing → ${what}`
  : `Settings → Apps → Africa Sportfishing → ${what === 'Notifications' ? 'Notifications' : `Permissions → ${what}`}`);
const native = (plugin, method, options = {}) => window.Capacitor.nativePromise(plugin, method, options);
const nativeListen = (plugin, eventName, fn) => window.Capacitor.nativeCallback(plugin, 'addListener', { eventName }, fn);
if (NATIVE && navigator.geolocation) {
  // The same calls as the browser's, so every page works unchanged.
  const geo = navigator.geolocation;
  const position = (p) => ({ coords: { ...p.coords }, timestamp: p.timestamp });
  // The plugin's codes (OS-PLUG-GLOC-00nn) as the browser's: 1 no permission (or location
  // left off), 3 too slow, 2 anything else.
  const failure = (e) => {
    const n = Number(String(e?.code ?? '').slice(-4));
    return { code: n === 3 || n === 9 || n === 7 ? 1 : n === 10 ? 3 : 2, message: e?.message || 'No position' };
  };
  const options = (o = {}) => ({ enableHighAccuracy: !!o.enableHighAccuracy, timeout: o.timeout ?? 60000, maximumAge: o.maximumAge ?? 0 });
  const watches = new Map();
  let nextWatch = 1;
  const set = (name, value) => Object.defineProperty(geo, name, { value, configurable: true, writable: true });
  set('getCurrentPosition', (ok, fail, o) => {
    native('Geolocation', 'getCurrentPosition', options(o)).then((p) => ok(position(p)), (e) => fail?.(failure(e)));
  });
  set('watchPosition', (ok, fail, o) => {
    const id = nextWatch++;
    watches.set(id, window.Capacitor.nativeCallback('Geolocation', 'watchPosition', options(o), (p, e) => {
      if (!watches.has(id)) return;
      if (e) fail?.(failure(e));
      else if (p) ok(position(p));
    }));
    return id;
  });
  set('clearWatch', (id) => {
    const callbackId = watches.get(id);
    watches.delete(id);
    if (callbackId != null) Promise.resolve(callbackId).then((c) => native('Geolocation', 'clearWatch', { id: c })).catch(() => {});
  });
}
// Location permission: 'granted', 'denied' or 'prompt'.
async function locationPermission() {
  if (NATIVE) {
    try { const r = (await native('Geolocation', 'checkPermissions')).location; return r === 'granted' || r === 'denied' ? r : 'prompt'; } catch { return 'prompt'; }
  }
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}

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
      // With no signal at all (or when asked not to wait) it fails at once.
      if (init.method === 'GET' && !opts.once && navigator.onLine !== false && attempt < RETRY_WAITS.length) {
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
    try { localStorage.removeItem('kept-me'); } catch {}
    location.hash = '#/login';
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

// A fish logged: a short buzz and a tick that pops up, then fades.
function celebrate(title, sub = '') {
  try { navigator.vibrate?.([18, 40, 28]); } catch { /* not on every phone */ }
  document.querySelector('.celebrate')?.remove();
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.setAttribute('role', 'status');
  el.innerHTML = html`<span class="celebrate-tick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><b>${title}</b>${sub ? raw(html`<span>${sub}</span>`) : ''}`;
  document.body.append(el);
  setTimeout(() => el.classList.add('out'), 1500);
  setTimeout(() => el.remove(), 1900);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2500);
}

const kgToLb = (kg) => Math.round(kg * 2.20462);
// Units, chosen on More (kg or lb, metres or feet, °C or °F) and kept on this
// phone. Everything is stored metric; only what's shown and typed changes.
const UNIT_KEY = 'units';
const UNIT_CHOICES = { weight: ['kg', 'lb'], depth: ['m', 'ft'], temp: ['°C', '°F'] };
function unitPrefs() {
  // Signed in: the account's choice (picked when it was made, or on More); else this phone's.
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(UNIT_KEY) || '{}'); } catch {}
  saved = { ...saved, ...(state.me?.units || {}) };
  return Object.fromEntries(Object.entries(UNIT_CHOICES).map(([k, [first, ...rest]]) => [k, rest.includes(saved[k]) ? saved[k] : first]));
}
const round1 = (n) => Math.round(n * 10) / 10;
// To what's shown, and from what was typed back to metric (empty stays empty).
const UNIT_MATH = {
  lb: [(kg) => kg * 2.20462, (lb) => lb / 2.20462],
  ft: [(m) => m * 3.28084, (ft) => ft / 3.28084],
  '°F': [(c) => (c * 9) / 5 + 32, (f) => ((f - 32) * 5) / 9],
};
const toUnit = (kind, v) => (v == null || v === '' ? '' : round1((UNIT_MATH[unitPrefs()[kind]]?.[0] ?? Number)(Number(v))));
const fromUnit = (kind, v) => (v == null || String(v).trim() === '' ? '' : round1((UNIT_MATH[unitPrefs()[kind]]?.[1] ?? Number)(Number(String(v).replace(',', '.')))));
const unit = (kind) => unitPrefs()[kind];
// The three choices as tap-to-pick chips, for Create account and More.
const UNIT_LABELS = { weight: ['Weight', { kg: 'kg', lb: 'lb' }], depth: ['Depth', { m: 'metres', ft: 'feet' }], temp: ['Water temperature', { '°C': '°C', '°F': '°F' }] };
const unitFields = () => {
  const now = unitPrefs();
  return Object.entries(UNIT_LABELS).map(([k, [label, names]]) => `<div class="unit-row"><span>${label}</span><div class="chips">${
    UNIT_CHOICES[k].map((u) => `<label class="chip2"><input type="radio" name="unit_${k}" value="${esc(u)}"${now[k] === u ? ' checked' : ''}> ${esc(names[u])}</label>`).join('')}</div></div>`).join('');
};
const unitsFrom = (form) => Object.fromEntries(Object.keys(UNIT_CHOICES).map((k) => [k, form.querySelector(`[name=unit_${k}]:checked`)?.value]));
function saveUnitsHere(units) {
  try { localStorage.setItem(UNIT_KEY, JSON.stringify(units)); } catch {}
}
const fmtWeight = (kg) => (kg == null ? '' : unit('weight') === 'lb' ? `${kgToLb(kg)} lb` : `${+kg.toFixed(1)} kg`);
const fmtDepth = (m) => (m == null ? '' : `${Math.round(toUnit('depth', m))} ${unit('depth')}`);
const fmtTemp = (c) => (c == null ? '' : `${toUnit('temp', c)}${unit('temp')}`);
// Stored times look like "2026-10-28 14:05:00" (UTC); iPhones only read them with a "T".
const parseTime = (d) => new Date(d.length === 10 ? `${d}T12:00:00` : `${d.replace(' ', 'T')}${/Z|[+-]\d\d:\d\d$/.test(d) ? '' : 'Z'}`);
const fmtDate = (d) => parseTime(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
// A stored time ("2026-10-28 14:05:00", UTC) as local day and time.
const fmtWhen = (d) => parseTime(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
// "Today" on the boat's clock (its country's; the server says which), Monrovia's if
// signed out. West African clocks never change, so this is the same all year.
const myZone = () => state.me?.timeZone || 'Africa/Monrovia';
const dateIn = (zone, at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(at instanceof Date ? at : new Date(at));
const hourIn = (zone, at = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(at));
const today = () => dateIn(myZone());
// Who weighed a registered fish: the weighmaster (as the rules want) or, without one, the captain.
const weigherBadge = (c) => (c.weighRole === 'weighmaster' ? `<span class="badge new">Weighmaster${c.weighedByName ? `: ${esc(c.weighedByName)}` : ''}</span>`
  : c.weighRole === 'captain' || c.weighRole === 'own' ? `<span class="badge guest">${c.weighRole === 'captain' ? "Captain's weigh-in" : "Own boat's weigh-in"}${c.weighedByName ? `: ${esc(c.weighedByName)}` : ''}</span>${c.weighReason ? ` <span class="small">${esc(c.weighReason)}</span>` : ''}`
    : c.weighRole === 'officer' ? `<span class="badge">Entered by ${c.weighedByName ? esc(c.weighedByName) : 'an officer'}</span>` : '');
const plural = (n, word) => `${n} ${word}${n === 1 || word.endsWith('fish') ? '' : word.endsWith('ch') ? 'es' : 's'}`;

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

// The pages, in groups: each pages-*.js part adds one (a function of the page's element).
const PAGE_GROUPS = [];
