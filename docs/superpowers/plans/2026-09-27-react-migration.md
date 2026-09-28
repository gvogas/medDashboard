# React migration: where it stands and how to finish

Written 27 September 2026 to pick the work up later. The design and the stage list are in
`docs/superpowers/specs/2026-09-27-react-foundation-design.md`; stages 1–2 are specified in
`2026-09-27-react-shell-design.md`. The look (Texture) is `design/mockup-react-texture.html`.

## Where it stands

- Branch **`re`**, 51 commits ahead of `main`. **Nothing is pushed or
  deployed**; the live site still runs the pre-React code from `main`.
- **Done:** stages 0–6. The app runs on Vite + React + Tailwind. React owns the top bar,
  the view dock, the sidebar and its Spotify player, sign-in, toasts, the stat tiles, every
  view (week, month, table, Study, Spotify; `src/components/views/`, `study/`, `spotify/`,
  in `#stats` and `#views`), the focus screen (`src/components/focus/`, in `#focus`),
  the corner dock (in `#study-dock`), the sheet (`src/components/sheet/`, in `#sheet`),
  and the shortcuts panel and busy card (`src/components/overlays.tsx`). The Spotify
  engine is TypeScript (`src/data/spotify/`). What is left of `src/legacy/` is the
  store, sync, the importers, the run engine (`focus.js`, `timer.js`),
  `study-controller.js`, `keyboard.js`, `main.js` and a `render.js` that is only
  `notify()`, connected through `src/bridge.ts` and `src/data/`.
- **Checks after 5 and 6** (`d822893`): type-check clean, 886 Vitest tests + 18 node tests
  pass, `npm run build` passes its CSP checks. The production build (`npm run dev:built`,
  the real CSP) was driven through every view, a whole run (focus screen, music panel,
  Esc, the dock, a break, Stop & log) and the Log study sheet with no CSP violation or
  console error. In the dev server the same, plus 5a's History (tabs, delete and Undo, a
  heatmap day), the leaderboard's Join and Leave, and a run logged and shown in History.
  A release review of the whole diff found no critical or important defects; its minor
  findings are fixed in `d822893`. **Not yet seen:** the look (themes, light and dark,
  phone width) and Spotify with a real account: the automation browser counted as a
  hidden tab, so screenshots failed and Spotify never polled.

| Stage | What | State |
|---|---|---|
| 0 | Vite, TS, Tailwind, shadcn; magnetic dock | Done (`5b8cb72`, table fix `c9e278d`) |
| 1 | Data hooks and actions (`src/data/`) | Done (`330448a`) |
| 2 | Sidebar, top bar, sign-in, toasts; drawer restyled with CSS | Done (merges up to `93e9f80`, polish `d000298`) |
| 3 | Views: week, month, table; stat tiles | Done (`219df59`, spec `2026-09-27-react-views-design.md`) |
| 4 | Drawers, in three parts | Done: 4a (`7e40ff8`), 4b (`e759bd5`), 4c (`5c056c1`–`b1c8614`; specs `2026-09-27-react-drawers-4a/4b/4c-design.md`) |
| 5 | Study, in two parts: 5a the history, achievements and leaderboard; 5b the timer, flip clock, focus screen and dock | Done: 5a (merge `7d39ef8`, spec `2026-09-28-react-study-5a-design.md`), 5b (`40672d5`, `d818b42`, `ad0d29e`; spec `2026-09-28-react-study-5b-spotify-6-design.md`) |
| 6 | Spotify: view and player | Done with 5b (`5d0b7f0`, `6f5e4de`, `fbc107b`, `9b89919`); review fixes `d822893` |
| 7 | Cleanup: delete `src/legacy/`, one React root, Tailwind preflight on | **Next** |

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
- **5b (done, with stage 6):** the Ready and Your flow cards (`study/timer-cards.tsx`),
  the corner dock (`study/study-dock.tsx`) and the focus screen (`focus/focus-screen.tsx`,
  with the music pill and side panel), over `src/data/study-timer.ts` (the run, the flow
  edits, the title and badge) and `study/flip-clock.tsx`. `focus.js` and `timer.js`
  stay as the engine; `focus.prime()` takes full screen and sound inside the Start click.
  `views/study.js`, `flipclock.js`, `#focusClock`, `#studyDock` and `#viewRoot` are gone.

## Stage 6: Spotify (done)

The engine is `src/data/spotify/` (`player.ts`, `web-player.ts`, `library.ts`,
`commands.ts`, `useSpotify()`). The page (`spotify/spotify-page.tsx`: `<NowPlaying>`
and Up next / Recent on the left, `<MusicBrowser>` on the right), the sidebar player and
the focus screen's panel share the parts in `src/components/spotify/`. The legacy view,
`views/player.js` and the shims are gone. The CSP hosts for the SDK and artwork are kept.

## Stage 7: cleanup

- Delete `src/legacy/js` and the legacy CSS; keep the tokens (`tokens.css`) as the theme.
  Left to move: the store, sync, the importers, `focus.js`/`timer.js`, `study-controller.js`,
  `keyboard.js`, `main.js`, `session.js`, and `render.js` (only `notify()`, imported widely).
  Dead CSS kept until then: `.panel`, `.ph`, `.empty` in `components.css`; `keepFocus` and
  `restoreFocus` in `dom.js`.
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
