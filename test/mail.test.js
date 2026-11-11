const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMailer } = require('../src/mail');

test('mail through Brevo\'s API: sender, attachment, and Brevo\'s own error message', async () => {
  const calls = [];
  let reply = { ok: true, status: 201, json: async () => ({ messageId: 'x' }) };
  const fetchImpl = async (url, init) => { calls.push([url, init]); return reply; };
  const mailer = createMailer({ BREVO_API_KEY: 'xkeysib-test', MAIL_FROM: 'Africa Sportfishing <info@africasportfishing.com>' }, { fetchImpl });
  assert.equal(mailer.configured, true);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wabg-mail-')), 'b.db.gz');
  fs.writeFileSync(file, 'hello');
  await mailer.send({ to: 'boss@example.com', subject: 'Backup', text: 'Keep this', attachments: [{ filename: 'b.db.gz', path: file }] });
  const [url, init] = calls[0];
  assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(init.headers['api-key'], 'xkeysib-test');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.sender, { name: 'Africa Sportfishing', email: 'info@africasportfishing.com' });
  assert.deepEqual(body.to, [{ email: 'boss@example.com' }]);
  assert.deepEqual(body.attachment, [{ name: 'b.db.gz', content: Buffer.from('hello').toString('base64') }]);
  reply = { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ code: 'unauthorized', message: 'Key not found' }) };
  await assert.rejects(mailer.send({ to: 'a@b.c', subject: 's', text: 't' }), /Brevo said 401 \(unauthorized\): Key not found/);
});

test('mail settings with a stray line break or space still work', () => {
  const mailer = createMailer({ SMTP_HOST: 'smtp-relay.brevo.com\n', SMTP_PORT: ' 587 ', SMTP_USER: 'c278e4001@smtp-brevo.com\n', SMTP_PASS: 'xsmtpsib-abc \n' });
  assert.equal(mailer.configured, true);
  const opts = mailer.transportOptions;
  assert.deepEqual([opts.host, opts.port, opts.auth.user, opts.auth.pass], ['smtp-relay.brevo.com', 587, 'c278e4001@smtp-brevo.com', 'xsmtpsib-abc']);
});
