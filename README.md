# West Africa Big Game 🎣

A shared catch log and social feed for big game fishing clubs across West Africa, from Dakar to Lagos.

## Features

- **Accounts & clubs**: anglers sign up, register their club (country, harbour, description) and join it.
- **Log a catch**: species (22 West African big game species, grouped as billfish, tuna, pelagics, jacks, inshore, sharks), weight in kg (shown in lb too), length, date, country, spot, boat, IGFA line class, released/tagged flags, a photo and the story behind it.
- **Shared feed**: everyone's catches in one place, filtered by species, country, club or released-only.
- **Social**: likes, comments, and sharing through the phone's share sheet, a copied link or WhatsApp.
- **Leaderboards**: heaviest fish per species, top anglers (billfish count first) and top clubs, by season and country.
- **Club & angler pages**: members, stats and recent catches.
- Mobile-first layout with dark mode, so it works on the dock as well as on a laptop.

## Running it

Requires Node.js 22.13 or later (uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm test
```

Environment variables:

| Variable      | Default            | Purpose                                   |
|---------------|--------------------|-------------------------------------------|
| `PORT`        | `3000`             | HTTP port                                 |
| `DB_FILE`     | `data/fishing.db`  | SQLite database file                      |
| `UPLOAD_DIR`  | `uploads`          | Where catch photos are stored             |
| `NODE_ENV`    | —                  | `production` marks the session cookie as secure (needs HTTPS) |

## Project layout

```
server.js         entry point
src/app.js        Express app and JSON API (/api/...)
src/auth.js       password hashing (scrypt) and cookie sessions
src/db.js         SQLite schema, species and country lists
public/           single-page front end (vanilla JS, no build step)
test/             API tests (node:test)
```

## API overview

| Method | Path                          | Notes                                  |
|--------|-------------------------------|----------------------------------------|
| GET    | `/api/meta`                   | Countries and species                  |
| POST   | `/api/auth/register`, `/login`, `/logout` | JSON body                  |
| GET/PATCH | `/api/me`                  | Current angler; change club, bio, etc. |
| GET/POST | `/api/clubs`                | List or register clubs                 |
| GET    | `/api/clubs/:id`              | Club, members, stats                   |
| GET    | `/api/catches`                | Feed; filters `species`, `country`, `club`, `user`, `released=true`, paging with `before` |
| POST   | `/api/catches`                | `multipart/form-data`, optional `photo` (JPEG/PNG/WebP, max 8 MB) |
| GET/DELETE | `/api/catches/:id`        | Details with comments; owners can delete |
| POST   | `/api/catches/:id/like`       | Toggle like                            |
| POST   | `/api/catches/:id/comments`   | Add a comment                          |
| GET    | `/api/leaderboard`            | `year`, `country` filters              |
| GET    | `/api/users/:id`              | Angler profile and stats               |

## Ideas for next steps

- French (and Portuguese) translations for Senegal, Côte d'Ivoire, Guinea-Bissau and Cabo Verde.
- Club admins who verify catches before they count towards records, and tournament/season scoring.
- Photo resizing, and cloud storage (S3 or similar) once it's hosted.
- GPS/map of catch spots, tide and moon data, tag-and-release reporting to research programmes.
- Package as an installable PWA or wrap it for the app stores.
