const nodemailer = require('nodemailer');

// Sends email through any SMTP provider (Gmail, Zoho, Resend, Mailgun...),
// configured with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM.
// Without SMTP_HOST, messages are printed to the server log instead, which is
// enough for local development.
function createMailer(env = process.env) {
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async send({ to, subject, text }) {
        console.log(`[mail not configured] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
      },
    };
  }
  const port = Number(env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  return {
    configured: true,
    send: ({ to, subject, text, html }) => transport.sendMail({ from, to, subject, text, html }),
  };
}

module.exports = { createMailer };
