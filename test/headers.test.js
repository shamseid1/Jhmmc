const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

test('security headers: a content policy that allows the page\'s own inline script, and no framing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-hd-'));
  const app = createApp({ dbFile: path.join(tmp, 'fishing.db'), uploadDir: path.join(tmp, 'up'), nightlyBackups: false, secureCookies: true });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    for (const url of ['/', '/api/meta', '/privacy']) {
      const r = await fetch(base + url);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'self'/, url);
      assert.match(csp, /frame-ancestors 'none'/, url);
      assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline|unsafe-eval/, 'scripts: only the app\'s own');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.match(r.headers.get('strict-transport-security'), /max-age=\d+/);
    }
    // Every inline script in the page served is allowed by its hash (or it wouldn't run).
    const r = await fetch(`${base}/`);
    const page = await r.text();
    const inline = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(inline.length > 0);
    for (const code of inline) {
      assert.ok(r.headers.get('content-security-policy').includes(`'sha256-${crypto.createHash('sha256').update(code).digest('base64')}'`));
    }
  } finally {
    srv.close();
  }
});
