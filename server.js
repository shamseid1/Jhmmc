const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const app = createApp({
  dbFile: process.env.DB_FILE || 'data/fishing.db',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  secureCookies: process.env.NODE_ENV === 'production',
  // Members who forget their password are told to write here; this account is the admin.
  adminEmail: process.env.ADMIN_EMAIL || 'shamseid4@gmail.com',
});
if (!process.env.SMTP_HOST) console.warn('SMTP_HOST is not set: password reset emails are printed to this log instead of sent.');

app.listen(port, () => {
  console.log(`West Africa Big Game running on http://localhost:${port}`);
});
