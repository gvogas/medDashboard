# React shell: data hooks, sidebar, top bar, sign-in, toasts

Stages 1 and 2 of the move to React (roadmap and the Texture look:
`2026-09-27-react-foundation-design.md`). React takes over the app's frame; the views,
stat tiles and drawer contents stay legacy for now. The new version need not match the old
one exactly: what isn't worth keeping is simplified or dropped.

## Scope

In React: data hooks, the sidebar, the top bar, sign-in, toasts.
Legacy, restyled with CSS only: the drawer (container and contents move together in
stage 4), the shortcuts panel, the busy screen.
Legacy, untouched: the views and stat tiles (stage 3), the Spotify player, which the
sidebar hosts in a slot (stage 6).

The drawer stays legacy because it is bound to its element: modules capture `#drawer` at
import, bind listeners on it, patch it in place, and share an `inert` counter with the
overlays. A React container now would be rewired again in stage 4.

## Data (`src/data/`)

- **`store.ts`** — hooks over `legacy/js/store.js` through `useSyncExternalStore`:
  `useItems`, `useCourses`, `useProfile`. The store replaces each collection array and the
  profile on every reload, so the snapshot is the reference itself. One listener on
  `store.subscribe` wakes them on `change`, `synced`, `hidden`, `remote`, `signed-out`;
  `open()`/`close()` emit nothing, so session start and sign-out call `notify()`.
- **`ui.ts`** — `useUi(select)` over the legacy `ui` object (mutated in place, no events):
  a version counter bumped by the bridge's `notify()`. `notify()` runs at the end of
  `render()`, `renderView()` and wherever `renderSidebar()` was called.
- **`sync.ts`** — `useSyncStatus()` → `{state, pending, message}`. One `sync.onStatus`
  listener copies the status (mutated in place; `onStatus` has no unsubscribe) and fans out.
  It keeps the live announcements: trouble starting, and "Synced again".
- **`actions.ts`** — typed calls into legacy: `setView`, `goToday`, `step(dir)`,
  `setSearch`, `toggleType`, `setCourse`, `newItem`, `openSettings`, `openCourse`,
  `syncNow`, and the type-list edits (add, rename, recolour, hide, delete, reorder).
- **`types.ts`** — `Item`, `Course`, `Profile`, `SyncState`, `Ui`, from model.js's
  normalizers.

Other hooks (quotes, sessions, achievements, conflicts) arrive with the stage that uses
them. The legacy "hold the redraw while typing or pressing" logic stays for the legacy
views and drawers; React components don't need it.

## Sidebar

`index.html` keeps a static `<aside id="side" class="side">`; React renders inside. The
container's `.on` and `inert` stay with legacy `setSide`, so React never fights over them.

Clean and quiet: generous spacing, sentence-case section labels, counts in small mono
chips, edit controls only in edit mode.

- **Brand**: the R mark and "Rounds".
- **Open items**: a row per type (pip, label, count chip). Counts follow the course filter,
  not search. Click: with all types on, show only this one; if it is the only one on,
  bring all back; otherwise toggle it. `aria-pressed` per row.
- **Edit mode** (✎ → Done, or Escape): drag to reorder (Framer Motion `Reorder`) or ↑/↓
  on the grip; rename inline; the colour dot cycles the palette; eye hides; ✕ deletes a
  custom type with no items. "+ Add" opens name, colour and kind; Enter saves.
- **Courses**: "All courses", a row per active course with ✎, and "+ New course" (the
  second add button in the heading goes). **The count is the course's open items**, like
  the types, rather than its weekly meetings.
- **Pocket / ID badge**: as now, chosen by `data-bg`, each with its ✎ to Settings.
- **Player**: a `<div id="player">` React renders once and never touches; legacy
  `renderPlayer` draws into it.

## Top bar

`index.html` keeps a static `<header class="bar">`; React renders inside.

- ☰ menu on narrow screens (`setSide`, `aria-expanded`).
- Title and subtitle per view, owned by React (legacy `renderHeader` loses its text code):
  "Week board" + range and school week; "September 2026"; "All items"; "Spotify" + device
  state; "Study".
- ‹ Today › as minimal TextureButtons, **only in Week and Month** (Table showed them to no
  effect).
- The magnetic dock.
- Search with a `/` hint; sets `ui.search`, redraws the view after 120 ms.
- Sync status: a dot and a word ("Synced", "Saving…", "Syncing…", "Offline · 3",
  "Sync problem", "Signed out"); click syncs now; message in the tooltip.
- Settings (icon TextureButton, toggles Settings) and New item (accent TextureButton; a
  round floating button under 700px).

Keys `n`, `t`, `[`, `]`, `1`–`5` call actions directly; nothing presses buttons by id.

## Sign-in

React replaces `#signin`'s markup: a centred TextureCard with the "Rounds" wordmark as a
**TextGif** over a slow teal GIF we host (`public/`), plain teal under reduced motion;
username, password, one button. Errors as today (wrong password; try again in N min;
offline; sign in from the app; other), in a `role="alert"` line; the button reads
"Signing in…" while waiting. The lab-coat pocket on the sign-in card is dropped.
`session.js` keeps the flow (`showSignIn`, `signIn`, reload on success).

## Toasts

A React toaster, bottom left. `legacy/js/views/toast.js` keeps
`toast(text, {undo, label, badge, error, ms})` and `hideToast()` as a shim into the bridge,
so every caller is unchanged. One at a time; a new one replaces the old. A TextureCard that
springs in (no spring under reduced motion), action button and ✕. Errors are
`role="alert"`, the rest `role="status"`. The achievement toast keeps its medal badge.

## Drawer and overlays: CSS only

A floating sheet 10px from the edges with rounded corners, a blurred scrim, a springier
slide (none under reduced motion), Texture buttons and fields, sentence-case labels. The
shortcuts panel and busy screen get the same card. No legacy JS changes.

## Removed

`views/sidebar.js`, `views/types-nav.js`, `views/signin.js`; `renderHeader`'s text code
and the sync pill's DOM code in `sync-status.js`; `toast.js`'s DOM code; the id-pressing
in `keyboard.js`; the old markup in `index.html`; CSS used only by those.

## Build

The data layer first, with its tests. Then four sub-agents in parallel, each in its own
git worktree: **sidebar**; **top bar** with keyboard actions; **sign-in and toasts** (and
the GIF); **drawer and overlay CSS**. Each is reviewed against this spec and merged in
turn; shared files (`index.html`, `main.js`) are reconciled at merge.

## Testing

- **Hooks**: a store event re-renders a component using that collection and not one that
  doesn't; `notify()` updates `useUi`; sync status reaches `useSyncStatus`, announcing only
  trouble and recovery.
- **Sidebar**: the three filter-click cases; edit mode; keyboard reorder; course counts.
- **Top bar**: the title per view; ‹ Today › only in Week and Month; search sets
  `ui.search`; sync labels.
- **Sign-in**: each error; the button disabled while waiting.
- **Toasts**: Undo; errors as alerts; replacement.
- Existing suites, type-check, build and its CSP checks, `legacy-classes`.
- By hand in light, dark, Med and CS: sign in/out, every view, filters, courses, search,
  type editing and reorder, the phone-width sidebar, drawers, toast Undo, shortcuts,
  offline and back; then the production build under `vite preview` with no CSP violations.
