# West Africa Sportfishing

A shared catch log and social feed for big game fishing across West Africa. Clubs live inside the platform; the first, **JHMMC** (Jim Holder Memorial Marine Club, Monrovia), runs its points, tournaments, records and members-only feed here.


**Names.** Everyone signs up with a first name and a last name (both required; together they are the full name) and may add a nickname. Others see the nickname (on the feed, Participants, leaderboards, records and comments), or the full name if there is none; a person's profile shows both. The full name is for the club's records: the Members and Club members pages (which show both), tournament sheets, registration history and the secretary's notifications. Accounts from before had their name split at the first space; anyone without a last name is asked for one the next time they save their profile.

**JHMMC is West Africa Sportfishing (for now).** Every boat in the app, in a club or not, registers its fish for points through JHMMC and the JHMMC secretary approves them, with the same points system for everyone. JHMMC boats weigh at a JHMMC weigh station; boats elsewhere at their home port (no choice to make). The Leaderboard shows **All of West Africa** (every boat, same season dates as JHMMC), the **JHMMC Season** (JHMMC boats only; only they compete in it) and the **JHMMC Tournaments**; the West Africa record book is the heaviest approved fish from any boat. Tournaments stay JHMMC's (JHMMC boats only) unless West African tournaments are added later. When a country's club is ready to run its own weigh-ins, the admin switches it over (`PATCH /api/admin/clubs/:id {selfRun: true}`) and its boats then register with their own secretary instead.

**Finish the trip.** From 3 pm, a boat's captain whose trip today has fish but is missing the technique, area, depth or water temperature sees "Finish today's trip" at the top of the feed; it opens Log fish at the trip details and goes once they're filled in.

**Photos.** Each fish in Log fish has a 📷 button: take or pick a photo whenever there's a moment, and it shows on that fish's "boated" line in the feed ("Liberian Girl boated a blue marlin"). A weighed fish's picture is its **weigh station photo** (required at the weigh-in), on the weigh-in post, the fish's page and the angler's and boat's profiles. The crew can add **their own photo** afterwards (the angler with the fish, the crew on the dock): from the 📷 buttons under their own weigh-in post, or **Add your photo / Change your photo** on the fish's page. That fish then has two photos, swiped between: the crew's first, then the weigh station's. In the main feed a weigh-in post holds one boat's whole day (each fish's weight and points, and the totals).

**Boat and angler pages: catches to show off.** A boat's or angler's page shows their approved fish as a photo grid, three across: each tile has the fish's photo (the crew's own if they added one, else the weigh station's; the marlin if neither), the species, weight and points, and a Released tag for releases; tap one for the fish's page. Above it: fish weighed, releases, season points with the place (on the JHMMC Season table for a JHMMC boat and its anglers, else All of West Africa), and the biggest fish; species chips and Newest / Biggest to sort. On a boat's page, fish logged at sea with a photo show too (anglers' pages keep weighed fish only), marked as the log has them (Boated or Released, with the estimate if given), with no points and never the spot; a fish later weighed shows once, as weighed. The crew can hide one with "Show on our boat's page" in Log fish. On their own fish the crew sees a 📷 to add their photo (`GET /api/trophies?team=`, `?user=` or `?angler=`). A guest angler (a name typed in at the weigh-in, no account) has the same page: tapping their name anywhere (a fish's page, the leaderboard, records, the boat's guest list) opens it. Fish logged at sea stay in the main feed and the boat's log. The log photo is never mixed in. A video of a fish on the scale is evidence: only the secretary, JHMMC captains (to dispute), the boat's crew and whoever registered it see it. A released fish's release video shows to everyone once the secretary has approved the fish. Photos are shrunk on the phone before uploading, which also strips the GPS spot from them.

**Weigh-in** (what used to be called Register fish) is the official step at the weigh station, for points; Log fish is at sea, for the log. When a captain's boat has boated fish today that aren't weighed in yet, the feed opens with "2 fish boated today · Go to the weigh-in"; it updates as fish are weighed in and goes once they all are.

**Clubs.** Only JHMMC (the admin) opens clubs. Anyone else fills in the same form on the Clubs page, which sends a request: the admin gets a notification, approves or declines it on the Clubs page (More → Platform admin → Clubs shows how many are waiting), and the person hears back. A requested club stays hidden, and boats can't join it, until it's approved.

**One app, one bottom bar.** Feed (the public feed, + Post at the top), Leaderboard (choose a club; JHMMC members open on JHMMC: Points, Tournaments and Records tabs; Overall or Tournaments and Ocean or River as dropdown chips; tap a boat's or angler's fish or points to see the fish behind the number), Log fish (crews), Participants and More. JHMMC captains and officials register fish from More. JHMMC members carry the club's logo in the header on every page. The club's officer tools (review, members, payments) are in More.

**Install it (PWA).** The app installs to the home screen like a normal app (full screen, its own icon, name "WA Sportfishing"). On Android (Chrome, Samsung Internet, Edge) the **Install** button on **More** installs it in one tap where the browser allows it, and otherwise opens step-by-step instructions for that browser; on an iPhone it shows how to use Safari's Share → Add to Home Screen. The service worker (`public/sw.js`) keeps a copy of the app's own files so it opens without signal; data always comes from the server.

**Dark or light.** The app starts in the phone's own setting (light if it has none). The brush button at the top right of the **More** page opens the choice of **Auto** (follow the phone), **Light** (easier to read in bright sun) or **Dark**; the choice is remembered on that phone.

**Units.** Each person picks kg or lb, metres or feet, and °C or °F when creating their account (or later in their profile). Weights, depths and water temperatures show and are typed in those units; everything is stored metric, and the log's one-line format and spreadsheet stay metric. JHMMC registrations at the weigh station are always entered in kg.

**Log: My boat and Regional.** Anyone on a boat opens the log on **My boat**: only their boat's trips, its own Season tab and its own spreadsheet. **Regional** is every boat's trips, by country, as below.

**Season report** (the Season tab, for My boat or Regional): key numbers (fish caught, billfish, share of billfish released, species, best month, heaviest from the scales), a species table, fish by month and by hour of the day, the rough areas and techniques that produced, and the best conditions. Counts only, never rates per trip, because lost fish and blank days often go unlogged.

**Trends** (the Trends tab, My boat or Regional): a species month by month, year against year, with when it first arrived ("Sailfish arrived 3 weeks earlier than in 2025") and a per-boat view so more boats on the app isn't mistaken for more fish; what's biting now (the last 14 days against the 14 before, up or down, and where); and water temperature and billfish week by week on two charts over the same 26 weeks.

**Catch map → Regional** (signed-in members only; the Catch map's other tab, My boat, has the crew's exact spots): the sea in areas of about 10 km, each drawn as a circle shaded by how many fish were caught in it that month (by species if chosen); tap a circle for the count of fish and boats. No exact spots and no boat names; an area shows even if only one boat fished it. Boat crews also get the depth contours under the circles (layers button).

**Regional log.** One line per outing, the same format for every boat: date, boat (boats have to be on the app), country, each species with how many were released, kept or lost (or **No catch**: blank days count too), technique, rough area, water depth (m) and water temperature (°C). Rough areas only in the log. **Log fish** (the middle of the bottom bar on the West Africa side, also in the Regional log and More; crew only): at sea, tap the fish (big buttons: blue marlin, yellowfin tuna, sailfish and dorado for Ocean boats; barracuda, grouper, crevalle and snapper for River boats; the rest in a list) and then Kept, Released or Lost, two taps, as each fish is landed or lost; each fish is listed on its own, and a released fish can be given an estimated weight afterwards (Estimate weight; it never counts for points or records, and goes in the caption if shared); on Android, long-press the app icon for a Log fish shortcut; the phone's GPS spot and time are taken there and then (at sea a fish can't be logged until the GPS has its spot), the fish joins the boat's line for the day (started by the first one), and the crew finishes the trip (technique, area, depth, temperature) at the end of the day. Without signal the fish wait on the phone and send themselves when it's back; each fish's spot is for the crew and their catch maps only. Back on land, the same page takes a day (a date chip) to add an earlier trip's fish (no spot), or to log a blank day as **No catch** (one line per boat per day). **Share to feed** on any logged fish opens a post with it filled in. A fish registered at the weigh station is linked to the same fish in the boat's log (same boat, day and species), so it's counted once. When it was the boat's only fish of that species that day, the log and the catch map show its scale weight on that fish; with several (ten tunas), nobody knows which weight was which, so each one shows just "weighed" and the day's weights go together under the species ("3 yellowfin tuna weighed: 100, 64, 30 kg · 194 kg in all"). Points come from the weigh-in either way. Fish registered but never logged are added to the log from the weigh station (no spot), and leave it if withdrawn; **More → Regional log** shows everyone's outings by country, each copyable as one line (`date | boat | country | catch | technique | area, depth | temp`), and a **Season** tab: outings, blank days, billfish per day fished, a species per day fished by month, the conditions on billfish days, and the whole log as a spreadsheet, one line per trip (`/api/outings.csv`) or one row per fish (`/api/outings/fish.csv`, with each fish's GPS spot only for the boat's own crew). Outings can be filtered by month, species and (Regional) boat, 30 at a time with **Load more**. Hours of the day are in each country's local time. A wrong tap in Log fish can be fixed with **Edit** (species or Kept/Released/Lost; the time and spot stay); fish that came from the weigh station are changed by the secretary. Anyone can read the log.

## Features

- **Open to look at**: anyone with the link can browse the feed, leaderboards, boats, anglers, clubs and catches without an account.
- **Personal accounts**: every angler signs in with their own email and password to like, comment, join a boat or log catches.
- **Boats are teams**: a captain registers the boat (name, home port, country, club) and gets a 6-character crew invite code to share, for example on WhatsApp. Crew join with the code, and a boat can have any number of crew.
- **Captain controls**: change boat details, make a new invite code (the old one stops working), hand over the captaincy, remove crew, and move a guest angler's typed-name catches to their account once they join the crew.
- **Individual anglers** without a boat can follow the feed, like and comment, but can't post catches.
- **Participants tab**: every angler and every boat as a photo card with a search box, showing the boat (or boat length and make) and released/weighed counts. Captains add the boat's photo, length and make; anglers can add their own photo.
- **Participants and dashboards** count only fish weighed in and approved (released and weighed); posts never count.
- **The feed fills itself** (nobody posts by hand): each boat's weigh-in for the day as one post, like the sheet: its approved fish, heaviest first, with each fish's weight and points and the total weight and points (weights in the reader's units), every fish logged at sea ("Released a blue marlin", "Landed a wahoo", "Lost a blue marlin"; boat, species and time, never the spot), and announcements from JHMMC's officers (title and message, under the JHMMC logo). Tabs: All (everything, including every fish logged at sea), Weigh-ins, Announcements. Every announcement is also sent as a phone notification to everyone who turned them on (More → Notifications: this phone on or off, and which kinds: announcements, your fish approved or not counted, every weigh-in, fish logged at sea). Officials always get fish to review; that one isn't a choice. Boat and profile pages show their own fish the same way.
- **Quick posts** (the West Africa feed, for showing off a catch): the Post tab needs only a photo or video and the species; the angler, weight, length, line class, released/tagged, caption, place (or the phone's location), date (today if left empty) and country are all on the form, optional.
- **Videos**: posts on either feed can carry a video (recorded now or chosen from the phone) as well as or instead of a photo, and a registration can add a video of the fish on the scale, recorded there and then like the scale photo (which stays required). Videos go up as recorded, up to 100 MB (about a minute). Everyone, JHMMC crews included, can post a weight; posts never score JHMMC points, which come only from the captain's registration at the weigh station. Photos are shrunk to 1600px JPEGs on the phone before upload so posting works over Starlink or a weak signal.
- **Depth contours on My catch map** (boat crews only, signed in): map tiles at zooms 7 to 12, so only the part in view loads and the lines stay sharp when zooming in, switched on and off with the map's layers button. They cover the coast from the Rio Nunez in Guinea past the Îles de Los, Freetown, the Banana Islands, Sherbro, Robertsport, Monrovia, Buchanan, Rivercess, Greenville and Harper to Tabou on the Ivory Coast border, and the deep water off it (screenshots taken at different zooms are scaled to one by their scale bars): chart screenshots stitched at full resolution by their overlapping contour lines, scaled by the 3 mi bar and placed by matching the earlier Monrovia chart (which fills in where the screenshots don't reach). The tiles are one packed file (`charts/coast.tiles` with `coast.index.json`, listed in `charts/charts.json`), served only through `/api/charts/coast/{z}/{x}/{y}.png`. Depths in feet.
- **Where it was caught**: taken by Log fish in the regional log. Older posts that have a spot still show it to the boat's crew (or everyone, if the poster chose) on a map.
- **Shared feed** filtered by species, boat, club, country or released-only, with likes, comments and sharing through the phone's share sheet, a copied link or WhatsApp.
- **Two separate books.** *Posts* are what members log themselves: they make the feed, the West Africa leaderboard, records, Participants and every club's records except JHMMC's, and never score points. *JHMMC registrations* are made by the boat's captain at the weigh station (the digital Fish Registration Form) and approved by the secretary: they make the JHMMC Points tables and JHMMC's club records, and don't appear on the feed. A JHMMC boat's page lists its registrations separately from its posts.
- **JHMMC points (official scoring)**: only boats registered under JHMMC, as Ocean or River with separate standings. Each JHMMC boat has a weigh station (Extreme, Beerville, Barracuda Club, Lofa River), which is also its home port, set by the captain or by the admin on the Boats page. The **captain** registers their own boat's whole day in one sheet at that station (today's fish only; scale photos taken with the camera there and then; the secretary may register any boat and enter an earlier day's paper form): then any number of fish, each with species, angler, official weight, line class and a photo on the scale (released fish: no weight, but a photo of the release, taken or chosen from the camera roll as long as it's from the last day); a video is optional for any fish, submitted together and saved all-or-nothing. Points are worked out the moment the weight is entered (shown under each weight as "Points (automatic)", with the total weight and total points at the bottom of the sheet, and saved with the registration as "awaiting approval"), using the same `src/scoring.js` the server runs (served to the browser as `/scoring.js`); the **secretary** approves the points the rules suggest, changes them with a note, or rejects. Every fishing day scores; the secretary keeps the season dates and tournaments on the calendar and the points-per-kg table (seeded from the 2025-26 form). Rules: weight × species points; released marlin 500; marlin under 100 kg kept is −500 (any weight); released sailfish scores as 25 kg; under 2 kg (ocean) / 1 kg (river) doesn't count. The **Points** tab has two tables for the two end-of-season trophies, each split Ocean and River: **Overall** (every day's points) and **Tournaments** (only fish caught during the season's tournaments, added up), plus each tournament's own results. Only boats the secretary has **entered** in a tournament compete in it (its results, winner and the Tournaments table); a boat fishing on a tournament day without entering scores for the season only. **Club roles** (set by the admin on the Club members page, JHMMC members only; their powers stop at the club, apart from the platform **admin**, who runs all of West Africa Sportfishing: every club, boat, member and post): the **Secretary** is the only one (with the admin) who reviews and approves fish and keeps the registration history; the **President** and **Vice President** run the other club tools (tournaments and their registration sheets, club members, calendar, scoring, registering fish for any boat); the **Treasurer** marks paid memberships and tournament fees but can't enter boats, change anglers or decide who is a member. None of them can delete West Africa posts or see a post's private spot; on More their tools sit under **JHMMC officials** (or **JHMMC treasurer**), apart from **Platform admin**. Scoring rules live in `src/scoring.js`.
- **Weights, never points**: the secretary never types points; they always come from the rules. A wrong weight (a missed 0) is corrected in the weight box, on the review page before approving or with **Correct weight** on an approved fish's page, with a note that's required; the points shown update as it's typed. **Fix species, angler or photo** (on the fish's page, waiting or approved, any day: captains can only register the same day) corrects a wrong species, a wrong angler (one of the boat's crew or a typed name) or a bad weigh-station photo, with a note; the points follow, the crew is told, and the record keeps the old values and the old photo. **Not counted** takes an approved fish off the points, with a reason. The crew gets a notification each time, and the registration record keeps it ("Weight corrected from 15 to 150 kg: …", "Taken off the points"). **Delete** (for a fish registered twice or by mistake) asks for a reason too, kept in the record and sent to the crew; the weigh station photo and video stay as evidence.
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

Each push to the deployed branch redeploys automatically. A persistent disk needs a paid instance (Starter); Render shows the price before you confirm. Render also keeps daily snapshots of the disk (the service's **Disks** tab).

### Demo copy

A second service, for showing the club, runs the same code with a made-up season: four JHMMC Ocean boats with club members' names (the catches are made up), weighed and approved fish with pictures, likes and comments, a tournament coming up, a trip logged at sea, and one fish waiting for the secretary. Visitors arrive already signed in as the captain of a made-up Demo Boat (with its own trips and a weighed fish), so nobody plays with a real member's boat, and can switch to its angler or the secretary from the sign-in page; every page says it is a demo copy. Nobody can change those accounts' passwords or emails, so one visitor can't lock out the next.

1. On Render, **New → Web Service**, the same repository and branch, build `npm ci`, start `npm start`, the Free instance type.
2. Add the environment variable `DEMO=1` (and `NODE_ENV=production`). No disk and no email.
3. Deploy. The season fills itself in on first start (dates are relative to that day); on the Free type the disk is wiped when the service restarts, which starts a fresh season. Share its address with the club.

### Weighmasters

The rules want every fish weighed by the weigh station's weighmaster. The secretary appoints them under **More → Weighmasters**: captains of JHMMC boats, one station each. A weighmaster's weigh-in screen lets him pick any JHMMC boat; his weigh-ins are at his station and marked "Weighmaster: name". When there's no weighmaster, a captain still weighs his own boat's fish but has to say why (no weighmaster at the station, the station was closed, or another reason); those are marked "Captain's weigh-in" with the reason on the secretary's review screen. Once approved they count the same. A weighmaster weighing his own boat counts as a captain's weigh-in.

### Privacy and deleting an account

The privacy policy is at **/privacy** (linked from More → Info and the sign-up page, and the address to give the App Store and Play Store); its contact is `ADMIN_EMAIL`. Members delete their own account under **More → Edit profile → Delete my account**, with their password: the account, profile photo, posts, comments, likes and notification phones go at once; fish already weighed in stay for their boat as "Former member", so nobody's points change, and the boat's logged trips stay. The admin's own account and the demo's shared accounts can't be deleted this way.

### Secretary desk

The secretary also sets each JHMMC boat's weigh station and Ocean/River (**More → JHMMC boats**; the admin does it for any boat, under Platform admin). **More → Secretary desk** (the JHMMC officers) is one screen to start the day: fish to review, open disputes and fish registered today; what needs attention (disputed fish with the latest reason, fish waiting over a day); what waits at each weigh station; the next tournament and how many boats have entered; shortcuts; and the officer's own last changes from the activity log.

### Activity log

Everything the JHMMC officers and the admin change is recorded with who did it and when, in plain words and with what it was before where that matters: approvals and rejections, corrected weights, species, anglers and photos, deleted fish (with the reason), weigh-ins sent for a boat, the scoring table, season dates, tournaments and entries, memberships, announcements, accounts, boats and clubs. **More → Activity log** (the admin and the JHMMC officers) shows it, newest first, filtered by person; nothing in the app can edit or delete it. Changes to a fish are also sent to its crew, and changes to the scoring table or the season dates are announced in the feed automatically.

### Backups

Every night the app copies its database (every fish, account, point and decision; not the photos) to `backups/` next to it, as `fishing-<date>-<time>.db.gz`, keeping the newest copy of each of the last 14 days. Each nightly copy is also emailed to the admin (`ADMIN_EMAIL`) once email (SMTP) is set up. The admin's **More → Backups** lists the copies, downloads one, and makes one now (and emails it).

To restore: stop the service, unzip the copy (`gunzip fishing-….db.gz`), put it in place of `/var/data/fishing.db` (from the service's **Shell** tab, or a one-off job), and start it again.

### Before the whole club starts using it

1. **Set up email** (SMTP, below), so password resets reach members and the nightly backups reach the admin.
2. **Clear the test data** (ask Claude for this one; it isn't part of the app).
3. Check a backup arrives by email the next morning.

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
src/demo.js       the demo copy's made-up season (DEMO=1)
demo/             its fish pictures
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
| POST   | `/api/catches/:id/review`     | Secretary: `{decision: approve|reject|weight, weightKg?, note?}`; points always come from the rules (`weightKg` corrects the weight, with a note; `weight` does it on an approved fish; `reject` on an approved fish takes it off the points) |
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
