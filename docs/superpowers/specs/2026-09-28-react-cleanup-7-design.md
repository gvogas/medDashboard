# Stage 7: cleanup

The last stage of the React move (`2026-09-27-react-foundation-design.md`). Nothing the
user sees changes, apart from what Tailwind's reset may shift and is then put back.
Decided with the owner on 28 September: the legacy modules are converted to TypeScript as
they move, not just relocated.

## Where things go

**`src/core/`**: the logic with no DOM or React, shared with the Worker and the tests.
`dates`, `model`, `school`, `grades`, `history`, `achievements`, `reviews`, `prep`,
`timer`, `sticker`, `db`, `store`, `api`, `sync`, `importers/{csv,ics,plan}`, `pdftext`
and the vendored `vendor/pdfjs.mjs` (kept as it is). Each becomes `.ts`.

- Relative imports with the `.ts` extension and no `@/` alias: `worker/` (bundled by
  wrangler) imports `school`, and `test/local-store.node.mjs` loads `store` in plain Node
  (24, which strips types). So only erasable TypeScript: no `enum`, no parameter
  properties, no `namespace`. `tsconfig.json` gets `allowImportingTsExtensions` and
  `erasableSyntaxOnly`.
- The shapes in `src/data/types.ts` move to `src/core/types.ts` (re-exported from
  `src/data/types.ts` so components keep their imports) and type the core.
- `worker/`, `test/` and `scripts/` import the new paths. Comments naming
  `src/legacy/...` are updated.

**`src/data/`**: the controllers, as TypeScript beside the hooks they feed.

| Legacy | Becomes |
|---|---|
| `state.js` (`ui`) | `src/data/ui.ts` owns the object (typed as `Ui`) |
| `views/render.js` | gone; callers use `notify()` |
| `views/toast.js`, `views/signin.js` | gone; callers use `data/toast.ts`; sign-in shown by state |
| `views/school-bits.js` | `src/lib/school-bits.ts` |
| `query.js` | `src/data/query.ts` |
| `focus.js` | `src/data/run.ts` (the run and its storage; `study-timer.ts` reads it) |
| `fireworks.js` | `src/lib/fireworks.ts` |
| `session.js` | `src/data/session.ts` |
| `theme.js` | `src/data/theme.ts` |
| `sync-status.js` | `src/data/sync-status.ts` |
| `study-controller.js` | `src/data/study-controller.ts` |
| `keyboard.js` | `src/data/keyboard.ts` |
| `dom.js` | what is still used in `src/lib/dom.ts`: `isTyping`, and `refind` (focus goes back to the same control after a redraw: `keys.ts`, the sheet); `esc`, `setHTML`, `keepFocus`, `restoreFocus` go |
| `ornament.js` | `src/components/ornament.tsx`, a canvas drawn from a ref; the redraw signal in `src/data/ornament.ts` |
| `main.js` | `src/boot.ts`, imported first by `main.tsx` |

`src/bridge.ts` (`notify`, `subscribe`, `getVersion`, the study badge) stays as the
change signal, since the store and `ui` are still mutable objects; its comment no longer
talks about legacy. Renaming it is not worth the churn.

## One React root

`index.html` keeps the head, the inline theme script (its CSP hash unchanged) and one
`<div id="root">`. `<App>` renders what the static containers were: the sign-in screen or
the app (`.app` grid: sidebar, content with the ornament canvas, top bar, drape, stats,
views; dock and focus screen), the scrim, the sheet, the overlays and the toaster.

- Signed in or not is state (`data/signin.ts`), not `hidden` set by `views/signin.js`.
- The phone sidebar's open state, the `inert` on the sidebar, content and `#app`, and the
  scrim's `on` are rendered from state (`data/sidebar.ts`, `data/overlay.ts`) instead of
  set on elements. Element ids that tests, focus handling or `keyboard.ts` look up
  (`side`, `menuBtn`, `search`, `scrim`) stay.
- Order in the DOM stays the same, so the stacking and the inert rules still hold: the app,
  the scrim, the sheet, the overlays, the toaster.

## CSS

- `src/legacy/css/tokens.css` → `src/styles/tokens.css`, unchanged, as the theme.
- `layout.css`, `components.css`, `study.css` go. What React still uses from them moves:
  the page base (body font, scrollbars, focus ring, the `kbd` look) into `src/styles/base.css` in the
  base layer, after preflight; the shell's layout (the coat's weave, the phone rules) and
  the Settings sheet's art (background thumbs, the pocket preview) into
  `src/styles/shell.css`, in a `shell` layer where the `legacy` layer was, so nothing
  changes places in the cascade. (Built that way rather than as utilities on `<App>`: the
  weave and the phone rules read better as CSS.) The unlock toast's medal becomes React
  with the Study page's group colours; the fireworks canvas takes utilities. Dead rules (`.panel`, `.ph`, `.empty`, `[data-layout]`, `.info`,
  `.swatch`, `.btn`, `.seg`, `.pocket`, `.mono`…) are dropped.
- Tailwind's preflight on; the `legacy` layer removed; `@source not "./legacy"` removed;
  `test/legacy-classes.node.mjs` removed. `test/syntax.node.mjs` checks the service worker only.
- Preflight zeroes margins, sets `border: 0 solid`, makes images block and buttons
  unstyled. Every view, sheet and overlay is compared before and after (screenshots, both
  themes, Med and CS, desktop and phone width) and anything that moved is put back with
  utilities on the component.

## Order

1. Core to TypeScript (`src/core/`), imports updated; all tests pass.
2. Controllers to `src/data/`, `main.js` to `boot.ts`; `src/legacy/js` deleted.
3. One React root, the ornament component.
4. CSS: tokens moved, legacy CSS moved or dropped, preflight on, the look checked.
5. Checks: `npm run check`, the production build driven through every view with no CSP
   violation or console error; a review of the whole diff.
