const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/demo');

const start = async (opts) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-acct-'));
  const dbFile = path.join(tmp, 'fishing.db');
  const app = createApp({ dbFile, uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com', nightlyBackups: false, ...opts });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const login = async (email, password = 'demo-pass-1') => {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    return async (method, url, body) => {
      const res = await fetch(`${base}/api${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
  };
  return { tmp, dbFile, base, srv, login };
};

test('delete my account: password needed; posts go, weighed fish stay as "Former member"; admin and demo accounts stay', async () => {
  const s = await start();
  try {
    await seedDemo(s.base, { adminEmail: 'boss@example.com' });
    const raw = new DatabaseSync(s.dbFile);
    const ziad = raw.prepare("SELECT id FROM users WHERE email = 'ziad@example.com'").get().id;
    const weighed = raw.prepare('SELECT COUNT(*) AS n FROM catches WHERE user_id = ?').get(ziad).n;
    assert.ok(weighed > 0);
    const before = raw.prepare("SELECT points FROM catches WHERE user_id = ? AND status = 'approved'").all(ziad).map((r) => r.points);
    const me = await s.login('ziad@example.com');
    assert.equal((await me('DELETE', '/me', { password: 'wrong-pass' })).status, 400);
    assert.equal((await me('DELETE', '/me', { password: 'demo-pass-1' })).status, 200);
    assert.equal((await me('GET', '/me')).body.user, null, 'signed out');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(ziad).n, 0);
    const kept = raw.prepare("SELECT angler_name AS a, points FROM catches WHERE angler_name = 'Former member'").all();
    assert.deepEqual(kept.map((r) => r.points).sort(), before.sort(), "the season's points don't change");
    assert.equal((await s.login('ziad@example.com')).length, 3);
    // The admin can't delete their own account this way.
    const { hashPassword } = require('../src/auth');
    raw.prepare("UPDATE users SET password_hash = ? WHERE email = 'boss@example.com'").run(hashPassword('password1'));
    const boss = await s.login('boss@example.com', 'password1');
    assert.equal((await boss('DELETE', '/me', { password: 'password1' })).status, 400);
    raw.close();
  } finally {
    s.srv.close();
  }
  // The demo's shared accounts can't be deleted.
  const d = await start({ demo: true, adminEmail: 'admin@example.com' });
  try {
    await seedDemo(d.base, { adminEmail: 'admin@example.com' });
    const cap = await d.login('captain@example.com');
    assert.equal((await cap('DELETE', '/me', { password: 'demo-pass-1' })).status, 403);
  } finally {
    d.srv.close();
  }
});

test('privacy policy: a plain page with the contact email', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/privacy`);
    assert.equal(r.status, 200);
    const page = await r.text();
    assert.match(page, /Privacy policy/);
    assert.match(page, /info@africasportfishing\.com/, "the club's address");
    assert.doesNotMatch(page, /boss@example\.com/, "never the admin's own");
    assert.doesNotMatch(page, /\{\{contact\}\}/);
    assert.match(page, /Delete my account/);
  } finally {
    s.srv.close();
  }
});

test('help page and the Android app link file', async () => {
  const s = await start();
  try {
    const help = await (await fetch(`${s.base}/support`)).text();
    assert.match(help, /Help/);
    assert.match(help, /info@africasportfishing\.com/);
    assert.deepEqual(await (await fetch(`${s.base}/.well-known/assetlinks.json`)).json(), [], 'empty until the Play fingerprint is set');
  } finally {
    s.srv.close();
  }
});

test("the admin fixes a member's name, email and boat; never the admin's own email; it's all on record", async () => {
  const s = await start();
  try {
    await seedDemo(s.base, { adminEmail: 'boss@example.com' });
    const raw = new DatabaseSync(s.dbFile);
    const { hashPassword } = require('../src/auth');
    raw.prepare("UPDATE users SET password_hash = ? WHERE email = 'boss@example.com'").run(hashPassword('password1'));
    const boss = await s.login('boss@example.com', 'password1');
    const sec = await s.login('secretary@example.com');
    const id = (email) => raw.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
    const boat = (name) => raw.prepare('SELECT id, captain_id AS captain FROM teams WHERE name = ?').get(name);
    const shams = id('shams@example.com');
    const edit = (who, body) => who('PATCH', `/admin/users/${shams}/account`, body);

    assert.equal((await edit(sec, { firstName: 'Sam' })).status, 403, 'the admin only, not the secretary');
    assert.equal((await edit(boss, { email: 'not an email' })).status, 400);
    assert.equal((await edit(boss, { email: 'jack@example.com' })).status, 409, "another member's email");
    assert.equal((await edit(boss, { lastName: '' })).status, 400, 'a last name is needed');
    assert.equal((await boss('PATCH', `/admin/users/${id('boss@example.com')}/account`, { email: 'me@example.com' })).status, 400, "the admin's email stays");

    // Shams captains Liberian Girl: moved to Bait Master, the next crew member there takes over.
    const girl = boat('Liberian Girl');
    assert.equal(girl.captain, shams);
    const r = await edit(boss, { firstName: 'Shams', lastName: 'Eid-Haddad', email: 'Shams.Eid@Example.com', teamId: boat('Bait Master').id });
    assert.equal(r.status, 200);
    const now = { ...raw.prepare('SELECT name, first_name AS f, last_name AS l, email, team_id AS t FROM users WHERE id = ?').get(shams) };
    assert.deepEqual(now, { name: 'Shams Eid-Haddad', f: 'Shams', l: 'Eid-Haddad', email: 'shams.eid@example.com', t: boat('Bait Master').id });
    const newCaptain = boat('Liberian Girl').captain;
    assert.ok(newCaptain && newCaptain !== shams, 'Liberian Girl has a new captain from its crew');
    assert.equal(raw.prepare('SELECT team_id AS t FROM users WHERE id = ?').get(newCaptain).t, girl.id);
    assert.equal((await s.login('shams.eid@example.com')).length, 3, 'signs in with the new email');

    // Taken off any boat; on record with what it was before.
    assert.equal((await edit(boss, { teamId: '' })).status, 200);
    assert.equal(raw.prepare('SELECT team_id AS t FROM users WHERE id = ?').get(shams).t, null);
    const log = raw.prepare("SELECT action FROM activity_log WHERE action LIKE 'Account of %' ORDER BY id").all().map((x) => x.action);
    assert.equal(log.length, 2);
    assert.match(log[0], /name Shams Eid → Shams Eid-Haddad/);
    assert.match(log[0], /email shams@example\.com → shams\.eid@example\.com/);
    assert.match(log[0], /boat Liberian Girl → Bait Master/);
    assert.match(log[1], /boat Bait Master → none/);
    raw.close();
  } finally {
    s.srv.close();
  }
});
