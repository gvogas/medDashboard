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
| Cloudflare project | **Not created yet.** Nothing is deployed. |
| Real build | Not started. |

## What's here

```
prototype.html            the working prototype — open it in a browser, no build step
mockups.html              the three design directions it was chosen from
mockup-a-ornament.html    the ornament study: DNA, stethoscope, white coat
PLAN.md                   decisions, seven phases, file layout, backlog
docs/DATA-MODEL.md        the schema explained: tables, API, sync, migration
migrations/0001_init.sql  the D1 schema, ready to apply
wrangler.jsonc            Workers config: static assets, D1 binding, cron
```

## Features in the prototype

- **Six item types** — exams, assignments, labs, tutoring, office hours, tasks. Each
  opens a page with notes, a checklist and links.
- **Courses** you add and edit, each with a colour and a list of classes (kind, day,
  start, end, room).
- **Three views** — week board grouped by day, a month calendar showing the class
  timetable only, and a sortable table of everything.
- **Live status** — overdue flags, next-exam countdown, class hours per week, lab hours.
- **Settings** — light / dark / follow-the-device, the name embroidered on the lab coat
  and its colour, and your own quotes shown in a tile beside the stats.
- Everything is stored in the browser for now; the plan keeps that as the local cache
  and syncs it to D1 so it follows you to your phone.

## Running it

The prototype needs nothing — open `prototype.html`.

Once the Cloudflare and Google setup is done (phase 0 of the plan):

```sh
npm i -g wrangler
wrangler login
wrangler d1 migrations apply rounds --local     # schema into the local D1
wrangler dev                                    # http://localhost:8787
wrangler d1 migrations apply rounds --remote    # schema into production
wrangler deploy                                 # static files + Worker, one command
```

## Licence

MIT — see [`LICENSE`](LICENSE).
