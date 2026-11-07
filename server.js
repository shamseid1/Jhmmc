const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
// DEMO=1: a demo copy with a made-up season, for showing the club (README "Demo copy").
const demo = process.env.DEMO === '1';
const app = createApp({
  dbFile: process.env.DB_FILE || 'data/fishing.db',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  secureCookies: process.env.NODE_ENV === 'production',
  // Members who forget their password are told to write here; this account is the admin.
  adminEmail: process.env.ADMIN_EMAIL || (demo ? 'admin@example.com' : 'shamseid4@gmail.com'),
  demo,
  // The demo's data is all made up: nothing to back up or email.
  nightlyBackups: !demo,
});
if (!process.env.SMTP_HOST && !demo) console.warn('SMTP_HOST is not set: password reset emails are printed to this log instead of sent.');

app.listen(port, () => {
  console.log(`West Africa Big Game${demo ? ' (demo copy)' : ''} running on http://localhost:${port}`);
  if (demo) {
    const { seedDemo } = require('./src/demo');
    seedDemo(`http://127.0.0.1:${port}`, { adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com' })
      .then((made) => console.log(made ? 'Demo season filled in.' : 'Demo season already there.'))
      .catch((err) => console.error('Demo season failed:', err.message));
  }
});
