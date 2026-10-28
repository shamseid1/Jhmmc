# West Africa Big Game

A shared catch log and social feed for big game fishing clubs across West Africa, from Dakar to Lagos.

## Features

- **Open to look at**: anyone with the link can browse the feed, leaderboards, boats, anglers, clubs and catches without an account.
- **Personal accounts**: every angler signs in with their own email and password to like, comment, join a boat or log catches.
- **Boats are teams**: a captain registers the boat (name, home port, country, club) and gets a 6-character crew invite code to share, for example on WhatsApp. Crew join with the code, and a boat can have any number of crew.
- **Captain controls**: change boat details, make a new invite code (the old one stops working), hand over the captaincy, remove crew, and move a guest angler's typed-name catches to their account once they join the crew.
- **Individual anglers** without a boat can like and comment, but cannot log catches.
- **Participants tab**: every angler and every boat as a photo card with a search box, showing the boat (or boat length and make) and released/weighed counts. Captains add the boat's photo, length and make; anglers can add their own photo.
- **Log a catch** (crew only): any crew member can log a fish for anyone on the same boat, or for any other angler by typing their name (guests don't need an account; their catches count in the feed, leaderboards, records and Participants). Species (22 West African big game species), weight in kg (shown in lb too), length, date, country, spot, IGFA line class in pounds (2 to 130 lb, or unlimited), released/tagged, a photo and the story. The catch is credited to the angler, the boat and the boat's club.
- **Quick posts**: the Post tab needs only a photo and the species (plus an optional caption); weight, length, line class, place, date and released/tagged sit under "Add weight and details". Photos are shrunk to 1600px JPEGs on the phone before upload so posting works over Starlink or a weak signal.
- **Where it was caught**: a place name plus an optional GPS spot, either from the phone ("Use my location", works at sea without signal) or typed from the boat's GPS or chartplotter (decimal, degrees-minutes or degrees-minutes-seconds, with N/S/E/W or signs). The exact spot is shown only to the boat's crew and officials unless the poster ticks "Show the exact spot to everyone"; the catch page shows it on an OpenStreetMap map with an "Open in maps" link.
- **Shared feed** filtered by species, boat, club, country or released-only, with likes, comments and sharing through the phone's share sheet, a copied link or WhatsApp.
- **Two separate books.** *Posts* are what members log themselves: they make the feed, the West Africa leaderboard, records, Participants and every club's records except JHMMC's, and never score points. *JHMMC registrations* are made only by weighmasters at the dock (the digital Fish Registration Form) and approved by the secretary: they make the JHMMC Points tables and JHMMC's club records, and don't appear on the feed. A JHMMC boat's page lists its registrations separately from its posts.
- **JHMMC points (official scoring)**: only boats registered under JHMMC, as Ocean or River with separate standings. A weighmaster registers each fish with the official weight, weigh station (Extreme, Beerville, Barracuda Club, Lofa River), line class and a photo on the scale (released fish: proof, no weight); the **secretary** approves the points the rules suggest, changes them with a note, or rejects. Only Sundays, public holidays and tournament days score; the secretary keeps the season calendar and the points-per-kg table (seeded from the 2025-26 form). Rules: weight × species points; released marlin 500; marlin under 100 kg kept is deducted; released sailfish scores as 25 kg; under 2 kg (ocean) / 1 kg (river) doesn't count. The **Points** tab shows the season table for boats and anglers and each tournament's results. The admin makes members weighmasters or secretaries on the Members page. Scoring rules live in `src/scoring.js`.
- **Leaderboards**: heaviest fish per species, top boats, top anglers (billfish count first) and top clubs, by season and country.
- **Records**: the IGFA all-tackle world record for each species (weight, angler, place, year, African records flagged) beside the heaviest fish logged in the app and how close it came, plus the app's own records by species and IGFA line class. The world records live in `src/igfa-records.js`; check them against https://igfa.org/world-records/ and update that file when a record falls.
- **Club records**: the Records page has a "Records for" picker listing IGFA, then JHMMC, then every other club. A club's book shows its heaviest fish of each species (angler, boat, line class, share of the world record) and its records by line class; it opens on the angler's own club. Each club page also lists its records. JHMMC (Liberia) is created automatically as the founding club (`HOME_CLUB` in `src/db.js`).
- **More menu** (last tab): your dashboard, your boat, profile, the rules, records, clubs and sign in/out.
- **Rules** (under More): the JHMMC 2026-2027 season rules (and the official PDF to download) and a plain-language summary of the IGFA International Angling Rules linking to the official text. The rule texts live in `public/rules.js`; replace them and `public/rules/` each season.
- **Boat, club and angler pages** with crew, stats and recent catches.
- Mobile-first layout with a bottom tab bar on phones (Feed, Leaderboard, Log catch for crews, Participants, More), and dark mode.

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
| `ADMIN_EMAIL` | `shamseid4@gmail.com` | Club admin's email. Members who forget their password are told to write to it, and the account with this email gets the admin Members page |
| `APP_URL`     | the request's address | Public address used in emailed links, e.g. `https://west-africa-big-game.onrender.com` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | — | Email server for password resets. Without `SMTP_HOST`, emails are printed to the server log |
| `MAIL_FROM`   | `SMTP_USER`        | Sender shown on emails, e.g. `JHMMC <noreply@jhmmc.com>` |

Upgrading: newer versions upgrade the database automatically on start. The only exception is a database from the very first version (before boats), which the app refuses to open rather than lose data; move it aside and restart.

## Putting it online (Render)

The repo includes `render.yaml`, which sets up one web service with a 1 GB persistent disk at `/var/data` for the database and photos.

1. Create an account at https://render.com and sign in with GitHub.
2. Choose **New → Blueprint**, pick the `Jhmmc` repository and the branch to deploy, and confirm.
3. Render builds the app and gives it an address like `https://west-africa-big-game.onrender.com`.
4. Optional: add your own domain under the service's **Settings → Custom Domains**.

Each push to the deployed branch redeploys automatically. A persistent disk needs a paid instance (Starter); Render shows the price before you confirm. Back up `/var/data` (the service's **Disks** tab offers snapshots).

## Email (password resets)

Without email set up, "Forgot your password?" tells members to email the admin (`ADMIN_EMAIL`). The admin opens **More → Members**, finds the member and taps **Create reset link**: a one-time link valid for 24 hours, sent to the member by WhatsApp or email, with which they choose their own new password. Once SMTP is set up, members get reset links by email themselves.


Members can reset a forgotten password from the sign-in page (a one-time link, valid for an hour) and change it under Edit profile; either way they get an email saying the password changed, and other devices are signed out. Any SMTP provider works:

- **Gmail** (quickest): turn on 2-Step Verification for the Google account, create an app password at https://myaccount.google.com/apppasswords, then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=` the Gmail address, `SMTP_PASS=` the 16-letter app password. Gmail allows about 500 emails a day.
- **Your own domain** (e.g. `noreply@jhmmc.com`): use the SMTP details from your email host or a sending service such as Resend, Mailgun or Brevo.

On Render, enter these under the service's **Environment** tab, together with `APP_URL`, then redeploy.

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

Reading (GET) is open to everyone. Every other request needs a signed-in angler.

| Method | Path                          | Notes                                  |
|--------|-------------------------------|----------------------------------------|
| GET    | `/api/meta`                   | Countries and species                  |
| POST   | `/api/auth/register`, `/login`, `/logout` | JSON body                  |
| GET/PATCH | `/api/me`                  | Current angler, their boat and whether they are captain |
| POST   | `/api/auth/forgot`, `/api/auth/reset` | `{email}` emails a reset link; `{token, password}` sets the new password |
| POST   | `/api/me/password`            | `{current, password}` changes your password |
| GET    | `/api/admin/users`            | Admin: every member |
| POST   | `/api/admin/users/:id/reset-link` | Admin: one-time reset link (24 hours) to pass on |
| GET/POST | `/api/teams`                | List boats, or register one (you become captain) |
| GET/PATCH | `/api/teams/:id`           | Boat, crew and stats (invite code shown to crew only); captain edits details |
| POST   | `/api/teams/join`             | `{code}` joins a boat's crew           |
| POST   | `/api/teams/leave`            | Captains hand over first if they have crew |
| POST   | `/api/teams/:id/code`         | Captain: new invite code               |
| POST   | `/api/teams/:id/photo`        | Captain: boat photo (`multipart/form-data`) |
| GET    | `/api/anglers`                | All anglers with boat, photo and released/weighed counts |
| POST   | `/api/me/photo`               | Your own photo (`multipart/form-data`) |
| POST   | `/api/teams/:id/captain`      | Captain: `{userId}` hands over         |
| DELETE | `/api/teams/:id/members/:userId` | Captain: remove crew                |
| POST   | `/api/teams/:id/guests/link`  | Captain: `{name, userId}` moves this boat's catches under a typed name to a crew member |
| GET/POST | `/api/clubs`                | List or register clubs                 |
| GET    | `/api/clubs/:id`              | Club, its boats, stats                 |
| GET    | `/api/catches`                | Feed posts (`official=1` for JHMMC registrations instead); filters `species`, `team`, `club`, `country`, `user`, `angler` (typed name), `released=true`, paging with `before` |
| POST   | `/api/catches`                | Crew only. `multipart/form-data`, optional `anglerId` (crew mate, or `other` with `anglerName`) and `photo` (JPEG/PNG/WebP, max 8 MB) |
| GET/DELETE | `/api/catches/:id`        | Details with comments; the angler, whoever logged it, or the captain can delete |
| POST   | `/api/catches/:id/like`       | Toggle like                            |
| POST   | `/api/catches/:id/comments`   | Add a comment                          |
| GET    | `/api/leaderboard`            | `year`, `country` filters              |
| GET    | `/api/points`                 | `division=ocean|river`: season standings for boats and anglers, tournaments with winners |
| GET    | `/api/tournaments/:id`        | One tournament's results by boat |
| GET    | `/api/events`                 | Season dates, holidays and tournaments |
| POST/DELETE | `/api/events`, `/api/events/:id` | Secretary: add or remove a holiday or tournament |
| PATCH  | `/api/settings/season`        | Secretary: `{start, end}` season dates |
| PATCH  | `/api/species/:id`            | Secretary: `{pointsPerKg}` |
| GET    | `/api/officials/queue`        | Registrations waiting for the secretary, with the rules' suggested points (weighmasters see their own) |
| POST   | `/api/weigh`                  | Weighmaster: register a fish for a JHMMC boat (weight, station, line, scale photo) |
| POST   | `/api/catches/:id/review`     | Secretary: `{decision: approve|reject, points?, note?}` |
| PATCH  | `/api/admin/users/:id`        | Admin: `{role: weighmaster|secretary|null}` |
| GET    | `/api/records`                | IGFA all-tackle records, best catch per species, line-class records; `club` limits to one club |
| GET    | `/api/users/:id`              | Angler profile and stats               |

## Ideas for next steps

- French (and Portuguese) translations for Senegal, Côte d'Ivoire, Guinea-Bissau and Cabo Verde.
- Captains or club officials who verify catches before they count towards records, and tournament scoring.
- Photo resizing, and cloud storage (S3 or similar) once it's hosted.
- GPS/map of catch spots, tide and moon data, tag-and-release reporting to research programmes.
- Package as an installable PWA or wrap it for the app stores.

## Credits

- Icons: [Lucide](https://lucide.dev) (ISC licence), copied into `public/app.js`.
- Marlin logo: traced from artwork supplied by the club (`public/marlin.svg`, `public/logo.svg`).
