const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const COUNTRIES = [
  'Benin', 'Burkina Faso', 'Cabo Verde', "Côte d'Ivoire", 'The Gambia', 'Ghana',
  'Guinea', 'Guinea-Bissau', 'Liberia', 'Mali', 'Mauritania', 'Niger', 'Nigeria',
  'Senegal', 'Sierra Leone', 'Togo',
];

// Big game species commonly targeted off the West African coast, with the
// JHMMC points per kg from the 2025-26 Fish Registration Form (editable in the app).
const SPECIES = [
  ['Atlantic blue marlin', 'Makaira nigricans', 'Billfish', 5],
  ['Atlantic sailfish', 'Istiophorus albicans', 'Billfish', 5],
  ['White marlin', 'Kajikia albida', 'Billfish', 5],
  ['Swordfish', 'Xiphias gladius', 'Billfish', 3],
  ['Yellowfin tuna', 'Thunnus albacares', 'Tuna', 3],
  ['Bigeye tuna', 'Thunnus obesus', 'Tuna', 3],
  ['Skipjack tuna', 'Katsuwonus pelamis', 'Tuna', 3],
  ['Little tunny', 'Euthynnus alletteratus', 'Tuna', 3],
  ['Wahoo', 'Acanthocybium solandri', 'Pelagic', 5],
  ['Dorado (mahi-mahi)', 'Coryphaena hippurus', 'Pelagic', 3],
  ['West African Spanish mackerel', 'Scomberomorus tritor', 'Pelagic', 3],
  ['Barracuda', 'Sphyraena afra', 'Pelagic', 3],
  ['Greater amberjack', 'Seriola dumerili', 'Reef & jacks', 3],
  ['Crevalle jack', 'Caranx hippos', 'Reef & jacks', 5],
  ['African pompano', 'Alectis ciliaris', 'Reef & jacks', 3],
  ['Cubera snapper', 'Lutjanus cyanopterus', 'Reef & jacks', 5],
  ['Snapper', 'Lutjanus spp.', 'Bottom', 5],
  ['Giant African threadfin', 'Polydactylus quadrifilis', 'Inshore', 3],
  ['Atlantic tarpon', 'Megalops atlanticus', 'Inshore', 5],
  ['Butter nose', null, 'Inshore', 5],
  ['Leerfish (garrick)', 'Lichia amia', 'Inshore', 3],
  ['Dusky grouper', 'Epinephelus marginatus', 'Bottom', 5],
  ['Shortfin mako shark', 'Isurus oxyrinchus', 'Shark', 5],
  ['Hammerhead shark', 'Sphyrna spp.', 'Shark', 5],
  // Species in the JHMMC record book (as at May 2026) the list didn't have.
  ['Striped marlin', 'Kajikia audax', 'Billfish', 3],
  ['Atlantic bonito', 'Sarda sarda', 'Tuna', 3],
  ['Cobia', 'Rachycentron canadum', 'Pelagic', 3],
  ['Rainbow runner', 'Elagatis bipinnulata', 'Pelagic', 3],
  ['Bigeye trevally', 'Caranx sexfasciatus', 'Reef & jacks', 3],
  ['Almaco jack', 'Seriola rivoliana', 'Reef & jacks', 3],
  ['Tripletail', 'Lobotes surinamensis', 'Inshore', 3],
  ['Yellow tail', null, 'Inshore', 3],
  ['Grunter', null, 'Inshore', 3],
  ['Spotted grunter', null, 'Inshore', 3],
  ['Tiger fish', null, 'River', 3],
  ['Stingray', null, 'Ray', 3],
  ['Other', null, 'Other', 3],
];

// JHMMC weigh stations; Lofa River weighs for river boats.
const WEIGH_STATIONS = ['Extreme', 'Beerville', 'Barracuda Club', 'Lofa River'];

// IGFA line classes, in pounds, plus 100 lb, which local tournaments use.
const LINE_CLASSES = ['2 lb', '4 lb', '6 lb', '8 lb', '12 lb', '16 lb', '20 lb', '30 lb', '50 lb', '80 lb', '100 lb', '130 lb', 'Unlimited'];

// The founding club: always present, and listed first after IGFA on the Records page.
const HOME_CLUB = { name: 'JHMMC', country: 'Liberia' };

const SCHEMA_VERSION = 30;

// A catch is credited to a member (user_id) or, for anglers without an
// account, to a typed name (angler_name). logged_by is whoever entered it.
const catchesTable = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  angler_name TEXT,
  logged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  species_id INTEGER NOT NULL REFERENCES species(id),
  weight_kg REAL,
  length_cm REAL,
  released INTEGER NOT NULL DEFAULT 0,
  tagged INTEGER NOT NULL DEFAULT 0,
  caught_on TEXT NOT NULL,
  country TEXT,
  location TEXT,
  line_class TEXT,
  notes TEXT,
  photo TEXT,
  video TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Official scoring: registered at the weigh station by the captain, then approved by the secretary.
  status TEXT NOT NULL DEFAULT 'pending_review',
  -- Where the fish was caught (phone GPS). Private to the boat unless spot_public.
  lat REAL,
  lng REAL,
  spot_public INTEGER NOT NULL DEFAULT 0,
  weigh_station TEXT,
  weighed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  weighed_at TEXT,
  scale_photo TEXT,
  -- Optional: a video of the fish on the scale, recorded there and then.
  scale_video TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  points REAL,
  points_note TEXT,
  CHECK (user_id IS NOT NULL OR angler_name IS NOT NULL)
);`;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  country TEXT NOT NULL,
  city TEXT,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  -- Full name (first_name last_name), for the club's records; the nickname
  -- (if any) is what others see.
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  nickname TEXT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  country TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  bio TEXT,
  photo TEXT,
  role TEXT,
  weigh_station TEXT,
  -- Belongs to JHMMC (set by the admin); only members can hold a club role.
  jhmmc INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A team is a boat and its crew. The captain manages members and the invite code.
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  home_port TEXT,
  country TEXT,
  length_ft REAL,
  make TEXT,
  photo TEXT,
  division TEXT NOT NULL DEFAULT 'ocean',
  -- JHMMC boats: the weigh station they bring their fish to, which is also
  -- their home port (home_port is kept the same).
  weigh_station TEXT,
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  captain_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  join_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- One-time password reset links. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scientific_name TEXT,
  category TEXT NOT NULL,
  points_per_kg REAL NOT NULL DEFAULT 3
);

-- Calendar: tournaments, from date to end_date (NULL for one day), and
-- holidays from earlier versions, no longer used for scoring.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  end_date TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('holiday', 'tournament')),
  name TEXT NOT NULL
);

-- Boats entered in a tournament: only their fish count for its results.
CREATE TABLE IF NOT EXISTS tournament_entries (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, team_id)
);

-- Who fishes on an entered boat in a tournament: crew with accounts or guests
-- by name. Non-members pay a temporary membership, ticked off when paid.
CREATE TABLE IF NOT EXISTS tournament_anglers (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES club_people(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  member INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tournament_anglers_entry ON tournament_anglers(event_id, team_id, position);

-- Club members without an account (children, for example), kept by the
-- secretary, with the boat they usually fish on.
CREATE TABLE IF NOT EXISTS club_people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS club_people_paid (
  person_id INTEGER NOT NULL REFERENCES club_people(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  PRIMARY KEY (person_id, season)
);

-- Paid JHMMC members, per season (keyed by the season's start date).
CREATE TABLE IF NOT EXISTS club_members (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, season)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

${catchesTable('catches')}
CREATE INDEX IF NOT EXISTS catches_created ON catches(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS catches_species ON catches(species_id, weight_kg DESC);
CREATE INDEX IF NOT EXISTS catches_club ON catches(club_id);
CREATE INDEX IF NOT EXISTS catches_team ON catches(team_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catch_id INTEGER NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, catch_id)
);

-- Another JHMMC captain questioning a registration within 24 hours.
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY,
  catch_id INTEGER NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (catch_id, user_id)
);

-- Everything that happened to a JHMMC registration: kept even if the fish or
-- the person is later deleted, so names and figures are copied in.
CREATE TABLE IF NOT EXISTS registration_log (
  id INTEGER PRIMARY KEY,
  catch_id INTEGER NOT NULL,
  team_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('registered', 'withdrawn', 'deleted', 'disputed', 'approved', 'rejected')),
  user_id INTEGER,
  user_name TEXT NOT NULL,
  details TEXT NOT NULL,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS registration_log_catch ON registration_log(catch_id);
CREATE INDEX IF NOT EXISTS registration_log_team ON registration_log(team_id, id DESC);

-- Phones and browsers that asked for notifications (Web Push).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The JHMMC feed: members only. A post is a message, a photo, a fish, or any mix.
CREATE TABLE IF NOT EXISTS club_posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  photo TEXT,
  video TEXT,
  species_id INTEGER REFERENCES species(id),
  -- Where the fish was caught (phone GPS or typed): only the poster sees it.
  lat REAL,
  lng REAL,
  weight_kg REAL,
  released INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS club_posts_created ON club_posts(created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS club_post_likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE IF NOT EXISTS club_post_comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES club_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS club_post_comments_post ON club_post_comments(post_id, id);

-- More photos on a post (the first stays in the post's own photo column):
-- 'catch' for a West Africa post, 'club' for a JHMMC feed post.
CREATE TABLE IF NOT EXISTS post_photos (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('catch', 'club')),
  post_id INTEGER NOT NULL,
  file TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS post_photos_post ON post_photos(kind, post_id, id);

-- The regional log: one line per outing, blank days included, same format for
-- everyone. Rough areas only, never exact spots.
CREATE TABLE IF NOT EXISTS outings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  boat TEXT NOT NULL,
  country TEXT,
  date TEXT NOT NULL,
  no_catch INTEGER NOT NULL DEFAULT 0,
  technique TEXT,
  area TEXT,
  depth_m REAL,
  water_c REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS outings_date ON outings(date DESC, id DESC);
CREATE TABLE IF NOT EXISTS outing_fish (
  id INTEGER PRIMARY KEY,
  outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  species_id INTEGER NOT NULL REFERENCES species(id),
  released INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outing_fish_outing ON outing_fish(outing_id);
-- Each fish as it was landed ("Fish on"), with the phone's spot and time.
-- The spot is for the boat's crew only; the log shows the counts.
CREATE TABLE IF NOT EXISTS outing_landings (
  id INTEGER PRIMARY KEY,
  outing_id INTEGER NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  species_id INTEGER NOT NULL REFERENCES species(id),
  fate TEXT NOT NULL CHECK (fate IN ('released', 'kept', 'lost')),
  lat REAL,
  lng REAL,
  landed_at TEXT NOT NULL,
  client_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS outing_landings_outing ON outing_landings(outing_id, id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  catch_id INTEGER NOT NULL REFERENCES catches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get();
  if (hasTables && version < 2) {
    throw new Error(`${file} was created by an older version of the app. Move it aside and restart to create a fresh database.`);
  }
  // Upgrades that keep existing data, keyed by the version they upgrade from.
  if (hasTables && version < 3) {
    db.exec(`
      ALTER TABLE users ADD COLUMN photo TEXT;
      ALTER TABLE teams ADD COLUMN length_ft REAL;
      ALTER TABLE teams ADD COLUMN make TEXT;
      ALTER TABLE teams ADD COLUMN photo TEXT;
    `);
  }
  if (hasTables && version < 4) {
    // Line classes were recorded in kilograms; IGFA pairs each with a pound class.
    const kgToLb = { '6 kg': '12 lb', '8 kg': '16 lb', '10 kg': '20 lb', '15 kg': '30 lb', '24 kg': '50 lb', '37 kg': '80 lb', '60 kg': '130 lb' };
    const update = db.prepare('UPDATE catches SET line_class = ? WHERE line_class = ?');
    for (const [kg, lb] of Object.entries(kgToLb)) update.run(lb, kg);
  }
  if (hasTables && version < 5) {
    // user_id becomes optional for anglers without an account; SQLite needs a rebuild for that.
    const cols = 'id, user_id, logged_by, team_id, club_id, species_id, weight_kg, length_cm, released, tagged, caught_on, country, location, line_class, notes, photo, created_at';
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`BEGIN;
      ${catchesTable('catches_v5')}
      INSERT INTO catches_v5 (${cols}) SELECT ${cols} FROM catches;
      DROP TABLE catches;
      ALTER TABLE catches_v5 RENAME TO catches;
      COMMIT;`);
    db.exec('PRAGMA foreign_keys = ON');
  }
  if (hasTables && version < 6) {
    const addColumn = (table, column, definition) => {
      const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
      if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    addColumn('users', 'role', 'TEXT');
    addColumn('teams', 'division', "TEXT NOT NULL DEFAULT 'ocean'");
    addColumn('species', 'points_per_kg', 'REAL NOT NULL DEFAULT 3');
    for (const [column, definition] of [
      ['status', "TEXT NOT NULL DEFAULT 'pending_review'"], ['weigh_station', 'TEXT'],
      ['weighed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'], ['weighed_at', 'TEXT'], ['scale_photo', 'TEXT'],
      ['reviewed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'], ['reviewed_at', 'TEXT'],
      ['points', 'REAL'], ['points_note', 'TEXT'],
    ]) addColumn('catches', column, definition);
    // Existing species take the JHMMC points from the registration form.
    const setPoints = db.prepare('UPDATE species SET points_per_kg = ? WHERE name = ?');
    for (const [name, , , points] of SPECIES) setPoints.run(points, name);
  }
  if (hasTables && version < 7) {
    // Only JHMMC boats go through weigh-in and approval; other clubs' catches are unofficial.
    db.prepare(`
      UPDATE catches SET status = 'unofficial'
      WHERE status IN ('pending_weigh', 'pending_review')
        AND (club_id IS NULL OR club_id NOT IN (SELECT id FROM clubs WHERE name = ? COLLATE NOCASE))
    `).run(HOME_CLUB.name);
  }
  if (hasTables && version < 8) {
    // Feed posts and JHMMC registrations are now separate: anything a crew
    // logged becomes a feed post; only weighmaster registrations stay official.
    db.exec(`
      UPDATE catches SET status = 'unofficial'
      WHERE status = 'pending_weigh'
        OR (status = 'pending_review' AND COALESCE((SELECT role FROM users WHERE id = catches.logged_by), '') = '')
    `);
  }
  if (hasTables && version < 9) {
    const has = (column) => db.prepare('PRAGMA table_info(catches)').all().some((c) => c.name === column);
    if (!has('lat')) db.exec('ALTER TABLE catches ADD COLUMN lat REAL');
    if (!has('lng')) db.exec('ALTER TABLE catches ADD COLUMN lng REAL');
    if (!has('spot_public')) db.exec('ALTER TABLE catches ADD COLUMN spot_public INTEGER NOT NULL DEFAULT 0');
  }
  if (hasTables && version < 10) {
    if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'weigh_station')) {
      db.exec('ALTER TABLE users ADD COLUMN weigh_station TEXT');
    }
  }
  if (hasTables && version < 11) {
    if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'end_date')) {
      db.exec('ALTER TABLE events ADD COLUMN end_date TEXT');
    }
  }
  if (hasTables && version < 12) {
    if (!db.prepare('PRAGMA table_info(teams)').all().some((c) => c.name === 'weigh_station')) {
      db.exec('ALTER TABLE teams ADD COLUMN weigh_station TEXT');
    }
  }
  if (hasTables && version < 14) {
    // JHMMC boats: the weigh station is their home port.
    const home = db.prepare('SELECT id FROM clubs WHERE name = ?').get(HOME_CLUB.name)?.id;
    db.prepare(`UPDATE teams SET weigh_station = (SELECT value FROM json_each(?) WHERE lower(value) = lower(trim(teams.home_port)))
      WHERE club_id = ? AND weigh_station IS NULL`).run(JSON.stringify(WEIGH_STATIONS), home ?? -1);
    db.prepare('UPDATE teams SET home_port = weigh_station WHERE club_id = ? AND weigh_station IS NOT NULL').run(home ?? -1);
  }
  if (hasTables && version < 15) {
    // Captains now register their own boat's fish; there are no weighmasters.
    db.exec("UPDATE users SET role = NULL, weigh_station = NULL WHERE role = 'weighmaster'");
  }
  if (hasTables && version < 21) {
    const cols = db.prepare('PRAGMA table_info(tournament_anglers)').all();
    if (cols.length && !cols.some((c) => c.name === 'person_id')) {
      db.exec('ALTER TABLE tournament_anglers ADD COLUMN person_id INTEGER REFERENCES club_people(id) ON DELETE SET NULL');
    }
  }
  if (hasTables && version < 22) {
    if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'jhmmc')) {
      db.exec('ALTER TABLE users ADD COLUMN jhmmc INTEGER NOT NULL DEFAULT 0');
    }
    // Start with the people who are clearly JHMMC: on a JHMMC boat, holding a
    // role, or already marked as a paid member.
    db.prepare(`UPDATE users SET jhmmc = 1 WHERE role IS NOT NULL
      OR team_id IN (SELECT t.id FROM teams t JOIN clubs c ON c.id = t.club_id WHERE c.name = ?)`).run(HOME_CLUB.name);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'club_members'").get()) {
      db.exec('UPDATE users SET jhmmc = 1 WHERE id IN (SELECT user_id FROM club_members)');
    }
  }
  if (hasTables && version < 23 && !db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'nickname')) {
    db.exec('ALTER TABLE users ADD COLUMN nickname TEXT');
  }
  if (hasTables && version < 24 && !db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'first_name')) {
    db.exec('ALTER TABLE users ADD COLUMN first_name TEXT');
    db.exec('ALTER TABLE users ADD COLUMN last_name TEXT');
    // Split the names people already gave at the first space; one word is a first name only.
    db.exec(`UPDATE users SET
      first_name = CASE WHEN instr(trim(name), ' ') > 0 THEN substr(trim(name), 1, instr(trim(name), ' ') - 1) ELSE trim(name) END,
      last_name = CASE WHEN instr(trim(name), ' ') > 0 THEN trim(substr(trim(name), instr(trim(name), ' ') + 1)) END`);
  }
  if (hasTables && version < 25) {
    // Videos: on posts, on JHMMC feed posts, and of a fish on the scale.
    for (const [table, column] of [['catches', 'video'], ['catches', 'scale_video'], ['club_posts', 'video']]) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (cols.length && !cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }
  if (hasTables && version < 26) {
    const cols = db.prepare('PRAGMA table_info(club_posts)').all();
    if (cols.length && !cols.some((c) => c.name === 'lat')) db.exec('ALTER TABLE club_posts ADD COLUMN lat REAL; ALTER TABLE club_posts ADD COLUMN lng REAL;');
  }
  if (hasTables && version < 29 && db.prepare('PRAGMA table_info(outings)').all().some((c) => c.name === 'hours')) {
    // Hours fishing was dropped from the regional log.
    db.exec('ALTER TABLE outings DROP COLUMN hours');
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // Species renamed since earlier versions; catches keep pointing at the same row.
  db.prepare("UPDATE species SET name = 'Barracuda' WHERE name = 'Guinean barracuda'").run();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO species (name, scientific_name, category, points_per_kg) VALUES (?, ?, ?, ?)'
  );
  for (const s of SPECIES) insert.run(...s);
  db.prepare('INSERT OR IGNORE INTO clubs (name, country) VALUES (?, ?)').run(HOME_CLUB.name, HOME_CLUB.country);
  // Season dates, changed by the secretary on the Calendar page.
  const setting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  setting.run('season_start', '2026-09-01');
  setting.run('season_end', '2027-08-31');
  return db;
}

module.exports = { openDb, COUNTRIES, LINE_CLASSES, HOME_CLUB, WEIGH_STATIONS };
