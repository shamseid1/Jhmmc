const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
const app = createApp({
  dbFile: process.env.DB_FILE || 'data/fishing.db',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  secureCookies: process.env.NODE_ENV === 'production',
});

app.listen(port, () => {
  console.log(`West Africa Big Game Fishing running on http://localhost:${port}`);
});
