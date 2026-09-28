# React migration: where it stands and how to finish

Written 27 September 2026 to pick the work up later. The design and the stage list are in
`docs/superpowers/specs/2026-09-27-react-foundation-design.md`; stages 1–2 are specified in
`2026-09-27-react-shell-design.md`. The look (Texture) is `design/mockup-react-texture.html`.

## Where it stands

- Branch **`re`**, 36 commits ahead of `main`. **Nothing is pushed or
  deployed**; the live site still runs the pre-React code from `main`.
- **Done:** stages 0–4 and 5a. The app runs on Vite + React + Tailwind. React owns
  the top bar, the view dock, the sidebar, sign-in, toasts, the stat tiles, the week, month
  and table views (`src/components/views/`, in `#stats` and `#views`), the Study page
  but its timer (`src/components/study/`, in `#views`: the tiles, History, achievements,
  the leaderboard; the start panel and flow are legacy, in its `#studyTimer` slot) and the sheet: item,
  course, Settings, import, school calendar, study session and achievement
  (`src/components/sheet/`, in `#sheet`), and the shortcuts panel and busy card
  (`src/components/overlays.tsx`, in `#overlays`); the legacy `#drawer` is gone;
  everything else is the legacy code in `src/legacy/`, bundled by Vite and connected
  through `src/bridge.ts` and `src/data/`.
- **Checks after 5a:** type-check clean, 710 Vitest tests + 18 node tests pass,
  `npm run build` passes its CSP checks. 5a is checked in tests only so far: its browser
  pass (the spec's list: Med and CS, light and dark, desktop and phone width) is still to
  do. 4c was checked in the dev server (Settings in Med dark and light, desktop and phone
  width; an import from pasted CSV, cancelled); the school sheet only in tests. The
  production build under the real CSP was last run at `d000298`.

| Stage | What | State |
|---|---|---|
| 0 | Vite, TS, Tailwind, shadcn; magnetic dock | Done (`5b8cb72`, table fix `c9e278d`) |
| 1 | Data hooks and actions (`src/data/`) | Done (`330448a`) |
| 2 | Sidebar, top bar, sign-in, toasts; drawer restyled with CSS | Done (merges up to `93e9f80`, polish `d000298`) |
| 3 | Views: week, month, table; stat tiles | Done (`219df59`, spec `2026-09-27-react-views-design.md`) |
| 4 | Drawers, in three parts | Done: 4a (`7e40ff8`), 4b (`e759bd5`), 4c (`5c056c1`–`b1c8614`; specs `2026-09-27-react-drawers-4a/4b/4c-design.md`) |
| 5 | Study, in two parts: 5a the history, achievements and leaderboard; 5b the timer, flip clock, focus screen and dock | 5a done (`5916e68`–`ae04e91` and the CSS cleanup after; spec `2026-09-28-react-study-5a-design.md`); **5b next** |
| 6 | Spotify: view and player | **Next, built together with 5b** (spec `2026-09-28-react-study-5b-spotify-6-design.md`) |
| 7 | Cleanup: delete `src/legacy/`, one React root, Tailwind preflight on | To do |

## Resuming

1. `git switch re`, `npm ci` if packages changed, then `npm run dev` → http://127.0.0.1:8787.
2. **Before starting a server, check the port.** On this Windows machine, stopping a
   background `npm run dev` or `vite preview` leaves `vite.js` running and serving old code
   on 8787/8790. In PowerShell: `Get-NetTCPConnection -LocalPort 8787 -State Listen`, check
   the owning process is our `vite.js`, stop it and its children.
3. **Don't run `npm run build` while the dev server runs**; if the dev page is blank with
   503s on `node_modules/.vite/deps`, restart the dev server.
4. Checks: `npm run typecheck`, `npm test` (Workers + jsdom projects, then node tests),
   `npm run build`. `npm run check` runs all three.
5. Sub-agents in parallel: create each worktree yourself from `re`
   (`git worktree add -b shell/<name> ../tracker-<name> re`), give the agent that absolute
   path, have it check `git log -1` first and run its own `npm ci`. The automatic worktree
   option started agents on `main` last time.
6. Keep files LF (a CRLF in `index.html` breaks the CSP hash). Look inside a folder before
   deleting it; gitignored folders here have held hand-made files.

## Shipping stages 0–2 (can happen before stage 3)

- [ ] Go through the site in your own browser: every view, filters, courses, search, the
      type editor, drawers, toast Undo, sign-out and sign-in, a phone-width window.
- [ ] **Spotify:** confirm the sidebar player loads (it never did in the automated checks,
      because that tab counts as hidden and Spotify polls only when the page is visible).
- [ ] **Med theme and light mode:** most checks were in CS dark; give Med light and dark a
      proper look.
- [ ] Offline: load, go offline, reload; the service worker should open the app.
- [ ] Merge `re` into `main`, then `npm run deploy` (it runs the checks, applies remote
      migrations, and deploys with `wrangler deploy`). Installed copies pick up the new
      service worker on their next load.

## Stage 3: the views (done)

Brainstorm a short design first, then spec, then build (the usual flow).

- **Hooks to add** in `src/data/`: `useQuotes`, derived selectors for the week's instances and
  classes (`legacy/js/query.js` `instances`, `classes`, `passFilters`), memoized on the
  collection references plus `useUi`'s version so `getSnapshot` never loops.
- **Stat tiles** (`legacy/js/views/stats.js`, `#stats`) as TextureCards: next exam or quiz
  with the ECG line, open assignments, overdue, class hours, lab hours, the quote tile that
  turns its own page. Fix the phone-width overflow while there.
- **Week** (`views/week.js`, `views/bits.js`): day headers, items as raised cards with a
  colour bar, classes dashed, today highlighted, office hours and the tasks panel with quick
  add. **Month** (`views/month.js`): the class grid and deadlines toggle. **Table**
  (`views/table.js`): sortable, own-scroll, phone cards.
- Clicking an item still calls the legacy `openItem` (drawers stay legacy until stage 4).
- Delete the replaced view code and its CSS; `render.js`'s `drawView` shrinks to the
  remaining legacy views (Spotify, Study).
- Watch: `refreshAfterSync`'s hold-while-typing logic only matters for legacy views; the
  tasks panel's quick-add input moves to React, so its guard can go.

## Stage 4: drawers

Done, in three parts (see the specs): **4a** the sheet container, item and course, time
field; **4b** Settings with its tabs, and the import and school calendar sheets; **4c** the
session and achievement sheets, the shortcuts panel and busy card (`<Overlays>`,
`data/keys.ts`, `data/ai-read.ts`), the phone sidebar in `data/sidebar.ts`; the legacy
`#drawer`, `drawer-base.js`, `timepicker.js` and the drawer CSS are gone.
- 4c was checked in the dev server by hand (sessions, an achievement with a crop, Undo,
  the shortcuts panel, the phone sidebar); the busy card only in tests.
- Kept for the React Settings sheet until stage 7: the `.bgthumb` and `.coatpreview`
  rules in `components.css` (masked SVG art and the pocket preview).

- `src/data/overlay.ts` decides what takes focus: the sheet, or an overlay (`cover()`)
  over everything.

## Stage 5: study

- **5a (done):** the Study page is React (`src/components/study/`): the tiles, one History
  card (Week, Month, Term), achievements and the leaderboard, over `src/data/study.ts` and
  `src/data/leaderboard.ts`. `history.js` and `achievements.js` still do the arithmetic.
  `views/achievements.js` and `views/leaderboard.js` are gone; `views/study.js` keeps
  the start panel and the flow (`renderStudyTimer`, into the `#studyTimer` slot React
  renders once), the focus screen's clock side and the per-tick paint. Session deletes
  still wait in `study-controller.js` (`deleteWithUndo`, `commitUndo`); Undo is
  `undoSessionDelete` in `study.ts`. The unlock toast's See finds its medal a frame
  after switching to Study.
- **5b (next, with stage 6):** the timer cards replace the `#studyTimer` slot, then the
  focus screen, the corner dock and the music; see
  `2026-09-28-react-study-5b-spotify-6-design.md`. `flipclock.js`, `focus.js`,
  `timer.js`, `#focusClock`, `#studyDock`; the focus screen is a page layout
  (`html.focusing`). The dock's study badge already reads through the bridge.

## Stage 6: Spotify

`spotify.js`, `web-player.js`, `views/spotify-view.js` (+ `spotify-data`, `-html`,
`-commands`), and the sidebar player (`views/player.js`, now drawn into a slot React
renders once in `src/components/sidebar.tsx`). Keep the CSP hosts for the SDK and artwork.

## Stage 7: cleanup

- Delete `src/legacy/js` and the legacy CSS; keep the tokens (`tokens.css`) as the theme.
- One React root instead of the static containers in `index.html`; keep the inline theme
  script and its CSP hash.
- Turn Tailwind's preflight on; remove the `legacy` cascade layer and
  `test/legacy-classes.node.mjs`.
- Move `ornament.js` (the background art) into a component.
- Remove the bridge once nothing legacy is left.

## Known issues and notes

- `magnetic-dock`, `texture-card`, `texture-button`, `text-gif` are vendored in
  `src/components/ui/` and adapted; cult-ui's registry was down, so they came from its
  GitHub source. `scripts/make-wordmark-gif.py` regenerates `public/wordmark.gif`.
- `.claude/worktrees/` holds the stage 2 agents' worktrees (gitignored); their branches
  (`worktree-agent-*`) are merged and can be deleted with the worktrees once no longer needed.
- The QA scripts that lived in `.build/` (`seed-qa.mjs`, `http-smoke.mjs`, …) were deleted
  by mistake on 27 September and are not in git.
- The local `demo` account has sample items seeded for this week and next.
