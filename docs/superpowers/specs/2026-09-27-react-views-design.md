# React views: week, month, table and the stat tiles

Stage 3 of the move to React (roadmap and the Texture look:
`2026-09-27-react-foundation-design.md`; the shell it builds on:
`2026-09-27-react-shell-design.md`; the look: `design/mockup-react-texture.html`).
React takes over the stat tiles and the week, month and table views. Spotify, Study and the
focus screen stay legacy (stages 5–6); the drawers stay legacy (stage 4), so clicking an
item still calls the legacy `openItem`.

## Decisions

- **Five stat tiles, as in the mockup:** Next exam / quiz, Open assignments, Overdue,
  Study today, Quote. Class hours and Lab hours are dropped.
- **Schedule tabs** Everything / Deadlines / Classes on the week and the month, one shared
  setting. They replace the month's Deadlines toggle.
- **The week as the mockup draws it:** a date column, then the day's classes and items in
  one time-sorted list.

## Mounting

`index.html` gets `<div id="views"></div>` beside `#viewRoot`. `main.tsx` mounts
`<Stats>` in `#stats` and `<Views>` in `#views`. Each container has one owner:

- `<Views>` reads `useUi((u) => [u.view, u.focus])` and renders `WeekView`, `MonthView` or
  `TableView` for those views, nothing otherwise (and nothing while focusing). `#views`
  gets `hidden` when it renders nothing.
- The legacy `drawView` handles only Spotify, Study and the focus screen. For week, month
  and table it hides `#viewRoot`, clears it and returns; for the others it shows it. It no
  longer toggles `#stats`.
- `<Stats>` renders nothing on Spotify, Study and the focus screen; `#stats` gets `hidden`
  then.
- `render()` stops calling `renderStats`. The table's own-scroll class moves to `#views`
  (set by `<Views>` for the table).

## Data (`src/data/`)

- **`store.ts`** gains `useQuotes` and `useStudySessions`, built like `useItems`.
- **`types.ts`** gains `Quote`, `StudySession`, and on `Ui`: `schedule`, `sort`,
  `quoteIx`.
- **`views.ts`** — pure selectors, moved into TypeScript from `query.js`, `views/*.js` and
  `stats.js`. Each takes the collections and the filter state and returns plain objects;
  none touches the DOM:
  - `weekDays(items, courses, ui, cal, today)` → 7 days, each `{date, isToday, info,
    entries}` where `entries` is classes and item instances merged and sorted by start
    time (untimed items last), filtered by `ui.schedule`. Empty days are dropped while a
    search is on, as today.
  - `officeHours(...)`, `tasks(...)` — as `week.js` computes them (tasks: open first, then
    by date, 9 shown, open count).
  - `monthCells(...)` → 42 cells `{date, out, isToday, info, chips, more, off}`, 4 chips a
    cell with "+N more", deadlines per `ui.schedule`, weekly items and office hours never
    on the grid. `timetable(...)` → the weekly timetable columns with hours per day.
  - `tableRows(items, courses, ui)` → filtered and sorted rows.
  - `stats(items, courses, sessions, prefs, today)` → the tile numbers (below).
  - A hook, `useViewData`, memoizes each selector on the collection references and the ui
    version, so `getSnapshot` never loops.
  `query.js` keeps `instances`, `classes`, `passFilters` and `matchSearch` for the legacy
  code still using them; the TypeScript versions call the same `occurrences`, `dayInfo`,
  `classWeekday` helpers from the legacy modules rather than copying them.
- **`actions.ts`** gains: `openItem(id)`, `newItemOn(date)`, `toggleTask(id, el)` (the
  celebration, `setStatus`, `touch`, `chainReview`, then `render()`), `quickAddTask(title)`,
  `goToDay(date)` (anchor, view week, `rememberUi`), `setSchedule(tab)`, `sortTable(key)`,
  `nextQuote(el)` (fireworks; opens Settings at `qText` when there is nothing to rotate
  to), `openStudy()`.

### The schedule setting

`ui.schedule: 'all' | 'deadlines' | 'classes'`, default `'all'`, saved by `rememberUi`
in place of `monthDeadlines`. On load, a saved `schedule` wins; otherwise a saved
`monthDeadlines: false` becomes `'classes'`. `ui.monthDeadlines` is removed.

## Components (`src/components/views/`)

All panels are `TextureCard`s. Colours come from the type's or course's accent, as the
sidebar does now.

### `stats.tsx` — `<Stats>`

1. **Next exam / quiz** — days to go (Today / Tomorrow / N days), the ECG line (Med) or the
   clock signal (CS), the type chip, title and prep-pace line (`prepPace`, `prepLabel`). Hot
   when there is one. Click opens the item. "Nothing scheduled" otherwise.
2. **Open assignments** — the count; foot "N due this week" (Monday to Sunday of the
   current week), or "none this week".
3. **Overdue** — the count; hot above zero with "needs attention today"; at zero the
   number is green with "All caught up".
4. **Study today** — minutes today of the daily goal as a meter, and the streak ("🔥 N-day
   streak", hidden at 0), from `history.js` `minutesByDay` and `streak` with the study
   prefs, as the Study view reads them. No goal: the minutes and a "Set a daily goal"
   foot. Click goes to the Study view.
5. **Quote** — text and source, "i / n" when there are several. Click shows the next with
   the rise animation (on a real change only) and fireworks; with none, "Add a quote to
   keep here" and a click opens Settings at the quote field. The index stays in
   `ui.quoteIx`, wrapped when quotes are deleted.

At phone width the tiles are one row that scrolls sideways with scroll-snap, fixing the
overflow.

### `week.tsx` — `<WeekView>`

- **Schedule card:** header "Schedule", the count, the tabs (a segmented control with
  `aria-pressed`), the helix / data-bus rule. Seven days, Monday first. Each day: a date
  column (day, date, Today tag, school tags from `schoolTags`' rules, a + button labelled
  "Add item on …") and the entry list. Classes: dashed cards with time, course name, room.
  Items: raised buttons with the colour bar, title (struck when a completed task), meta
  (course · room · time · weekly), the checklist bar, the type chip and the status or
  Today/Soon chip, dimmed when complete. "Nothing due" on an empty day; school days off,
  breaks and exams get their tint. Empty states: "No matches this week" / "Nothing here
  yet", as today.
- **Office hours card:** as today, the first row marked with the mini scope / prompt icon;
  rows open the item.
- **Tasks card:** checkboxes (`aria-pressed`, labelled "Done: …"), titles that open the
  item, the date or "overdue", the quick-add input (controlled; Enter adds, keeps focus,
  clears), the steroid / binary-tree corner art.

### `month.tsx` — `<MonthView>`

The tabs in the header (title: "Classes and deadlines", "Deadlines" or "Class schedule"),
the week range from the school calendar, the class count. The 6×7 grid: cells are buttons
with the existing aria-label; deadline chips then class chips; "+N more"; "N classes off";
out-of-month dimmed; today marked. A click goes to that week. Below, the weekly timetable
(Mon–Sat, Sunday only if a class lands there); a card click opens the course.

### `table.tsx` — `<TableView>`

"All items, N shown of M". Sortable headers are buttons with `aria-sort` on the `th`; the
same key flips the direction. Rows are focusable and open the item on click, Enter or
Space. Columns and cells as today. The table scrolls on its own. Below 640px the rows are
stacked cards (title, chips, date and time, where).

### Shared

`bits.tsx`: `TypeChip`, `StatusChip`, `Steps` (the checklist bar), `ClassCard`,
`SchoolTags`, and `onActivate` (Enter/Space on a non-button element). The legacy `bits.js`
keeps what the drawers use.

## Removed

`views/week.js`, `month.js`, `table.js`, `stats.js`; `renderQuote`/`nextQuote` callers
(Settings' quote delete calls `notify()`); the `main.js` click branches for
`data-quotenext`, `data-add`, `data-toggle`, the row/task/office-hours open,
`data-monthdeadlines`, `data-day`, `data-sort`; the `quickTask` handler in `keyboard.js`;
the refresh-after-sync hold for the quick-task input; the legacy CSS for these views; the
unused parts of `bits.js`. `test/legacy-classes.node.mjs` loses the removed classes.

## Testing

- **Selectors** (Vitest, no DOM): week grouping and time order, untimed last; each tab;
  school days (off, break, swap); search dropping empty days; office hours order; tasks
  order and cap; the 42 month cells, "+N more", classes off, weekly items kept off; table
  sort both ways on each key; stats: next exam tie-break on start, open-this-week, overdue,
  goal meter, streak, quote wrap.
- **Components** (jsdom, Testing Library, like `top-bar.test.tsx`): render with seeded
  data; item click → `openItem`; +, task checkbox, quick-add Enter, month cell, table
  header, quote tile each call their action; tabs switch and persist; empty states; stats
  and views hidden on Spotify and Study; the migration from `monthDeadlines`.
- Legacy tests of the removed views are moved or deleted. `npm run check` passes.
- Browser pass: Med and CS, light and dark, desktop and phone width; focus stays on a
  ticked task and on the quote tile after a redraw.

## Build order

One commit each on `re`:

1. Hooks, types, selectors and actions, with tests.
2. `<Stats>`; `stats.js` removed.
3. `<WeekView>`, the schedule setting and its migration; `week.js` and the quick-task code
   removed.
4. `<MonthView>`; `month.js` removed.
5. `<TableView>`; `table.js`, the leftover CSS and click branches removed.
6. Browser pass and fixes; the migration plan's stage table updated.

Steps 3–5 depend only on 1 and can run as parallel sub-agents in worktrees created from
`re`.
