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
const today = () => new Date().toISOString().slice(0, 10);
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

// PDFs for the club (leaderboard, members, tournament sheets): jsPDF 2.5.2 and
// jspdf-autotable 3.8.4, kept in public/vendor, loaded the first time one is made.
let pdfLib = null;
function loadPdf() {
  const script = (src) => new Promise((resolve, reject) => {
    const js = document.createElement('script');
    js.src = src; js.onload = resolve; js.onerror = reject;
    document.head.append(js);
  });
  pdfLib ??= script('/vendor/jspdf/jspdf.umd.min.js').then(() => script('/vendor/jspdf/jspdf.plugin.autotable.min.js'))
    .then(() => window.jspdf.jsPDF)
    .catch(() => { pdfLib = null; throw new Error("The PDF maker couldn't load. Check your connection and try again."); });
  return pdfLib;
}
const imageData = (url) => fetch(url).then((r) => r.blob()).then((b) => new Promise((done) => {
  const fr = new FileReader(); fr.onload = () => done(fr.result); fr.readAsDataURL(b);
}));
// One A4 PDF: the logos and title on top, then a table per section, page numbers at the foot.
// sections: [{ heading, head: [...], body: [[...]], widths?: {col: pt} }]
async function savePdf({ title, subtitle = '', sections, file }) {
  const JsPdf = await loadPdf();
  const [logo, crest] = await Promise.all([imageData('/logo-mark.png'), imageData('/jhmmc-logo.png')]).catch(() => []);
  const doc = new JsPdf({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const NAVY = [0, 26, 67];
  if (logo) doc.addImage(logo, 'PNG', 40, 28, 44, 44, 'logo', 'FAST');
  if (crest) doc.addImage(crest, 'PNG', W - 92, 32, 52, 44, 'crest', 'FAST');
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text('AFRICA SPORTFISHING', 92, 47);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90, 100, 120).text('JHMMC · Jim Holder Memorial Marine Club', 92, 62);
  const made = new Date().toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...NAVY).text(title, 40, 112, { maxWidth: W - 80 });
  let y = 112 + (doc.splitTextToSize(title, W - 80).length - 1) * 22;
  if (subtitle) {
    doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(90, 100, 120).text(subtitle, 40, y + 18, { maxWidth: W - 80 });
    y += 18 + (doc.splitTextToSize(subtitle, W - 80).length - 1) * 14;
  }
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...NAVY).text(`Generated ${made}`, 40, y + 16);
  y += 16;
  y += 22;
  for (const s of sections) {
    if (s.newPage) { doc.addPage(); y = 50; continue; }
    if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 50; }
    if (s.heading) { doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...NAVY).text(s.heading, 40, y + 4); y += 12; }
    // A bar chart: one bar per row, the value at its end (bars grow from zero; a negative one points left).
    if (s.bars) {
      const labelW = 130; const x0 = 40 + labelW; const full = W - 40 - x0 - 50;
      const lo = Math.min(0, ...s.bars.map((b) => b.value)); const hi = Math.max(0, ...s.bars.map((b) => b.value));
      const at = (v) => x0 + ((v - lo) / (hi - lo || 1)) * full;
      y += 10;
      for (const b of s.bars) {
        doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(20, 30, 50).text(doc.splitTextToSize(b.label, labelW - 10)[0], 40, y + 10);
        const [a, z] = [Math.min(at(0), at(b.value)), Math.max(at(0), at(b.value))];
        doc.setFillColor(...(b.value < 0 ? [198, 40, 40] : NAVY)).roundedRect(a, y, Math.max(z - a, 1.5), 13, 2, 2, 'F');
        doc.setFont('helvetica', 'bold').text(String(b.value), b.value < 0 ? a - 4 : z + 5, y + 10, { align: b.value < 0 ? 'right' : 'left' });
        y += 21;
      }
      doc.setDrawColor(200, 208, 220).line(at(0), y - 21 * s.bars.length - 3, at(0), y - 6);
      y += 18;
      continue;
    }
    doc.autoTable({
      startY: y, head: [s.head], body: s.body.length ? s.body : [[{ content: s.none || 'None.', colSpan: s.head.length }]],
      margin: { left: 40, right: 40, bottom: 50 }, theme: 'striped',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 5, textColor: [20, 30, 50] },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [242, 245, 250] },
      columnStyles: s.widths || {},
      // Number columns: the heading lines up with the numbers.
      didParseCell: (d) => {
        if (d.section === 'head' && s.widths?.[d.column.index]?.halign) d.cell.styles.halign = s.widths[d.column.index].halign;
        s.paint?.(d);
      },
    });
    y = doc.lastAutoTable.finalY + 30;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(130, 140, 155);
    doc.text(`Generated ${made} · africasportfishing.com`, 40, doc.internal.pageSize.getHeight() - 24);
    doc.text(`Page ${i} of ${pages}`, W - 40, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
  }
  doc.save(file);
}
const fileName = (s) => `${s.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-')}.pdf`;
// A "Download PDF" button: shows it's working, says what went wrong.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-pdf]');
  if (!btn || !btn.pdf) return;
  const was = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Making the PDF…';
  try { await savePdf(await btn.pdf()); } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.innerHTML = was; }
});
const pdfButton = (label = 'Download PDF') => `<button type="button" class="btn pdf-btn" data-pdf>${icon('download')} ${esc(label)}</button>`;

// The maps: satellite imagery (Esri World Imagery) with borders and place
// names (country, city, town) on top.
function addSatellite(L, map) {
  const esri = (service) => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  L.tileLayer(esri('World_Imagery'), { maxZoom: 18, attribution: 'Imagery © Esri' }).addTo(map);
  L.tileLayer(esri('Reference/World_Boundaries_and_Places'), { maxZoom: 18 }).addTo(map);
  // Places the club wants on every map.
  for (const p of MAP_PLACES) {
    L.circleMarker([p.lat, p.lng], { radius: 5, weight: 2, color: '#ffffff', fillColor: '#f5a524', fillOpacity: 1 })
      .bindTooltip(p.name, { permanent: true, direction: 'right', className: 'place-label', offset: [6, 0] })
      .addTo(map);
  }
}
// Each with its name and position.
const MAP_PLACES = [
  { name: 'Marshall', lat: 6.15, lng: -10.3833 },
];
const spotPin = (L, released) => ({ radius: 9, weight: 3, color: '#ffffff', fillColor: released ? '#3fcf8e' : '#2f7cf6', fillOpacity: 1 });
// The small map on a catch's page, on satellite imagery.
// The depth charts as one map layer: map tiles (sharp at every zoom, only the
// part in view is loaded) or, for an older chart, one picture.
const depthLayer = (L, charts) => L.layerGroup(charts.map((c) => {
  const bounds = [[c.bounds.south, c.bounds.west], [c.bounds.north, c.bounds.east]];
  return c.tiles
    // From zoom 8, where the lines can be read; further out they'd only show as dark patches.
    ? L.tileLayer(c.tiles, { bounds, minZoom: 8, minNativeZoom: c.minZoom, maxNativeZoom: c.maxZoom, opacity: 0.95, className: 'depth-tiles' })
    : L.imageOverlay(c.url, bounds, { opacity: 0.95 });
}));

async function drawSpotMaps(root) {
  const boxes = [...root.querySelectorAll('.spot-map-view:not(.leaflet-container)')];
  if (!boxes.length) return;
  let L;
  try {
    L = await loadLeaflet();
  } catch {
    for (const box of boxes) box.outerHTML = '<p class="small muted">The map couldn\'t load just now.</p>';
    return;
  }
  for (const box of boxes) {
    const at = [Number(box.dataset.lat), Number(box.dataset.lng)];
    const map = L.map(box, { scrollWheelZoom: false }).setView(at, 11);
    addSatellite(L, map);
    L.circleMarker(at, spotPin(L, box.dataset.released === 'true')).addTo(map);
  }
}

// A post's media: its video (with the first photo as the still before it plays)
// and its photos; more than one swipes sideways.
function mediaHtml(item, alt = '') {
  const photos = item.photos ?? (item.photoUrl ? [{ url: item.photoUrl }] : []);
  const slides = [
    ...photos.map((x) => html`<img class="catch-photo" src="${x.url}" alt="${alt}" loading="lazy">`),
    // A video only reaches officers and the boat's crew; it goes after the photos.
    ...(item.videoUrl ? [html`<video class="catch-photo" src="${item.videoUrl}" controls playsinline preload="metadata"></video>`] : []),
  ];
  if (slides.length < 2) return slides[0] ?? '';
  return html`<div class="gallery-wrap"><div class="gallery">${slides.map((x) => raw(x))}</div>
    <span class="gallery-count">${raw(icon('camera'))} ${slides.length}</span></div>`;
}

// An empty page or list: a picture, a line, and the next step if there is one.
function emptyState(iconName, text, action = null) {
  return html`<div class="card empty-state"><span class="es-icon">${raw(icon(iconName))}</span><p>${text}</p>
    ${action ? raw(html`<a class="btn primary" href="${action[0]}">${action[1]}</a>`) : ''}</div>`;
}

// Club roles and how they read.
const ROLE_OPTIONS = [['', 'Member'], ['president', 'President'], ['vice_president', 'Vice President'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']];
const roleLabel = (role) => ROLE_OPTIONS.find(([k]) => k === role)?.[1] || role;

// A photo field that shows the photo already saved (a plain file box always
// says "No file chosen"), and the new one as soon as it's picked.
const photoField = (label, current) => html`<div class="photo-field"><span class="spot-head">${label}</span>
  <div class="photo-field-row">
    <img class="photo-field-img" src="${current || ''}" alt="" ${current ? '' : 'hidden'}>
    <label class="btn">${raw(icon('camera'))} <span>${current ? 'Change photo' : 'Add a photo'}</span>
      <input name="photo" type="file" accept="image/*" hidden></label>
  </div></div>`;
document.addEventListener('change', (e) => {
  const input = e.target.closest('.photo-field input[type=file]');
  const file = input?.files?.[0];
  if (!file) return;
  const img = input.closest('.photo-field').querySelector('img');
  img.src = URL.createObjectURL(file);
  img.hidden = false;
  input.closest('label').querySelector('span').textContent = 'Change photo';
});

// The registration record, one entry per fish: where it stands now, and
// everything that happened to it, in order.
const LOG_ACTIONS = {
  registered: 'Registered', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
  repointed: 'Corrected', uncounted: 'Taken off the points',
};
const LOG_STATUS = {
  registered: 'Waiting', withdrawn: 'Withdrawn', deleted: 'Deleted', disputed: 'Disputed', approved: 'Approved', rejected: 'Rejected',
  repointed: 'Approved', uncounted: 'Not counted',
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

// ---- trends (Log → Trends) ---------------------------------------------------
// Year against year by month, what's biting now, and water against billfish by
// week. Lines and bars in plain SVG; colours from --series-1..3 (validated,
// colour-blind safe), every series also named in a legend and at its line end.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function trendsHtml(tr, { perBoat, link, mine }) {
  const W = 340; const H = 150; const L = 28; const R = 44; const T = 10; const B = 22;
  const x = (i, n) => L + (i * (W - L - R)) / (n - 1);
  const value = (m) => (perBoat ? (m.boats ? m.count / m.boats : 0) : m.count);
  const top = Math.max(1, ...tr.years.flatMap((y) => y.months.map(value)));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const nice = (v) => (perBoat ? (Math.round(v * 10) / 10) : Math.round(v));
  const grid = [0, top / 2, top].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="tr-grid"/><text x="${L - 4}" y="${y(g) + 4}" class="tr-axis" text-anchor="end">${nice(g)}</text>`).join('');
  // This year's line stops at this month: the months to come aren't zeros.
  const thisYear = String(new Date().getFullYear());
  const thisMonth = new Date().getMonth();
  const lines = tr.years.map((yr, k) => {
    const pts = yr.months.slice(0, yr.year === thisYear ? thisMonth + 1 : 12).map((m, i) => [x(i, 12), y(value(m))]);
    const last = pts[pts.length - 1];
    return `<g class="tr-s${k + 1}"><polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="tr-line"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" class="tr-dot"><title>${esc(`${MONTH_SHORT[i]} ${yr.year}: ${nice(value(yr.months[i]))} ${tr.species ? tr.species.toLowerCase() : 'fish'}${perBoat ? ' per boat' : ''}`)}</title></circle>`).join('')}
      <text x="${last[0] + 6}" y="${last[1] + 4}" class="tr-label">${yr.year}</text></g>`;
  }).join('');
  const months = MONTH_SHORT.map((m, i) => (i % 2 ? '' : `<text x="${x(i, 12)}" y="${H - 6}" class="tr-axis" text-anchor="middle">${m[0]}</text>`)).join('');
  // "Sailfish arrived 3 weeks earlier than last year"
  const [cur, prev] = tr.years;
  let arrival = '';
  if (cur?.first && prev?.first) {
    const doy = (d) => (Date.parse(d) - Date.parse(`${d.slice(0, 4)}-01-01`)) / 864e5;
    const weeks = Math.round((doy(prev.first) - doy(cur.first)) / 7);
    arrival = weeks === 0 ? `${tr.species} arrived about the same time as in ${prev.year}.`
      : `${tr.species} arrived ${Math.abs(weeks)} week${Math.abs(weeks) === 1 ? '' : 's'} ${weeks > 0 ? 'earlier' : 'later'} than in ${prev.year} (first caught ${fmtDate(cur.first)}).`;
  } else if (cur?.first) arrival = `First ${tr.species.toLowerCase()} this year: ${fmtDate(cur.first)}.`;
  const yearChart = tr.species ? `<h2>Year against year${info(perBoat ? '<p>Fish per boat that logged fish that month, so more boats on the app doesn\'t look like more fish.</p>' : '<p>Fish caught each month. Tap “Per boat logging fish” to allow for more boats using the app.</p>')}</h2><div class="card pad">
    <label class="season-species">${esc(tr.species)} caught, by month
      <select id="trend-species">${options(tr.speciesList.map((v) => [v, v]), tr.species)}</select></label>
    <div class="tr-legend">${tr.years.map((yr, k) => `<span class="tr-s${k + 1}"><i></i>${yr.year}</span>`).join('')}
      <a class="small" href="${link({ per: perBoat ? '' : 'boat' })}">${perBoat ? 'Show totals' : 'Per boat logging fish'}</a></div>
    <svg viewBox="0 0 ${W} ${H}" class="tr-svg" role="img" aria-label="${esc(tr.species)} by month, year against year">${grid}${months}${lines}</svg>
    ${arrival ? `<p class="small">${esc(arrival)}</p>` : ''}
    <table class="sr-only"><thead><tr><th>Month</th>${tr.years.map((yr) => `<th>${yr.year}</th>`).join('')}</tr></thead>
      <tbody>${MONTH_SHORT.map((m, i) => `<tr><td>${m}</td>${tr.years.map((yr) => `<td>${nice(value(yr.months[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </div>` : '<div class="card pad empty">Trends start once fish are logged.</div>';

  // What's biting now
  const arrow = (r) => (r.now > r.before ? '↑ up' : r.now < r.before ? '↓ down' : '= same');
  const biting = `<h2>What's biting now${info(`<p>Fish caught in the last 14 days against the 14 before${mine ? '' : `, from ${plural(tr.now.boats, 'boat')} (${tr.now.boatsBefore} before)`}.</p>`)}</h2><div class="card">
    ${tr.now.biting.length ? `<ul class="list">${tr.now.biting.slice(0, 8).map((r) => `<li class="biting">
      <span><b>${esc(r.species)}</b>${r.area ? ` <span class="small muted">· mostly ${esc(r.area)}</span>` : ''}</span>
      <span class="small"><b>${r.now}</b> <span class="muted">vs ${r.before}</span> · ${arrow(r)}</span></li>`).join('')}</ul>`
      : '<p class="pad muted">No fish logged in the last four weeks.</p>'}</div>`;

  // Water and billfish by week: two charts on the same weeks (never two scales on one chart).
  const n = tr.weeks.length;
  const temps = tr.weeks.map((w) => (w.water == null ? null : toUnit('temp', w.water)));
  const tv = temps.filter((v) => v != null);
  const SW = 340; const SH = 90;
  const sx = (i) => L + (i * (SW - L - 8)) / (n - 1);
  let water = '';
  if (tv.length) {
    const lo = Math.floor(Math.min(...tv)) - 1; const hi = Math.ceil(Math.max(...tv)) + 1;
    const sy = (v) => 8 + (SH - 22) * (1 - (v - lo) / (hi - lo || 1));
    const segs = []; let cur2 = [];
    temps.forEach((v, i) => { if (v == null) { if (cur2.length) segs.push(cur2); cur2 = []; } else cur2.push(`${sx(i)},${sy(v)}`); });
    if (cur2.length) segs.push(cur2);
    water = `<svg viewBox="0 0 ${SW} ${SH}" class="tr-svg" role="img" aria-label="Water temperature by week">
      <line x1="${L}" x2="${SW - 8}" y1="${sy(hi)}" y2="${sy(hi)}" class="tr-grid"/><line x1="${L}" x2="${SW - 8}" y1="${sy(lo)}" y2="${sy(lo)}" class="tr-grid"/>
      <text x="${L - 4}" y="${sy(hi) + 4}" class="tr-axis" text-anchor="end">${hi}</text><text x="${L - 4}" y="${sy(lo) + 4}" class="tr-axis" text-anchor="end">${lo}</text>
      <g class="tr-s1">${segs.map((sg) => `<polyline points="${sg.join(' ')}" class="tr-line"/>`).join('')}
      ${temps.map((v, i) => (v == null ? '' : `<circle cx="${sx(i)}" cy="${sy(v)}" r="3.5" class="tr-dot"><title>Week of ${fmtDate(tr.weeks[i].start)}: ${v}${unit('temp')}</title></circle>`)).join('')}</g></svg>`;
  }
  const bTop = Math.max(1, ...tr.weeks.map((w) => w.billfish));
  const bw = (SW - L - 8) / n - 2;
  const bars = `<svg viewBox="0 0 ${SW} ${SH}" class="tr-svg" role="img" aria-label="Billfish caught by week">
    <line x1="${L}" x2="${SW - 8}" y1="${SH - 14}" y2="${SH - 14}" class="tr-grid"/>
    <text x="${L - 4}" y="${12}" class="tr-axis" text-anchor="end">${bTop}</text><text x="${L - 4}" y="${SH - 10}" class="tr-axis" text-anchor="end">0</text>
    <g class="tr-s1">${tr.weeks.map((w, i) => (w.billfish ? `<rect x="${sx(i) - bw / 2}" y="${(SH - 14) - ((SH - 22) * w.billfish) / bTop}" width="${bw}" height="${((SH - 22) * w.billfish) / bTop}" rx="2" class="tr-bar"><title>Week of ${fmtDate(w.start)}: ${w.billfish} billfish</title></rect>` : '')).join('')}</g>
    ${[0, Math.floor(n / 2), n - 1].map((i) => `<text x="${sx(i)}" y="${SH - 1}" class="tr-axis" text-anchor="middle">${new Date(`${tr.weeks[i].start}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`).join('')}</svg>`;
  const weekly = `<h2>Water and billfish, week by week${info('<p>The last 26 weeks, on the same weeks, so you can see the fish come as the water changes. Water temperature is the average of the trips that logged it.</p>')}</h2><div class="card pad">
    <p class="small"><b>Water temperature (${unit('temp')})</b></p>
    ${water || '<p class="small muted">No water temperatures logged yet.</p>'}
    <p class="small"><b>Billfish caught</b></p>${bars}</div>`;
  return yearChart + biting + weekly;
}

// Where fish are being caught, region-wide: 10 km circles shaded by fish
// caught (one hue, light to dark), for a month and species. No pins, no boats.
async function renderGridMap(box, q, link) {
  const gq = new URLSearchParams({ ...(q.get('gyear') && { year: q.get('gyear') }), ...(q.get('gspecies') && { species: q.get('gspecies') }), ...(q.get('gmonth') && { month: q.get('gmonth') }) });
  const [g, L, { charts }] = await Promise.all([api(`/outings/grid?${gq}`), loadLeaflet().catch(() => null),
    state.me?.teamId || state.me?.isAdmin ? api('/charts').catch(() => ({ charts: [] })) : { charts: [] }]);
  if (!box.isConnected) return;
  const sel = (label, items, current) => `<select class="chip-select" data-go aria-label="${label}">${options(items, current)}</select>`;
  box.innerHTML = html`<div class="filter-chips">
      ${g.years.length > 1 ? raw(sel('Year', g.years.map((y) => [link({ gyear: y, gmonth: '' }), y]), link({ gyear: g.year, gmonth: '' }))) : ''}
      ${raw(sel('Species', [[link({ gspecies: '', gmonth: '' }), 'All species'], ...g.speciesList.map((x) => [link({ gspecies: x, gmonth: '' }), x])], link({ gspecies: g.species || '', gmonth: '' })))}
      ${g.months.length ? raw(sel('Month', g.months.map((m) => [link({ gmonth: String(m) }), MONTH_SHORT[m - 1]]), link({ gmonth: String(g.month) }))) : ''}
      ${raw(info(html`<p>Each circle marks an area about 10 km across, darker where more fish were caught${g.month ? ` in ${MONTH_SHORT[g.month - 1]} ${g.year}` : ''}. Tap one for the count.</p><p>No exact spots and no boat names.${charts.length ? ' The depth contours switch on and off with the layers button.' : ''}</p>`))}
    </div>
    ${g.cells.length ? raw('<div class="card catch-map" id="grid-map"></div>') : raw('<div class="card pad empty">No fish logged with a spot for this choice yet.</div>')}`;
  if (!g.cells.length || !L) return;
  const map = L.map('grid-map', { zoomControl: true });
  addSatellite(L, map);
  // The depth chart (crews only), under the circles; on unless switched off.
  if (charts.length) {
    // All the chart areas are one layer, "Depth contours".
    const contours = depthLayer(L, charts).addTo(map);
    L.control.layers(null, { 'Depth contours': contours }, { collapsed: true, position: 'topright' }).addTo(map);
  }
  const most = Math.max(...g.cells.map((c) => c.fish));
  const fill = getComputedStyle(document.documentElement).getPropertyValue('--series-1').trim() || '#2a78d6';
  for (const c of g.cells) {
    // A circle on each 10 km area's centre, drawn a bit larger than the area so it reads well.
    L.circle([(c.south + c.north) / 2, (c.west + c.east) / 2], { radius: 12000, color: '#ffffff', weight: 1, fillColor: fill, fillOpacity: 0.2 + 0.6 * (c.fish / most) })
      .addTo(map).bindPopup(`<b>${c.fish} ${c.fish === 1 ? 'fish' : 'fish'}</b><br>${c.boats === 1 ? '1 boat' : `${c.boats} boats`}`);
  }
  map.fitBounds(L.latLngBounds(g.cells.flatMap((c) => [[c.south, c.west], [c.north, c.east]])).pad(0.4), { maxZoom: 10 });
}

// Leaderboard: points, tournaments and the record book, one tab each.
// A dropdown chip whose choices are pages: picking one goes there.
document.addEventListener('change', (e) => {
  if (e.target.matches('select[data-go]')) location.hash = e.target.value.replace(/^#/, '');
});
const boardTabs = (on) => html`<div class="line-tabs" role="tablist">
  <a role="tab" href="#/leaderboard" aria-selected="${on === 'board'}">Points</a>
  <a role="tab" href="#/tournaments" aria-selected="${on === 'tournaments'}">Tournaments</a>
  <a role="tab" href="#/records" aria-selected="${on === 'records'}">Records</a></div>`;

// JHMMC boats for the secretary's weigh sheet, grouped by weigh station.
function boatOptions(boats, mine) {
  const label = (t) => `${t.name} (${t.division === 'river' ? 'River' : 'Ocean'})`;
  const order = [...new Set([mine, ...state.meta.weighStations].filter(Boolean)), null];
  const groups = order.map((w) => [w, boats.filter((t) => (t.weighStation || null) === w)]).filter(([, list]) => list.length);
  const opts = (list) => list.map((t) => `<option value="${esc(t.id)}">${esc(label(t))}</option>`).join('');
  if (groups.length < 2) return `<option value="">Choose…</option>${opts(boats)}`;
  return `<option value="">Choose…</option>${groups.map(([w, list]) =>
    `<optgroup label="${esc(w ? (w === mine ? `${w} (your station)` : w) : 'Other weigh stations')}">${opts(list)}</optgroup>`).join('')}`;
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
    // An <img> applies the photo's EXIF rotation, so a portrait photo stays portrait
    // (createImageBitmap ignores it on some browsers, e.g. older Samsung Internet).
    const url = URL.createObjectURL(file);
    const img = new Image();
    try { img.src = url; await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
    img.width = img.naturalWidth; img.height = img.naturalHeight;
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

// Tapping a photo opens it whole, any shape, full screen; tap again to close.
const PHOTO_URL = /\.(jpe?g|png|webp)(\?|$)/i;
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[target="_blank"]');
  const img = !a && e.target.closest('img.catch-photo, img[data-view]');
  const src = a && PHOTO_URL.test(a.getAttribute('href') || '') ? a.getAttribute('href') : img && !img.closest('a') ? img.currentSrc || img.src : '';
  if (!src) return;
  e.preventDefault();
  let dlg = document.getElementById('photo-viewer');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'photo-viewer';
    dlg.innerHTML = '<img alt=""><button type="button" class="pv-close" aria-label="Close">×</button>';
    dlg.addEventListener('click', () => dlg.close());
    document.body.append(dlg);
  }
  dlg.querySelector('img').src = src;
  dlg.showModal();
});

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

// Who's signed in and the species list are kept on the phone too, so the app
// (and Log fish) opens at sea even before the offline copy has them.
const kept = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
async function refreshMe() {
  try {
    state.me = (await api('/me')).user;
    keep('kept-me', state.me);
  } catch (err) {
    if (err.status) throw err;
    state.me = kept('kept-me'); // no signal: the last one seen
  }
}

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
        location.hash = '#/';
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
    ${x.canDelete ? raw('<button type="button" class="link danger small" data-act="drop-ann">Remove</button>') : ''}</div>
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
  <span class="pill ${x.kind === 'weighin' ? 'kept' : x.fate}">${x.kind === 'weighin' ? 'Weigh-in' : x.fate === 'released' ? 'Released' : x.fate === 'kept' ? 'Boated' : 'Lost'}</span>
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

// The first thing a visitor sees: navy, the logo's marlin, one line, two buttons.
const HERO = `<section class="hero welcome">
  <img class="welcome-mark" src="/logo-mark.png" alt="">
  <p class="welcome-eyebrow">JHMMC · Liberia</p>
  <h1>Every big fish in West Africa, in one place</h1>
  <p>Weigh-ins, the leaderboard and every boat's fish, live.</p>
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

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => ({
  async home() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    // Fish logged at sea show under All; Weigh-ins and Announcements have their own tabs.
    const type = ['weighins', 'announcements'].includes(q.get('type')) ? q.get('type') : 'all';
    const tab = (key, label) => html`<a role="tab" href="#/${key === 'all' ? '' : `?type=${key}`}" aria-selected="${type === key}">${label}</a>`;
    // JHMMC's officers (and the admin) post announcements: a tournament, membership to pay…
    const officer = !!state.me?.canReview;
    view.innerHTML = html`${raw(noBoatBanner())}
      ${officer ? raw(html`<details class="card pad ann-new"><summary>${raw(icon('edit'))} New announcement</summary>
        <form class="stack" id="ann">
          <label>Title <input name="title" required maxlength="120" placeholder="e.g. Tournament this Saturday"></label>
          <label>Message <textarea name="body" maxlength="2000" rows="3" placeholder="e.g. Remember to pay your membership before Friday."></textarea></label>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post announcement</button></div>
        </form></details>`) : ''}
      <div id="tournament-call"></div>
      <div id="weigh-call"></div>
      <div class="line-tabs feed-tabs" role="tablist">${raw(tab('all', 'All'))}${raw(tab('weighins', 'Weigh-ins'))}${raw(tab('announcements', 'Announcements'))}</div>
      ${state.me ? raw('<div id="notify" class="feed-notify"></div>') : ''}
      <div id="feed"></div>`;
    // Today's trip, for the cards at the top: fish boated but not weighed in yet,
    // and from 3 pm a reminder to finish the trip (the boat's captain).
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
      view.innerHTML = html`<div class="card pad empty"><p>${body.error || "This invite link doesn't work."}</p><a href="#/">Go to the feed</a></div>`;
      return;
    }
    const { team } = body;
    const who = team.captain ? `${team.captain} invites you` : "You're invited";
    const head = html`<h1>Join ${team.name}</h1>
      <p class="muted">${who} to join the crew of <b>${team.name}</b>${team.clubName ? ` (${team.clubName})` : ''} on Africa Sportfishing.
      As crew you log your fish at sea, keep the boat's log and see its catch map.</p>`;
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
          <a class="btn primary" target="_blank" rel="noopener" href="${whatsapp(inviteMsg)}">Invite on WhatsApp</a>
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
    // Big buttons for the fish weighed most, like Log fish; the list has every species.
    const WEIGH_QUICK = ['Blue marlin', 'Yellowfin tuna', 'Sailfish', 'Dorado', 'Wahoo', 'Barracuda']
      .map((n) => state.meta.species.find((x) => x.name === n)).filter(Boolean);
    const fishRow = () => html`<fieldset class="fish card pad">
      <legend><b class="fish-no"></b> <button type="button" class="link danger" data-act="remove-fish">Remove</button></legend>
      <div class="weigh-quick">${WEIGH_QUICK.map((x) => raw(html`<button type="button" class="wq" data-sp="${x.id}">${x.name}</button>`))}</div>
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
    if (!asked && new Date().getUTCHours() < 5) {
      const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
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
    const queued = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return []; } };
    const saveQueue = (q) => { try { localStorage.setItem(QUEUE, JSON.stringify(q)); } catch {} };
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
        gps.textContent = err.code === 1
          ? 'Location is blocked: allow it for this site in your phone settings. Fish can only be logged with their spot.'
          : 'Finding GPS… Fish can be logged as soon as the spot is taken.';
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
    } else {
      gps.textContent = "This phone or browser can't share its location, so fish can't be logged at sea from it.";
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
      await api('/auth/logout', { method: 'POST' });
      state.me = null;
      try { localStorage.removeItem('kept-me'); } catch {}
      state.clubs = null;
      location.hash = '#/';
    });
  },

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
    view.querySelector('.sheet-totals').insertAdjacentHTML('afterend', `<p class="pdf-row">${pdfButton('Download the sheet (PDF)')}</p>`);
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
    view.querySelector('.sheet-totals').insertAdjacentHTML('afterend', `<p class="pdf-row">${pdfButton('Download the list (PDF)')}</p>`);
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
    const inClub = users.filter((u) => u.jhmmc).length;
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Members (${users.length})${raw(info(html`<p>Tick who belongs to JHMMC; the secretary then marks which of them have paid this season. Roles such as Secretary are set on the Club members page. Weighmasters are appointed on the Weighmasters page. When a member forgets their password, check the request came from their sign-up email, then make a reset link and send it to them. It works once and expires after 24 hours; they choose the new password themselves.</p>`))}</h1>
      ${admin ? '' : raw(recordedNote('Adding someone to JHMMC or taking them out is visible to the officers.'))}
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by name, email or boat" aria-label="Search members" autocomplete="off"></label>
      <div class="card"><ul class="list">${users.map((u) => raw(html`<li class="member-row" data-id="${u.id}" data-find="${`${u.name} ${u.nickname || ''} ${u.email} ${u.teamName || ''}`.toLowerCase()}">
        <div><b>${u.name}</b>${u.nickname ? raw(html` <span class="muted">“${u.nickname}”</span>`) : ''}<div class="muted small">${u.email}${u.teamName ? ` · ${u.teamName}` : ''}</div></div>
        ${admin ? raw('<button data-act="reset-link">Create reset link</button>') : ''}
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
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(`Hello ${name}, here is your link to set a new password for the Africa Sportfishing app. It works once, within ${hours} hours: ${link}`)}">Send on WhatsApp</a></div>`;
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
    // JHMMC boats open on the JHMMC record book; everyone else on West Africa's
    // (every approved fish weighed through JHMMC, from any boat).
    const homeId = books.find((c) => c.name.toLowerCase() === home)?.id;
    const book = q.get('club') || (state.me?.clubId && state.me.clubId === homeId ? String(homeId) : 'wa');
    const isIgfa = book === 'igfa';
    const isWa = book === 'wa';
    const got = await api('/records' + (isIgfa || isWa ? '' : `?club=${encodeURIComponent(book)}`));
    const { species, lineRecords, checked, igfaUrl, book: recordBook } = got;
    const club = isWa ? { id: 'wa', name: 'Africa Sportfishing' } : got.club;
    const kg = (n) => `${(Math.round(n * 10) / 10).toLocaleString()} kg`;
    const lb = (n) => `${Math.round(n * 2.20462).toLocaleString()} lb`;
    const pct = (s) => Math.round((s.best.weightKg / s.igfa.kg) * 100);
    const picker = html`<label class="club-pick">Records for
      <select id="club-pick">${raw(options([['wa', 'Africa Sportfishing'], ...books.map((c) => [c.id, c.name]), ['igfa', 'IGFA world records']], isIgfa ? 'igfa' : club.id))}</select>
    </label>`;

    let body;
    if (isIgfa) {
      const month = new Date(checked + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      body = html`<h2>IGFA all-tackle world records${raw(info(html`<p>The heaviest fish of each species ever accepted by the International Game Fish Association. Checked ${month}; <a href="${igfaUrl}" target="_blank" rel="noopener">IGFA's search</a> has the official, current list and every line-class record.</p>`))}</h2>
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
      body = html`<h2>${club.name} record book${raw(info(html`<p>The club's records as at ${fmtDay(recordBook.asAt)}, with fish approved in the app ranked in among them (marked New).</p>`))}</h2>
        <p class="small"><a href="${recordBook.pdf}" target="_blank" rel="noopener">Download the record book (PDF)</a></p>
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
        ${held.length ? raw(html`<div class="records">${held.map((s) => raw(html`<article class="card pad record">
          <div class="record-head"><b>${s.name}</b>${s.best.lineClass ? raw(html`<span class="badge">${s.best.lineClass} line</span>`) : ''}</div>
          <div><a class="wr-lb" href="#/catch/${s.best.catchId}">${lb(s.best.weightKg)}</a> <span class="muted">${kg(s.best.weightKg)}</span></div>
          <div class="small muted"><a href="${anglerHref(s.best.userId, s.best.angler)}">${s.best.angler}</a>${s.best.teamName ? ` · ${s.best.teamName}` : ''} · ${fmtDate(s.best.caughtOn)}</div>
          ${s.igfa ? raw(html`<div class="ours"><div class="bar blue" title="Share of the IGFA world record"><i style="width:${Math.min(100, Math.max(2, pct(s)))}%"></i></div>
            <span class="small muted">${pct(s)}% of the IGFA world record (${s.igfa.display})</span></div>`) : ''}
        </article>`))}</div>`) : raw(html`<div class="card pad empty">No approved fish ${isWa ? 'yet' : `from ${club.name} boats yet`}. The first one weighed and approved sets the record.</div>`)}
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
    view.innerHTML = html`<h1>Leaderboard</h1>${raw(boardTabs('records'))}${raw(picker)}${raw(body)}`;
    view.querySelector('#club-pick').addEventListener('change', (e) => {
      location.hash = `#/records?club=${e.target.value}`;
    });
  },

  // A guest angler (a name typed in at the weigh-in, no account): their fish.
  async guest() {
    const name = new URLSearchParams(location.hash.split('?')[1] || '').get('name') || '';
    view.innerHTML = html`<h1>${name}</h1>
      <p class="muted">Guest angler · not on the app</p>
      <h2>Catches</h2>
      <div id="trophies"></div>`;
    await renderTrophies(view.querySelector('#trophies'), { angler: name });
  },

  async user(id) {
    const { user, stats } = await api(`/users/${id}`);
    view.innerHTML = html`${user.photoUrl ? raw(html`<img class="avatar" src="${user.photoUrl}" alt="">`) : ''}<h1>${user.name}</h1>
      ${user.fullName !== user.name ? raw(html`<p class="full-name">${user.fullName}</p>`) : ''}
      <p class="muted">${user.teamName ? raw(html`<a href="#/boat/${user.teamId}">${user.teamName}</a> · `) : 'Individual angler · '}${user.country || ''}</p>
      ${user.bio ? raw(html`<p>${user.bio}</p>`) : ''}
      ${state.me?.id === user.id ? raw('<a class="btn" href="#/profile">Edit profile</a>') : ''}
      <h2>Catches</h2>
      <div id="trophies"></div>`;
    await renderTrophies(view.querySelector('#trophies'), { user: user.id });
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
        <label>Nickname (optional) <input name="nickname" maxlength="40" placeholder="e.g. Big Mo" value="${me.nickname || ''}">
          <span class="small muted">Shown instead of your full name.</span></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, me.country, 'Choose…'))}</select></label>
        <label>About you <textarea name="bio" maxlength="500">${me.bio || ''}</textarea></label>
        ${raw(photoField('Your photo', me.photoUrl))}
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>
      <h2>Units</h2>
      <form class="card pad units" id="units">${raw(unitFields())}
        <span class="small muted">How weights, depths and water temperatures show for you, and what you type them in.</span></form>
      <h2>Change password</h2>
      <form class="card pad stack" id="pw">
        <label>Current password <input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <p class="error"></p>
        <div><button type="submit">Change password</button></div>
      </form>
      ${me.isAdmin ? '' : raw(html`<h2>Delete my account</h2>
      <details class="card pad delete-account"><summary>Delete my account and my data</summary>
        <form class="stack" id="del">
          <p class="small">This can't be undone. <b>Deleted:</b> your account, email and password, your profile photo, your posts,
          comments and likes, and the phones getting your notifications. <b>Kept, without your name:</b> fish already weighed in
          for a boat (shown as "Former member", so the season's points don't change) and your boat's logged trips.
          See the <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>
          <label>Your password <input name="password" type="password" required autocomplete="current-password"></label>
          <label>Type DELETE to confirm <input name="confirm" required autocomplete="off" autocapitalize="characters"></label>
          <p class="error"></p>
          <div><button type="submit" class="danger">Delete my account</button></div>
        </form></details>`)}
      <p><a href="#/more">‹ Back to More</a></p>`;
    // Units: saved on the account (and this phone) as soon as one is tapped.
    view.querySelector('#units').addEventListener('change', async (e) => {
      const units = unitsFrom(e.currentTarget);
      saveUnitsHere(units);
      try {
        state.me = (await api('/me', { method: 'PATCH', body: { units } })).user;
      } catch (err) {
        toast(err.message);
        return;
      }
      toast('Units saved.');
    });
    const del = view.querySelector('#del');
    if (del) {
      bindForm(del, async () => {
        if (del.confirm.value.trim().toUpperCase() !== 'DELETE') throw new Error('Type DELETE to confirm.');
        await api('/me', { method: 'DELETE', body: { password: del.password.value } });
        state.me = null;
        try { localStorage.removeItem('kept-me'); } catch {}
        toast('Your account has been deleted.');
        location.hash = '#/';
        location.reload();
      });
    }
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
    // The demo copy: shared accounts, one tap each.
    const demo = state.meta.demo ? (await api('/demo').catch(() => ({ accounts: [] }))).accounts : [];
    view.innerHTML = html`<h1>Sign in</h1>
      ${demo.length ? raw(html`<div class="card pad stack demo-accounts"><p style="margin:0"><b>Demo copy.</b> Try the app as one of these
        (made-up people, shared with everyone who has the link):</p>
        ${demo.map((a) => raw(html`<button type="button" data-demo="${a.email}">${a.role}</button>`))}</div>`) : ''}
      <form class="card pad stack" id="f">
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Sign in</button></div>
      </form>
      <p><a href="#/forgot">Forgot your password?</a></p>
      <p>New here? <a href="#/register">Create an account</a>.</p>`;
    const form = view.querySelector('#f');
    for (const b of view.querySelectorAll('[data-demo]')) {
      b.addEventListener('click', () => {
        const a = demo.find((x) => x.email === b.dataset.demo);
        form.email.value = a.email;
        form.password.value = a.password;
        form.requestSubmit();
      });
    }
    bindForm(form, async () => {
      if (state.me) await api('/auth/logout', { method: 'POST' }).catch(() => {});
      state.me = (await api('/auth/login', { method: 'POST', body: formData(form) })).user;
      location.hash = state.afterLogin || '#/';
      state.afterLogin = null;
    });
  },

  async forgot() {
    if (!state.meta.emailEnabled) {
      // No email sending yet: the admin makes reset links by hand.
      const admin = state.meta.contactEmail;
      const mail = admin && `mailto:${admin}?subject=${encodeURIComponent('Password reset - Africa Sportfishing')}&body=${encodeURIComponent('Hello, I forgot my password. My account email is: ')}`;
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
      <form class="card pad stack" id="f">
        <div class="row">
          <label>First name <input name="firstName" required maxlength="40" autocomplete="given-name"></label>
          <label>Last name <input name="lastName" required maxlength="40" autocomplete="family-name"></label>
        </div>
        <label>Nickname (optional) <input name="nickname" maxlength="40" placeholder="e.g. Big Mo">
          <span class="small muted">Shown instead of your full name.</span></label>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, null, 'Choose…'))}</select></label>
        <fieldset class="units"><legend>Units</legend>${raw(unitFields())}
          <span class="small muted">How weights, depths and water temperatures show for you. You can change them in your profile.</span></fieldset>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create account</button></div>
      </form>
      <p class="small muted">By creating an account you agree to the <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>
      <p>Already a member? <a href="#/login">Sign in</a>.</p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const units = unitsFrom(form);
      saveUnitsHere(units);
      state.me = (await api('/auth/register', { method: 'POST', body: { ...formData(form), units } })).user;
      toast('Welcome!');
      // Came from an invite link: back to it, to join that boat.
      location.hash = state.afterLogin?.startsWith('#/join/') ? state.afterLogin : '#/crew';
      state.afterLogin = null;
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
  // The marlin from the logo, filled (Log fish).
  fish: '<use href="/marlin.svg#m" x="-3" y="-3" width="30" height="30" style="fill:currentColor;stroke:none"/>',
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
  share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  // A sportfisher, head-on (the boat mark in boat.svg).
  boat: '<use href="/boat.svg#b" x="-2.5" y="-2.5" width="29" height="29" style="fill:currentColor;stroke:none"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
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
  document.title = `${state.pending ? `(${state.pending}) ` : ''}Africa Sportfishing`;
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

// The "notifications on this phone" switch: on More for everyone (announcements),
// on the Review page for officials (fish to review), and on the feed until it's on.
async function renderNotify(el, { what = 'a captain registers fish', hideWhenOn = false } = {}) {
  // On the feed it's only an offer: nothing if this phone can't, or won't, have them.
  if (hideWhenOn && (!pushSupported() || Notification.permission === 'denied')) return;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushSupported()) {
    el.innerHTML = iphone && !installed
      ? `<p><b>Get notifications for ${what}.</b></p><p class="small muted">On iPhone, first add this app to your Home Screen: tap the Share button, then <b>Add to Home Screen</b>. Open the app from the Home Screen and come back to this page.</p>`
      : '<p class="small muted">This browser can\'t show notifications. Chrome on Android, or the app added to an iPhone Home Screen, can.</p>';
    return;
  }
  if (Notification.permission === 'denied') {
    el.innerHTML = '<p class="small muted">Notifications are blocked for this site. Allow them in your browser\'s site settings, then come back here.</p>';
    return;
  }
  const { reg, sub } = await pushSubscription();
  if (sub && hideWhenOn) {
    el.innerHTML = '';
    el.className = '';
    api('/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
    return;
  }
  // Re-send a live subscription, in case the server forgot it.
  if (sub) api('/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {});
  el.innerHTML = sub
    ? `<p class="small muted">${icon('check')} Notifications on for this phone · <button class="link" data-act="push-off">Turn off</button></p>`
    : `<div class="notify-row"><span><b>Get notifications</b> on this phone for ${what}.</span><button class="primary" data-act="push-on">Turn on notifications</button></div>`;
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
    renderNotify(el, { what, hideWhenOn });
  };
}

function renderNav(active = state.navActive) {
  state.navActive = active;
  syncHeader();
  // One bar for everyone. Captains and officials do the weigh-in from More (or the feed's card).
  const me0 = state.me;
  const links = [
    ['#/', 'Feed', 'home', 'feed'],
    ['#/leaderboard', 'Leaderboard', 'leaderboard', 'leaderboard'],
    ...(me0?.teamId ? [['#/fishon', 'Log fish', 'fishon', 'fish', 'cta']] : []),
    ['#/participants', 'Participants', 'participants', 'participants'],
  ];
  links.push(['#/more', 'More', 'more', 'more']);
  const current = {
    boat: 'participants', user: 'participants', guest: 'participants', weigh: 'more',
    records: 'leaderboard', points: 'leaderboard', join: 'more', weighmasters: 'more', tournament: 'leaderboard', enter: 'leaderboard', sheet: 'more', 'tournament-sheets': 'more',
    'points-fish': 'leaderboard', scoring: 'more', new: 'home', edit: 'home', rules: 'more', install: 'more', spots: 'more', outing: 'more', log: 'more',
    clubs: 'more', club: 'more', profile: 'more', crew: 'more', login: 'more', register: 'more', forgot: 'more', reset: 'more', members: 'more',
    'admin-boats': 'more', backups: 'more', activity: 'more', desk: 'more', 'club-members': 'more', notifications: 'more', pending: 'more', history: 'more', review: 'more', calendar: 'more',
    // The officials' Tournament sheets live in More; the Tournaments tab in the Leaderboard.
    tournaments: /[?&]sheets=1/.test(location.hash) ? 'more' : 'leaderboard',
  }[active] || active;
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, icon, cls]) => `<a href="${href}" class="${cls || ''}"${key === current ? ' aria-current="page"' : ''}${key === 'more' ? ' data-nav="more"' : ''}>
      <span class="nav-icon">${icon === 'fish' ? '<span class="fish-mark" aria-hidden="true"></span>' : `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`}${key === 'more' && state.pending
        ? `<span class="count-badge" aria-label="${state.pending} to review">${state.pending > 99 ? '99+' : state.pending}</span>` : ''}</span><span>${label}</span></a>`)
    .join('');
}

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', arg] = path.split('/');
  const view = document.createElement('div');
  const pages = pagesFor(view);
  let page = Object.hasOwn(pages, name) ? name : 'home';
  if (state.me && (page === 'login' || page === 'register') && !(page === 'login' && state.meta?.demo)) page = 'home';
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
const THEME_COLORS = { dark: '#001a43', light: '#f4f6fa' };
// A new key each time everyone is reset: everyone moved to light mode once
// (choices saved under 'theme' and 'appearance' no longer count).
const THEME_KEY = 'look';
try {
  localStorage.removeItem('theme');
  localStorage.removeItem('appearance');
  localStorage.removeItem('jhmmc-feed'); // the two sides are one now
} catch {
  // Nothing saved, nothing to clear.
}
const phoneDark = matchMedia('(prefers-color-scheme: dark)');
const themeChoice = () => {
  try {
    // New phones start in light mode; Auto (follow the phone) only when picked.
    const t = localStorage.getItem(THEME_KEY);
    return t === 'dark' || t === 'auto' ? t : 'light';
  } catch {
    return 'light';
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
    localStorage.setItem(THEME_KEY, value);
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
  toast('Installed. Open Africa Sportfishing from your home screen.');
});
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// "Sign in" links inside a page come back to that page afterwards.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-return]')) state.afterLogin = location.hash;
});

// Without signal, pictures that aren't on the phone are hidden rather than shown broken.
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && navigator.onLine === false) e.target.hidden = true;
}, true);
// Signal back: a page that couldn't load tries again.
window.addEventListener('online', () => {
  if (document.querySelector('.offline-note, .feed-list .empty')) route();
});

// No signal: a thin bar says so, instead of errors; it goes when the signal is back.
function showOffline() {
  let bar = document.getElementById('offline-bar');
  if (navigator.onLine !== false) { bar?.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'offline-bar';
  bar.setAttribute('role', 'status');
  bar.textContent = 'Offline. Fish you log are saved and sent when you’re back in range.';
  document.body.append(bar);
}
window.addEventListener('offline', showOffline);
window.addEventListener('online', showOffline);
showOffline();

// Pull down at the top of a page to refresh it, like other apps.
(() => {
  let startY = null; let dy = 0; let spin = null;
  const skip = (t) => t.closest('.leaflet-container, input, textarea, select, dialog, .gallery, .hour-bars');
  document.addEventListener('touchstart', (e) => {
    startY = window.scrollY <= 0 && e.touches.length === 1 && !skip(e.target) ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { spin?.remove(); spin = null; return; }
    if (!spin) {
      spin = document.createElement('div');
      spin.className = 'ptr';
      spin.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`;
      document.body.append(spin);
    }
    const pull = Math.min(dy / 2.2, 80);
    spin.style.transform = `translate(-50%, ${pull}px) rotate(${dy * 1.5}deg)`;
    spin.classList.toggle('ready', pull >= 64);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!spin) return;
    const el = spin; spin = null;
    if (el.classList.contains('ready')) {
      el.classList.add('spinning');
      try { navigator.vibrate?.(10); } catch { /* not on every phone */ }
      try { await route(); } finally { el.remove(); }
    } else el.remove();
    startY = null;
  });
})();

(async function init() {
  [state.meta] = await Promise.all([
    api('/meta').then((m) => (keep('kept-meta', m), m)).catch((err) => {
      const m = kept('kept-meta');
      if (!m) throw err;
      return m;
    }),
    refreshMe(),
  ]);
  // The demo copy: everyone arrives signed in as the captain of its first boat, and every page says it's a demo.
  if (state.meta.demo) {
    if (!state.me) {
      try {
        const [captain] = (await api('/demo')).accounts;
        state.me = (await api('/auth/login', { method: 'POST', body: { email: captain.email, password: captain.password } })).user;
        keep('kept-me', state.me);
      } catch {
        // Signed out after all: the sign-in page lists the demo accounts.
      }
    }
    document.querySelector('.topbar')?.insertAdjacentHTML('afterend',
      '<div class="demo-bar">Demo copy: made-up data. <a href="#/login">Try it as a captain, an angler or the secretary</a></div>');
  }
  window.addEventListener('hashchange', route);
  route();
})();
