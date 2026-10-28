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
  return `${c.angler} landed a${w} ${c.species}${how}${boat}${c.location ? ' off ' + c.location : ''}! 🎣`;
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

const whatsapp = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

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
        ${c.teamName ? raw(html` · 🚤 <a href="#/boat/${c.teamId}">${c.teamName}</a>`) : ''}
        ${c.clubName ? raw(html` · <a href="#/club/${c.clubId}">${c.clubName}</a>`) : ''}
        · ${fmtDate(c.caughtOn)}${details ? ' · ' + details : ''}
      </p>
      <div class="badges">
        ${c.released ? raw('<span class="badge release">Released</span>') : ''}
        ${c.tagged ? raw('<span class="badge release">Tagged</span>') : ''}
        ${c.lengthCm ? raw(html`<span class="badge">${c.lengthCm} cm</span>`) : ''}
        ${c.lineClass ? raw(html`<span class="badge">${c.lineClass} line</span>`) : ''}
      </div>
      ${full && c.notes ? raw(html`<p class="notes">${c.notes}</p>`) : ''}
      <div class="actions">
        <button data-act="like" class="${c.liked ? 'liked' : ''}" aria-pressed="${c.liked}">♥ <span>${c.likes}</span></button>
        <a class="btn" href="#/catch/${c.id}">💬 ${c.comments}</a>
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

// Shown to anglers who are signed in but not on a boat.
function noBoatBanner() {
  return state.me.teamId ? '' : `<div class="card pad banner">
    <div><b>You're browsing as an individual angler.</b><br><span class="muted small">You can follow the feed, like and comment. To log catches, join a boat's crew or register your boat.</span></div>
    <a class="btn primary" href="#/crew">Get on a boat</a>
  </div>`;
}

// ---- pages ----------------------------------------------------------------

// Each navigation renders into its own element, so a slow page that finishes
// after the user has moved on writes into a detached node instead.
const pagesFor = (view) => ({
  async welcome() {
    view.innerHTML = html`<section class="hero">
        <h1>Every big fish in West Africa, in one place</h1>
        <p>Log your boat's catches, follow the other crews, and climb the leaderboard, from Dakar to Lagos.</p>
        <a class="btn primary" href="#/register">Create an account</a> <a class="btn ghost-light" href="#/login">Sign in</a>
      </section>
      <div class="how">
        <div class="card pad"><h3>🚤 Crews by boat</h3><p class="muted small">Each boat is a team. The captain registers it and shares an invite code with the crew.</p></div>
        <div class="card pad"><h3>🎣 Log every fish</h3><p class="muted small">Species, weight, line class, tag and release, photo and the story behind it.</p></div>
        <div class="card pad"><h3>🏆 Leaderboards</h3><p class="muted small">Heaviest fish by species, top boats, anglers and clubs by season and country.</p></div>
      </div>`;
  },

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
        <form class="stack" id="comment">
          <textarea name="body" required maxlength="1000" placeholder="Congratulate the angler…"></textarea>
          <p class="error"></p>
          <div><button type="submit" class="primary">Post comment</button></div>
        </form>
      </div>`;
    wireCards(view.querySelector('.feed'), new Map([[String(c.id), c]]));
    const form = view.querySelector('#comment');
    bindForm(form, async () => {
      await api(`/catches/${id}/comments`, { method: 'POST', body: formData(form) });
      route();
    });
  },

  async new() {
    if (!state.me.teamId) {
      view.innerHTML = html`<h1>Log a catch</h1>${raw(noBoatBanner())}`;
      return;
    }
    const { team } = await api(`/teams/${state.me.teamId}`);
    view.innerHTML = html`<h1>Log a catch</h1>
      <p class="muted">Logging for 🚤 <b>${team.name}</b>${team.clubName ? ` · ${team.clubName}` : ''}</p>
      <form class="card pad stack" id="f">
        <label>Angler <select name="anglerId">${raw(options(team.members.map((m) => [m.id, m.id === state.me.id ? `${m.name} (me)` : m.name]), state.me.id))}</select></label>
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

  // Join a crew with a code, register a boat, or carry on as an individual.
  async crew() {
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
    const { teams } = await api('/teams');
    view.innerHTML = html`<h1>Boats</h1>
      ${state.me.teamId ? '' : raw('<p><a class="btn primary" href="#/crew">Join or register a boat</a></p>')}
      <div class="card"><ul class="list">
        ${teams.length ? teams.map((t) => raw(html`<li>
          <a href="#/boat/${t.id}"><b>🚤 ${t.name}</b></a>
          <div class="muted small">${[t.homePort, t.country].filter(Boolean).join(', ')}${t.clubName ? ` · ${t.clubName}` : ''} · ${t.members} crew · ${plural(t.catches, 'catch')}</div>
        </li>`)) : raw('<li class="muted">No boats registered yet.</li>')}
      </ul></div>`;
  },

  async boat(id) {
    const [{ team, stats }, clubs] = await Promise.all([api(`/teams/${id}`), loadClubs()]);
    const inviteMsg = `Join our boat ${team.name} on West Africa Big Game: sign up at ${location.origin} then enter invite code ${team.joinCode}`;
    view.innerHTML = html`<h1>🚤 ${team.name}</h1>
      <p class="muted">${[team.homePort, team.country].filter(Boolean).join(', ')}${team.clubName ? raw(html` · <a href="#/club/${team.clubId}">${team.clubName}</a>`) : ''}</p>
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
      ${team.isCaptain ? raw(html`<h2>Boat details</h2>
      <form class="card pad stack" id="edit">
        <label>Boat name <input name="name" required maxlength="80" value="${team.name}"></label>
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
      await api(`/teams/${id}`, { method: 'PATCH', body: formData(edit) });
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
      <form class="card pad stack" id="f">
        <label>Club name <input name="name" required maxlength="100"></label>
        <div class="row">
          <label>Country <select name="country" required>${raw(options(state.meta.countries, state.me.country, 'Choose…'))}</select></label>
          <label>Town / harbour <input name="city" maxlength="80"></label>
        </div>
        <label>About <textarea name="description" maxlength="1000"></textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create club</button></div>
      </form>`;
    const form = view.querySelector('#f');
    bindForm(form, async () => {
      const { club } = await api('/clubs', { method: 'POST', body: formData(form) });
      state.clubs = null;
      location.hash = `#/club/${club.id}`;
    });
  },

  async club(id) {
    const { club, teams, stats } = await api(`/clubs/${id}`);
    view.innerHTML = html`<h1>${club.name}</h1>
      <p class="muted">${[club.city, club.country].filter(Boolean).join(', ')}</p>
      ${club.description ? raw(html`<p>${club.description}</p>`) : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
      </div>
      <h2>Boats (${teams.length})</h2>
      <div class="card"><ul class="list">${teams.length ? teams.map((t) => raw(html`<li><a href="#/boat/${t.id}">🚤 ${t.name}</a> <span class="muted small">· ${t.members} crew · ${plural(t.catches, 'catch')}</span></li>`)) : raw('<li class="muted">No boats in this club yet. Captains can pick the club on their boat page.</li>')}</ul></div>
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
    view.innerHTML = html`<h1>Leaderboard</h1>
      <div class="filters">
        <select name="year" aria-label="Season">${raw(options(years, q.year, 'All time'))}</select>
        <select name="country" aria-label="Country">${raw(options(state.meta.countries, q.country, 'All countries'))}</select>
      </div>
      <h2>Heaviest by species</h2>
      <div class="card table-wrap"><table>
        <thead><tr><th>Species</th><th class="num">Weight</th><th>Angler</th><th>Boat</th></tr></thead>
        <tbody>${records.length ? records.map((r) => raw(html`<tr>
          <td><a href="#/catch/${r.id}">${r.species}</a></td><td class="num">${Math.round(r.weightKg * 10) / 10} kg</td>
          <td><a href="#/user/${r.userId}">${r.angler}</a></td><td>${r.teamId ? raw(html`<a href="#/boat/${r.teamId}">${r.teamName}</a>`) : '—'}</td></tr>`)) : nothing(4)}</tbody>
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
          <td><a href="#/user/${a.userId}">${a.angler}</a><div class="muted small">${a.teamName || ''}</div></td>
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

  async user(id) {
    const { user, stats } = await api(`/users/${id}`);
    view.innerHTML = html`<h1>${user.name}</h1>
      <p class="muted">${user.teamName ? raw(html`🚤 <a href="#/boat/${user.teamId}">${user.teamName}</a> · `) : 'Individual angler · '}${user.country || ''}</p>
      ${user.bio ? raw(html`<p>${user.bio}</p>`) : ''}
      ${state.me.id === user.id ? raw('<a class="btn" href="#/profile">Edit profile</a>') : ''}
      <div class="stats">
        <div class="card stat"><b>${stats.catches}</b><span>catches</span></div>
        <div class="card stat"><b>${stats.released}</b><span>released</span></div>
        <div class="card stat"><b>${stats.heaviestKg ? Math.round(stats.heaviestKg) + ' kg' : '—'}</b><span>heaviest</span></div>
      </div>
      <div id="feed"></div>`;
    await renderFeed(view.querySelector('#feed'), { user: user.id });
  },

  async profile() {
    const me = state.me;
    view.innerHTML = html`<h1>Your profile</h1>
      <p>${me.teamId ? raw(html`🚤 Crew of <a href="#/boat/${me.teamId}">${me.teamName}</a>${me.isCaptain ? ' (captain)' : ''}`) : raw('Individual angler · <a href="#/crew">Get on a boat</a>')}</p>
      <form class="card pad stack" id="f">
        <label>Name <input name="name" required maxlength="80" value="${me.name}"></label>
        <label>Country <select name="country">${raw(options(state.meta.countries, me.country, 'Choose…'))}</select></label>
        <label>About you <textarea name="bio" maxlength="500">${me.bio || ''}</textarea></label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Save</button></div>
      </form>
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
      state.clubs = null;
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
      location.hash = state.afterLogin || '#/';
      state.afterLogin = null;
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

const PUBLIC_PAGES = ['welcome', 'login', 'register'];

function renderNav(active) {
  let links;
  if (!state.me) {
    links = [['#/login', 'Sign in', 'login'], ['#/register', 'Join', 'register', 'cta']];
  } else {
    links = [
      ['#/', 'Feed', 'home'],
      ['#/leaderboard', 'Leaderboard', 'leaderboard'],
      ['#/boats', 'Boats', 'boats'],
      ['#/clubs', 'Clubs', 'clubs'],
      ['#/profile', 'Me', 'profile'],
    ];
    if (state.me.teamId) links.push(['#/new', '+ Catch', 'new', 'cta']);
  }
  document.getElementById('nav').innerHTML = links
    .map(([href, label, key, cls]) => `<a href="${href}" class="${[cls, key === active ? 'active' : ''].join(' ')}">${label}</a>`)
    .join('');
}

async function route() {
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', arg] = path.split('/');
  const view = document.createElement('div');
  const pages = pagesFor(view);
  let page = Object.hasOwn(pages, name) ? name : 'home';
  if (!state.me && !PUBLIC_PAGES.includes(page)) {
    // Remember where a shared link was pointing so we can go there after sign-in.
    if (location.hash && location.hash !== '#/') state.afterLogin = location.hash;
    page = 'welcome';
  }
  if (state.me && PUBLIC_PAGES.includes(page)) page = 'home';
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
