# React foundation

The front end moves to React, one piece at a time, so shadcn-style components
(componentry, cult-ui) can improve the UI. The live site keeps working after every stage.
This spec is stage 0: the tooling, and the first React piece, the view switcher becoming
a magnetic dock. Mockup of the target look: `design/mockup-react-texture.html`.

## The look: Texture

Rounds keeps its identity: the teal ward-board palette and the CS slate-indigo one, light
and dark, the lab-coat pocket and ID badge, the ornaments, Figtree / IBM Plex Mono /
Spectral. Components are restyled to it, never the other way round.

- **Cards** (TextureCard): stacked rims, a light edge above a dark one, a soft
  panel-to-panel-2 gradient, a small lift on hover.
- **Buttons** (TextureButton): the primary is an accent gradient with a light inner
  highlight; the rest are the quiet "minimal" variant on panel colours.
- **Schedule items** are raised cards with a colour bar; classes are dashed.
- **Labels** are sentence case, not tracked capitals; counts sit in small mono chips.
- **Drawers** are floating sheets over a blurred scrim.
- **Sign-in** wordmark is a TextGif.

## Stages

Each stage gets its own short spec, is built, and ships.

| # | Stage | Moves to React |
|---|---|---|
| 0 | Foundation | Vite, TS, Tailwind, shadcn; the dock |
| 1 | Data hooks | hooks over store, sync, api, model (they stay plain JS) |
| 2 | Shell | sidebar, top bar, drawers (Sheet), toasts, sign-in, keyboard |
| 3 | Views | week, month, table |
| 4 | Drawers | item, course, session, import, school, achievement, settings |
| 5 | Study | timer, flip clock, focus screen, leaderboard |
| 6 | Spotify | the view and the player |
| 7 | Cleanup | delete `src/legacy/`, the old CSS, turn Tailwind preflight on |

## Stage 0: tooling

**Packages.** Runtime: `react`, `react-dom`, `framer-motion`, `clsx`, `tailwind-merge`,
`class-variance-authority`. Dev: `vite`, `@vitejs/plugin-react`, `@cloudflare/vite-plugin`,
`typescript`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/vite`,
`jsdom`, `@testing-library/react`.

**Layout.**

- `index.html` moves to the repo root (Vite's entry) and loads `src/main.tsx`.
- `public/js` and `public/css` move to `src/legacy/js` and `src/legacy/css`, bundled by
  Vite as they are. `public/` keeps only static files: `_headers`, `sw.js`,
  `manifest.webmanifest`, `icon.svg`, `apple-touch-icon.png`. pdf.js stays a dynamic
  import and gets its own chunk.
- React code lives in `src/`: `main.tsx`, `bridge.ts`, `components/`, `components/ui/`
  (shadcn), `lib/utils.ts` (`cn()`), `index.css` (Tailwind).
- `components.json`: TSX, CSS variables, alias `@/*` → `src/*`. `tsconfig.json` with
  `allowJs` so TSX can import the legacy modules.

**Dev.** `npm run dev` is `vite`. The Cloudflare plugin runs the Worker, D1, AI and secrets
inside Vite from `wrangler.jsonc`, on `127.0.0.1:8787` (the Spotify redirect URI);
a taken port fails rather than moving.

**Build.** `npm run build` is `vite build` then a shorter `scripts/build.mjs`:

1. The inline theme script's hash is in `_headers` (as now).
2. No `style=` attribute in `index.html` or `src/**` (as now, on sources, not the bundle).
3. The built `index.html` has no inline `<script>` but the theme one.
4. `sw.js` in the output gets `CACHE` from the build hash and `SHELL` from Vite's manifest:
   `/`, `/index.html`, the manifest and icons, every file under `/assets/`.

The handwritten `SHELL` in `public/sw.js` becomes a placeholder the build fills.
`wrangler.jsonc`'s `assets.directory` points at Vite's client output; `deploy` runs
`vite build`, the checks, migrations, then `wrangler deploy`.

**Headers.** `/releases/*` becomes `/assets/*`, `immutable`. `/`, `/index.html`, `/sw.js`
stay `no-cache`. The CSP does not change: Vite emits no inline scripts in production and
Motion sets styles through the CSSOM, which `style-src-attr 'none'` allows.

**Tailwind.** v4 with `preflight` off until stage 7, so the legacy CSS is untouched.
`dark:` is `[data-app="dark"] &`. shadcn's colours map onto Rounds' tokens directly in
`@theme inline` as `--color-*`. shadcn's own `:root` variables (`--primary`, `--border`…)
are **not** defined: its `--accent` would overwrite Rounds' `--accent`.

| Tailwind colour | Rounds token |
|---|---|
| `background` | `--bg` |
| `foreground` | `--ink` |
| `card`, `popover` | `--panel` |
| `muted` | `--panel-2` |
| `muted-foreground` | `--ink-3` |
| `primary`, `ring` | `--accent` |
| `primary-foreground` | `--on-accent` |
| `secondary`, `accent` | `--accent-soft` |
| `accent-foreground` | `--accent-ink` |
| `border`, `input` | `--line` |
| `destructive` | `--crit` |

`shadcn add` writes its variables into `index.css`; they are removed after each add.

**Components installed.** `@componentry/magnetic-dock` (shadcn CLI). From cult-ui's GitHub
source, since its registry is unavailable: `texture-card`, `texture-button`, `text-gif`
(its `next/image` becomes `<img>`; its GIF is served from our own origin, as `img-src` is
`'self'`). Their neutral and indigo colours become token classes. Only the dock is used
in stage 0.

## Stage 0: the dock

`#viewSeg`'s buttons are replaced by `<div id="viewDock">`, where `main.tsx` mounts
`<ViewDock>`.

- Five items: Week, Month, Table, Spotify, Study, each a small inline SVG icon.
- 28px icons, 1.25× at most, labels below with the shortcut ("Month 2").
- The active view has `aria-pressed="true"`, the accent-soft fill and a dot beneath.
- A running study timer shows as a badge on Study ("24:13").
- Reduced motion: no magnification, no spring.
- Texture styling: a tray, rimmed icons.

**Bridge** (`src/bridge.ts`), the only coupling between React and the legacy code:

- `subscribe(fn)` / `notify()`: `renderHeader()` calls `notify()`; the dock reads `ui.view`
  through `useSyncExternalStore`.
- `setView(view)`: sets `ui.view`, `rememberUi()`, `render()`. Taken out of `main.js`'s
  click handler. The dock and the 1–5 keys call it; nothing presses `#viewSeg` any more.
- `setStudyBadge(text | null)`: called by `study.js` where it set the Study button's text.

## Testing

- The existing suites pass unchanged in behaviour; imports move from `public/js` to
  `src/legacy/js`, and `syntax.node.mjs` checks `src/legacy/js`.
- The "service worker lists every module" check is replaced by one on the build output:
  the built `sw.js` lists every file under `/assets/`, `/` and `/index.html`.
- A second Vitest project (jsdom) for React. The dock: five buttons; `aria-pressed` follows
  `ui.view` after `notify()`; a click calls `setView` with its view; `setStudyBadge` shows
  and hides the badge; with reduced motion, hovering changes no size.
- By hand on `npm run dev`: the whole app after sign-in; the dock and 1–5; the study badge;
  Spotify connects; an offline reload opens from the service worker. Then `npm run build`
  and a `wrangler deploy --dry-run`.
