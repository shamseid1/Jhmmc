# West Africa Big Game

A shared catch log and social feed for big game fishing across West Africa. Clubs live inside the platform; the first, **JHMMC** (Jim Holder Memorial Marine Club, Monrovia), runs its points, tournaments, records and members-only feed here.


**Names.** Everyone signs up with a first name and a last name (both required; together they are the full name) and may add a nickname. Others see the nickname (on the feed, Participants, leaderboards, records and comments), or the full name if there is none; a person's profile shows both. The full name is for the club's records: the Members and Club members pages (which show both), tournament sheets, registration history and the secretary's notifications. Accounts from before had their name split at the first space; anyone without a last name is asked for one the next time they save their profile.

**Two sides.** JHMMC members switch between two sides with the switch on their profile card at the top of **More**, or by double-tapping **More** (the app remembers the last one on that phone; a small JHMMC tag sits in the header on the JHMMC side). **West Africa**: the public feed for showing off a catch, Leaderboard (a club leaderboard: choose the club and see its points tables, laid out like JHMMC's: Overall or Tournaments, Ocean or River, boats, tournaments and anglers; only clubs that score in the app have one, so far JHMMC; posted fish never count; tap a boat's or angler's fish or points to see the fish behind the number), Post, Participants, More (records and clubs under Records & clubs). **JHMMC**: the club's own tabs, Points, Tournaments (results for everyone; entry for captains; the registration sheet for officials), Register fish (captains and officials), Records (the JHMMC record book) and More; it has no feed (members share day-to-day photos in the club's WhatsApp group). Everyone else only has the West Africa side. The earlier members-only JHMMC feed has been removed; its posts stay in the database (`club_posts`), and any spots on them still show on My catch map.

**Install it (PWA).** The app installs to the home screen like a normal app (full screen, its own icon, name "Big Game"). On Android (Chrome, Samsung Internet, Edge) the **Install** button on **More** installs it in one tap where the browser allows it, and otherwise opens step-by-step instructions for that browser; on an iPhone it shows how to use Safari's Share → Add to Home Screen. The service worker (`public/sw.js`) keeps a copy of the app's own files so it opens without signal; data always comes from the server.

**Dark or light.** The app starts in the phone's own setting (light if it has none). The brush button at the top right of the **More** page opens the choice of **Auto** (follow the phone), **Light** (easier to read in bright sun) or **Dark**; the choice is remembered on that phone.

**Regional log.** One line per outing, the same format for every boat: date, boat (boats have to be on the app), country, each species with how many were released, kept or lost (or **No catch**: blank days count too), technique, rough area, water depth (m) and water temperature (°C). Rough areas only in the log. **Fish on** (the middle of the bottom bar on the West Africa side, also in the Regional log and More; crew only): at sea, pick the species and tap Released, Kept or Lost as each fish is landed; the phone's GPS spot and time are taken there and then, the fish joins the boat's line for the day (started by the first one), and the crew finishes the trip (technique, area, depth, temperature) at the end of the day. Without signal the fish wait on the phone and send themselves when it's back; each fish's spot is for the crew and their catch maps only. **Log a whole trip** adds a past trip or a blank day in one go (one line per boat per day); **More → Regional log** shows everyone's outings by country, each copyable as one line (`date | boat | country | catch | technique | area, depth | temp`), and a **Season** tab: outings, blank days, billfish per day fished, a species per day fished by month, the conditions on billfish days, and the whole log as a spreadsheet (`/api/outings.csv`). Anyone can read the log.

## Features

- **Open to look at**: anyone with the link can browse the feed, leaderboards, boats, anglers, clubs and catches without an account.
- **Personal accounts**: every angler signs in with their own email and password to like, comment, join a boat or log catches.
- **Boats are teams**: a captain registers the boat (name, home port, country, club) and gets a 6-character crew invite code to share, for example on WhatsApp. Crew join with the code, and a boat can have any number of crew.
- **Captain controls**: change boat details, make a new invite code (the old one stops working), hand over the captaincy, remove crew, and move a guest angler's typed-name catches to their account once they join the crew.
- **Individual anglers** without a boat can follow the feed, like and comment, but can't post catches.
- **Participants tab**: every angler and every boat as a photo card with a search box, showing the boat (or boat length and make) and released/weighed counts. Captains add the boat's photo, length and make; anglers can add their own photo.
- **Post** (crew only, the New post button on the feed), like Instagram: a photo or video and a caption; the species, angler (anyone on the boat, or a guest by name), weight and IGFA line class can be added but aren't required. Likes and comments on the feed. Fish with their spots go in the regional log (Fish on), not on posts.
- **Quick posts** (the West Africa feed, for showing off a catch): the Post tab needs only a photo or video and the species; the angler, weight, length, line class, released/tagged, caption, place (or the phone's location), date (today if left empty) and country are all on the form, optional.
- **Videos**: posts on either feed can carry a video (recorded now or chosen from the phone) as well as or instead of a photo, and a registration can add a video of the fish on the scale, recorded there and then like the scale photo (which stays required). Videos go up as recorded, up to 100 MB (about a minute). Everyone, JHMMC crews included, can post a weight; posts never score JHMMC points, which come only from the captain's registration at the weigh station. Photos are shrunk to 1600px JPEGs on the phone before upload so posting works over Starlink or a weak signal.
- **Where it was caught**: taken by Fish on in the regional log. Older posts that have a spot still show it to the boat's crew (or everyone, if the poster chose) on a map.
- **Shared feed** filtered by species, boat, club, country or released-only, with likes, comments and sharing through the phone's share sheet, a copied link or WhatsApp.
- **Two separate books.** *Posts* are what members log themselves: they make the feed, the West Africa leaderboard, records, Participants and every club's records except JHMMC's, and never score points. *JHMMC registrations* are made by the boat's captain at the weigh station (the digital Fish Registration Form) and approved by the secretary: they make the JHMMC Points tables and JHMMC's club records, and don't appear on the feed. A JHMMC boat's page lists its registrations separately from its posts.
- **JHMMC points (official scoring)**: only boats registered under JHMMC, as Ocean or River with separate standings. Each JHMMC boat has a weigh station (Extreme, Beerville, Barracuda Club, Lofa River), which is also its home port, set by the captain or by the admin on the Boats page. The **captain** registers their own boat's whole day in one sheet at that station (today's fish only; scale photos taken with the camera there and then; the secretary may register any boat and enter an earlier day's paper form): then any number of fish, each with species, angler, official weight, line class and a photo on the scale (released fish: no weight, but a video of the release is required, recorded or chosen from the camera roll as long as it's from the last day), submitted together and saved all-or-nothing. Points are worked out the moment the weight is entered (shown under each weight as "Points (automatic)", with the total weight and total points at the bottom of the sheet, and saved with the registration as "awaiting approval"), using the same `src/scoring.js` the server runs (served to the browser as `/scoring.js`); the **secretary** approves the points the rules suggest, changes them with a note, or rejects. Every fishing day scores; the secretary keeps the season dates and tournaments on the calendar and the points-per-kg table (seeded from the 2025-26 form). Rules: weight × species points; released marlin 500; marlin under 100 kg kept is −500 (any weight); released sailfish scores as 25 kg; under 2 kg (ocean) / 1 kg (river) doesn't count. The **Points** tab has two tables for the two end-of-season trophies, each split Ocean and River: **Overall** (every day's points) and **Tournaments** (only fish caught during the season's tournaments, added up), plus each tournament's own results. Only boats the secretary has **entered** in a tournament compete in it (its results, winner and the Tournaments table); a boat fishing on a tournament day without entering scores for the season only. **Club roles** (set by the admin on the Club members page, JHMMC members only; their powers stop at the club, apart from the platform **admin**, who runs all of West Africa Big Game: every club, boat, member and post): the **Secretary** is the only one (with the admin) who reviews and approves fish and keeps the registration history; the **President** and **Vice President** run the other club tools (tournaments and their registration sheets, club members, calendar, scoring, registering fish for any boat); the **Treasurer** marks paid memberships and tournament fees but can't enter boats, change anglers or decide who is a member. None of them can delete West Africa posts or see a post's private spot; on More their tools sit under **JHMMC officials** (or **JHMMC treasurer**), apart from **Platform admin**. Scoring rules live in `src/scoring.js`.
- **Safeguards on registrations**: captains tick a declaration on every sheet and must let the app take the phone's location when they send it (refused without one; this applies to everyone, the secretary, officers and admin included) (a false registration disqualifies the boat: see "Registering fish in the app" in the JHMMC rules). Every JHMMC captain can see all pending registrations under **More → Pending registrations** and dispute another boat's fish within 24 hours with a reason; the secretary sees disputes on the review screen (with a phone notification) and must add a note to approve a disputed fish. Registrations can't be edited, only withdrawn before review. Every registration, withdrawal, deletion, dispute, approval and rejection is kept in **Registration history** (secretary and admin), with who, when, the fish as it stood, its scale photo and, if allowed, where the captain's phone was.
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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | made on first start | Keys for phone notifications (Web Push). Without them the app makes a pair and keeps it in the database |
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
| DELETE | `/api/admin/users/:id`        | Admin: delete an account (catches stay under the name; comments and likes go) |
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
| GET    | `/api/points`                 | `division=ocean|river`, `scope=overall|tournaments`: standings for boats and anglers (every day, or tournament fish only), tournaments with winners |
| GET    | `/api/tournaments/:id`        | One tournament's results by boat |
| GET    | `/api/club-members`           | Secretary: everyone, and whether they've paid this season's JHMMC membership |
| PUT    | `/api/club-members/:userId`   | Secretary: `{paid}` marks a paid member for the current season (crew in tournaments follow this) |
| POST/PUT/DELETE | `/api/club-members/named[/:id]` | Secretary: members without an account (children, say): `{name, teamId, paid}`; captains pick them for tournaments as `{personId}` |
| GET    | `/api/tournaments`            | Captains and officials: the season's tournaments with boats, anglers, non-members and unpaid temporary memberships |
| GET    | `/api/tournaments/:id/my-entry` | A JHMMC captain's entry: their boat, crew and anglers |
| GET    | `/api/tournaments/:id/sheet`  | Secretary: the registration sheet, every JHMMC boat with its anglers |
| PUT    | `/api/tournaments/:id/entries/:teamId` | The boat's captain (until the tournament is over) or the secretary: `{entered, anglers: [{userId} or {name}]}`; only the secretary decides who is a member (crew from the paid list; guests only if the secretary marks them, with `member` on their own edits); only entered boats compete |
| PATCH  | `/api/tournaments/:id/anglers/:anglerId` | Secretary: `{paid, member}` for an angler's temporary membership |
| GET    | `/api/events`                 | Season dates and tournaments (first and last day) |
| POST/DELETE | `/api/events`, `/api/events/:id` | Secretary: add a tournament (`date`, optional `endDate`, up to 14 days) or remove one |
| PATCH  | `/api/settings/season`        | Secretary: `{start, end}` season dates |
| PATCH  | `/api/species/:id`            | Secretary: `{pointsPerKg}` |
| GET    | `/api/officials/queue`        | Registrations waiting for the secretary, with the rules' suggested points (captains see their own) |
| GET    | `/api/officials/pending`      | Secretary: how many registrations are waiting (the menu badge) |
| GET    | `/api/registrations/pending`  | JHMMC captains and officials: every boat's registrations waiting, with dispute status (`canDispute`, `disputeUntil`) |
| POST   | `/api/catches/:id/disputes`   | A JHMMC captain disputes another boat's pending registration within 24 hours: `{reason}` |
| GET    | `/api/registrations/log`      | Secretary/admin: the registration record, newest first (`catch`, `team`, `before` to page) |
| GET    | `/api/push/key`               | Public key for subscribing to phone notifications |
| POST/DELETE | `/api/push/subscribe`    | Turn phone notifications on or off for this browser (`PushSubscription` JSON / `{endpoint}`) |
| POST   | `/api/weigh`                  | Captain (own boat) or secretary: register a fish for a JHMMC boat (weight, line, scale photo; station from the boat) |
| POST   | `/api/weigh/sheet`            | Captain (own boat) or secretary: a boat's fish in one go: `teamId`, `caughtOn`, `fish` (JSON list), scale photos as `scale_<n>`; all or nothing |
| POST   | `/api/catches/:id/review`     | Secretary: `{decision: approve|reject, points?, note?}` |
| PATCH  | `/api/admin/users/:id`        | Admin: `{jhmmc, role: president|vice_president|secretary|treasurer|null}`: who belongs to JHMMC (Members page) and their role (set on the Club members page); roles are for JHMMC members only |
| PATCH  | `/api/admin/teams/:id`        | Admin: `{weighStation, division}` for a JHMMC boat (its weigh station is also its home port) |
| DELETE | `/api/catches/:id/comments/:commentId` | Remove a comment (its author, or the admin) |
| GET    | `/api/records`                | IGFA all-tackle records, best catch per species, line-class records; `club` limits to one club. For JHMMC, `book` is the club record book (`src/jhmmc-records.js`, from the club's PDF as at 3 May 2026) with approved registrations ranked in |
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
