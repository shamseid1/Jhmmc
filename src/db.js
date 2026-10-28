const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const COUNTRIES = [
  'Benin', 'Burkina Faso', 'Cabo Verde', "Côte d'Ivoire", 'The Gambia', 'Ghana',
  'Guinea', 'Guinea-Bissau', 'Liberia', 'Mali', 'Mauritania', 'Niger', 'Nigeria',
  'Senegal', 'Sierra Leone', 'Togo',
];

// Big game species commonly targeted off the West African coast.
const SPECIES = [
  ['Atlantic blue marlin', 'Makaira nigricans', 'Billfish'],
  ['Atlantic sailfish', 'Istiophorus albicans', 'Billfish'],
  ['White marlin', 'Kajikia albida', 'Billfish'],
  ['Swordfish', 'Xiphias gladius', 'Billfish'],
  ['Yellowfin tuna', 'Thunnus albacares', 'Tuna'],
  ['Bigeye tuna', 'Thunnus obesus', 'Tuna'],
  ['Skipjack tuna', 'Katsuwonus pelamis', 'Tuna'],
  ['Little tunny', 'Euthynnus alletteratus', 'Tuna'],
  ['Wahoo', 'Acanthocybium solandri', 'Pelagic'],
  ['Dorado (mahi-mahi)', 'Coryphaena hippurus', 'Pelagic'],
  ['West African Spanish mackerel', 'Scomberomorus tritor', 'Pelagic'],
  ['Guinean barracuda', 'Sphyraena afra', 'Pelagic'],
  ['Greater amberjack', 'Seriola dumerili', 'Reef & jacks'],
  ['Crevalle jack', 'Caranx hippos', 'Reef & jacks'],
  ['African pompano', 'Alectis ciliaris', 'Reef & jacks'],
  ['Cubera snapper', 'Lutjanus cyanopterus', 'Reef & jacks'],
  ['Giant African threadfin', 'Polydactylus quadrifilis', 'Inshore'],
  ['Atlantic tarpon', 'Megalops atlanticus', 'Inshore'],
  ['Leerfish (garrick)', 'Lichia amia', 'Inshore'],
  ['Dusky grouper', 'Epinephelus marginatus', 'Bottom'],
  ['Shortfin mako shark', 'Isurus oxyrinchus', 'Shark'],
  ['Hammerhead shark', 'Sphyrna spp.', 'Shark'],
  ['Other', null, 'Other'],
];

// IGFA line classes, in pounds, plus 100 lb, which local tournaments use.
const LINE_CLASSES = ['2 lb', '4 lb', '6 lb', '8 lb', '12 lb', '16 lb', '20 lb', '30 lb', '50 lb', '80 lb', '100 lb', '130 lb', 'Unlimited'];

// The founding club: always present, and listed first after IGFA on the Records page.
const HOME_CLUB = { name: 'JHMMC', country: 'Liberia' };

const SCHEMA_VERSION = 4;

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

CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  scientific_name TEXT,
  category TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
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
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO species (name, scientific_name, category) VALUES (?, ?, ?)'
  );
  for (const s of SPECIES) insert.run(...s);
  db.prepare('INSERT OR IGNORE INTO clubs (name, country) VALUES (?, ?)').run(HOME_CLUB.name, HOME_CLUB.country);
  return db;
}

module.exports = { openDb, COUNTRIES, LINE_CLASSES, HOME_CLUB };
