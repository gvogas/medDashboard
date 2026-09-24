# medDashboard

A med-school tracker — assignments, exams, labs, tutorials, office hours and tasks —
with courses that carry their own class timetable: day, time and room number.

Built as a multi-user web app on Cloudflare: static files and a small Worker API in
front of a D1 (SQLite) database. Accounts are usernames and passwords, created by you. The look is the "Ward Board":
clinical teal on cool paper, a white coat you pick the colour of, and a DNA and
biomolecule layer behind the board.

## State

| | |
| --- | --- |
| Design | **Approved.** Three directions explored, one chosen and refined. |
| Prototype | **Working**, every feature clickable, data in browser storage. |
| Plan and schema | **Written** — see [`PLAN.md`](PLAN.md) and [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). |
| Worker API | **Built and tested** — sessions, profile, rows, sync, nightly purge. |
| Front end | **Ported** — local-first store, sync, sign-in screen, PWA shell. |
| Accounts | **Built** — username and password, created with `npm run user:add`. |
| Live | **Deployed** at https://rounds.termanitor07.workers.dev; `npm run deploy` releases a change. |

## What's here

```
public/                   the app: index.html, css/, js/, manifest, service worker, icons
worker/                   the API: routes, auth, validation, D1 queries, rate limits, Spotify proxy
scripts/                  add-user, build, deploy checks (secrets, database), CSP hash, Spotify key
migrations/               the D1 schema, one file per change
test/                     vitest, running inside the Workers runtime against a local D1
wrangler.jsonc            Workers config: static assets, D1 binding, vars, cron
design/                   the original prototype and the mockups it was chosen from
PLAN.md                   decisions, phases, file layout, backlog
docs/DATA-MODEL.md        the schema explained: tables, API, sync
docs/DEPLOYING.md         running, deploying, accounts and troubleshooting, step by step
docs/API-REVIEW.md        endpoint inventory, rate limits, caching and review findings
docs/RELIABILITY-UPGRADE.md  sync revisions, local queue and Spotify token keys
```

## Features

- **Seven item types** — exams, assignments, labs, tutorials, office hours, tasks and
  projects. Each opens a page with notes, a checklist and links.
- **Courses** you add and edit, each with a colour and a list of classes (kind, day,
  start, end, room). Courses can be archived without losing their items.
- **Four views** — week board grouped by day, a month calendar showing the class
  timetable only, a sortable table of everything, and Spotify.
- **Live status** — overdue flags, next-exam countdown, class hours per week, lab hours.
- **Settings** — light / dark / follow-the-device, a Med or CS background (the CS one
  swaps the lab coat for a lanyard ID badge), the name embroidered on the coat and its
  colour, and your own quotes shown in a tile beside the stats.
- **Local-first** — the app renders from IndexedDB, works offline, and syncs to D1 on
  load, on focus and after every edit. The pill in the top bar shows where it stands.
- **Several people** — each has a username and password and sees only their own data.
- **Spotify** — a badge on the coat shows what you are listening to, with previous,
  play/pause and next, and a Spotify view lets you search, browse your playlists and
  Liked Songs, see the queue and set the volume. Each person connects their own account
  from Settings.

## Running it locally

Needs Node and Wrangler (`npm i -g wrangler`, then `wrangler login` once).

```sh
npm install
npm run db:local        # apply the schema to the local D1
npm run db:check        # read-only integrity checks and table counts
npm run dev             # http://localhost:8787
npm run dev:built       # the same, serving the built, versioned site
npm test                # regression tests against the Worker, a local D1 and a fake Spotify
```

Local sessions need a `.dev.vars` file (git-ignored): copy `.dev.vars.example` and set
any long random `SESSION_SECRET`. The two Spotify values can stay empty until you set
the player up. Then create an account on the local database and sign in with it:

```sh
npm run user:add -- yourname --name "Your Name"
```

## Going live

The step-by-step guide is [`docs/DEPLOYING.md`](docs/DEPLOYING.md). In short:

1. **Secret.** `wrangler secret put SESSION_SECRET` with a long random string.
   Rotating it signs everyone out.
2. **Database and deploy.**

```sh
npm run deploy          # pending migrations into the production D1, then static files + Worker
```

3. **Accounts.** One command per person, on the production database. It asks for the
   password twice and never shows it. There is no sign-up page: only accounts you
   create this way can sign in.

```sh
npm run user:add -- yourname --remote --name "Your Name"
```

To change someone's password, the same command with `--reset`:

```sh
npm run user:add -- yourname --reset --remote
```

To remove an account together with everything it owns, `--delete`. It asks you to
type the username to confirm:

```sh
npm run user:add -- yourname --delete --remote
```

Passwords are hashed with PBKDF2-SHA256 at 100,000 iterations and a random salt,
the most the Workers runtime allows per call. Five wrong guesses lock a username for
a minute, doubling per further guess up to an hour. Usernames are 3–32 characters of
letters, digits, dot, dash or underscore, and are not case-sensitive.

### Spotify

The player is off until the app has a Spotify client id and secret. Setting it up is
about ten minutes, once, and is walked through in [`docs/DEPLOYING.md`](docs/DEPLOYING.md#spotify).
In short: create an app at developer.spotify.com with the two callback URLs and the
Web API and Web Playback SDK ticked (the tab itself can play, as a device called Rounds), add each
listener's Spotify email to it (five at most, a Spotify limit), put the client id in
`wrangler.jsonc` and `.dev.vars`, and set the secret:

```sh
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put SPOTIFY_TOKEN_KEYS     # JSON keyring, see docs/RELIABILITY-UPGRADE.md
npm run deploy
```

Then everyone connects their own account from Settings. Controls need Spotify Premium;
free accounts still see what is playing. Tokens live in D1, the refresh token
encrypted under `SPOTIFY_TOKEN_KEYS`, which is separate from `SESSION_SECRET`: rotating
the session secret signs people out but leaves Spotify connected.

If you ever edit the inline script in `public/index.html`, run `npm run csp:update` to
write its new hash into `public/_headers`, or the page's security policy will block it.
`npm run build` refuses to build while the hash is stale.

On a phone, open the site and choose *Add to Home Screen*; it installs as an app and
opens offline.

## Licence

MIT — see [`LICENSE`](LICENSE).
