# React drawers, part 4c: sessions, achievements, the overlays, and the end of #drawer

The last part of stage 4 (the split and the sheet: `2026-09-27-react-drawers-4a-design.md`;
Settings: `2026-09-27-react-drawers-4b-design.md`; resume plan:
`docs/superpowers/plans/2026-09-27-react-migration.md`). The study-session and achievement
drawers move into the React sheet; the shortcuts panel and the AI busy screen become React
overlays; then the legacy `#drawer` and what only it used are removed.

## Decisions

- **Deletes go straight to Undo**, as items and courses do since 4a: a session to the
  Study view's own Undo (the session hidden from the history, Undo shown there), an
  achievement to the Undo toast. The "Delete …?" footer question goes, and with it
  `confirmFoot` and `ui.confirm`.
- **The overlays get their own root** (`<Overlays>` in a new `#overlays`, outside `#app`),
  and keep using `cover()` so everything beneath is inert while one is up.

## Sheet kinds (`src/data/overlay.ts`)

`SheetState` gains `{ kind: "session", draft: SessionDraft }` and
`{ kind: "achievement", draft: AchievementDraft }`. With the legacy drawer gone,
`onLegacyClose` and `legacyDrawer` go; `settle()` handles `#app`, `#sheet` and the covers.
The scrim belongs to the sheet and the phone sidebar.

## Components

### `sheet/session-sheet.tsx` — Log study / Edit session

- **Head:** "Log study" or "Edit session", "recorded by the timer" or "logged by hand", ✕.
- **Body:** for a new session, the lead line ("Time away from the timer: the library, Anki
  on your phone, a study group. It counts toward your streak and goal like a timer
  session."). Fields: **Day** (date, up to today), **Started** (`TimeField`), **How long**
  (1–720 minutes, focused on open) with quick buttons 15m, 25m, 30m, 45m, 1h, 1h 30m
  (pressed when they match), **Course** (live courses, plus the session's own if archived;
  "No course" when its course is gone; changing it clears the item), **For** ("Nothing in
  particular" and the course's open items, plus the session's own), **What you covered**
  (optional, 200). The impact line (`role="status"`) as typed.
- **Foot:** "Ready to log" / "Unsaved changes" / "Not ready yet"; **Delete** (existing) —
  closes the sheet and calls `deleteWithUndo`; **Cancel**; **Log 30m** / **Save** in the
  study colour, disabled until valid. Saving keeps the session's other fields (rounds, the
  manual flag) and closes the sheet.

### `sheet/achievement-sheet.tsx` — New / Edit achievement

- **Head:** "New achievement" or "Edit achievement", ✕ (the gold accent).
- **Sticker:** without a crop in progress, the sticker (88px) or a "?" placeholder and
  **Upload a picture** / **Change picture** (a file input for images) with its note.
  Picking a file reads it (`sticker.js` `readPicture`; unreadable: "That picture could not
  be read. Try a JPG or PNG.") and starts the crop: a 208px canvas drawn by `drawSticker`,
  moved by dragging (pointer capture) or the arrow keys (12px) through `dragCrop`, a
  **Zoom** slider (1–3); **Cancel** drops the picture, **Use this** cuts it with
  `stickerData` (too detailed: the existing toast) and focuses Name. The picture lives
  only in the component.
- **Fields:** **Name** (40, "20 hours on Neuro"); **Earned when** — two buttons, *Study
  hours* on one course / *A grade* on one exam or quiz (switching sets 10 hours or 90, and a
  course if none); for hours, **Course** and **Hours** (1–1000); for a grade, **Exam or
  quiz** (the tests in date order, "Exam removed" when its item is gone) and **Grade**
  (1–100) "or more". The standing line (`role="status"`) from `ownAchievements`.
- **Foot:** "Finish the crop first" / "Upload a sticker" / "Give it a name" / "Ready to
  add" / "Unsaved changes" / "Not ready yet"; **Delete** (existing; `deleteLater`, the Undo
  toast); **Cancel**; **Add** / **Save** in the study colour, disabled until valid.
- Opening a new one at 30 achievements shows "You have 30 achievements, the most there can
  be." and opens nothing.

### `overlays.tsx` — `<Overlays>`

- **Shortcuts:** a Texture card over the dimmed page, `role="dialog"`, labelled
  "Keyboard shortcuts": n New item; t Go to today; [ ] Previous / next week or month;
  1 – 5 Week, Month, Table, Spotify, Study; / Search; ? Show this list; Esc Close a drawer
  or leave the focus screen; "Shortcuts are off while you type in a field." Opened by ?
  and Settings' button; closed by ?, Esc, ✕ or a click outside; focus goes to ✕, and back
  to where it was (or its successor) on close.
- **Busy:** `role="alertdialog"`, labelled by its title ("Uploading your course" / "Reading
  your school calendar"): the spinner, the file name, the stage (`aria-live`), "Please wait
  and keep this tab open. It usually takes 10 to 30 seconds.", and the seconds so far. It
  takes focus and gives it back to the sheet when it goes.

## Data (`src/data/`)

- **`session-edit.ts`** — `newSession(courseId?)`, `sessionDraft(session)`,
  `startedAtOf(draft)`, `validSession`, `impact(draft, sessions, prefs, today)`,
  `saveSession(draft)`; `openSession(id | null, courseId?)` in `actions.ts`.
- **`achievement-edit.ts`** — `newAchievement(courses)`, `validAchievement`, `standing`,
  `footHint`, `switchRule`, `saveAchievementDraft`; `openAchievement(id | null)` and
  `deleteAchievement(id)` in `actions.ts`.
- **`ai-read.ts`** — `readWithAi` (moved from `views/busy.js`, with its error messages),
  and the busy store `useBusy()` the overlay reads. `pdfText` stays in
  `legacy/js/pdftext.js`.
- **`keys.ts`** — `openKeys`, `closeKeys`, `keysOpen`, `useKeys()`; `keyboard.js` and the
  Settings button use them.
- **`sidebar.ts`** — `setSide` and `narrow`, moved from `drawer-base.js`: the phone sidebar
  (`.on`, `inert` on it and on `.content`, the scrim when no sheet is open, `notify()`).

## Removed

`legacy/js/views/drawer-session.js`, `drawer-achievement.js`, `drawer-base.js`, `bits.js`,
`keys.js`, `busy.js`, `legacy/js/timepicker.js`; `#drawer` in `index.html`. In `main.js`:
the `data-act` handling, `achievementClick`, the `sd`/`ach` inputs, the drawer's
`restoreFocus` fallback and the scrim listener (the sheet and `sidebar.ts` handle it). In
`study-controller.js`: `openSession` and `data-sd-mins`; `data-ach-new` and `data-ach-edit`
clicks call the actions. `keyboard.js`: Escape closes the sheet or the sidebar, and
`drawerOpen()` becomes `getSheet() !== null`. `state.js`: `confirm`, `sessionDraft`,
`achDraft`. CSS: the drawer (`.drawer`, `.dhead`, `.dbody`, `.dfoot`, `.fields`, `.dsec`,
`.btn` in the drawer, `.icon-btn` where unused, `.tp`, `.tp-pop`), the session and
achievement drawers (`.sdraw`, `.adraw`, `.ach-*`, `.crop-*`, `.stk*`, `.quick`,
`.sd-hint`), `.keys*` and `.busy-*`. `test/timepicker.test.js` keeps testing
`src/lib/time.ts`.

## Testing

- **Pure:** `validSession` (minutes 1–720, a day up to today, a time); `impact` (today's
  goal, another day, the streak going up, the streak kept); `startedAtOf`;
  `validAchievement`, `footHint`, `switchRule`, `standing`.
- **Session sheet** (jsdom): opens with How long focused; quick buttons set the minutes and
  press; a course change clears the item; the impact line follows; Save stores it with the
  base's fields kept; Delete calls `deleteWithUndo`.
- **Achievement sheet:** rule switch sets the target; the crop flow with `sticker.js`
  mocked (pick, zoom, arrow keys, Use this, Cancel); Save disabled mid-crop and without a
  name or sticker; the limit toast; Delete calls `deleteLater`.
- **Overlays:** shortcuts open and close with ?, Esc, ✕ and a click outside, `#app` inert
  while open, focus back after; busy shows and counts, gives focus back, and `readWithAi`
  puts the error in the note.
- Legacy tests of the removed code move or go; `npm run check` passes.
- **Browser pass:** log a session, edit it, delete it and Undo; create an achievement from
  a local picture with a crop, delete it and Undo; the shortcuts panel; the phone sidebar
  and scrim. The busy screen only if an AI read is worth spending.

## Build order

One commit each on `re`:

1. The data modules and tests; the sheet kinds; `overlays.tsx`, `ai-read.ts`, `keys.ts`,
   `sidebar.ts`.
2. The session and achievement sheets; their drawers removed.
3. `#drawer`, `drawer-base.js`, `bits.js`, `keys.js`, `busy.js`, `timepicker.js` removed;
   the CSS; the plan marks stage 4 done and stage 5 next.
