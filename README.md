# medDashboard

A med-school tracker — assignments, exams, labs, tutoring, office hours and tasks —
with courses that carry their own class timetable: day, time and room number.

Built as a multi-user web app on Cloudflare: static files and a small Worker API in
front of a D1 (SQLite) database, with Google sign-in. The look is the "Ward Board":
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
| Google sign-in | **Built**, waiting on a client id in `wrangler.jsonc`. |
| Deployed | **Not yet.** The D1 database exists; nothing is deployed. |

## What's here

```
public/                   the app: index.html, css/, js/, manifest, service worker, icons
worker/                   the API: index.js, api.js, auth.js, google.js, validate.js, db.js
migrations/0001_init.sql  the D1 schema
test/                     vitest, running inside the Workers runtime against a local D1
wrangler.jsonc            Workers config: static assets, D1 binding, vars, cron
prototype.html            the original single-file prototype — open it, no build step
mockups.html              the three design directions it was chosen from
mockup-a-ornament.html    the ornament study: DNA, stethoscope, white coat
PLAN.md                   decisions, phases, file layout, backlog
docs/DATA-MODEL.md        the schema explained: tables, API, sync, migration
```

## Features

- **Six item types** — exams, assignments, labs, tutoring, office hours, tasks. Each
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
- **Several people** — each signs in with Google and sees only their own data.

## Running it locally

Needs Node and Wrangler (`npm i -g wrangler`, then `wrangler login` once).

```sh
npm install
npm run db:local        # apply the schema to the local D1
npm run dev             # http://localhost:8787
npm test                # 47 tests against the Worker and a local D1
```

Local sign-in needs a `.dev.vars` file (git-ignored). Copy `.dev.vars.example` and
set any long random `SESSION_SECRET`. With `DEV_LOGIN=1` the sign-in screen shows an
email box that works on localhost only; production never has it.

## Going live

1. **Google sign-in.** In Google Cloud (free, no billing): create a project, publish an
   External OAuth consent screen, then create an OAuth client of type *Web application*
   with authorised JavaScript origins `https://rounds.<your-subdomain>.workers.dev`
   and `http://localhost:8787`. Put the client id in `wrangler.jsonc` under
   `GOOGLE_CLIENT_ID`. Optionally set `ALLOWED_EMAILS` to a comma-separated list to
   pin the app to specific accounts; empty means anyone with a Google account.
2. **Secret.** `wrangler secret put SESSION_SECRET` with a long random string.
   Rotating it signs everyone out.
3. **Database and deploy.**

```sh
npm run db:remote       # schema into the production D1, once per migration
npm run deploy          # static files + Worker, one command
```

On a phone, open the site and choose *Add to Home Screen*; it installs as an app and
opens offline.

## Licence

MIT — see [`LICENSE`](LICENSE).
