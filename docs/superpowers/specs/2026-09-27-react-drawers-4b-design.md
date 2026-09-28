# React drawers, part 4b: Settings, import and the school calendar

Part 4b of stage 4 (the split and the sheet: `2026-09-27-react-drawers-4a-design.md`;
resume plan: `docs/superpowers/plans/2026-09-27-react-migration.md`). Settings with its
tabs, the import preview and the school calendar review move from the legacy `#drawer`
into the React sheet. Afterwards the legacy drawer holds only the session and achievement
drawers, which 4c moves.

## Decisions

- **Settings keeps its four tabs** (You, Study, Spotify, Account) and their groups. Deep
  links still open the right tab at the right field.
- **Questions stay where Undo cannot help:** turning the calendar feed off or making a new
  link, removing the school calendar, and signing out with unsynced edits.
- **The import preview and the school calendar review stay separate sheets**, opened from
  Settings; Cancel goes back to Settings.
- **The busy screen stays legacy until 4c.** It covers everything through `overlay.ts`
  (`cover`), so it layers over the React sheet as it does over the drawer.

## Sheet kinds (`src/data/overlay.ts`)

`SheetState` gains:

- `{ kind: "settings", tab: SettingsTab, focus: string | null }`
- `{ kind: "import", plan: ImportPlan, name: string }`
- `{ kind: "school", draft: SchoolDraft }`

`openSettings(focus?)` opens Settings on the tab the focus lives on (`o-name`, `qText` →
You; `goalGrp`, `importGrp`, `schoolGrp` → Study; `spotifyGrp` → Spotify), else the last
tab used (`ui.settingsTab`). `toggleSettings()` closes it if it is open. `ui.settings`
goes; everything that asked it asks `getSheet()?.kind === "settings"`.

## Live data

- Profile, quotes, sync status and the UI state (theme, background): the existing hooks.
- **`useConflicts()`** in `store.ts`: `store.conflicts`, woken by `store.subscribe` as the
  collections are (the store replaces the list on reload).
- **Spotify:** `main.js`'s `spotify.onState` and `web.onChange` callbacks call `notify()`,
  so the sheet reads `spotify.state` and `web.state` through `useUi`'s version.
  `refreshSpotifyGroup` goes.
- **Busy flags and notes** (`ui.outlineBusy`, `ui.schoolBusy`, `ui.importNote`,
  `ui.schoolNote`, `ui.spotifyNote`): still set by `readWithAi` and the Spotify return;
  their `refresh` callbacks become `notify()`. `ui.importNote`, `schoolNote` and
  `spotifyNote` clear when Settings closes, as today.
- **Sign-out:** `session.js` sets `ui.signoutAsk` and calls `notify()` instead of
  `renderSettings`.
- **Calendar feed:** component state in the Study tab, loaded the first time the tab
  opens in a session (kept in `ui.feed` so switching tabs does not reload it).
- **Reviews:** read and written with `reviews.js` (`readSetting`, `writeSetting`, this
  device only); switching it on runs `runReviews()`.

## Components (`src/components/sheet/`)

### `settings-sheet.tsx`

Head: "Settings", "saved as you type", ✕; below it the tab strip (a `Segmented`-style
row), the Account tab carrying the saved-copy count or a red dot on a sync error. Foot:
"Rounds", **Keyboard shortcuts ?** (closes Settings, opens the legacy shortcuts panel),
**Done**. Opening at a field focuses it and scrolls it into view.

- **You:** *Look* — Light / Dark / System as swatch buttons, and the line "following your
  device — currently dark", "always dark" or "always light"; Med / CS as thumbnail cards
  ("Helices, rings and a lipid tail", "Circuits, trees and code"), with "CS swaps the coat
  for an ID badge and adds Projects." Through `theme.js` `setTheme`, `setBg`.
  *Lab coat* (Med) — Name (28), Line under (34), both saved as typed; the five coat
  swatches with the colour's name; the pocket preview (embroidery, role, the tuck art);
  the note. *ID badge* (CS) — Name and Line under, and its note. *Quotes* — "N saved",
  each quote with its source and ✕; "Quote — press Enter to add" (300), "Who said it
  (optional)" (80), Add; with none, "No quotes yet — the tile stays clear." Adding shows
  the new quote on the tile; removing wraps the tile's index.
- **Study:** *Daily goal* — "1h 30m a day" or "off"; − and + by 15 minutes (0–720, − off
  at no goal), the value, and presets Off, 1h, 1h 30m, 2h, 3h, 4h; the note. *Streak* —
  "A day counts from [N] min" (1–240; out of range puts the saved value back), the rest-day
  buttons Mon–Sun, "Fireworks at the daily goal and at 7, 30, 100 and 365 days". All
  through `savePrefs`. *Reviews* — "Create review tasks after lectures" and its note.
  *Import* — **Calendar or CSV…** (over 2 MB: "That file is over 2 MB; export a single term
  instead."), **Course outline…** ("Reading outline…" and disabled while busy), the note,
  *Paste instead* with the textarea and **Preview**, and the import note (red when an
  error). *School calendar* — as today: off (the note, **Upload calendar…**), on (name,
  where the school year is, counts; **Review dates**, **Replace…**, **Remove**), asking
  ("Remove the school calendar? …", **Keep**, **Remove**), and the school note.
  *Calendar feed* — "checking" / "on" / "off"; on: the read-only link with **Copy**
  ("Copied" for two seconds), **Add to Google Calendar**, **Add to Apple Calendar**,
  **New link** and **Turn off** each asking first (**Keep**, **New link** / **Turn off**),
  and the privacy note; off: the note and **Create a calendar link**; errors in red.
- **Spotify:** checking ("Checking your saved Spotify connection…", or unavailable when
  stale); connected (the device playing on, paused, nothing playing, or unavailable;
  **Disconnect**); not connected (**Connect**, a link to `/api/spotify/connect`). Notes:
  requests paused until a time, reconnect to play in this browser, this tab is a device
  called Rounds, the connect result, and the Premium note (with the "ask before
  connecting" line when not connected). Disconnect failing offline shows the error toast.
- **Account:** *Data* — "N items · M courses", the live sync line, **Export data and saved
  copies**. *Saved copies* — "Edits the server turned down…", each copy expandable with its
  reason, "Your saved action: delete this record." for a delete, its values, **Restore my
  edit** and **Discard saved copy**. *Account* — the username; **Sign out** and **Sign out
  everywhere**; while asking, the warning with **Export data**, **Stay signed in** and
  **Sign out and erase**.

### `import-sheet.tsx`

Head: "Import", the file name ("pasted text" when pasted), ✕. Body: the summary line
(`planSummary`); what kept new courses bring (teacher, term) and the term start when none
is set; "Week 1 starts" with its note when items are dated by week number; up to six notes
and "…and N more.". Then one group per course (a colour pip, code · name, "new course"):
each class with a tick, kind, day and times, room; each item with a tick (disabled without
a date), a type select (visible types plus its own), the title ("already there" for a
duplicate, dimmed) and when (every Tue / Sat 26 Sep · wk 3 / week 3, and the start). Items
with no course in a last group. Ticks update the summary and the button without redrawing
the rows. Foot: "Nothing is saved until you import", **Cancel** (Settings at Import),
**Import N** (disabled at 0). Import writes every row in one `saveRows`, courses first;
a failure part-way is reported ("The import stopped part-way: …"); either way Settings
reopens at Import with the result.

### `school-sheet.tsx`

Head: "School calendar", ✕. Body: "Read from **file**. Check the dates, then save. Nothing
changes until you do." or "Your saved school calendar. Changes apply when you save.", and
the truncation warning. *Name* (80). *Semesters* (up to 4): name (40), first and last day
of classes, "N weeks of classes · dates" or "Check the dates", a red outline when invalid,
✕ while there is more than one, **+ Add a semester** (after the last one). *Special days*
(up to 80): the note about kinds; the days in date order under the semester they fall in
or follow; each with from and to (moving from carries a to that was equal, empty or
earlier), label (60, the kind's name as placeholder), kind, "Follows [Mon]'s classes" for a
swap, ✕, a red outline when invalid; **+ Add a day** (today, no classes) focuses its from.
Foot: "2 semesters, 14 days" or "Fix the dates marked in red", **Cancel**, **Save calendar**
(disabled while invalid). Saving closes the sheet, redraws the board and shows "School
calendar saved".

## Data (`src/data/`)

- **`settings.ts`** — `syncLine(status)`, `themeLabel(theme, dark)`, `TAB_OF`, `hm(min)`,
  `feedLink(url, tz)`, `savedValues(row)` (label/value pairs), the goal presets.
- **`import-edit.ts`** — `previewImport(text, name)` (returns an error or opens the sheet),
  `previewOutline`, `readOutlineFile(file)`, `importCount(plan)`, `commitImport(plan)`.
  The parsers and `planImport`, `planOutline`, `planSummary`, `setWeek1` stay in
  `legacy/js/importers/`.
- **`school-edit.ts`** — `readSchoolFile(file)`, `openSchool(read, source)`, `termOk`,
  `dayOk`, `valid`, `footHint`, `toSave`, `moveFrom(day, from)`, `groupDays(draft)`.
- **`actions.ts`** — `openSettings`, `toggleSettings`, `setSettingsTab`, `addQuote`,
  `removeQuote`, `saveCoat`, `exportData`, `resolveConflict`, `disconnectSpotify`,
  `showShortcuts`.

## Removed

`legacy/js/views/drawer-settings.js`, `drawer-import.js`, `drawer-school.js`. In
`main.js`: the `data-settab`, `data-themeset`, `data-bgset`, `data-coatcolor`, `data-qx`,
`data-spotify="connect"` clicks; the `import-*`, `export-data`, `conflict-*`, `signout*`,
`spotify-disconnect`, `addquote`, `feed-*`, `shortcuts` actions; `schoolClick`; the
`data-of`, `data-reviews`, `data-imp*`, `data-sc*` inputs; the `goalDayMin`,
`goalCelebrate`, `importFile`, `outlineFile`, `schoolFile` changes; `refreshSyncNote`,
`refreshSpotifyGroup`, `applyCoat` move (the coat colour is applied from a small hook in
`main.tsx`'s tree, and at boot by `session.js`). In `study-controller.js`: the
`data-goal-step`, `data-goal-set`, `data-rest` clicks and `studyChange`'s Settings fields.
`keyboard.js`: the quote Enter. `sync-status.js`, `theme.js`, `session.js`: their
`renderSettings` calls become `notify()`. Legacy CSS used only by these three drawers goes.

## Testing

- **Pure:** `syncLine`, `themeLabel`, `TAB_OF`, `hm`, `feedLink`, `savedValues`;
  `importCount`; `commitImport` writes courses before items, adds classes to an existing
  course up to twelve, fills rooms from the class, and sets the term start only when none
  is set and there is no school calendar; week-1 dating; the school validation, `toSave`,
  `moveFrom`, `footHint`, `groupDays`.
- **Settings sheet** (jsdom): tabs; a deep link opens the tab and focuses the field; theme
  and background call `setTheme`/`setBg`; coat fields and swatches save; quotes add (Enter
  and the button) and remove; goal −/+ and presets, rest days, day minimum, fireworks call
  `savePrefs`; reviews write the setting and run reviews; the feed loads, creates, copies,
  asks before New link and Turn off, shows an error offline; Spotify's three states; the
  Account badge, Restore and Discard; the sign-out question.
- **Import sheet:** ticks change the counts and button; the type select; week 1; Cancel to
  Settings; Import saves and reports.
- **School sheet:** invalid dates mark red and disable Save; adding a day focuses it; a
  swap shows Follows; Save stores it; Remove asks in Settings.
- Legacy tests of the removed code move or go; `npm run check` passes.
- Browser pass: Med and CS, light and dark, desktop and phone; every tab; theme,
  background, coat, a quote, the goal, the feed; an import from a small `.ics` or CSV; the
  school calendar review. At most one AI read (outline or calendar), as they share the
  account's daily quota with the live site.

## Build order

One commit each on `re`:

1. The data modules and their tests; the sheet kinds in `overlay.ts`; the `notify()` calls
   for Spotify, the busy flags, sign-out and the theme.
2. The Settings sheet; `drawer-settings.js` and its routing removed.
3. The import and school sheets; `drawer-import.js` and `drawer-school.js` removed.
4. CSS cleanup, browser pass and fixes; the plan marks 4b done and 4c next.
