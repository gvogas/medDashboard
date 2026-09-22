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
| Worker API | **Built and tested** — sessions, profile, rows, sync, import, nightly purge. |
| Front end | **Ported** — local-first store, sync, sign-in screen, settings import, PWA shell. |
| Accounts | **Built** — username and password, created with `npm run user:add`. |
| Live | **Deployed** at https://rounds.termanitor07.workers.dev; `npm run deploy` releases a change. |

## What's here

```
public/                   the app: index.html, css/, js/, manifest, service worker, icons
worker/                   the API: index.js, api.js, auth.js, password.js, validate.js, db.js
scripts/add-user.mjs      creates an account, locally or in production
migrations/0001_init.sql  the D1 schema
test/                     vitest, running inside the Workers runtime against a local D1
wrangler.jsonc            Workers config: static assets, D1 binding, vars, cron
design/                   the original prototype and the mockups it was chosen from
PLAN.md                   decisions, phases, file layout, backlog
docs/DATA-MODEL.md        the schema explained: tables, API, sync, migration
```

## Features

- **Six item types** — exams, assignments, labs, tutorials, office hours, tasks. Each
  opens a page with notes, a checklist and links.
- **Courses** you add and edit, each with a colour and a list of classes (kind, day,
  start, end, room). Courses can be archived without losing their items.
- **Three views** — week board grouped by day, a month calendar showing the class
  timetable only, and a sortable table of everything.
- **Live status** — overdue flags, next-exam countdown, class hours per week, lab hours.
- **Settings** — light / dark / follow-the-device, the name embroidered on the lab coat
  and its colour, your own quotes shown in a tile beside the stats, and an import of
  the prototype's data.
- **Local-first** — the app renders from IndexedDB, works offline, and syncs to D1 on
  load, on focus and after every edit. The pill in the top bar shows where it stands.
- **Several people** — each has a username and password and sees only their own data.

## Running it locally

Needs Node and Wrangler (`npm i -g wrangler`, then `wrangler login` once).

```sh
npm install
npm run db:local        # apply the schema to the local D1
npm run dev             # http://localhost:8787
npm test                # 51 tests against the Worker and a local D1
```

Local sessions need a `.dev.vars` file (git-ignored): copy `.dev.vars.example` and set
any long random `SESSION_SECRET`. Then create an account on the local database and
sign in with it:

```sh
npm run user:add -- yourname --name "Your Name"
```

## Going live

1. **Secret.** `wrangler secret put SESSION_SECRET` with a long random string.
   Rotating it signs everyone out.
2. **Database and deploy.**

```sh
npm run db:remote       # schema into the production D1, once per migration
npm run deploy          # static files + Worker, one command
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

If you ever edit the inline script in `public/index.html`, run `node scripts/csp-hash.mjs`
and paste the new hash into `public/_headers`, or the page's security policy will block it.

On a phone, open the site and choose *Add to Home Screen*; it installs as an app and
opens offline.

## Licence

MIT — see [`LICENSE`](LICENSE).
