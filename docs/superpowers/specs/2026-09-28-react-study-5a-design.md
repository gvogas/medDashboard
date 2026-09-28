# React Study, part 5a: the history, achievements and the leaderboard

The first half of stage 5 (resume plan: `docs/superpowers/plans/2026-09-27-react-migration.md`).
The Study page moves into React as a two-column dashboard; its history becomes one card with
Week / Month / Term tabs. The timer half (the start panel, the flow, the flip clock, the focus
screen, the corner dock) stays legacy until 5b, drawn into a slot React leaves for it.

## Decisions

- **React owns the Study page**, in `#views` like the week, month and table. The legacy code
  draws only the start panel and the flow, into `#studyTimer`, a slot React renders once (as
  the sidebar does for the Spotify player). 5b replaces the slot's contents; nothing else moves.
- **A dashboard in two columns.** The tiles across the top; left: the timer slot, then the
  leaderboard; right: the History card, then achievements. Under 900px one column: tiles,
  timer, History, achievements, leaderboard. Every panel is a Texture card.
- **One History card** replaces the Week panel, the Term panel and the Sessions panel. Its
  tabs are Week, Month and Term.

## Components (`src/components/study/`)

### `study-view.tsx` — `<StudyView>`

The layout, the tiles and the slot. `<Views>` shows it when `ui.view === "study"` and the focus
screen is not up. The slot (`<div id="studyTimer">`) is rendered once and never redrawn by
React; after it mounts, and on each redraw, the legacy `renderStudyTimer()` fills it.

### `tiles.tsx` — the three tiles

- **Streak:** the flame, "N days", "Longest N · a day counts from N min", and "· study today
  to keep it" while today does not count yet and there is a streak.
- **Today:** the goal ring and "1h 05m of 2h 00m", "N min to your daily goal" or "Daily goal
  reached"; with no goal, the calendar icon and **Set a daily goal** (Settings at the goal).
- **This term** (or "Last 12 weeks" with no term start): the total, "N sessions since 1 Sep".

### `history.tsx` — the History card

- **Head:** "History"; the tabs **Week / Month / Term** (a `Segmented`); ‹ and › for the
  week or month shown, with the range ("14 – 20 Sep", "September 2026"), › disabled at the
  current one, and **This week** / **This month** when away from it; no arrows on Term;
  **+ Log study** (`openSession(null)`). The tab is kept in `ui.hist.tab` for the session.
- **Week:** the total and "in N sessions · 20m more than the week before"; the bar chart,
  one bar a day split by course, future days faint, today's label marked, the goal line
  ("2h 00m goal"); the course bars; then the week's sessions, newest first. With none:
  "No study logged this week."
- **Month:** the stats (studied, sessions, days studied "12/28", a day on average); the
  calendar, Monday first, each past day a button with its total, its course split, its level
  tint and a tick when the goal was met, `aria-pressed` on the picked day; under it the
  picked day's sessions ("Tue 22 Sep · today", "1h 05m · 2 sessions"), or "Nothing logged
  this day." with **Log study**. The picked day: the one chosen, else today in this month,
  else its latest study day.
- **Term:** the heatmap from the term start (or the last 12 weeks), Monday to Sunday rows,
  month labels, level tints, today marked; the legend "Click a day to see its sessions ·
  Less … More"; the course bars under "By course". A day is a button: it switches to Month
  on that month with the day picked, and scrolls the day's sessions into view. A screen
  reader line says on how many days you studied.
- **A session row:** the day (Week only) and start time, the course chip, the item's title
  or the course name, the note or "N rounds", the length, "Timer" or "By hand", ✎ Edit
  (`openSession(id)`) and ✕ Delete (`deleteWithUndo(id)`).
- **Undo:** with a delete waiting, the card's foot says "Deleted ANAT · 45m from Tue 22 Sep."
  with **Undo**, on any tab, until it is final (six seconds, another delete, or leaving the
  page, as now).

### `achievements.tsx` — the Achievements card

- **Head:** "Achievements", "N of M", the progress bar.
- **Next up:** the three badges closest to done (`nextUp`), each with its progress and bar.
- **The groups** (Study hours, Streak, Big days, Tasks done, Exams, Grades), each with its
  icon and "N / M", as medals: earned filled with a tick and the date; locked hollow with a
  ring for how far along, and the percent (a grade's progress for Grades). Each medal has
  `id="ach-<id>"` and its title and blurb as a label.
- **Your own:** each sticker a button (`openAchievement(id)`), tilted by its id when earned,
  grey until then, its name and date or progress; with none, the line about making one;
  **+ New** (`openAchievement(null)`), disabled at 30 with "30 is the most".
- Two groups to a row in the right column, one when narrow.
- The unlock toast's **See** scrolls to the medal and pops it (`showAchievement` in
  `study-controller.js`, unchanged).

### `leaderboard.tsx` — the Leaderboard card

- **Not joined:** "See who has studied the most this week. …" and **Join the leaderboard**.
- **Joined:** **This week / All-time** (`ui.lbTab`); "14 – 20 Sep · Resets Monday" or "Since
  each person started · N people"; the ranked list (ties share a rank, 1–3 medals when above
  zero, "you" on your row, a bar, hours to one decimal under 100); "Counts logged study time"
  and **Leave the leaderboard**. Join and Leave are disabled while busy; focus goes to the
  other one after.
- **Loading…**, the offline line, the load error, and "That did not go through. Try again
  when you are online." as now.

## Data (`src/data/`)

- **`study.ts`** — `studyTiles(sessions, prefs, termStart, today)`, `weekOf(sessions, offset,
  today)` (the week, the week before's total, the course bars), `monthOf(sessions, offset,
  focusDay, today)` (the stats, the cells, the picked day), `termOf(sessions, prefs,
  termStart, today)` (the heat cells, the month labels, the course bars), `shownSessions`
  (all but the one waiting on Undo); memoized on the sessions list, the prefs and the
  bridge version. Actions: `setHistTab`, `stepHist(dir | 0)`, `pickDay(date)` (Month on
  that day), `undoSessionDelete`. `history.js` stays the arithmetic.
- **`leaderboard.ts`** — `loadLeaderboard()`, `joinLeaderboard(join)`, `setLbTab`,
  `lbRows(lb, tab, sessions, now)` (your row from this device, sorted, ranked), and
  `useLeaderboard()`. It loads when the Study page mounts and the totals are missing or
  over a minute old.
- **`store.ts`** — `useAchievements()`.
- **`ui.hist`** gains `tab: "week" | "month" | "term"` in place of `range`.

## Removed

`legacy/js/views/achievements.js`, `views/leaderboard.js`; in `views/study.js` everything
but the start panel, the flow, the focus screen's clock side and the per-tick paint
(`renderStudy` becomes `renderStudyTimer`, drawing into `#studyTimer`); `render.js` no longer
draws the Study view into `#viewRoot`. In `study-controller.js`: the `data-hist-*` and
`data-study-sessdel` clicks, `showDay`, `undoDelete` (moved to `study.ts`). In `main.js`:
`leaderboardClick`. CSS only the removed panels used (`.st-tiles`, `.st-week`, `.st-term`,
`.st-sess`, `.mcal`, `.hmap`, `.st-ach`, `.ach-*`, `.st-lb`, `.lb*`, …), keeping what the
start panel, the flow, the focus screen, the dock and the toast's sticker still use.

## Testing

- **Pure:** the tiles (streak text, goal left, term since); `weekOf` (totals, the comparison,
  the goal line's height); `monthOf` (stats, the picked day's fallbacks); `termOf` (cells from
  the term start, the 12-week fallback, levels); `lbRows` (your row from this device, ties,
  medals only above zero).
- **jsdom:** the page shows the tiles, the slot, the three cards; History's tabs and arrows
  (› disabled at the current week); a heatmap day opens Month on it; a session's ✎ opens the
  session sheet and ✕ shows Undo, which brings it back; + Log study; achievements (+ New
  disabled at 30, a sticker opens its sheet, `id="ach-…"` present); the leaderboard's
  not-joined, joined (tabs, ranks, "you"), busy and error states, Join and Leave calling the
  API.
- Legacy tests of the removed code move or go; `npm run check` passes.
- **Browser pass:** Med and CS, light and dark, desktop and phone width: the dashboard, each
  History tab, a session edited, deleted and undone, a heatmap day, achievements and the
  See toast, the leaderboard; start a run and stop it (the slot still works).

## Build order

One commit each on `re`:

1. The data modules and their tests; `useAchievements`; `ui.hist.tab`.
2. The Study page and its cards; the legacy panels and their routing removed; the timer slot.
3. CSS cleanup, browser pass and fixes; the plan marks 5a done and 5b next.
