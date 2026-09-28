# React Study part 5b and Spotify (stage 6): the timer, the focus screen, the music

The second half of stage 5 and all of stage 6, built together after 5a (resume plan:
`docs/superpowers/plans/2026-09-27-react-migration.md`; 5a:
`2026-09-28-react-study-5a-design.md`). The timer moves into React, the focus screen is
redesigned around a big centred clock with the music in a side panel, the corner dock becomes
a pill, and the Spotify page is rebuilt from the same player parts. Mockups:
`.superpowers/brainstorm/1897-1790568598/content/` (`timer-looks-2.html` C,
`focus-looks.html` A, `focus-spotify.html` 1, `spotify-page.html` A).

## Decisions

- **The timer:** two cards in the Study page's left column, where 5a's `#studyTimer` slot
  was. **Ready** is dark with the focus screen's glow (look C); **Your flow** is as today
  with a proportional round bar on top.
- **The focus screen:** the clock takes the stage (look A). The Spotify view no longer sits
  beside it; the music is a pill at the bottom that opens a side panel (option 1).
- **The corner dock:** a glass pill with the clock, the phase, pause, the goal ring and
  Focus; no music controls (the sidebar player has them).
- **One player, two places:** `<NowPlaying>` and `<MusicBrowser>` make the focus panel and
  the Spotify page (layout A).
- **Engines:** `focus.js` and `timer.js` stay legacy (read through the bridge). The Spotify
  engine moves to TypeScript in stage 6.

## The timer cards (`src/components/study/timer-cards.tsx`)

- **Ready**, a dark card in both themes (`--fx-study-*` tokens, the glow top centre):
  "READY", the flip clock on the first step's minutes, the round strip (all future), "Round
  1 of 4" and "1h 40m study · 2h 00m total"; Course (`code · name`) and Item ("No item" and
  the course's open items) pickers kept in `ui.study`; **▶ Start focus**; the hint "Opens the
  focus screen: the clock and your music, nothing else." With no courses: "Add a course
  first; study time is logged against one." and **Add a course**.
- **Your flow**, a Texture card: "Your flow" and "Tap Study or Break to switch it"; one
  round as a proportional bar; the numbered steps, each a Study/Break toggle, a minutes box
  (1–180) and ✕ (disabled on the last step); **Add study**, **Add break** (to 12 steps);
  Repeat N rounds (1–12) with "1h 40m study · 2h 00m total"; Quick start presets
  (`FLOW_PRESETS`). Every change saves `profile.studyFlow` as now.

## The focus screen (`src/components/focus/`)

`<FocusScreen>` shows while `ui.focus`; the rest of the page (sidebar, top bar, stats,
views) is hidden. Dark in both themes, the glow centred behind the clock, break colours in a
break.

- **Top line:** **← Leave** (Esc); the course chip ("ANAT · Brachial plexus"); today's goal
  ring and "1h 12m of 2h today", counting this run's study so far; nothing there without a
  goal.
- **The stage:** "STUDY · ROUND 2 OF 4" (" · PAUSED"); the big flip clock, scaling with the
  screen; the wide round strip, filling live; "Next · **Break 5 min** · done at **15:40**"
  ("Last step · done at 15:40"; the finish moves on while paused); **Skip**, the round
  play/pause, **Stop & log**.
- **Music:** the pill at the bottom centre; **▴ Music** or **M** opens the side panel
  (about 38% wide, glass), the stage re-centres in what is left and the clock steps down a
  size if it must; ✕, Esc or M closes it. Esc closes the panel first, then leaves.
- **Keys:** Space pauses or resumes the timer; M the music; Esc as above.
- **Phone:** stacked, the clock as wide as fits; the panel a bottom sheet over the lower
  70%, the clock line above it.
- **Reduced motion:** the panel appears without sliding; the clock's digits just change.
- **Kept:** fullscreen on start, the wake lock, the chime, a new study step pulling you
  back in, Stop & log (or the end) going to the Study page. The tab title shows the time.

## The corner dock (`src/components/study/study-dock.tsx`)

Fixed bottom right (full width on a phone), only during a run and off the focus screen: the
mini flip clock, "Study · round 2 of 4", ❚❚/▶, today's goal ring with a goal, **Focus**.
Break colours in a break.

## The music

### `<MusicPill>` (`focus/music-pill.tsx`)

The cover, the track and artist, a thin progress line, ⏮ ❚❚ ⏭, the device, **▴ Music**. Not
connected: **Connect Spotify** (`/api/spotify/connect`). Nothing playing: "Pick something to
play ▴". The cooldown or a failed command: the page's short note.

### `<NowPlaying>` (`src/components/spotify/now-playing.tsx`)

A big cover, the title and artist, the progress (elapsed / length, not seekable), shuffle,
⏮ ❚❚ ⏭, repeat (off / all / one), the **device** button opening "Play on" (with "This tab"
for the Web Playback device; restricted devices disabled) and the volume, disabled where the
device does not take it.

### `<MusicBrowser>` (`src/components/spotify/music-browser.tsx`)

A search box (`/` focuses it, Enter searches) and the tabs:

- **Up next:** the current track and the queue, and the note that Spotify lets apps add
  and skip but not remove or reorder.
- **Recent:** recently played; "Reconnect Spotify" when that permission is missing.
- **Library:** Liked Songs and the playlists as a cover grid, ↻ to refresh.

A playlist, album or artist opens inside with ‹ Back, ▶ Play all (shuffle beside it) and the
track filter; an artist lists albums and singles. Search results: Tracks, Artists, Albums,
Playlists, each with Show more. A track row: the cover, the title, the artist · album, the
length (the equaliser when playing), ▶ and + (add to the queue). The open place is
`ui.spotify` (pane, ids, query, filter), shared by the panel and the page.

`compact` (the focus panel): the tabs are Up next / Recent / Library; the grid is three
across. The page: Library and search only (Up next / Recent are in the left card).

### The focus panel (`focus/music-panel.tsx`)

`<NowPlaying>` over a compact `<MusicBrowser>`, with "Music" and ✕.

## The Spotify page (`src/components/spotify/spotify-page.tsx`)

Two Texture cards: left `<NowPlaying>` with Up next / Recent tabs under it; right the full
`<MusicBrowser>`. Space plays or pauses when not typing. Not connected: one card with
**Connect Spotify**. Under 760px one column: the pill on top, the browser under it.

## The sidebar player (`src/components/spotify/sidebar-player.tsx`)

The badge at the bottom of the sidebar, the same look as today (the mark, the track,
prev/play/next, the progress line), drawn by React; the slot in `sidebar.tsx` goes.

## Data

- **`src/data/study-timer.ts`:** `useRun()` (reads `focus.read()`, redrawn on each tick
  through the bridge); `startRun`, `togglePause`, `skip`, `stopRun`, `openFocus`,
  `leaveFocus`, `toggleMusic`; the flow edits `setStepKind`, `setStepMinutes`, `addStep`,
  `delStep`, `setRounds`, `applyPreset`; pure `stripSegments(flow, run)`, `nextLine(run)`,
  `doneAt(run, now)`, `todaySoFar(sessions, run, today)`, `flowTotals(flow)`. The tab
  title and the study badge move here from `views/study.js`.
- **`src/components/study/flip-clock.tsx`:** the four-card flip clock, sizes `big`, `mid`,
  `mini`, the same flip and reduced-motion behaviour, a screen reader line.
- **`src/data/spotify/`:** the engine in TypeScript: `player.ts` (the poller and the
  controls, from `spotify.js`: 10 s playing, 20 s quiet, only visible, the cooldown after a
  429), `web-player.ts` (the Web Playback SDK device), `library.ts` (the loaders and the
  session cache, from `spotify-data.js`), `commands.ts` (play, queue, shuffle, repeat,
  devices, volume). `useSpotify()` reads them. The CSP hosts for the SDK and artwork stay.
- **`ui.focusMusic`:** the panel open or shut, for the session.

## Removed

`views/study.js` (all that 5a left), `views/flipclock.js`, `views/player.js`,
`views/spotify-view.js`, `spotify-html.js`, `spotify-data.js`, `spotify-commands.js`,
`spotify.js`, `web-player.js`; `views/render.js` (nothing legacy draws a view any more);
`#focusClock`, `#studyDock`, `#viewRoot`, the `#studyTimer` slot and the sidebar's Spotify
slot; in `study-controller.js` the `data-study-*` clicks and `onFocusTick`'s drawing; the
Spotify branches of `keyboard.js` and `main.js`; the CSS for the focus layout, the start
panel, the flow, the dock, the flip clock and the Spotify view. `focus.js` and `timer.js`
stay for stage 7.

## Testing

- **Pure:** `stripSegments` (past, now, future fill), `nextLine` (the last step),
  `doneAt` (moves while paused), the flow edits (limits, never no steps), `flowTotals`;
  the Spotify poll delay, the cooldown text, the mapping of tracks, albums, playlists
  (moved from the legacy tests).
- **jsdom:** Ready with and without courses; Start begins a run and shows the focus screen;
  pause, skip, stop call `focus.js`; Esc closes the panel then leaves; M and Space; the dock
  off the focus screen, Focus back; the pill's states; the panel's tabs, a playlist opened
  and back, search, + to the queue, the device list; the Spotify page connected, not
  connected, rate-limited; the sidebar player.
- `npm run check` passes.
- **Browser pass:** Med and CS, light and dark, desktop and phone: a whole run (start,
  pause, skip into a break, leave and back through the dock, the panel and something
  played, Stop & log, the session in History); the Spotify page with a real account.

## Build order

One commit each on `re`, after 5a's three:

1. `study-timer.ts`, the Spotify engine in `src/data/spotify/`, `<FlipClock>`, their tests.
2. The Ready and flow cards and the dock; the slot gone.
3. The focus screen, the pill and the panel; the legacy focus layout gone.
4. The Spotify page and the sidebar player; the legacy Spotify files gone.
5. CSS cleanup, the browser pass and fixes; the plan marks stages 5 and 6 done, 7 next.
