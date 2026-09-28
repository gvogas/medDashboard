# React drawers, part 4a: the sheet, the item and the course

Stage 4 of the move to React (roadmap: `2026-09-27-react-foundation-design.md`; resume
plan: `docs/superpowers/plans/2026-09-27-react-migration.md`) is split in three:

| Part | Moves to React |
|---|---|
| **4a** (this spec) | The sheet container; the item and course drawers; the time picker; date fields |
| 4b | Settings with its tabs; the import and school calendar drawers |
| 4c | The session and achievement drawers; the shortcuts panel and busy screen; the legacy `#drawer` removed |

Until 4c, drawers not yet moved keep the legacy `#drawer`. The look is the Texture sheet in
`design/mockup-react-texture.html`.

## Decisions

- **Status is a row of buttons** (the type's 2–3 statuses), not a dropdown.
- **Date stays the browser's date field**, styled; no calendar popover.
- **Delete goes straight to the Undo toast** for items and courses; the "Delete …?" footer
  question is dropped. A course deleted this way unfiles its items as before; Undo brings
  it back. The course's "Discard your changes?" question stays: a course saves only on Save.
- **The container is our own**, on `inert`, not Radix Dialog: it shares one mechanism with
  the legacy drawer and overlays while they coexist.

## Overlays and focus (`src/data/overlay.ts`)

The bookkeeping in `legacy/js/views/drawer-base.js` moves here, so both containers use one
source of truth:

- `cover(on)` — an overlay (shortcuts, busy card) opens or closes above everything.
- `settle()` — sets `inert` on `#app`, the legacy `#drawer` and the React `#sheet` from what
  is open: with a cover up, everything below it is inert; with a drawer or sheet open,
  `#app` is inert; a closed drawer or sheet is inert itself.
- `useSheet()` / `sheet` — what the React sheet shows: `null`, `{kind: "item", id}`,
  `{kind: "new-item", draft}` or `{kind: "course", id: string | null}`.
- Opening the React sheet closes the legacy drawer (running its `beforeClose` and
  `resetDrawerState`), and opening a legacy drawer (`showDrawer`) closes the React sheet
  after flushing its pending save.
- The legacy `drawerOpen()` returns true while the React sheet is open, so shortcuts stay
  off and the study controller behaves as it does with a drawer.
- `drawer-base.js` keeps `showDrawer`, `hideDrawer`, `closeDrawer`, `resetDrawerState`,
  `setSide` and the scrim for the legacy drawers, calling into `overlay.ts`. The scrim is
  shared: a click closes whichever is open.

## Components (`src/components/sheet/`)

### `sheet.tsx` — `<Sheet>`

Mounted by `main.tsx` in a new `<div id="sheet">` in `index.html`. A floating Texture sheet
on the right (full height against the right edge on phones), over the blurred scrim.
`role="dialog"`, `aria-modal`, labelled by the kind ("Assignment", "New course"). Escape
and a scrim click close it, except that an open time-picker popover takes Escape first.
Opening focuses the title for a new item or course, else the sheet; closing returns focus
to the opener, or its successor if a redraw replaced it. Closing runs the item sheet's
flush first.

### `item-sheet.tsx`

- **Head:** type chip, status or Overdue chip, countdown ("today", "in 3 days", "2 days
  ago", "every Tue"), the prep chip for an open exam or quiz with topics, ✕.
- **Title:** auto-growing textarea (max 140), "What is it called?" when new. Below, when
  the course has classes: "ANAT meets Mon 0900 · Hall B" and an "Edit course" link that
  opens the course sheet.
- **Fields:** Type (visible types plus the current one), Course (live courses, or none),
  Date, Time (start and end `TimeField`s; moving the start moves the end by the same
  amount, measured from the times when the start field took focus), Room (max 80),
  Status (segmented; the type's statuses), Weight (gradable types), Grade (when graded),
  Studied (minutes studied for it, when any), and for office hours and tutorials:
  Repeats weekly on the date's weekday, Until, and Dept (office hours).
- **Kept rules:** picking a course or type fills the title for office hours ("Dr. X —
  office hours"), exams ("Exam — Course"), quizzes and tutorials, unless the title was
  typed by hand; an exam or quiz on a class day takes that class's room unless one was
  typed; a status the new type lacks goes back to its first; finishing celebrates from
  the pressed button and books the next spaced review.
- **Notes** (max 5000). **Checklist**, titled Topics for exams and quizzes: done count, the
  pink progress bar, each step with a tick, editable text and ✕; "Add a step, press
  Enter"; "Fill topics from lectures" for an exam or quiz whose course has lectures, with
  its note. **Links:** only `http(s)` URLs are links (others are plain text); add with a
  label and a URL, Enter; ✕ removes.
- **Footer:** new — "Give it a name to save" / "Ready to save", Cancel, Save item (disabled
  without a title). Stored — "Edits save as you type", Delete, Done. Delete closes the
  sheet and calls `deleteLater` (the Undo toast).
- **Saving:** a new item is a draft in memory until Save. A stored item saves as it is
  edited: title, notes and room 400 ms after typing pauses, everything else at once, since
  the end follows the start and the weekday the date and those must save together.
  Leaving a text field or closing saves at once. A sync that reloads the item keeps a
  value still waiting to save. If the item disappears (deleted on another device), the
  sheet closes.

### `course-sheet.tsx`

- **Head:** "Course" / "New course", the code chip in the course colour, hours a week, ✕.
- **Fields:** Name (auto-growing, max 80), Code (max 8), Teacher (60), Term (40), Colour
  (swatches with `aria-pressed`, the colour's name beside them), Archived (existing
  courses: "hidden from the sidebar, items kept").
- **Classes:** kind, day (Mon–Sun), start and end `TimeField`s, room (40), ✕; "+ Add a class"
  (Lecture, Mon 0900–1000); at twelve, "Twelve classes is the most a course can hold."
  "No classes yet — add the first one below." when empty.
- **Grades** (existing courses with weighted items): current weighted average, the meter,
  what the rest needs for 50/60/70 or the target ("secured", "out of reach"), the target
  field (1–100), What if… scores for ungraded items (never saved, cleared on close), and
  "Weights add up to N%, not 100." The grade maths stays in `legacy/js/grades.js`.
- **Warning** when items are filed under it: "N items are filed under this course.
  Deleting it leaves them without a course."
- **Footer:** "Give it a name to save" / "Ready to save" / "Unsaved changes"; Delete
  (existing; straight to the Undo toast, and the course filter goes back to All if it was
  this course), Cancel, Save course (disabled without a name; a missing code becomes the
  name's first four letters). With unsaved changes, ✕, Escape and the scrim ask "Discard
  your changes to X?" with Keep editing and Discard; asked, a second Escape or scrim
  click discards.

### `time-field.tsx` — `<TimeField>`

A text input holding HH:MM. Typing "830", "8:30", "8pm" lands on a valid time when it
leaves the field; a value that does not parse gets a red outline and is not saved. Focus
opens a popover of quarter hours with the nearest one highlighted; ↑/↓ nudge by fifteen
minutes; Enter or Escape confirms and closes. `parseTime` and `stepTime` move to
`src/lib/time.ts`; `legacy/js/timepicker.js` re-exports them and keeps its DOM wiring for
the legacy session drawer until 4c.

### `fields.tsx`

Texture-styled `Field` (label and control on the drawer's two-column grid), `Select`,
`TextInput`, `NumberInput`, `DateInput`, `Segmented`, `Checkbox`, `Swatches`, `TitleArea`
(auto-growing). 4b reuses them.

## Data (`src/data/`)

- **`item-edit.ts`** — from `drawer-item.js`: `touch`, `touchSoon`, `flushTouch` (the
  400 ms typing save and the held value), `setStatus`, `celebrate`, `chainReview`,
  `autoTitleFor` / `autoTitle`, the room rule, `countdown`. `main.js`, `keyboard.js`,
  `study-controller.js` and `actions.ts` import these from here.
- **`course-edit.ts`** — `courseChanged`, `saveCourseDraft`, the new-course defaults.
- **`actions.ts`** — `openItem`, `newItem`, `newItemOn`, `openCourse` open the React sheet;
  `closeSheet`, `deleteItem`, `deleteCourse` (both through `deleteLater`), `fillTopics`.

## Removed

`legacy/js/views/drawer-item.js` and `drawer-course.js`; in `main.js`, the `data-act`
branches `close`/`cancel`/`save`/`delete`/`keep`/`delete-yes`/`addmtg`/`course-save`/
`course-delete`/`course-delete-yes`/`fill-topics`, the `data-cl`, `data-clx`, `data-linkx`,
`data-color`, `data-mx`, `data-editcourse` clicks, the item and course `input` routing
(`data-f`, `data-cf`, `data-mf`, `data-whatif`, `data-cltext`), `noteStartBase`, and the
`focusout` flush; in `keyboard.js`, the checklist and link Enter handlers and the item and
course title Enter; `sync-status.js`'s `renderItemDrawer` call. `confirmFoot` and
`CHECK_SVG` stay in `bits.js` while the session drawer uses them. Legacy CSS used only by
the item and course drawers goes; rules the remaining drawers share (`.dhead`, `.dbody`,
`.fields`, `.dfoot`, `.btn`) stay until 4c.

## Testing

- **Pure** (Vitest): `parseTime` and `stepTime` (existing cases, moved); auto-title and
  auto-room; the status reset on a type change; `countdown`; `courseChanged`.
- **Sheet** (jsdom): opens and closes with ✕, Escape and the scrim; `#app` inert while
  open; focus returns to the opener; the React sheet and the legacy drawer close each
  other; `drawerOpen()` is true while the sheet is open.
- **Item sheet:** a title typed saves after the pause and at once on close; a reload
  mid-typing keeps the typed text; a status button saves, and done celebrates and books a
  review; moving the start moves the end; checklist add, tick, edit, remove; links add and
  remove, only `http(s)` clickable; a new item cannot save without a title; Delete calls
  `deleteLater`.
- **Course sheet:** edits stay in the draft until Save; Cancel with changes asks, a second
  Escape discards; classes add and remove, capped at twelve; what-if scores change the
  projection and are not saved.
- **Time field:** typing, picking, ↑/↓, Escape, the red outline.
- Legacy tests of the removed code are moved or deleted; `npm run check` passes.
- Browser pass: Med and CS, light and dark, desktop and phone; add, edit and delete an
  item and a course and Undo each; open Settings (legacy) right after the item sheet and
  back, to check the hand-over.

## Build order

One commit each on `re`, in order (2 and 3 both change `main.js` and `actions.ts`):

1. `overlay.ts` with the legacy drawer moved onto it; `<Sheet>` and `useSheet`;
   `fields.tsx`; `time-field.tsx` and `src/lib/time.ts`.
2. The item sheet and `item-edit.ts`; `drawer-item.js` and its routing removed.
3. The course sheet and `course-edit.ts`; `drawer-course.js` and its routing removed.
4. CSS cleanup, browser pass and fixes; the migration plan marks 4a done and 4b next.
