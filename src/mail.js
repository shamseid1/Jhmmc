const fs = require('node:fs');
const nodemailer = require('nodemailer');

// Sends email through any SMTP provider (Gmail, Zoho, Resend, Mailgun...),
// configured with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM.
// Without SMTP_HOST, messages are printed to the server log instead, which is
// enough for local development.
// Or through Brevo's web API with BREVO_API_KEY (an "xkeysib-" key) and MAIL_FROM:
// it works where SMTP logins are refused, and says plainly why when it can't send.
const parseFrom = (from) => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  return m ? { name: m[1].replace(/^"|"$/g, '') || undefined, email: m[2] } : { email: (from || '').trim() };
};
function brevoApiMailer(env, fetchImpl = globalThis.fetch) {
  const sender = parseFrom(env.MAIL_FROM);
  return {
    configured: true,
    async send({ to, subject, text, html, attachments }) {
      const body = {
        sender, to: [{ email: to }], subject, textContent: text, ...(html && { htmlContent: html }),
        ...(attachments?.length && {
          attachment: attachments.map((a) => ({ name: a.filename, content: (a.content ?? fs.readFileSync(a.path)).toString('base64') })),
        }),
      };
      const res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Brevo said ${res.status}${err.code ? ` (${err.code})` : ''}: ${err.message || res.statusText}`);
      }
      return res.json().catch(() => ({}));
    },
  };
}

function createMailer(env = process.env, { fetchImpl } = {}) {
  if (env.BREVO_API_KEY) return brevoApiMailer(env, fetchImpl);
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async send({ to, subject, text, attachments }) {
        console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n\n${text}\n${attachments ? `(${attachments.length} attachment)\n` : ''}`);
      },
    };
  }
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // Give up in seconds, not minutes, so a wrong setting shows as an error straight away.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    configured: true,
    send: ({ to, subject, text, html, attachments }) => transport.sendMail({ from, to, subject, text, html, attachments }),
  };
}

module.exports = { createMailer };
