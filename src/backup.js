const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Copies of the database: every fish, account and point. A copy is taken with
// VACUUM INTO, so it is complete and consistent even while the app is in use,
// then gzipped. The last KEEP days are kept next to the database (a bad edit
// or a broken update can be undone from them), and each nightly copy is also
// emailed to the admin (the disk itself can fail).
const KEEP = 14;
const NAME = /^fishing-(\d{4}-\d{2}-\d{2})(?:-(\d{6}))?\.db\.gz$/;

function createBackups(db, { dir, mailer, adminEmail, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });

  const list = () => fs.readdirSync(dir)
    .filter((f) => NAME.test(f))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));

  function make() {
    const t = now().toISOString();
    const name = `fishing-${t.slice(0, 10)}-${t.slice(11, 19).replace(/:/g, '')}.db.gz`;
    const raw = path.join(dir, `${name}.tmp`);
    fs.rmSync(raw, { force: true });
    db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
    fs.writeFileSync(path.join(dir, name), zlib.gzipSync(fs.readFileSync(raw)));
    fs.rmSync(raw, { force: true });
    // Keep the newest copy of each of the last KEEP days.
    const days = new Set();
    for (const b of list()) {
      const day = b.name.match(NAME)[1];
      if (days.has(day) || days.size >= KEEP) fs.rmSync(path.join(dir, b.name), { force: true });
      else days.add(day);
    }
    return list().find((b) => b.name === name);
  }

  async function email(b) {
    if (!mailer?.configured || !adminEmail) return false;
    await mailer.send({
      to: adminEmail,
      subject: `West Africa Sportfishing backup ${b.name.match(NAME)[1]}`,
      text: `The app's database as of ${b.at}: every fish, account and point.\n\n`
        + 'Keep this email. To restore, see "Backups" in the README.',
      attachments: [{ filename: b.name, path: path.join(dir, b.name) }],
    });
    return true;
  }

  // Once a day (checked every hour): a copy, emailed to the admin.
  async function daily() {
    const today = now().toISOString().slice(0, 10);
    if (list().some((b) => b.name.includes(today))) return null;
    const b = make();
    try {
      await email(b);
    } catch (err) {
      console.error('Backup made but not emailed:', err.message);
    }
    return b;
  }
  function start() {
    const run = () => daily().catch((err) => console.error('Backup failed:', err.message));
    setTimeout(run, 60 * 1000).unref();
    setInterval(run, 60 * 60 * 1000).unref();
  }

  const file = (name) => (NAME.test(name) && fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null);
  return { list, make, email, daily, start, file, emailOn: !!(mailer?.configured && adminEmail) };
}

module.exports = { createBackups };
