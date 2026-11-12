const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

test('reporting, blocking and the community rules', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-reports-'));
  const sent = [];
  const pusher = { publicKey: 'k', async send(sub, payload) { sent.push(payload); return true; } };
  const app = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'up'), adminEmail: 'boss@example.com', pusher });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const at = `http://127.0.0.1:${srv.address().port}/api`;
  const as = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(at + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
  };
  try {
    const boss = as();
    const ana = as();
    // Signing up means agreeing to the rules.
    assert.match((await ana('POST', '/auth/register', { firstName: 'Ana', lastName: 'Kollie', email: 'ana@example.com', password: 'password1' })).body.error, /community rules/);
    const anaMe = (await ana('POST', '/auth/register', { acceptRules: true, firstName: 'Ana', lastName: 'Kollie', email: 'ana@example.com', password: 'password1' })).body.user;
    assert.equal(anaMe.rulesAccepted, true);
    const bossMe = (await boss('POST', '/auth/register', { acceptRules: true, firstName: 'The', lastName: 'Boss', email: 'boss@example.com', password: 'password1' })).body.user;
    await boss('PUT', '/push/subscribe', {});
    const ann = (await boss('POST', '/announcements', { title: 'Bad words here', body: 'x' })).body;

    // Ana reports it; the officers are told; reporting again doesn't make a second report.
    assert.equal((await ana('POST', '/reports', { kind: 'announcement', id: ann.id, reason: 'nope' })).status, 400);
    assert.equal((await ana('POST', '/reports', { kind: 'announcement', id: ann.id, reason: 'offensive', note: 'Rude' })).status, 201);
    assert.equal((await ana('POST', '/reports', { kind: 'announcement', id: ann.id, reason: 'harassment' })).status, 201);
    assert.equal((await ana('POST', '/reports', { kind: 'user', id: anaMe.id, reason: 'spam' })).status, 400, 'not your own profile');
    assert.equal((await ana('GET', '/reports')).status, 403, 'only officers see reports');
    let list = (await boss('GET', '/reports')).body;
    assert.equal(list.open, 1);
    assert.equal(list.reports[0].reasonText, 'Harassment or abuse');
    assert.match(list.reports[0].target.what, /Bad words here/);
    assert.equal((await boss('GET', '/me')).body.user.openReports, 1);

    // Blocking: the person's posts leave Ana's feed, and come back when unblocked.
    const feedHas = async () => (await ana('GET', '/feed')).body.items.some((x) => x.kind === 'announcement');
    assert.equal(await feedHas(), true);
    assert.equal((await ana('POST', '/blocks', { userId: anaMe.id })).status, 400, "can't block yourself");
    assert.equal((await ana('POST', '/blocks', { userId: bossMe.id })).status, 201);
    assert.deepEqual((await ana('GET', '/me')).body.user.blocked, [bossMe.id]);
    assert.equal(await feedHas(), false);
    await ana('DELETE', `/blocks/${bossMe.id}`);
    assert.equal(await feedHas(), true);

    // The officer removes it: gone from the feed, the report closed and recorded.
    assert.equal((await boss('POST', `/reports/${list.reports[0].id}/resolve`, { action: 'remove' })).status, 200);
    assert.equal(await feedHas(), false);
    list = (await boss('GET', '/reports')).body;
    assert.equal(list.open, 0);
    assert.equal(list.reports[0].status, 'removed');
    const activity = (await boss('GET', '/activity')).body;
    assert.match(JSON.stringify(activity), /Report: removed Announcement/);

    // Older accounts agree once, on their next visit.
    assert.equal((await ana('POST', '/me/accept-rules')).status, 200);
  } finally {
    srv.close();
  }
});
