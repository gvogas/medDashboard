# medDashboard

A med-school tracker — assignments, exams, labs, tutoring, office hours and tasks —
with courses that carry their own class timetable: day, time and room number.

Built as a single-user web app on Firebase. The look is the "Ward Board": clinical
teal on cool paper, a white coat you pick the colour of, and a DNA and biomolecule
layer behind the board.

## State

| | |
| --- | --- |
| Design | **Approved.** Three directions explored, one chosen and refined. |
| Prototype | **Working**, every feature clickable, data in browser storage. |
| Plan and schema | **Written** — see [`PLAN.md`](PLAN.md) and [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). |
| Firebase project | **Not created yet.** Nothing is deployed. |
| Real build | Not started. |

## What's here

```
prototype.html            the working prototype — open it in a browser, no build step
mockups.html              the three design directions it was chosen from
mockup-a-ornament.html    the ornament study: DNA, stethoscope, white coat
PLAN.md                   decisions, six phases, file layout, backlog
docs/DATA-MODEL.md        the schema: collections, fields, limits, queries, migration
firestore.rules           ownership + shape validation, ready to deploy
firestore.indexes.json    composite indexes, large fields exempted
firebase.json             Firestore, Hosting, emulator ports
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
- Everything is stored in the browser for now; the plan replaces that with Firestore
  so it syncs to your phone.

## Running it

The prototype needs nothing — open `prototype.html`.

Once the Firebase project exists (phase 0 of the plan):

```sh
firebase emulators:start      # Firestore + Auth + Hosting locally
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only hosting
```

## Licence

MIT — see [`LICENSE`](LICENSE).
