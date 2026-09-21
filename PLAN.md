# Rounds — build plan

A med-school tracker for assignments, exams, labs, tutoring, office hours and tasks,
with courses that carry their own class timetable (day, time, room).

The design is approved and exists as a working prototype: `prototype.html`
(published at https://claude.ai/artifact/TSz6cXXKMDCeuLeuXwFL9n). This plan turns
that single file into a real site with real storage.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | **Firebase Firestore** | Real-time sync between laptop and phone, offline cache built in, free at this scale. |
| Auth | **Google sign-in, single user** | One click, no passwords to manage. Every row lives under your own uid. |
| Front end | **Vanilla JS, ES modules, no build step** | The prototype already works this way. Nothing to compile, nothing to keep upgrading. |
| Hosting | **Firebase Hosting** (free Spark plan) | Same CLI as the database, HTTPS and a URL you can open on your phone. |
| Dates | **`YYYY-MM-DD` strings, local** | "Due Friday" must mean Friday wherever you are. ISO strings also sort chronologically, so no `Timestamp` gymnastics for range queries. |
| Recurrence | **Stored once, expanded in the client** | Weekly office hours and class meetings are one row each, not 40 rows a term. |

The full schema, field limits, query patterns and index list are in
[`docs/DATA-MODEL.md`](docs/DATA-MODEL.md). The rules are in
[`firestore.rules`](firestore.rules).

## Phases

### 0 — Firebase project (needs your go-ahead)
- Create the project (suggested id `rounds-tracker`), enable Firestore in native mode
  in a region near you (`europe-west3` or `europe-west1`), enable Hosting.
- Enable **Google** as a sign-in provider. This one has to be clicked in the Firebase
  console — the CLI can't turn providers on.
- `firebase init` for Firestore + Hosting, writing `firebase.json`, `.firebaserc`.
- Register a web app and drop its config into `js/firebase-config.js`.
  The web API key is not a secret; the rules are what protect the data.

**Open question:** the Firebase CLI here is signed in as `termanitor07@gmail.com`,
but you're `george@vogas.net` in Claude. Tell me which Google account should own the
project and sign in to the app — the choice is hard to undo later.

### 1 — Database
- Deploy `firestore.rules` and `firestore.indexes.json`.
- Rules check ownership **and** shape: a bug can't write an unknown `type`, a
  malformed date or a 10MB note.
- Verify with the rules emulator: a signed-out read is denied, another uid's read is
  denied, a bad `status` write is denied.

### 2 — Storage layer
- `js/store.js` — the only file that knows Firestore exists. Exposes
  `subscribe()`, `saveItem()`, `deleteItem()`, `saveCourse()`, `saveProfile()`, and
  nothing else.
- `persistentLocalCache` on, so the app opens instantly, works in a lecture hall with
  no signal, and queues writes until you're back.
- Three live listeners: courses, quotes, and items from the start of the term.
  Everything else — filters, search, overdue, countdowns, the week grid — is computed
  in memory, exactly as the prototype does it. A semester is a few hundred rows.

### 3 — Port the UI
Split `prototype.html` into modules, same markup and CSS, wired to the store instead
of `localStorage`:

```
index.html
css/  tokens.css  layout.css  components.css
js/   main.js  auth.js  store.js  state.js  model.js  dates.js  dom.js
      firebase-config.js
      views/  sidebar.js  stats.js  week.js  month.js  table.js
              drawer-item.js  drawer-course.js  drawer-settings.js
firestore.rules   firestore.indexes.json   firebase.json
docs/DATA-MODEL.md
```

- `model.js` holds what the app knows about itself: the six types, their status sets,
  the five course colours, `isOverdue`, `isComplete`, `occurrences`.
- `dates.js` holds the date helpers, unchanged from the prototype.
- Views stay dumb: given state, return HTML. One delegated click listener, as now.
- A sign-in screen in the same visual language: the coat pocket, one Google button.

### 4 — Bring your data across
- Settings gets **Import from this browser**: reads `rounds.proto.v2`, maps it onto the
  schema, writes it in batches of 500, and records `importedAt` so it can't run twice
  by accident.
- Whatever you've typed into the prototype survives the move.

### 5 — Get it on your phone
- Deploy to Hosting.
- `manifest.webmanifest` + a service worker that caches the shell, so it installs to
  your home screen and opens offline like an app.
- Optional: `rounds.vogas.net` as a custom domain.

### 6 — Backlog, in the order I'd do it
1. **Timetable import** — paste an `.ics` feed or a CSV and have courses, classes and
   exam dates created for you, instead of typing a semester in by hand.
2. **Export / backup** — one button that hands you a JSON file of everything.
3. **Grade weighting** — a weight per assessment so the app can project a block grade.
4. **Reminders** — "problem set due in 12 hours" as a browser notification.
5. **Attachments** — slide decks and lab sheets on an item, via Cloud Storage.
6. **Term archiving** — roll a finished block out of the week board without deleting it.

## What stays exactly as designed

Nothing in the approved look changes in the port: the Ward Board palette, light and
dark, the five course colours, the coat with its picked colour and embroidery, the
capsule scrollbars, the DNA and molecule layer, the draped stethoscope, light-pink
completed rows, pink checklist bars, the quote tile, and a page where only the list
scrolls.

## Cost

Spark (free) covers this comfortably: a term is roughly 400 item reads on a cold load,
cached afterwards, against a 50,000 reads/day allowance. Nothing here needs Blaze.
