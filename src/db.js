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
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  bio TEXT,
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
  club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
  species_id INTEGER NOT NULL REFERENCES species(id),
  weight_kg REAL,
  length_cm REAL,
  released INTEGER NOT NULL DEFAULT 0,
  tagged INTEGER NOT NULL DEFAULT 0,
  caught_on TEXT NOT NULL,
  country TEXT,
  location TEXT,
  boat TEXT,
  line_class TEXT,
  notes TEXT,
  photo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS catches_created ON catches(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS catches_species ON catches(species_id, weight_kg DESC);
CREATE INDEX IF NOT EXISTS catches_club ON catches(club_id);

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
  db.exec(SCHEMA);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO species (name, scientific_name, category) VALUES (?, ?, ?)'
  );
  for (const s of SPECIES) insert.run(...s);
  return db;
}

module.exports = { openDb, COUNTRIES };
