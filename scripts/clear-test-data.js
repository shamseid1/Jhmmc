// Run once, by hand, when testing is over (README "Before the whole club starts").
// Not part of the app: nobody can clear data from inside it.
//
//   node scripts/clear-test-data.js --keep "Sea Monkey"          shows what would go
//   node scripts/clear-test-data.js --keep "Sea Monkey" --yes    clears it (after a backup)
//
// Stays: every account, boat, crew, club membership and tournament, the activity log,
// and everything belonging to the boats named with --keep (repeat it for more boats).
// Goes: every other boat's weigh-ins and points (with their likes, comments, disputes
// and history), their logged trips and photos, feed posts by anyone not on a kept boat,
// and all announcements.
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createBackups } = require('../src/backup');

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function clearTestData({ dbFile, uploadDir, keep = [], yes = false, log = console.log }) {
  const db = openDb(dbFile);
  try {
    const kept = keep.map((name) => {
      const t = db.prepare('SELECT id, name FROM teams WHERE lower(name) = lower(?)').get(name.trim());
      if (!t) throw new Error(`No boat called "${name}". Boats: ${db.prepare('SELECT name FROM teams ORDER BY name').all().map((r) => r.name).join(', ')}`);
      return t;
    });
    const k = kept.length ? kept.map((t) => t.id).join(',') : '0';
    const sets = {
      catches: `SELECT id FROM catches WHERE COALESCE(team_id, 0) NOT IN (${k})`,
      outings: `SELECT id FROM outings WHERE COALESCE(team_id, 0) NOT IN (${k})`,
      posts: `SELECT id FROM club_posts WHERE user_id NOT IN (SELECT id FROM users WHERE team_id IN (${k}))`,
    };
    const n = (q) => db.prepare(`SELECT COUNT(*) AS n FROM (${q})`).get().n;
    const counts = {
      weighIns: n(sets.catches), trips: n(sets.outings), posts: n(sets.posts), announcements: n('SELECT id FROM announcements'),
      keptWeighIns: n('SELECT id FROM catches') - n(sets.catches), keptTrips: n('SELECT id FROM outings') - n(sets.outings),
    };
    log(`Keeping: ${kept.map((t) => t.name).join(', ') || 'no boat'} (${plural(counts.keptWeighIns, 'weigh-in')}, ${plural(counts.keptTrips, 'logged trip')}).`);
    log(`Clearing: ${plural(counts.weighIns, 'weigh-in')}, ${plural(counts.trips, 'logged trip')}, ${plural(counts.posts, 'feed post')}, ${plural(counts.announcements, 'announcement')}.`);
    if (!yes) {
      log('Nothing changed. Add --yes to clear.');
      return { counts, cleared: false };
    }
    const backup = createBackups(db, { dir: path.join(path.dirname(path.resolve(dbFile)), 'backups') }).make();
    log(`Backup first: ${backup.name}`);
    const files = db.prepare(`
      SELECT photo AS f FROM catches WHERE id IN (${sets.catches}) UNION ALL SELECT video FROM catches WHERE id IN (${sets.catches})
      UNION ALL SELECT scale_photo FROM catches WHERE id IN (${sets.catches}) UNION ALL SELECT scale_video FROM catches WHERE id IN (${sets.catches})
      UNION ALL SELECT file FROM post_photos WHERE kind = 'catch' AND post_id IN (${sets.catches})
      UNION ALL SELECT photo FROM outing_landings WHERE outing_id IN (${sets.outings})
      UNION ALL SELECT photo FROM club_posts WHERE id IN (${sets.posts}) UNION ALL SELECT video FROM club_posts WHERE id IN (${sets.posts})
      UNION ALL SELECT file FROM post_photos WHERE kind = 'club' AND post_id IN (${sets.posts})`).all().map((r) => r.f).filter(Boolean);
    db.exec('BEGIN');
    try {
      db.exec(`DELETE FROM post_photos WHERE kind = 'catch' AND post_id IN (${sets.catches})`);
      db.exec(`DELETE FROM post_photos WHERE kind = 'club' AND post_id IN (${sets.posts})`);
      db.exec(`DELETE FROM registration_log WHERE catch_id IN (${sets.catches})`);
      db.exec(`DELETE FROM catches WHERE id IN (${sets.catches})`);
      db.exec(`DELETE FROM outings WHERE id IN (${sets.outings})`);
      db.exec(`DELETE FROM club_posts WHERE id IN (${sets.posts})`);
      db.exec('DELETE FROM announcements');
      db.prepare("INSERT INTO activity_log (user_id, user_name, role, action, details) VALUES (NULL, 'Server', 'admin', 'Cleared the test data', ?)")
        .run(`Kept ${kept.map((t) => t.name).join(', ') || 'no boat'}'s data. Removed ${counts.weighIns} weigh-ins, ${counts.trips} trips, ${counts.posts} posts and ${counts.announcements} announcements. Backup first: ${backup.name}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    for (const f of files) fs.rmSync(path.join(uploadDir, path.basename(f)), { force: true });
    log('Done.');
    return { counts, cleared: true, backup: backup.name };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const keep = args.flatMap((a, i) => (a === '--keep' ? [args[i + 1]] : [])).filter(Boolean);
  try {
    clearTestData({
      dbFile: process.env.DB_FILE || 'data/fishing.db', uploadDir: process.env.UPLOAD_DIR || 'uploads', keep, yes: args.includes('--yes'),
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { clearTestData };
