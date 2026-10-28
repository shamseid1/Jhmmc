'use strict';

// ---- helpers --------------------------------------------------------------

const state = { me: null, meta: null, clubs: null, afterLogin: null };
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
const fmtDate = (d) =>
  new Date(d + (d.length === 10 ? 'T12:00:00' : 'Z')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : word.endsWith('ch') ? 'es' : 's'}`;

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

function catchCard(c, { full = false } = {}) {
  const photo = c.photoUrl
    ? html`<img class="catch-photo" src="${c.photoUrl}" alt="${c.species} caught by ${c.angler}" loading="lazy">`
    : `<div class="catch-photo placeholder" aria-hidden="true">${MARLIN}</div>`;
  const details = [c.location, c.country].filter(Boolean).join(', ');
  return html`<article class="card" data-id="${c.id}">
    ${full ? raw(photo) : raw(`<a href="#/catch/${c.id}">${photo}</a>`)}
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
        ${c.released ? raw('<span class="badge release">Released</span>') : ''}
        ${c.tagged ? raw('<span class="badge release">Tagged</span>') : ''}
        ${c.lengthCm ? raw(html`<span class="badge">${c.lengthCm} cm</span>`) : ''}
        ${c.lineClass ? raw(html`<span class="badge">${c.lineClass} line</span>`) : ''}
      </div>
      ${full && c.weightKg && c.worldRecordKg ? raw(html`<p class="small muted">${Math.round((c.weightKg / c.worldRecordKg) * 100)}% of the IGFA all-tackle world record (${Math.round(c.worldRecordKg)} kg). <a href="#/records">See records</a></p>`) : ''}
      ${full && c.notes ? raw(html`<p class="notes">${c.notes}</p>`) : ''}
      <div class="actions">
        <button data-act="like" class="${c.liked ? 'liked' : ''}" aria-pressed="${c.liked}" aria-label="Like">${raw(icon('heart'))} <span>${c.likes}</span></button>
        <a class="btn" href="#/catch/${c.id}" aria-label="Comments">${raw(icon('comment'))} ${c.comments}</a>
        <button data-act="share">Share</button>
        <a class="btn" href="${whatsapp(`${shareText(c)} ${location.origin}/#/catch/${c.id}`)}" target="_blank" rel="noopener">WhatsApp</a>
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

// Sends a visitor to sign in, then back to where they were.
function askToSignIn(msg = 'Sign in to do that.') {
  state.afterLogin = location.hash;
  toast(msg);
  location.hash = '#/login';
}

function needLogin(view, what) {
  state.afterLogin = location.hash;
  view.innerHTML = html`<div class="card pad empty">
    <p>Sign in to ${what}.</p>
    <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Create an account</a>
  </div>`;
}

const HERO = `<section class="hero">
  <h1>Every big fish in West Africa, in one place</h1>
  <p>Follow the boats and anglers, see every catch, and check the leaderboard, from Dakar to Lagos. Crews sign in to log their catches.</p>
  <a class="btn primary" href="#/register">Create an account</a> <a class="btn ghost-light" href="#/login">Sign in</a>
</section>`;

// Shown to anglers who are signed in but not on a boat, and to visitors.
function noBoatBanner() {
  if (!state.me) return HERO;
  return state.me.teamId ? '' : `<div class="card pad banner">
    <div><b>You're browsing as an individual angler.</b><br><span class="muted small">You can follow the feed, like and comment. To log catches, join a boat's crew or register your boat.</span></div>
    <a class="btn primary" href="#/crew">Get on a boat</a>
  </div>`;
}

const boardTabs = (active) => `<div class="seg" role="tablist">
  <a role="tab" href="#/leaderboard" aria-selected="${active === 'leaderboard'}">Leaderboard</a>
  <a role="tab" href="#/records" aria-selected="${active === 'records'}">Records</a>
</div>`;

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => ({
  async home() {
    const filters = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
    const [clubs, { teams }] = await Promise.all([loadClubs(), api('/teams')]);
    view.innerHTML = html`
      ${raw(noBoatBanner())}
      <div class="filters">
        <select name="species" aria-label="Species">${raw(speciesOptions(filters.species, 'All species'))}</select>
        <select name="team" aria-label="Boat">${raw(options(teams.map((t) => [t.id, t.name]), filters.team, 'All boats'))}</select>
        <select name="club" aria-label="Club">${raw(options(clubs.map((c) => [c.id, c.name]), filters.club, 'All clubs'))}</select>
        <select name="country" aria-label="Country">${raw(options(state.meta.countries, filters.country, 'All countries'))}</select>
        <select name="released" aria-label="Released">${raw(options([['true', 'Released only']], filters.released, 'Kept & released'))}</select>
      </div>
      ${filters.angler ? raw(html`<p><span class="chip">Catches by ${filters.angler} <a href="#/" aria-label="Show everyone">✕</a></span></p>`) : ''}
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
        ${state.me ? raw(`<form class="stack" id="comment">
          <textarea name="body" required maxlength="1000" placeholder="Congratulate the angler…"></textarea>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post comment</button></div>
        </form>`) : raw('<p><a href="#/login" data-return>Sign in</a> to comment.</p>')}
      </div>`;
    wireCards(view.querySelector('.feed'), new Map([[String(c.id), c]]));
    const form = view.querySelector('#comment');
    if (form) bindForm(form, async () => {
      await api(`/catches/${id}/comments`, { method: 'POST', body: formData(form) });
      route();
    });
  },

  async new() {
    if (!state.me) return needLogin(view, 'log a catch');
    if (!state.me.teamId) {
      view.innerHTML = html`<h1>Log a catch</h1>${raw(noBoatBanner())}`;
      return;
    }
    const { team } = await api(`/teams/${state.me.teamId}`);
    view.innerHTML = html`<h1>Log a catch</h1>
      <p class="muted">Logging for <b>${team.name}</b>${team.clubName ? ` · ${team.clubName}` : ''}</p>
      <form class="card pad stack" id="f">
        <label>Angler <select name="anglerId">${raw(options([...team.members.map((m) => [m.id, m.id === state.me.id ? `${m.name} (me)` : m.name]), ['other', 'Guest (type a name)']], state.me.id))}</select></label>
        <label id="angler-name" hidden>Angler's name <input name="anglerName" maxlength="80" autocomplete="off" placeholder="e.g. a guest or visiting angler"></label>
        <label>Species <select name="speciesId" required>${raw(speciesOptions(null, 'Choose species…'))}</select></label>
        <div class="row">
          <label>Weight (kg) <input name="weightKg" type="number" step="0.1" min="0" inputmode="decimal" placeholder="e.g. 180"></label>
          <label>Length (cm) <input name="lengthCm" type="number" step="1" min="0" inputmode="numeric" placeholder="optional"></label>
        </div>
        <div class="row">
          <label>Date <input name="caughtOn" type="date" required value="${today()}" max="${today()}"></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, team.country || state.me.country, 'Choose…'))}</select></label>
        </div>
        <label>Location / spot <input name="location" maxlength="120" placeholder="e.g. Bijagós, Banana Islands"></label>
        <label>Line class <select name="lineClass">${raw(options(state.meta.lineClasses, null, 'Not recorded'))}</select></label>
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
    const nameBox = view.querySelector('#angler-name');
    form.anglerId.addEventListener('change', () => {
      nameBox.hidden = form.anglerId.value !== 'other';
      form.anglerName.required = !nameBox.hidden;
      if (!nameBox.hidden) form.anglerName.focus();
    });
    bindForm(form, async () => {
      const fd = new FormData(form);
      if (!fd.get('photo')?.size) fd.delete('photo');
      const { catch: c } = await api('/catches', { method: 'POST', form: fd });
      toast('Catch posted. Tight lines!');
      location.hash = `#/catch/${c.id}`;
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
            <label>Home port <input name="homePort" maxlength="80" placeholder="e.g. Dakar"></label>
            <label>Country <select name="country">${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
          </div>
          <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), null, 'No club'))}</select></label>
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
    const inviteMsg = `Join our boat ${team.name} on West Africa Big Game: sign up at ${location.origin} then enter invite code ${team.joinCode}`;
    const spec = [team.lengthFt ? `${+team.lengthFt}'` : '', team.make].filter(Boolean).join(' ');
    view.innerHTML = html`${team.photoUrl ? raw(html`<img class="cover" src="${team.photoUrl}" alt="${team.name}">`) : ''}
      <h1>${team.name}</h1>
      <p class="muted">${[spec, team.homePort, team.country].filter(Boolean).join(' · ')}${team.clubName ? raw(html` · <a href="#/club/${team.clubId}">${team.clubName}</a>`) : ''}</p>
      ${team.isMember ? raw(html`<div class="card pad invite">
        <div><div class="muted small">Crew invite code</div><div class="code">${team.joinCode}</div></div>
        <div class="actions">
          <button data-act="copy-code">Copy code</button>
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(inviteMsg)}">Invite on WhatsApp</a>
          ${team.isCaptain ? raw('<button data-act="new-code">New code</button>') : ''}
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
        ${team.isCaptain && m.id !== state.me.id ? raw(`<span class="actions"><button data-act="make-captain">Make captain</button><button data-act="remove" class="danger">Remove</button></span>`) : ''}
      </li>`))}${team.members.length ? '' : raw('<li class="muted">No crew yet.</li>')}</ul></div>
      ${team.isCaptain && team.guests.length ? raw(html`<h2>Guest anglers</h2>
      <p class="small muted">Catches logged under a typed name. If one of them joins the crew, move their catches to their account.</p>
      <div class="card"><ul class="list">${team.guests.map((g) => raw(html`<li class="member guest" data-name="${g.name}">
        <span><a href="${anglerHref(null, g.name)}">${g.name}</a> <span class="muted small">· ${plural(g.catches, 'catch')}</span></span>
        <span class="actions">
          <select aria-label="Crew member for ${g.name}">${raw(options(team.members.map((m) => [m.id, m.name]), null, 'Move to…'))}</select>
          <button data-act="link">Move</button>
        </span>
      </li>`))}</ul></div>`) : ''}
      ${team.isCaptain ? raw(html`<h2>Boat details</h2>
      <form class="card pad stack" id="edit">
        <label>Boat name <input name="name" required maxlength="80" value="${team.name}"></label>
        <div class="row">
          <label>Length (feet) <input name="lengthFt" type="number" min="10" max="200" step="1" inputmode="numeric" value="${team.lengthFt ?? ''}"></label>
          <label>Make / model <input name="make" maxlength="60" value="${team.make || ''}" placeholder="e.g. Bertram 42"></label>
        </div>
        <label>Boat photo <input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <div class="row">
          <label>Home port <input name="homePort" maxlength="80" value="${team.homePort || ''}"></label>
          <label>Country <select name="country">${raw(options(state.meta.countries, team.country, 'Choose…'))}</select></label>
        </div>
        <label>Club <select name="clubId">${raw(options(clubs.map((c) => [c.id, c.name]), team.clubId, 'No club'))}</select></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>`) : ''}
      ${team.isMember ? raw('<p><button data-act="leave" class="danger">Leave this boat</button></p>') : ''}
      <h2>Boat catches</h2>
      <div id="feed"></div>`;

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
    if (edit) bindForm(edit, async () => {
      const { photo, ...fields } = formData(edit);
      await api(`/teams/${id}`, { method: 'PATCH', body: fields });
      if (photo?.size) {
        const fd = new FormData();
        fd.set('photo', photo);
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
    view.innerHTML = html`<h1>${club.name}</h1>
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
  async more() {
    const me = state.me;
    const item = (href, iconName, label, sub = '') => `<a class="menu-item" href="${href}">
      <span class="mi-icon">${icon(iconName)}</span>
      <span class="mi-text"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
      <span class="mi-go" aria-hidden="true">›</span></a>`;
    view.innerHTML = html`<h1 class="center">More</h1>
      ${me ? raw(html`<div class="card pad me-card">
          ${me.photoUrl ? raw(html`<img src="${me.photoUrl}" alt="">`) : raw(`<span class="me-ph">${icon('user')}</span>`)}
          <div><b>${me.name}</b><div class="muted small">${me.teamName ? `${me.teamName}${me.isCaptain ? ' · Captain' : ''}` : 'Individual angler'}</div></div>
        </div>`)
        : raw(`<div class="card pad"><p style="margin-top:0">Sign in to log catches with your boat, like and comment.</p>
          <a class="btn primary" href="#/login">Sign in</a> <a class="btn" href="#/register">Create account</a></div>`)}
      ${me ? raw(`<h2>You</h2><div class="card menu">
        ${item(`#/user/${me.id}`, 'dashboard', 'My dashboard', 'Your catches, releases and heaviest fish')}
        ${me.teamId ? item(`#/boat/${me.teamId}`, 'boat', 'My boat', me.teamName) : item('#/crew', 'boat', 'Get on a boat', 'Join a crew or register your boat')}
        ${item('#/profile', 'edit', 'Edit profile', 'Name, country, photo')}
      </div>`) : ''}
      ${me?.isAdmin ? raw(`<h2>Admin</h2><div class="card menu">
        ${item('#/members', 'key', 'Members', 'Find a member, make a password reset link')}
      </div>`) : ''}
      <h2>Rules</h2>
      <div class="card menu">
        ${raw(item('#/rules?book=jhmmc', 'rules', 'JHMMC rules', '2026-2027 season'))}
        ${raw(item('#/rules?book=igfa', 'scale', 'IGFA rules', 'International Angling Rules summary'))}
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
  async members() {
    if (!state.me?.isAdmin) {
      view.innerHTML = '<div class="card pad empty">Only the club admin can see this page.</div>';
      return;
    }
    const { users } = await api('/admin/users');
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Members (${users.length})</h1>
      <p class="small muted">When a member forgets their password, check the request came from their sign-up email, then make a reset link and send it to them. It works once and expires after 24 hours; they choose the new password themselves.</p>
      <label class="search">${raw(icon('search'))}<input type="search" placeholder="Search by name, email or boat" aria-label="Search members" autocomplete="off"></label>
      <div class="card"><ul class="list">${users.map((u) => raw(html`<li class="member-row" data-id="${u.id}" data-find="${`${u.name} ${u.email} ${u.teamName || ''}`.toLowerCase()}">
        <div><b>${u.name}</b><div class="muted small">${u.email}${u.teamName ? ` · ${u.teamName}` : ''}</div></div>
        <button data-act="reset-link">Create reset link</button>
        <div class="reset-out" hidden></div>
      </li>`))}</ul></div>`;
    view.querySelector('.search input').addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      for (const li of view.querySelectorAll('.member-row')) li.hidden = !!term && !li.dataset.find.includes(term);
    });
    view.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const row = btn.closest('.member-row');
      if (btn.dataset.act === 'copy-link') return copyText(row.dataset.link, 'Link copied');
      if (btn.dataset.act !== 'reset-link') return;
      try {
        const { link, hours, name } = await api(`/admin/users/${row.dataset.id}/reset-link`, { method: 'POST' });
        row.dataset.link = link;
        const out = row.querySelector('.reset-out');
        out.innerHTML = html`<p class="small muted">New link for ${name}, valid for ${hours} hours. Any older link stops working.</p>
          <input readonly value="${link}" aria-label="Reset link">
          <div class="actions"><button data-act="copy-link">Copy link</button>
          <a class="btn" target="_blank" rel="noopener" href="${whatsapp(`Hello ${name}, here is your link to set a new password for West Africa Big Game. It works once, within ${hours} hours: ${link}`)}">Send on WhatsApp</a></div>`;
        out.hidden = false;
        out.querySelector('input').select();
      } catch (ex) {
        toast(ex.message);
      }
    });
  },

  // The JHMMC season rules and a summary of the IGFA angling rules.
  async rules() {
    const which = new URLSearchParams(location.hash.split('?')[1] || '').get('book') === 'igfa' ? 'igfa' : 'jhmmc';
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
    const { species, lineRecords, checked, igfaUrl, club } = await api('/records' + (isIgfa ? '' : `?club=${encodeURIComponent(book)}`));
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
        <label>Name <input name="name" required maxlength="80" value="${me.name}"></label>
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
        fd.set('photo', photo);
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
        <label>Full name <input name="name" required maxlength="80" autocomplete="name"></label>
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

function renderNav(active) {
  const links = [
    ['#/', 'Feed', 'home', 'feed'],
    ['#/leaderboard', 'Leaderboard', 'leaderboard', 'leaderboard'],
  ];
  if (state.me?.teamId) links.push(['#/new', 'Log catch', 'new', 'catch', 'cta']);
  links.push(['#/participants', 'Participants', 'participants', 'participants']);
  links.push(['#/more', 'More', 'more', 'more']);
  const current = {
    boat: 'participants', user: 'participants', records: 'leaderboard',
    rules: 'more', clubs: 'more', club: 'more', profile: 'more', crew: 'more', login: 'more', register: 'more', forgot: 'more', reset: 'more', members: 'more',
  }[active] || active;
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, icon, cls]) => `<a href="${href}" class="${cls || ''}"${key === current ? ' aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg><span>${label}</span></a>`)
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
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    await pages[page](arg);
  } catch (ex) {
    view.innerHTML = html`<div class="card pad empty"><p>${ex.message}</p><a href="#/">Back to the feed</a></div>`;
  }
}

// "Sign in" links inside a page come back to that page afterwards.
document.addEventListener('click', (e) => {
  if (e.target.closest('a[data-return]')) state.afterLogin = location.hash;
});

(async function init() {
  [state.meta] = await Promise.all([api('/meta'), refreshMe()]);
  window.addEventListener('hashchange', route);
  route();
})();
