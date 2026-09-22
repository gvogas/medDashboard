# Rounds — build plan

A med-school tracker for assignments, exams, labs, tutorials, office hours and tasks,
with courses that carry their own class timetable (day, time, room). Several people
can use it, each with their own username and password, seeing only their own data.

The design is approved and exists as a working prototype: `design/prototype.html`
(published at https://claude.ai/artifact/TSz6cXXKMDCeuLeuXwFL9n). This plan turns
that single file into a real site with real storage.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Platform | **Cloudflare Workers**, free plan | Hosting, API, database and cron in one account. Nothing sleeps, nothing pauses, no card. |
| Database | **Cloudflare D1** (SQLite) | Real tables with real `CHECK` constraints. A term is a few hundred rows; D1's free tier is millions of reads a day. Exportable as one file. |
| Hosting | **Workers static assets** at `rounds.<account>.workers.dev` | Static files are free and unlimited. HTTPS out of the box, no domain needed. |
| Auth | **Username + password**, accounts created by a command | No sign-up page and no third party: only accounts you create can sign in. The Worker checks a salted PBKDF2 hash and issues a signed session cookie. |
| Front end | **Vanilla JS, ES modules, no build step** | The prototype already works this way. The only tool is `wrangler`, and that is for deploying. |
| Offline | **Local-first** — IndexedDB is what the UI renders from, a sync layer talks to the API | The prototype already renders from a local store. The app opens instantly, works with no signal, and queues writes until it is back. |
| Sync | **Per row, last write wins**, tombstones for deletes | You are one person on two devices, never editing the same row at the same second. A pull on load and on tab focus is all the "real-time" this needs. |
| Dates | **`YYYY-MM-DD` strings, local** | "Due Friday" must mean Friday wherever you are. ISO strings also sort chronologically. |
| Recurrence | **Stored once, expanded in the client** | Weekly office hours and class meetings are one row each, not 40 rows a term. |

The full schema, API, sync protocol and migration are in
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). The schema itself is
[`migrations/0001_init.sql`](migrations/0001_init.sql).

### Why not Cloudflare Access or Google

Access would have handled login with zero code, but it can only protect a domain
hosted in your Cloudflare account, and this project has no domain. Google sign-in
was built and then dropped in favour of plain accounts, so nobody needs a Google
account and there is no OAuth client to configure.

## Phases

Status, as of 22 September 2026: every phase is done and the app is live at
https://rounds.termanitor07.workers.dev. Only the backlog remains.

### 0 — Accounts and keys — done
- Cloudflare account, `npm i -g wrangler`, `wrangler login`. Pick the account's
  `workers.dev` subdomain in the dashboard; the app will live at
  `https://rounds.<subdomain>.workers.dev`.
- `wrangler d1 create rounds` and paste the database id into `wrangler.jsonc`.
- `wrangler secret put SESSION_SECRET` with 32 random bytes. This signs session
  cookies; rotating it signs everyone out.
- Accounts: `npm run user:add -- <username> [--remote]` hashes a password and inserts
  the row. There is no sign-up page.

### 1 — Database — done
- `wrangler d1 migrations apply rounds --local` then `--remote`.
- The schema enforces ownership and shape: composite primary keys `(user_id, id)`,
  enums and lengths as `CHECK` constraints, dates as `GLOB` patterns, JSON columns
  checked with `json_valid` and capped with `json_array_length`. A client bug cannot
  write an unknown `type`, a malformed date or a 10 MB note.
- Verify with `wrangler d1 execute --local`: a bad `status` is rejected, a 141-char
  title is rejected, a 13th meeting is rejected.

### 2 — Worker API — done
```
worker/index.js      routes /api/*; everything else falls through to static assets
worker/auth.js       signSession(), readSession(), requireUser()
worker/password.js   hashPassword(), verifyPassword(), normalizeUsername()
worker/db.js         every query, all scoped by user_id
worker/validate.js   the same shape rules as the schema, so errors are readable
worker/api.js        the handlers below
```
| Route | Does |
| --- | --- |
| `POST /api/login` | Body `{username, password}`. Verify the hash, set the cookie. Unknown user and wrong password fail identically. |
| `DELETE /api/session` | Clear the cookie. |
| `GET /api/me` · `PUT /api/me` | Profile: coat, theme, term start. |
| `GET /api/sync?since=<ms>` | Every row of yours changed after `since`, tombstones included, plus the server's `now`. |
| `PUT /api/{courses,items,quotes}/:id` | Upsert. The id is yours; the server stamps `updated_at`. |
| `DELETE /api/{courses,items,quotes}/:id` | Soft delete: sets `deleted_at`. Deleting a course clears `course_id` on its items. |

- Every handler starts with `requireUser()` and every query has `user_id = ?` in it.
  There is no route that takes a `user_id` from the client.
- Tests with `vitest` and `@cloudflare/vitest-pool-workers` against a local D1:
  unauthenticated request → 401, another user's row → 404, bad shape → 400 with the
  field named.
- A daily cron (`0 3 * * *`) hard-deletes tombstones older than 30 days.

### 3 — Storage layer in the browser — done
- `js/db.js` — a 40-line IndexedDB wrapper: three object stores (`courses`, `items`,
  `quotes`), a `meta` store for the profile, `lastSyncAt` and the dirty set.
- `js/store.js` — the only file the views know. Exposes `subscribe()`, `saveItem()`,
  `deleteItem()`, `saveCourse()`, `deleteCourse()`, `saveQuote()`, `deleteQuote()`,
  `saveProfile()`, and nothing else. Every save writes IndexedDB, marks the row dirty,
  notifies subscribers, then asks `sync.js` to push.
- `js/sync.js` — `push()` sends dirty rows and clears the flag on 2xx; `pull(since)`
  applies the server's changes, skipping rows that are dirty locally. Runs on load, on
  `visibilitychange`, on `online`, and after every push. Failures are silent and retried.
- Everything else — filters, search, overdue, countdowns, the week grid — is computed
  in memory from the local rows, exactly as the prototype does it.

### 4 — Port the UI — done
Split `design/prototype.html` into modules, same markup and CSS, wired to `store.js` instead
of `localStorage`:

```
public/
  index.html  manifest.webmanifest  sw.js
  css/  tokens.css  layout.css  components.css
  js/   main.js  api.js  db.js  sync.js  store.js  state.js  query.js
        model.js  dates.js  dom.js  ornament.js
        views/  render.js  bits.js  signin.js  sidebar.js  stats.js  week.js  month.js
                table.js  drawer-base.js  drawer-item.js  drawer-course.js  drawer-settings.js
worker/       index.js  api.js  auth.js  password.js  validate.js  db.js  http.js
scripts/      add-user.mjs
migrations/   0001_init.sql
test/         api  rows  purge  password  security  sessions  timepicker  (vitest)
wrangler.jsonc
docs/DATA-MODEL.md
```

- `model.js` holds what the app knows about itself: the six types, their status sets,
  the five course colours, `isOverdue`, `isComplete`, `occurrences`.
- `dates.js` holds the date helpers, unchanged from the prototype.
- Views stay dumb: given state, return HTML. One delegated click listener, as now.
- `views/signin.js`: the coat pocket, a username and a password. A 401 anywhere shows
  the screen again.

### 6 — Get it on your phone
- `wrangler deploy`. Static files and the Worker ship together; D1 migrations are
  applied separately and first.
- `manifest.webmanifest` + a service worker that caches the shell, so it installs to
  your home screen and opens offline like an app.
- Optional, later: a custom domain, if you ever want one. Nothing above depends on it.

### 7 — Backlog, in the order I'd do it
1. **Timetable import** — paste an `.ics` feed or a CSV and have courses, classes and
   exam dates created for you, instead of typing a semester in by hand.
2. **Export / backup** — one button that hands you a JSON file of everything.
3. **Grade weighting** — a weight per assessment so the app can project a block grade.
4. **Reminders** — "problem set due in 12 hours" as a browser notification, sent by a
   Worker cron and Web Push.
5. **Attachments** — slide decks and lab sheets on an item, via Cloudflare R2
   (10 GB free).
6. **Term archiving** — roll a finished block out of the week board without deleting it.

### 8 — Spotify in the sidebar — done
A strip under the coat pocket shows what is playing on each person's own Spotify, with
previous, play/pause and next. The Worker holds the tokens (refresh token encrypted)
and proxies every call; the browser polls every 5 s while playing, 20 s otherwise.
Design: `docs/superpowers/specs/2026-09-22-spotify-player-design.md`; plan:
`docs/superpowers/plans/2026-09-22-spotify-player.md`.

## What stays exactly as designed

Nothing in the approved look changes in the port: the Ward Board palette, light and
dark, the five course colours, the coat with its picked colour and embroidery, the
capsule scrollbars, the DNA and molecule layer, the draped stethoscope, light-pink
completed rows, pink checklist bars, the quote tile, and a page where only the list
scrolls.

## Cost

The Workers free plan covers this with room for a whole cohort. No card is required
and nothing is paused for inactivity.

| Resource | Free allowance | 50 people, rough daily use |
| --- | --- | --- |
| Worker requests | 100,000 / day | ~10,000 |
| Static asset requests | unlimited | — |
| D1 rows read | 5,000,000 / day | ~50,000 |
| D1 rows written | 100,000 / day | ~2,000 |
| D1 storage | 5 GB | a few MB |
| Cron triggers | included | 1 / day |

