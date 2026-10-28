'use strict';

// ---- helpers --------------------------------------------------------------

const state = { me: null, meta: null, clubs: null };
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

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
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
const fmtDate = (d) =>
  new Date(d + (d.length === 10 ? 'T12:00:00' : 'Z')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);

function options(items, selected, placeholder) {
  return html`${placeholder ? raw(`<option value="">${esc(placeholder)}</option>`) : ''}${items.map((it) => {
    const [value, label] = Array.isArray(it) ? it : [it, it];
    return raw(`<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`);
  })}`;
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

function needLogin(view) {
  view.innerHTML = html`<div class="card pad empty">
    <p>You need to sign in to do that.</p>
    <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Join</a>
  </div>`;
}

// ---- share ----------------------------------------------------------------

function shareText(c) {
  const w = c.weightKg != null ? ` ${+c.weightKg.toFixed(1)} kg` : '';
  const how = c.released ? ' (released)' : '';
  return `${c.angler} landed a${w} ${c.species}${how}${c.location ? ' off ' + c.location : ''}! 🎣`;
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
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Link copied');
  } catch {
    prompt('Copy this link', url);
  }
}

function whatsappLink(c) {
  return `https://wa.me/?text=${encodeURIComponent(`${shareText(c)} ${location.origin}/#/catch/${c.id}`)}`;
}

// ---- catch card -----------------------------------------------------------

function catchCard(c, { full = false } = {}) {
  const photo = c.photoUrl
    ? html`<img class="catch-photo" src="${c.photoUrl}" alt="${c.species} caught by ${c.angler}" loading="lazy">`
    : '<div class="catch-photo placeholder" aria-hidden="true">🐟</div>';
  const details = [c.location, c.country].filter(Boolean).join(', ');
  return html`<article class="card" data-id="${c.id}">
    ${full ? raw(photo) : raw(`<a href="#/catch/${c.id}">${photo}</a>`)}
    <div class="pad">
      <div class="catch-head">
        <h3 class="catch-title"><a href="#/catch/${c.id}">${c.species}</a></h3>
        <span class="weight">${fmtWeight(c.weightKg)}</span>
      </div>
      <p class="meta">
        <a href="#/user/${c.userId}">${c.angler}</a>
        ${c.clubName ? raw(html` · <a href="#/club/${c.clubId}">${c.clubName}</a>`) : ''}
        · ${fmtDate(c.caughtOn)}${details ? ' · ' + details : ''}
      </p>
      <div class="badges">
        ${c.released ? raw('<span class="badge release">Released</span>') : ''}
        ${c.tagged ? raw('<span class="badge release">Tagged</span>') : ''}
        ${c.lengthCm ? raw(html`<span class="badge">${c.lengthCm} cm</span>`) : ''}
        ${c.lineClass ? raw(html`<span class="badge">${c.lineClass} line</span>`) : ''}
        ${c.boat ? raw(html`<span class="badge">🚤 ${c.boat}</span>`) : ''}
      </div>
      ${full && c.notes ? raw(html`<p>${c.notes}</p>`) : ''}
      <div class="actions">
        <button data-act="like" class="${c.liked ? 'liked' : ''}" aria-pressed="${c.liked}">♥ <span>${c.likes}</span></button>
        <a class="btn" href="#/catch/${c.id}">💬 ${c.comments}</a>
        <button data-act="share">Share</button>
        <a class="btn" href="${whatsappLink(c)}" target="_blank" rel="noopener">WhatsApp</a>
        ${full && state.me?.id === c.userId ? raw('<button data-act="delete" class="danger">Delete</button>') : ''}
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
    if (!state.me) return (location.hash = '#/login');
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
      await api(`/catches/${c.id}`, { method: 'DELETE' });
      toast('Catch deleted');
      location.hash = '#/';
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
  more.hidden = true;
  more.style.margin = '16px auto';
  more.style.display = 'block';
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
    if (!all.size) list.innerHTML = '<div class="card empty">No catches yet. Be the first to post one!</div>';
  }
  more.addEventListener('click', page);
  await page();
}

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => ({
  async home() {
    const filters = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const clubs = await loadClubs();
    view.innerHTML = html`
      ${state.me ? '' : raw(`<section class="hero">
        <h1>Every big fish in West Africa, in one place</h1>
        <p>Log your catches, back your club, and share your marlin, sailfish and tuna with anglers from Dakar to Lagos.</p>
        <a class="btn primary" href="#/register">Join your club</a>
      </section>`)}
      <div class="filters">
        <select name="species" aria-label="Species">${raw(speciesOptions(filters.species, 'All species'))}</select>
        <select name="country" aria-label="Country">${raw(options(state.meta.countries, filters.country, 'All countries'))}</select>
        <select name="club" aria-label="Club">${raw(options(clubs.map((c) => [c.id, c.name]), filters.club, 'All clubs'))}</select>
        <select name="released" aria-label="Released">${raw(options([['true', 'Released only']], filters.released, 'Kept & released'))}</select>
      </div>
      <div id="feed"></div>`;
    view.querySelector('.filters').addEventListener('change', (e) => {
      const p = new URLSearchParams(filters);
      if (e.target.value) p.set(e.target.name, e.target.value);
      else p.delete(e.target.name);
      location.hash = '#/?' + p;
    });
    await renderFeed(view.querySelector('#feed'), filters);
  },

  async catch(id) {
    const { catch: c, comments } = await api(`/catches/${id}`);
    view.innerHTML = html`
      <div class="feed">${raw(catchCard(c, { full: true }))}</div>
      <h2>Comments</h2>
      <div class="card pad">
        ${comments.length ? comments.map((m) => raw(html`<div class="comment">
          <a href="#/user/${m.userId}"><b>${m.author}</b></a> <span class="muted small">${fmtDate(m.createdAt)}</span>
          <div>${m.body}</div></div>`)) : raw('<p class="muted">No comments yet.</p>')}
        ${state.me ? raw(`<form class="stack" id="comment" style="margin-top:12px">
          <textarea name="body" required maxlength="1000" placeholder="Congratulate the angler…"></textarea>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post comment</button></div>
        </form>`) : raw('<p><a href="#/login">Sign in</a> to comment.</p>')}
      </div>`;
    wireCards(view.querySelector('.feed'), new Map([[String(c.id), c]]));
    const form = view.querySelector('#comment');
    if (form) bindForm(form, async () => {
      await api(`/catches/${id}/comments`, { method: 'POST', body: formData(form) });
      route();
    });
  },

  async new() {
    if (!state.me) return needLogin(view);
    view.innerHTML = html`<h1>Log a catch</h1>
      ${state.me.clubId ? '' : raw('<p class="card pad small">Tip: <a href="#/profile">join a club</a> so this catch counts on your club\'s leaderboard.</p>')}
      <form class="card pad stack" id="f">
        <label>Species <select name="speciesId" required>${raw(speciesOptions(null, 'Choose species…'))}</select></label>
        <div class="row">
          <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="e.g. 180"></label>
          <label>Length (cm) <input name="lengthCm" type="number" step="1" min="0" inputmode="numeric" placeholder="optional"></label>
        </div>
        <div class="row">
          <label>Date <input name="caughtOn" type="date" required value="${today()}" max="${today()}"></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
        </div>
        <div class="row">
          <label>Location / spot <input name="location" maxlength="120" placeholder="e.g. Bijagós, Banana Islands"></label>
          <label>Boat <input name="boat" maxlength="80" placeholder="optional"></label>
        </div>
        <label>Line class <select name="lineClass">${raw(options(['6 kg', '8 kg', '10 kg', '15 kg', '24 kg', '37 kg', '60 kg', 'Unlimited'], null, 'Not recorded'))}</select></label>
        <div class="row">
          <label class="check"><input type="checkbox" name="released"> Released alive</label>
          <label class="check"><input type="checkbox" name="tagged"> Tagged</label>
        </div>
        <label>Photo <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <label>Story / notes <textarea name="notes" maxlength="2000" placeholder="Lure, fight time, crew…"></textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Post catch</button></div>
      </form>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const fd = new FormData(form);
      if (!fd.get('photo')?.size) fd.delete('photo');
      const { catch: c } = await api('/catches', { method: 'POST', form: fd });
      toast('Catch posted! Tight lines 🎣');
      location.hash = `#/catch/${c.id}`;
    });
  },

  async clubs() {
    const clubs = await loadClubs(true);
    view.innerHTML = html`<h1>Clubs</h1>
      <div class="card"><ul class="list">
        ${clubs.length ? clubs.map((c) => raw(html`<li>
          <a href="#/club/${c.id}"><b>${c.name}</b></a>
          <div class="muted small">${[c.city, c.country].filter(Boolean).join(', ')} · ${c.members} members · ${c.catches} catches</div>
        </li>`)) : raw('<li class="muted">No clubs yet — register yours below.</li>')}
      </ul></div>
      <h2>Register a club</h2>
      ${state.me ? raw(html`<form class="card pad stack" id="f">
        <label>Club name <input name="name" required maxlength="100"></label>
        <div class="row">
          <label>Country <select name="country" required>${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
          <label>Town / harbour <input name="city" maxlength="80"></label>
        </div>
        <label>About <textarea name="description" maxlength="1000"></textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create club</button></div>
      </form>`) : raw('<p><a href="#/login">Sign in</a> to register a club.</p>')}`;
    const form = view.querySelector('#f');
    if (form) bindForm(form, async () => {
      const { club } = await api('/clubs', { method: 'POST', body: formData(form) });
      await refreshMe();
      location.hash = `#/club/${club.id}`;
    });
  },

  async club(id) {
    const { club, members, stats } = await api(`/clubs/${id}`);
    const isMember = state.me?.clubId === club.id;
    view.innerHTML = html`<h1>${club.name}</h1>
      <p class="muted">${[club.city, club.country].filter(Boolean).join(', ')}</p>
      ${club.description ? raw(html`<p>${club.description}</p>`) : ''}
      ${state.me && !isMember ? raw('<button class="primary" id="join">Make this my club</button>') : ''}
      ${isMember ? raw('<span class="badge release">Your club</span>') : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
      </div>
      <h2>Members (${members.length})</h2>
      <div class="card"><ul class="list">${members.length ? members.map((m) => raw(html`<li><a href="#/user/${m.id}">${m.name}</a> <span class="muted small">· ${m.catches} catches</span></li>`)) : raw('<li class="muted">No members yet.</li>')}</ul></div>
      <h2>Recent catches</h2>
      <div id="feed"></div>`;
    view.querySelector('#join')?.addEventListener('click', async () => {
      await api('/me', { method: 'PATCH', body: { clubId: club.id } });
      await refreshMe();
      toast(`Welcome to ${club.name}!`);
      route();
    });
    await renderFeed(view.querySelector('#feed'), { club: club.id });
  },

  async leaderboard() {
    const q = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const { records, anglers, clubs } = await api('/leaderboard?' + new URLSearchParams(q));
    const year = new Date().getFullYear();
    const years = Array.from({ length: 6 }, (_, i) => String(year - i));
    view.innerHTML = html`<h1>Leaderboard</h1>
      <div class="filters">
        <select name="year" aria-label="Season">${raw(options(years, q.year, 'All time'))}</select>
        <select name="country" aria-label="Country">${raw(options(state.meta.countries, q.country, 'All countries'))}</select>
      </div>
      <h2>Heaviest by species</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Weight</th><th>Angler</th><th>Club</th></tr></thead>
        <tbody>${records.length ? records.map((r) => raw(html`<tr>
          <td><a href="#/catch/${r.id}">${r.species}</a></td><td class="num">${Math.round(r.weightKg * 10) / 10} kg</td>
          <td><a href="#/user/${r.userId}">${r.angler}</a></td><td>${r.clubName || '—'}</td></tr>`)) : raw('<tr><td colspan="4" class="muted">No weighed catches yet.</td></tr>')}</tbody>
      </table></div>
      <h2>Top anglers</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Angler</th><th class="num">Billfish</th><th class="num">Catches</th><th class="num">Released</th></tr></thead>
        <tbody>${anglers.length ? anglers.map((a, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="#/user/${a.userId}">${a.angler}</a><div class="muted small">${a.clubName || ''}</div></td>
          <td class="num">${a.billfish}</td><td class="num">${a.catches}</td><td class="num">${a.released}</td></tr>`)) : raw('<tr><td colspan="5" class="muted">Nothing yet.</td></tr>')}</tbody>
      </table></div>
      <h2>Top clubs</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Club</th><th class="num">Catches</th><th class="num">Released</th><th class="num">Total kg</th></tr></thead>
        <tbody>${clubs.length ? clubs.map((c, i) => raw(html`<tr><td>${i + 1}</td>
          <td><a href="#/club/${c.clubId}">${c.clubName}</a><div class="muted small">${c.country}</div></td>
          <td class="num">${c.catches}</td><td class="num">${c.released}</td><td class="num">${c.totalKg}</td></tr>`)) : raw('<tr><td colspan="5" class="muted">Nothing yet.</td></tr>')}</tbody>
      </table></div>`;
    view.querySelector('.filters').addEventListener('change', (e) => {
      const p = new URLSearchParams(q);
      if (e.target.value) p.set(e.target.name, e.target.value);
      else p.delete(e.target.name);
      location.hash = '#/leaderboard?' + p;
    });
  },

  async user(id) {
    const { user, stats } = await api(`/users/${id}`);
    view.innerHTML = html`<h1>${user.name}</h1>
      <p class="muted">${user.clubName ? raw(html`<a href="#/club/${user.clubId}">${user.clubName}</a> · `) : ''}${user.country || ''}</p>
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
    if (!state.me) return needLogin(view);
    const clubs = await loadClubs(true);
    const me = state.me;
    view.innerHTML = html`<h1>Your profile</h1>
      <form class="card pad stack" id="f">
        <label>Name <input name="name" required maxlength="80" value="${me.name}"></label>
        <div class="row">
          <label>Country <select name="country">${raw(options(state.meta.countries, me.country, 'Choose…'))}</select></label>
          <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), me.clubId, 'No club'))}</select></label>
        </div>
        <label>About you <textarea name="bio" maxlength="500">${me.bio || ''}</textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>
      <p class="small muted">Club not listed? <a href="#/clubs">Register it</a>.</p>
      <p><button id="logout">Sign out</button></p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const { user } = await api('/me', { method: 'PATCH', body: formData(form) });
      state.me = user;
      toast('Profile saved');
      location.hash = `#/user/${user.id}`;
    });
    view.querySelector('#logout').addEventListener('click', async () => {
      await api('/auth/logout', { method: 'POST' });
      state.me = null;
      location.hash = '#/';
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
      <p>New here? <a href="#/register">Create an account</a>.</p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      state.me = (await api('/auth/login', { method: 'POST', body: formData(form) })).user;
      location.hash = '#/';
    });
  },

  async register() {
    const clubs = await loadClubs(true);
    view.innerHTML = html`<h1>Join West Africa Big Game</h1>
      <form class="card pad stack" id="f">
        <label>Full name <input name="name" required maxlength="80" autocomplete="name"></label>
        <label>Email <input name="email" type="email" required autocomplete="email"></label>
        <label>Password <input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
        <div class="row">
          <label>Country <select name="country">${raw(options(state.meta.countries, null, 'Choose…'))}</select></label>
          <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), null, 'Choose later'))}</select></label>
        </div>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create account</button></div>
      </form>
      <p>Already a member? <a href="#/login">Sign in</a>.</p>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      state.me = (await api('/auth/register', { method: 'POST', body: formData(form) })).user;
      toast('Welcome aboard!');
      location.hash = state.me.clubId ? '#/new' : '#/clubs';
    });
  },
});

// ---- router ---------------------------------------------------------------

function renderNav(active) {
  const links = [
    ['#/', 'Feed', 'home'],
    ['#/leaderboard', 'Leaderboard', 'leaderboard'],
    ['#/clubs', 'Clubs', 'clubs'],
  ];
  if (state.me) links.push(['#/profile', 'Me', 'profile'], ['#/new', '+ Catch', 'new', 'cta']);
  else links.push(['#/login', 'Sign in', 'login'], ['#/register', 'Join', 'register', 'cta']);
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, cls]) => `<a href="${href}" class="${[cls, key === active ? 'active' : ''].join(' ')}">${label}</a>`)
    .join('');
}

async function refreshMe() {
  state.me = (await api('/me')).user;
}

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', arg] = path.split('/');
  const view = document.createElement('div');
  const pages = pagesFor(view);
  const page = Object.hasOwn(pages, name) ? name : 'home';
  renderNav(page);
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await pages[page](arg);
  } catch (ex) {
    view.innerHTML = html`<div class="card pad empty"><p>${ex.message}</p><a href="#/">Back to the feed</a></div>`;
  }
}

(async function init() {
  [state.meta] = await Promise.all([api('/meta'), refreshMe()]);
  window.addEventListener('hashchange', route);
  route();
})();
