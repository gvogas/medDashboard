# Study tools, batch A — design

Date: 23 September 2026. Status: approved.

Four additions that need no schema, Worker or migration change: grade weighting with a
projected course grade, timetable import from `.ics` and CSV, spaced-review tasks
after lectures, and exam prep from the timetable. Everything they write is an ordinary
course or item row, saved through `saveCourse` / `saveItem`, so the existing sync,
validation and change feed carry it.

This is the first of three batches. Batch B (recurring items for every type, a study
timer and log) needs a migration; batch C (reminders by Web Push) needs keys, a
subscription table and a cron. Each gets its own spec.

## Constraints that shaped it

- No schema change. `items.weight` (0–100) and `items.checklist` (at most 50 steps)
  already exist and sync; nothing else is added to D1.
- Server limits stay authoritative: 12 meetings per course, course code 1–8 chars,
  name 80, item title 140, room 80. The client trims or drops before writing, and says so.
- Item and course ids are 1–24 chars.
- Free tiers only; no third-party scripts, so the parsers are written here.

## 1. Grade weighting and projection

**Item drawer.** A `Weight` field (number, 0–100, placeholder `% of course`) for the
gradable types: exam, assignment, lab, project. It shows in every status, so weights
can be entered when the item is created. The existing `Grade` field still appears only
when the status is `graded`. Empty means no weight (`null`).

**Course drawer.** A "Grades" section, shown when at least one of the course's items
has a weight:

- **Current** — weighted average of graded items that have both a grade and a weight:
  `Σ(grade × weight) / Σ(weight)`, one decimal. `—` when nothing is graded.
- **Counted** — `graded weight of total weight %`, with a meter.
- **Needed** — for each of 50, 60 and 70: the average needed on the remaining
  (ungraded) weight to finish at that mark, assuming the total is 100:
  `(target × 100 − Σ(grade × weight)) / remainingWeight`. Shown as `≥ 62%`;
  `secured` when ≤ 0; `out of reach` when > 100; hidden when nothing remains.
- A warning line when the total weight is not 100: `Weights add up to 85%`.

Items with status `missed` and a weight count as graded 0. Deleted items are not in
`data.items` and never count.

**Module.** `public/js/grades.js` exports
`courseGrade(items) → { current, graded, total, remaining, needed(target) }`.
Pure; no DOM, no store.

## 2. Import from .ics and CSV

**Entry.** Settings gains an "Import" group: a file picker (`.ics,.csv,.txt`) and a
"paste instead" textarea. The format is sniffed: `BEGIN:VCALENDAR` means ics,
otherwise CSV.

**.ics parser** — `public/js/importers/ics.js`, `parseIcs(text) → events[]`:

- Unfolds continuation lines (CRLF or LF followed by a space or tab), splits on the
  first unquoted `:`, reads parameters after `;`.
- Reads `VEVENT` blocks only: `SUMMARY`, `LOCATION`, `DTSTART`, `DTEND`, `RRULE`,
  `EXDATE` ignored, `STATUS:CANCELLED` skipped. Unescapes `\,` `\;` `\n` `\\`.
- Times: `…Z` (UTC) are converted to the browser's local time; `TZID=` and floating
  times are taken as written (wall-clock). `VALUE=DATE` (all day) gives a date with
  no start or end.
- `RRULE` with `FREQ=WEEKLY` marks the event as weekly; `BYDAY` gives the weekdays
  (one meeting per listed day), otherwise the weekday of `DTSTART`. Other
  frequencies are imported as a single event on `DTSTART`.

**CSV parser** — `public/js/importers/csv.js`, `parseCsv(text) → rows[]`: RFC 4180
quoting, comma or semicolon (sniffed from the header), header row required,
case-insensitive column names:

```
type,course,title,date,start,end,room,weight
class,PHARM,Pharmacology lecture,2026-09-14,09:00,10:00,LT2,
exam,PHARM,Midterm,2026-10-20,14:00,16:00,Hall A,30
```

`type=class` (or `lecture`, `lab-class`, a meeting kind such as `PBL`) becomes a
meeting on the date's weekday; any item type name becomes that item; anything else
becomes a task. Dates accept `YYYY-MM-DD` and `DD/MM/YYYY`.

**Mapping** — `public/js/importers/plan.js`, `planImport(events, data) → plan`, shared
by both formats:

- Weekly events → course meetings. The course is matched by code: the first
  token of the summary or the CSV `course` column, upper-cased, compared with
  existing course codes (archived included). No match proposes a new course
  (code from the token, name from the rest of the summary, next palette colour).
  Kind from keywords (`lab`, `pbl`, `tutorial`, `seminar`, `clinical`), else
  `Lecture`. A meeting identical to an existing one (weekday, start, end) is skipped.
- One-off events → items. Type from keywords: `exam|quiz|osce|test|midterm|final`
  → exam; `due|assignment|essay|submission` → assignment; `lab|practical` → lab;
  else task. Course matched the same way, `null` if none. An item with the same
  course, title and date as an existing one is marked duplicate.
- Limits: meetings beyond 12 per course and over-long fields are trimmed or dropped
  and listed in `plan.notes`.

**Preview.** A screen in the settings drawer: counts ("3 new courses · 14 classes ·
9 items"), then the rows grouped by course, each with a checkbox and, for items, a
type select. Duplicates start unticked. "Import n" writes the ticked rows (courses
first, so items can reference them); "Cancel" discards the plan. Nothing is written
before confirm. After writing: a line "Imported 14 classes and 9 items".

## 3. Spaced review, chained on completion

**Setting.** Settings › Study: "Create review tasks after lectures", off by default.
Stored per device in localStorage as `rounds.reviews = { on, through }`, read and
written in try/catch; unavailable storage means off.

**Generator** — `public/js/reviews.js`:

- `lectureDates(courses, from, to)` lists `{course, meeting, date}` for every
  `Lecture` meeting of every active course, for each date in `[from, to]`.
- `runReviews()` runs after the store loads and when the date rolls over (the
  existing focus/visibility handling, checking whether `today()` changed). With the
  setting on, it creates step 1 for every lecture from `through + 1` to yesterday,
  then sets `through` to yesterday. Turning the setting on sets `through` to
  yesterday, so the term is not backfilled.
- Step 1 is a `task`, course set, dated the day after the lecture, titled
  `Review 1/4 · PHARM Lecture Mon 14 Sep`.

**Chain.** When an item whose id is a review id changes to `done`, and it is step 1–3,
the next step is created, dated from today: step 2 at +2 days, step 3 at +4, step 4
at +14. On schedule that is days 1, 3, 7 and 21 after the lecture. Step 4 ends the
chain. Reopening a step does not remove the next one.

**Ids.** `rv` + base-36 of a 32-bit FNV-1a hash of `courseId|meetingId|date` + the
step digit: at most 10 characters. Two devices generating the same step write the
same row. Before creating, the generator skips an id already in `data.items`.

**When it runs.** After every successful sync pull (on load, on focus, after edits),
so this device already holds reviews another device created. A create of an id that
exists on the server is refused as a conflict and would leave a saved copy in
Settings; running after the pull keeps that to a narrow race.

**Known edge case.** Deleted rows are dropped from the local store, so if a review is
deleted on one device before a second device has generated that lecture, the second
device's create meets the server tombstone and becomes a saved copy in Settings.
Rare; closing it needs a server-side record (a later batch).

## 4. Exam prep

**Fill topics.** The exam drawer gains "Fill topics from lectures" when the exam has a
course with `Lecture` meetings. It appends one checklist step per lecture date from
the day after the course's previous exam (or `profile.termStart`, or 10 weeks before
the exam, whichever is latest) up to the day before the exam:
`PHARM Lecture · Mon 14 Sep`. Steps whose text already exists are skipped; the list
stops at 50 and says how many were left out. Uses `lectureDates` from `reviews.js`.

**Prep line.** For an open exam with checklist steps, a line in the exam drawer header
and in the **Next exam** stat tile foot: `7/20 topics · 1.1/day`, where the pace is
remaining steps ÷ days left (today counts as a day). It gets the `hot` style above
3 per day. With no steps, the tile foot stays as it is.

## 5. Course outline (added 23 September 2026)

Settings › Import › "Course outline…" takes a PDF, Word or text file (≤ 5 MB) and
opens the same preview as `.ics` and CSV.

- **Worker** — `POST /api/outline`, body is the file, `?name=&today=&termStart=`.
  `worker/outline.js` converts with `env.AI.toMarkdown` (free for documents; plain
  text is used as sent), caps the text at 48,000 characters, and asks
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for JSON matching a schema: code, name,
  instructor, term, weekly classes (kind, day, times, room) and assessments (title,
  type, date, times, room, weight). The reply is re-validated and bounded before it
  is returned; nothing is stored.
- **Limits** — 10 outlines per user per day (`request_limits` key `outline:<user>`,
  a 24-hour window), counted before the model runs, on top of the API limit.
  Workers AI's free allowance is 10,000 neurons a day; one outline is a few hundred.
- **Errors** — 413 over 5 MB, 422 unsupported or empty (a scanned PDF has no text),
  502 unreadable model output, 503 when Workers AI is unreachable, 429 over the limit.
- **Client** — `planOutline` maps the result onto the import plan: classes become
  meetings, dated assessments become items with their weights, undated ones are
  listed in the notes. A new course keeps its instructor and term and is offered even
  when nothing else is.
- **Tests** — the AI binding is remote-only, so `vitest.config.js` sets
  `remoteBindings: false` and `test/outline.test.js` drives `readOutline` with a fake
  binding; the endpoint tests cover auth, size, the unreachable case and the limit.

## Files

| File | Change |
| --- | --- |
| `public/js/grades.js` | new — weighted grade maths |
| `public/js/importers/ics.js`, `csv.js`, `plan.js` | new — parse and map |
| `public/js/reviews.js` | new — lecture dates, review ids, generator, chain |
| `public/js/views/drawer-import.js` | new — import picker and preview |
| `public/js/views/drawer-item.js` | weight field, fill topics, prep line |
| `public/js/views/drawer-course.js` | Grades section |
| `public/js/views/drawer-settings.js` | Import and Study groups |
| `public/js/views/stats.js` | prep pace in the Next exam tile |
| `public/js/main.js` | actions, review chain hook on status change, rollover |
| `public/css/components.css` | preview list, grade rows |
| `public/sw.js` | add the six new modules to the offline shell list |

## Testing

Vitest, following the existing node-side tests (`test/local-store.node.mjs` style):

- `grades` — no weights, partial grading, missed counts as 0, secured / out of
  reach, total not 100.
- `ics` — folding, escapes, UTC vs TZID vs all-day, weekly with and without
  `BYDAY`, cancelled events, a realistic export fixture.
- `csv` — quoting, semicolons, `DD/MM/YYYY`, unknown types.
- `plan` — course matching by code, new courses, the 12-meeting cap, duplicates.
- `reviews` — lecture dates across a week boundary, id length ≤ 24 and stability,
  watermark advance, chain dates, step 4 stops.
- exam topics — window from previous exam / term start, de-duplication, the 50 cap.

No Worker or D1 change, so the API tests are unaffected; `npm test` must stay green.
