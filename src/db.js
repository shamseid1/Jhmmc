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
  ['Other', null, 'Other', 3],
];

// JHMMC weigh stations; Lofa River weighs for river boats.
const WEIGH_STATIONS = ['Extreme', 'Beerville', 'Barracuda Club', 'Lofa River'];

// IGFA line classes, in pounds, plus 100 lb, which local tournaments use.
const LINE_CLASSES = ['2 lb', '4 lb', '6 lb', '8 lb', '12 lb', '16 lb', '20 lb', '30 lb', '50 lb', '80 lb', '100 lb', '130 lb', 'Unlimited'];

// The founding club: always present, and listed first after IGFA on the Records page.
const HOME_CLUB = { name: 'JHMMC', country: 'Liberia' };

const SCHEMA_VERSION = 7;

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Official scoring: weighed at the dock by a weighmaster, then approved by the secretary.
  status TEXT NOT NULL DEFAULT 'pending_review',
  weigh_station TEXT,
  weighed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  weighed_at TEXT,
  scale_photo TEXT,
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
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  country TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  bio TEXT,
  photo TEXT,
  role TEXT,
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

-- Scoring days besides Sundays: public holidays and tournaments.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holiday', 'tournament')),
  name TEXT NOT NULL
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
