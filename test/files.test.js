const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

test("the app's parts: every one loaded by the page and kept for offline use, strict, nothing missing", () => {
  const parts = fs.readdirSync(path.join(PUB, 'js')).filter((f) => f.endsWith('.js'));
  const page = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const loaded = [...page.matchAll(/<script src="\/js\/([\w-]+\.js)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual([...loaded].sort(), [...parts].sort(), 'index.html loads every part, and only those');
  assert.equal(loaded[0], 'core.js', 'the helpers first');
  assert.equal(loaded.at(-1), 'main.js', 'the router last');
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  for (const p of parts) {
    assert.ok(sw.includes(`'/js/${p}'`), `sw.js keeps ${p} for offline use`);
    assert.match(fs.readFileSync(path.join(PUB, 'js', p), 'utf8'), /^'use strict';$/m, `${p} is strict`);
  }
  // Every file the service worker keeps exists (one missing would stop it installing).
  const listed = [...sw.matchAll(/'(\/[^']+\.[a-z]+)'/g)].map((m) => m[1]);
  // (/scoring.js is the server's own scoring rules, src/scoring.js, so both score alike.)
  const FROM_SERVER = { '/scoring.js': path.join(__dirname, '..', 'src', 'scoring.js') };
  for (const f of listed) assert.ok(fs.existsSync(FROM_SERVER[f] || path.join(PUB, f)), `${f} exists`);
});
