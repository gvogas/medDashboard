# Study timer — design

Status: approved in conversation, 24 September 2026. Mockup:
https://claude.ai/artifact/AGBN5sTXi3jvkPJGHASXV5 (its Flow/Timer switch is gone from
this design; only the flow remains).

This is the timer half of batch B from the study-tools spec. Recurring items, the other
half, gets its own spec.

## What it is

A flip clock that runs a study flow you build: a list of Study and Break steps, each
with its own length in minutes, repeated for a number of rounds. Study time is one
colour and break time another, everywhere the timer shows. Finished study time is
logged against a course and, optionally, one item, and the Study tab shows where the
week's hours went.

There is one flow per person. The app remembers the last one and uses it next time.
Three quick-start buttons refill it:

| Quick start | Steps | Rounds |
| --- | --- | --- |
| Classic 25/5 | Study 25, Break 5 | 4 |
| Deep 50/10 | Study 50, Break 10 | 3 |
| Anki then read | Study 20, Break 5, Study 40, Break 15 | 2 |

The default flow for a new or migrated account is Classic 25/5.

There is no count-up stopwatch mode.

## Data — migration `0002_study.sql`

### `users.study_flow`

```sql
ALTER TABLE users ADD COLUMN study_flow TEXT NOT NULL
  DEFAULT '{"steps":[["study",25],["break",5]],"rounds":4}'
  CHECK (json_valid(study_flow) AND json_type(study_flow) = 'object');
```

Saved with the profile through `PUT /api/me`, so the flow follows the person across
devices. `worker/validate.js` checks the shape: `steps` is an array of 1–12 pairs, each
`["study"|"break", 1..180]` with an integer minute count, at least one `study` step;
`rounds` is an integer 1–12.

### `study_sessions`

(Named `study_sessions` in the build: "sessions" already means sign-in sessions in
this codebase.)

```sql
CREATE TABLE study_sessions (
  user_id        TEXT NOT NULL REFERENCES users(id),
  id             TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 24),
  course_id      TEXT,
  item_id        TEXT,
  started_at     INTEGER NOT NULL,
  study_minutes  INTEGER NOT NULL CHECK (typeof(study_minutes) = 'integer' AND study_minutes BETWEEN 1 AND 1440),
  rounds_done    INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rounds_done) = 'integer' AND rounds_done BETWEEN 0 AND 12),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  revision       INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision > 0),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX study_sessions_user_started ON study_sessions (user_id, started_at);
```

It is a synced row table exactly like `quotes`: `PUT` / `DELETE /api/study_sessions/:id`, the
`changes` feed, soft delete, and the nightly purge of tombstones. The server wiring is
adding `sessions` to the route pattern, `VALIDATORS`, the table list in `worker/db.js`
and the sync pull. `account_summary` gains a `study_sessions` count.

`rounds_done` counts rounds whose every step finished; it is shown in the log
("2 rounds") and not used for anything else.

Deleting a course clears `course_id` on its sessions, the same as items. Deleting an
item clears `item_id` on its sessions.

## Browser

### Engine — `public/js/timer.js`

No DOM. It takes the flow and a run record and answers "where are we": current round,
step index, kind (`study` / `break`), seconds left, study seconds so far, and whether
the flow is done.

The run record is timestamps, not a counter: `{ flow, startedAt, pausedAt, pausedMs,
skippedMs, skippedStudyMs }`; a skip jumps the clock forward and sets aside the study
time it passed over. Position is computed from
`now - startedAt - pausedMs`, so a phone that sleeps or a background tab that is
throttled comes back showing the right time, and a reload resumes the run.

The run record and the course/item picked for it live in the IndexedDB `meta` store
on that device only. They are not synced; only finished sessions are.

When a step ends the engine reports a phase change. The view plays a short chime (Web
Audio, after the first Start click so the browser allows sound) and the tab title shows
the time and phase, for example `24:13 · Study`. Push notifications are batch C.

### Rules

- Only study time is logged. Break time never counts.
- **Stop & log** ends the run and saves the study minutes done so far, rounded down.
- **Skip step** jumps to the next step. Study time already spent in the skipped step
  counts; the remainder does not.
- When the last step of the last round ends, the run stops and the session is saved.
- A run with less than 1 minute of study saves nothing.
- The flow cannot be edited while a run is going; the editor is only on the Study tab,
  which shows the focus screen during a run. Stop the run to change it.
- Course is required to start; item is optional and lists that course's items that are
  not done.

### Focus screen

Start opens the focus screen: the whole window shows only the timer and Spotify. The top
bar, the views, the stats and the sidebar are hidden.

- It is dark in both themes: a deep ground in the phase colour with a soft glow,
  cross-fading when the phase changes (see Colours for each background). Its colours are their own
  tokens (`--fx-*`) so the rest of the app's light theme is untouched.
- Top: **Leave focus** on the left, the course and item as a chip on the right.
- Left (top on a phone): the phase label, the flip clock, the round strip with the time
  left in the flow, then Skip step, a round Pause/Resume button in the phase colour, and
  Stop & log, and under them "Next · Break 10 min".
- Right (below on a phone): the Spotify view, drawn with `renderSpotifyInto()`, so
  playlists, search and the player all work without leaving. When Spotify is not
  connected it shows the Spotify view's own connect prompt.
- Start also asks the browser for full screen and a screen wake lock, so a phone on the
  desk stays on. Both are optional: if the browser refuses, the focus screen still
  opens in the window.
- It is a soft lock. A small **Leave focus** link opens the full app while the run keeps
  going; the corner clock then shows, and tapping it returns to the focus screen.
- When a new Study step begins and the person is outside the focus screen, the app goes
  back to it, unless a drawer is open (an edit in progress is never thrown away).
- The focus screen closes when the run is stopped or the flow finishes, landing on the
  Study tab with the log.

### Study tab — `public/js/views/study.js`

A fifth view after Spotify. While a run is going, opening it shows the focus screen
instead; what follows is the Study tab when no run is going.

Left column:
- The flip clock (`public/js/views/flipclock.js`): four digit cards, `MM:SS`, each card
  flips when its digit changes. With `prefers-reduced-motion` the digits change without
  the flip.
- The phase label (Study / Break / Done), the round, and a strip showing every step of
  every round in proportion to its minutes, filled as it passes, the current step
  outlined.
- Course and item pickers, Start / Pause, Skip step, Stop & log.
- The flow editor: the numbered steps (tap the name to switch Study and Break, a minutes
  field, remove), + Study, + Break, Repeat N rounds, and the quick-start buttons. It
  saves to the profile on change.

Right column, the log for the current week (Monday to Sunday):
- Total study time and session count.
- A bar per day, stacked by course colour.
- Minutes per course.
- Recent sessions with course, item, rounds and start time; each can be deleted.

### Corner clock

After **Leave focus**, while a run is going or paused, a small flip clock sits in the
bottom-right corner of every view (full width at the bottom on a phone) with the phase
label. It takes the phase colour and returns to the focus screen when tapped. The top bar's Study button shows
the time left while a run is going.

### Colours

`tokens.css` gains `--study`, `--study-soft`, `--study-ink`, `--study-card`,
`--study-card-2` and the same five for `--break`, plus the focus screen's `--fx-*` set,
in light and dark. The pair depends on the background:

| Background | Study | Break |
| --- | --- | --- |
| Med | soft pink (`#C8577F` light, `#EFA3BE` dark, `#F5A8C3` focus) | soft purple (`#8B5CC7` light, `#BCA6E6` dark, `#C9B6F2` focus) |
| CS | teal (`#0E7C74` light, `#3FBFB2` dark, `#5FD3C6` focus) | pink (`#C0577A` light, `#E28AA8` dark, `#F29BB8` focus) |

On Med the focus screen's ground is a deep rose during Study and a deep violet during
Break; on CS, deep teal and deep plum.
The clock cards, phase label, Start button, top-bar dot, corner clock border and the
strip all take the current phase's colour.

### Item page

An item with sessions shows "Studied 3h 20m" in its drawer, summed from its sessions.

## Tests

- `timer.js`: step boundaries, pause and resume, skip mid-study, the last round ending,
  a long gap (sleep) crossing several steps.
- Focus screen, by hand in the browser: Start opens it, Leave focus and the corner clock
  go out and back, a new Study step pulls you back but not with a drawer open, and it
  still opens when full screen is refused.
- Worker: session shape rejected with the field named, another user's session is 404,
  unauthenticated is 401, `study_flow` shape rejected, deleting a course or item
  unlinks its sessions.
- Migration: applies to a database created by `0001_schema.sql` with existing users,
  who get the default flow.

## Deploy note

Apply `0002_study.sql` to the remote D1 before deploying the Worker, or the live site
returns 500s on sync.
