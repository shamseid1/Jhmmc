// Africa Sportfishing, part of the app (public/js/pages-account.js): Rules, records, people's pages, the profile, signing in and up.
// The parts load in order (index.html) and share one scope, as one file would.

'use strict';

PAGE_GROUPS.push((view) => ({
  // The JHMMC season rules and a summary of the IGFA angling rules.
  // The community rules: what's allowed, how reporting and blocking work.
  async community() {
    view.innerHTML = html`<p class="back"><a href="#/more">‹ More</a></p>
      <h1>Community rules</h1>
      <div class="card pad">${raw(rulesList())}</div>
      ${state.me ? '' : raw('<p class="small muted">You agree to these when you create an account.</p>')}`;
  },

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
      ${state.me && state.me.id !== user.id ? raw(html`<p class="person-actions">
        ${raw(reportBtn('user', user.id, { userId: null, label: 'Report profile' }))}
        <button type="button" class="link small muted" data-block="${user.id}">${raw(icon('shield'))} ${state.me.blocked?.includes(user.id) ? 'Unblock' : 'Block'}</button></p>`) : ''}
      <h2>Catches</h2>
      <div id="trophies"></div>`;
    view.querySelector('[data-block]')?.addEventListener('click', async (e) => {
      const blocked = state.me.blocked?.includes(user.id);
      try {
        await api(blocked ? `/blocks/${user.id}` : '/blocks', { method: blocked ? 'DELETE' : 'POST', body: blocked ? undefined : { userId: user.id } });
        state.me = (await api('/me')).user;
        e.target.closest('button').innerHTML = `${icon('shield')} ${blocked ? 'Block' : 'Unblock'}`;
        toast(blocked ? `${user.name} unblocked.` : `${user.name} blocked: you won't see their posts on the feed.`);
      } catch (err) {
        toast(err.message);
      }
    });
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
          and the phones getting your notifications. <b>Kept, without your name:</b> fish already weighed in
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
        <label class="check"><input type="checkbox" name="acceptRules" value="yes" required> I agree to the <a href="#/community" target="_blank">community rules</a>: no offensive content, and reported posts are removed.</label>
        <p class="error"></p>
        <div><button type="submit" class="primary">Create account</button></div>
      </form>
      <p class="small muted">By creating an account you agree to the <a href="/privacy" target="_blank" rel="noopener">privacy policy</a> and the <a href="#/community">community rules</a>.</p>
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
}));
