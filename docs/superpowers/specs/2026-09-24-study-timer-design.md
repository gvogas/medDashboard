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

### `sessions`

```sql
CREATE TABLE sessions (
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
CREATE INDEX sessions_user_started ON sessions (user_id, started_at);
```

It is a synced row table exactly like `quotes`: `PUT` / `DELETE /api/sessions/:id`, the
`changes` feed, soft delete, and the nightly purge of tombstones. The server wiring is
adding `sessions` to the route pattern, `VALIDATORS`, the table list in `worker/db.js`
and the sync pull. `account_summary` gains a `sessions` count.

`rounds_done` counts rounds whose every step finished; it is shown in the log
("2 rounds") and not used for anything else.

Deleting a course clears `course_id` on its sessions, the same as items. Deleting an
item clears `item_id` on its sessions.

## Browser

### Engine — `public/js/timer.js`

No DOM. It takes the flow and a run record and answers "where are we": current round,
step index, kind (`study` / `break`), seconds left, study seconds so far, and whether
the flow is done.

The run record is timestamps, not a counter: `{ startedAt, pausedAt, pausedMs, skips }`,
where `skips` lists the times a step was skipped. Position is computed from
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
- Editing the flow while a run is going changes future steps only. The current step
  keeps its length.
- Course is required to start; item is optional and lists that course's items that are
  not done.

### Study tab — `public/js/views/study.js`

A fifth view after Spotify.

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

On every other view, while a run is going or paused, a small flip clock sits in the
bottom-right corner (full width at the bottom on a phone) with the phase label. It takes
the phase colour and opens the Study tab when tapped. The top bar's Study button shows
the time left while a run is going.

### Colours

`tokens.css` gains `--study`, `--study-soft`, `--study-ink`, `--study-card` and the
same five for `--break`, in light and dark and for the CS background. Study derives
from the theme accent (teal on Med, blue on CS); break is the existing pink family.
The clock cards, phase label, Start button, top-bar dot, corner clock border and the
strip all take the current phase's colour.

### Item page

An item with sessions shows "Studied 3h 20m" in its drawer, summed from its sessions.

## Tests

- `timer.js`: step boundaries, pause and resume, skip mid-study, the last round ending,
  a long gap (sleep) crossing several steps, flow edited mid-run.
- Worker: session shape rejected with the field named, another user's session is 404,
  unauthenticated is 401, `study_flow` shape rejected, deleting a course or item
  unlinks its sessions.
- Migration: applies to a database created by `0001_schema.sql` with existing users,
  who get the default flow.

## Deploy note

Apply `0002_study.sql` to the remote D1 before deploying the Worker, or the live site
returns 500s on sync.
