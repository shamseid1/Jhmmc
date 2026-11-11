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
    // A comment from before comments were taken out of the app: it goes with the account.
    raw.prepare('INSERT INTO comments (catch_id, user_id, body) VALUES (?, ?, ?)').run(raw.prepare('SELECT id FROM catches LIMIT 1').get().id, ziad, 'Nice one');
    assert.equal((await me('DELETE', '/me', { password: 'wrong-pass' })).status, 400);
    assert.equal((await me('DELETE', '/me', { password: 'demo-pass-1' })).status, 200);
    assert.equal((await me('GET', '/me')).body.user, null, 'signed out');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(ziad).n, 0);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?').get(ziad).n, 0);
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
