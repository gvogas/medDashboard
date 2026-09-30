# Term Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved "Term" redesign into the app in seven stages, each shipped and checked by the owner before the next starts.

**Architecture:** The redesign is mostly a restyle through the CSS tokens (`src/styles/tokens.css`) and the React components that draw the frame, the tiles and the views; features are added where the data model already has a place for them (a course's `term` for its semester, the coat's `role` for the goal, an item's `recur`/`recurUntil` for repeats). Only the themes need a database change (the profile's `bg` CHECK). Each stage is a branch off `term` (named `term-N-…`: git cannot hold `term` and `term/…` together), merged into `term` after review; `term` merges to `main` and deploys after each stage the owner signs off.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4 (utilities, preflight on), Vitest (jsdom + Workers pool), Cloudflare Workers + D1, `@fontsource` for self-hosted fonts.

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` (read it first).
**Prototype:** `design/term-prototype.dc.html`; the values in its `<script type="text/x-dc">` are the reference for every colour, size and word. Canvas: https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test` (Vitest: Workers + jsdom projects, then node tests), `npm run build` (with the CSP checks). `npm run check` runs all three. Run one file: `npx vitest run src/components/side-nav.test.tsx`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. On this Windows machine a stopped dev server can leave `vite.js` holding 8787/8790 and serving old code: before starting one, `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell, and stop the owning `vite.js` if it's there. Don't run `npm run build` while the dev server runs.
3. **Line endings:** keep files LF. A CRLF in `index.html` breaks the CSP hash.
4. **Colours in inline styles** go through `style` (the CSP allows styles set through the DOM), as `accent()` in `src/components/views/bits.tsx` does with `--c`.
5. **Deploying:** the Cloudflare Git build runs `npm run build` and does **not** apply remote D1 migrations. Before merging a stage with a migration to `main`, run `npm run db:remote` and `npm run db:check -- --remote`.
6. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on the stage branch; never push or merge to `main` without the owner's yes.
7. **Tests find text.** Many component tests look things up by visible text or accessible name. When a task changes a word, grep the tests for it (`rg -n "Rounds" src test`) and update them in the same commit.

---

## The stages

| # | Stage | Branch | Database | Detailed plan |
|---|---|---|---|---|
| 1 | The name and the look: fonts, tokens, sidebar with the pages, top bar, the four boxes, the week as rows, completed tint, month course colours, sign-in | `term-1-look` | none | **below** |
| 2 | Themes: six themes, their pictures with name and goal, next-exam animations, study words, dark timer colours | `term-2-themes` | clean db: widen `users.bg`, move to `rounds-v5` | `2026-09-30-term-stage-2-themes.md` |
| 3 | Semesters and repeats: course semester picker, classes only in their term, sidebar semester switch, weekly repeat for labs and tutorials | `term-3-semesters` | none (`courses.term`, `items.recur`) | written when Stage 2 is merged |
| 4 | The item card: type buttons, the property list, the Week/Month date picker, folded extras | `term-4-item-card` | none | written when Stage 3 is merged |
| 5 | Study in four tabs | `term-5-study` | none | written when Stage 4 is merged |
| 6 | Music page and the focus-mode panel restyled | `term-6-music` | none | written when Stage 5 is merged |
| 7 | Import with AI: class schedule (new), outline with semester, calendar | `term-7-import` | none; Worker route and prompt | written when Stage 6 is merged |

Why a detailed plan per stage and not all now: each stage changes the files the next one edits (Stage 1 rewrites the sidebar that Stage 2 puts the pictures in; Stage 3 changes the course data Stage 7 writes to). Plans written against code that no longer exists would be wrong.

### What each later stage must cover (its plan starts from this)

**Stage 2 — Themes.**
- The database: **not** a table rebuild (dropping `users` would cascade-delete the change feed). The owner chose a clean database instead: widen the `bg` CHECK in `0001_schema.sql` and move the live data into a fresh `rounds-v5` (see `2026-09-30-term-stage-2-themes.md`, Tasks 1 and 13). Update `BACKGROUNDS` in `worker/validate.js` and the `bg` type. Test: saves each value and rejects `"foo"`.
- `src/data/theme.ts` `applyBg()`: accept the six; `data-bg` on `<html>`.
- Tokens: one `:root[data-bg="…"]` block per theme, light and dark, with `--accent`, `--accent-soft` (today's tint), `--accent-ink`, `--done`, `--done-ink`, `--done-track`, `--done-bar-a`, `--done-bar-b`, `--motif`, `--study-deep` (values: `THEMES` and `STUDY` in the prototype).
- `src/components/sidebar-picture/` one component per theme (coat, badge, suit, jacket, jersey, vest): the SVG from the prototype (search `aria-label="Lab coat` etc.) with the name and goal as HTML spans over it, never SVG `<text>`. Snapshot-free tests: each renders the person's name and goal.
- "Headed for *goal*" under the picture; Settings gets "Where you're headed": six suggestions per theme (`GOALS`) plus free text, stored in `profile.coat.role` (≤34).
- The next-exam box's animation per theme (`@keyframes` in `src/index.css`, stopped under `prefers-reduced-motion`).
- Settings' theme picker: six radio rows (swatch, name, one-line description).
- The study word per theme ("On shift", "Compiling", …) and the Ready card's dark colour.

**Stage 3 — Semesters and repeats.**
- `src/core/school.ts`: `courseTerm(course, cal)` → the matching `Term` or `null` (all year); `classesOn(date)` skips a course whose term doesn't contain the date. Tests in `test/` next to the existing school tests.
- Course sheet: the `term` text box becomes a radio list of the calendar's terms + "Both semesters" (`''`), each with its dates; without a calendar, keep the text box.
- Sidebar: the semester select above Courses filters the list (all-year courses in both).
- Item model: allow `recur: 'weekly'` for labs too (`src/core/model.ts` normalise); `recurUntil` set from the chosen term's end or the year's end.

**Stage 4 — The item card.** Rebuild `src/components/sheet/item-sheet.tsx` as the prototype's card (spec §7), keeping every behaviour of today's sheet (drafts, typing saves, celebrate on finish, chain review, fill topics, prep pace, grade, weight, studied time, links, office-hours dept). New `src/components/sheet/date-picker.tsx` (week strip + month calendar) with its own tests: picks a day, ‹ › moves a week, Month opens, picking there returns to Week, Today, the busy dots.

**Stage 5 — Study.** `src/components/study/study-view.tsx` gets the tab list (Timer, History, Achievements, Leaderboard; the tab in `ui`), the Timer tab lays out the Ready card large beside Your flow and a new Today card; History full width with the week pane in two columns; Achievements groups two across; Leaderboard centred. The focus screen and dock unchanged.

**Stage 6 — Music.** Restyle `src/components/spotify/*` to the prototype's Music page and the focus panel (`src/components/focus/music-panel.tsx`); rename the page "Music". No change to the Spotify engine (`src/data/spotify/`).

**Stage 7 — Import with AI.** A top-bar button and an import card; a new Worker route `POST /api/ai/schedule` beside the outline route (`worker/outline.js` is the pattern: prompt, schema, validation, rate limit, tests with a fake `ai`). PDF timetables go through the text path; screenshots need a Workers AI vision model: pick one, measure its neuron cost, and keep test runs to a handful (the 10k/day allowance is shared with the live site). The preview writes to each course's `meetings` (≤12) and its `term`. The outline preview gains the semester picker.

---

## Stage 1 — The name and the look

**Branch:** `term-1-look` off `term` (which is off `main`).

**What the owner sees at the end:** the app called Term, in the new paper-and-ink look with the serif headings; the pages in the sidebar instead of the dock; the four boxes; the week as tidy rows with completed rows tinted pink and the checklist bars; month classes in their course colours; the quote, name, sync and Settings at the bottom of the sidebar; the sign-in screen in the same look. Medicine and CS both work; light and dark both work; nothing the app did before is gone.

### File structure

| File | Change | Responsibility |
|---|---|---|
| `package.json` | modify | add `@fontsource-variable/source-serif-4`, `@fontsource/ibm-plex-sans`; later remove Figtree and Spectral |
| `src/index.css` | modify | font imports, `--font-sans`, `--font-serif`, `--radius` |
| `src/styles/tokens.css` | modify | the new light/dark tokens for Medicine and CS; new `--side-bg`, `--done-bar-a/-b` |
| `src/styles/base.css` | modify | body font; plain scrollbars |
| `src/styles/shell.css` | modify | sidebar width and background; the ornament and drape rules go |
| `src/components/ui/texture-button.tsx` | modify | same API (`variant`, `size`), plain styles |
| `src/components/ui/card.tsx` | create | the plain card (white, 1px rule, 8px radius) |
| `src/components/side-nav.tsx` | create | the pages list in the sidebar |
| `src/components/side-nav.test.tsx` | create | its tests |
| `src/components/side-foot.tsx` | create | the sidebar's quote and account row (name, sync, Settings) |
| `src/components/side-foot.test.tsx` | create | its tests |
| `src/components/sync-status.tsx` | create | the sync button, moved out of the top bar |
| `src/components/sidebar.tsx` | modify | new order: wordmark, nav, types, courses, coat, player, foot |
| `src/components/top-bar.tsx` | modify | date line + serif title; dock, sync and Settings leave |
| `src/components/view-dock.tsx`, `ui/magnetic-dock.tsx` and their tests | delete | replaced by the side nav |
| `src/components/app.tsx`, `ornament.tsx` | modify / delete | the ornament and drape go |
| `src/components/views/bits.tsx` | modify | `Panel` on the plain card; `Steps` bar colours; `statusText()` |
| `src/components/views/status-text.test.ts` | create | tests for `statusText()` |
| `src/components/views/stats.tsx` | modify | four boxes; the quote tile goes |
| `src/components/views/week.tsx` | modify | day bands and entry rows; tasks tint |
| `src/components/views/month.tsx` | modify | class chips in course colours |
| `src/components/sign-in.tsx` | modify | the name and the look |
| strings across `src/` and `index.html`, `public/manifest.webmanifest` | modify | Rounds → Term |

---

### Task 1: The branch, the spec and the prototype

**Files:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md`, `docs/superpowers/plans/2026-09-29-term-redesign.md`, `design/term-prototype.dc.html` (already written on `main`'s working tree, uncommitted).

- [ ] **Step 1: Make the branches**

```bash
git switch -c term
git add docs/superpowers/specs/2026-09-29-term-redesign-design.md docs/superpowers/plans/2026-09-29-term-redesign.md design/term-prototype.dc.html
git commit -m "Spec and plan: the Term redesign; the approved prototype in design/

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch -c term-1-look
```

- [ ] **Step 2: Check the baseline is green**

Run: `npm ci && npm run check`
Expected: typecheck clean, all Vitest and node tests pass, build passes. If anything fails here, stop: it failed before this work.

---

### Task 2: The fonts

**Files:** Modify `package.json`, `src/index.css`, `src/styles/base.css`.

- [ ] **Step 1: Install**

```bash
npm install @fontsource-variable/source-serif-4 @fontsource/ibm-plex-sans
```

- [ ] **Step 2: Import them.** In `src/index.css`, under the existing `@import "@fontsource/spectral/…"` lines (leave Figtree and Spectral for now; Task 13 removes them), add:

```css
@import "@fontsource-variable/source-serif-4/wght.css";
@import "@fontsource-variable/source-serif-4/wght-italic.css";
@import "@fontsource/ibm-plex-sans/latin-400.css";
@import "@fontsource/ibm-plex-sans/latin-500.css";
@import "@fontsource/ibm-plex-sans/latin-600.css";
@import "@fontsource/ibm-plex-sans/latin-ext-400.css";
@import "@fontsource/ibm-plex-sans/latin-ext-500.css";
@import "@fontsource/ibm-plex-sans/latin-ext-600.css";
```

In the `@theme inline` block, replace the font lines and the radius:

```css
  --radius: 8px;
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-serif: "Source Serif 4 Variable", Georgia, serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
```

(`--font-serif` gives the `font-serif` utility.)

- [ ] **Step 3: The body font.** In `src/styles/base.css`, the `body` rule's `font-family` line becomes:

```css
  font-family:"IBM Plex Sans", system-ui, sans-serif;
```

- [ ] **Step 4: Check**

Run: `npm run build`
Expected: PASS, and `dist/assets/` holds `source-serif-4-*` and `ibm-plex-sans-*` `.woff2` files.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/index.css src/styles/base.css
git commit -m "Fonts: Source Serif 4 and IBM Plex Sans, self-hosted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The tokens

**Files:** Modify `src/styles/tokens.css`, `src/styles/base.css`.

The token names stay (every component reads them); their values change. Two new tokens: `--side-bg` (the sidebar) and `--done-bar-a`/`--done-bar-b` (the checklist bar's gradient).

- [ ] **Step 1: Medicine, light.** In the first `:root{…}` block of `src/styles/tokens.css`, replace the values of these lines (keep every other line as it is):

```css
  --bg:#F6F5F1; --panel:#FFFFFF; --panel-2:#FBFAF8; --side-bg:#EFEEE9;
  --ink:#1C1C1A; --ink-2:#55534E; --ink-3:#6E6B64;
  --line:#E6E3DC; --line-2:#EFEDE8;
  --accent:#0F5F58; --accent-soft:#EEF5F3; --accent-ink:#0A4540; --on-accent:#FFFFFF;
  --good:#2F7A4F; --crit:#A8322A; --on-crit:#FFFFFF; --warn:#8A5300;
  --done:#FBE8EF; --done-2:#F8DFE8; --done-line:#F2D3DF; --done-ink:#874A60; --done-track:#F3D3DE;
  --done-bar-a:#EFAEC3; --done-bar-b:#D9648C;
  --chip-bg:#F1EFEA; --chip-ink:#55534E;
  --bar-bg:#F6F5F1;
  --shadow-1:0 1px 2px rgba(28,28,26,.06);
  --shadow-2:0 2px 6px rgba(28,28,26,.06), 0 24px 60px rgba(28,28,26,.16);
  --lift:0 2px 6px rgba(28,28,26,.06), 0 24px 60px rgba(28,28,26,.16);
  --scrim:rgba(28,28,26,.28);
```

- [ ] **Step 2: Medicine, dark.** In `:root[data-app="dark"]{…}`, replace the same lines with:

```css
  --bg:#121312; --panel:#1B1C1A; --panel-2:#222320; --side-bg:#171816;
  --ink:#ECEAE4; --ink-2:#B9B6AE; --ink-3:#9A978F;
  --line:#2E2F2B; --line-2:#262724;
  --accent:#5CC2B6; --accent-soft:#16302D; --accent-ink:#8FDAD0; --on-accent:#06201D;
  --good:#5FB585; --crit:#EE7A68; --on-crit:#1B0A08; --warn:#DCA23F;
  --done:#35202A; --done-2:#3E2531; --done-line:#4A2C38; --done-ink:#EFB3C7; --done-track:#4A2C38;
  --done-bar-a:#B85C7E; --done-bar-b:#EF8FB0;
  --chip-bg:#262724; --chip-ink:#B9B6AE;
  --bar-bg:#121312;
  --scrim:rgba(0,0,0,.55);
```

- [ ] **Step 3: CS, light and dark.** In `:root[data-bg="cs"]{…}` set:

```css
  --bg:#F6F5F1; --panel:#FFFFFF; --panel-2:#FBFAF8; --side-bg:#EFEEE9;
  --ink:#1C1C1A; --ink-2:#55534E; --ink-3:#6E6B64;
  --line:#E6E3DC; --line-2:#EFEDE8;
  --accent:#2B4FA8; --accent-soft:#EFF2FA; --accent-ink:#1E3A80; --on-accent:#FFFFFF;
  --done:#E3F1E8; --done-2:#D7EBDF; --done-line:#C7E2D2; --done-ink:#2C6541; --done-track:#CFE7D8;
  --done-bar-a:#A8DDBC; --done-bar-b:#3E8E5E;
  --chip-bg:#F1EFEA; --chip-ink:#55534E;
```

and in `:root[data-app="dark"][data-bg="cs"]{…}`:

```css
  --bg:#121312; --panel:#1B1C1A; --panel-2:#222320; --side-bg:#171816;
  --ink:#ECEAE4; --ink-2:#B9B6AE; --ink-3:#9A978F;
  --line:#2E2F2B; --line-2:#262724;
  --accent:#8EA2F0; --accent-soft:#1B2340; --accent-ink:#B4C1F6; --on-accent:#0A1030;
  --done:#17301F; --done-2:#1D3A26; --done-line:#28503A; --done-ink:#9CD8B0; --done-track:#28503A;
  --done-bar-a:#3E8E5E; --done-bar-b:#8FD4A8;
  --chip-bg:#262724; --chip-ink:#B9B6AE;
```

- [ ] **Step 4: Plain scrollbars.** In `src/styles/base.css`, replace the scrollbar block (from `/* ═════════ scrollbars` to `::-webkit-scrollbar-corner{…}`) with:

```css
/* ═════════ scrollbars: thin and quiet ═════════ */
*{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
```

- [ ] **Step 5: Check the contrast of what changed.** Text on its background must be 4.5:1: `--ink-3` on `--bg`, `--done-ink` on `--done`, `--accent` on `--accent-soft`, and each dark pair. Run:

```bash
node -e "const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const r=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};for(const [a,b] of [['#6E6B64','#F6F5F1'],['#874A60','#FBE8EF'],['#0F5F58','#EEF5F3'],['#2C6541','#E3F1E8'],['#2B4FA8','#EFF2FA'],['#9A978F','#121312'],['#EFB3C7','#35202A'],['#5CC2B6','#16302D']])console.log(a,b,r(a,b))"
```

Expected: every ratio ≥ 4.5.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS (the tokens are CSS; no test reads their values).

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css
git commit -m "Tokens: paper and ink, one accent, the completed colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plain cards and buttons

**Files:** Create `src/components/ui/card.tsx`. Modify `src/components/ui/texture-button.tsx`, `src/components/views/bits.tsx`, `src/components/views/stats.tsx` (import only).

- [ ] **Step 1: The card.** Create `src/components/ui/card.tsx`:

```tsx
// A card: white on the paper, a 1px rule, an 8px corner. What the Texture card was.

import * as React from "react"
import { cn } from "@/lib/utils"

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn("rounded-[var(--radius)] border border-border bg-card", className)} {...props} />
    ),
)
Card.displayName = "Card"
```

- [ ] **Step 2: Panel on the card.** In `src/components/views/bits.tsx`, replace the `TextureCard` import with `import { Card } from "@/components/ui/card"`, delete the `FILL` constant, and replace `Panel` with:

```tsx
/** A panel: a card with a header line (title, then whatever `head` adds). `fill` takes the height left. */
export function Panel({ title, head, className, children, label, fill = false }: { title: ReactNode; head?: ReactNode; className?: string; children: ReactNode; label?: string; fill?: boolean }) {
    return (
        <Card className={cn("min-w-0 overflow-hidden", fill && "flex min-h-0 flex-1 flex-col", className)}>
            <section aria-label={label} className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
                    <h2 className="m-0 flex-1 text-[14px] font-semibold text-foreground">{title}</h2>
                    {head}
                </div>
                {children}
            </section>
        </Card>
    )
}
```

Then `rg -n "FILL" src` and replace each other use with `"flex min-h-0 flex-1 flex-col"`.

- [ ] **Step 3: The buttons.** Replace the body of `src/components/ui/texture-button.tsx` so the exported `TextureButton` keeps its props (`variant`: `"primary" | "accent" | "minimal" | …` as today, `size`, `className`, the rest) but draws a plain button. Keep the file's existing `variant` names; map them:

```tsx
import * as React from "react"
import { cn } from "@/lib/utils"

type Variant = "primary" | "secondary" | "accent" | "destructive" | "minimal" | "icon"
type Size = "default" | "sm" | "lg" | "icon"

const VARIANT: Record<Variant, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    accent: "bg-foreground text-background hover:opacity-90",
    secondary: "border border-border bg-card text-foreground hover:bg-muted",
    minimal: "border border-border bg-card text-foreground hover:bg-muted",
    icon: "bg-transparent text-ink-2 hover:bg-muted hover:text-foreground",
    destructive: "bg-destructive text-[var(--on-crit)] hover:opacity-90",
}
const SIZE: Record<Size, string> = {
    default: "h-9 px-3.5 text-[13px]",
    sm: "h-8 px-2.5 text-[12.5px]",
    lg: "h-11 px-5 text-[14px]",
    icon: "size-9",
}

export interface TextureButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant
    size?: Size
}

/** A plain button; the name is kept so its many callers don't change. */
export const TextureButton = React.forwardRef<HTMLButtonElement, TextureButtonProps>(
    ({ className, variant = "primary", size = "default", children, ...props }, ref) => (
        <button
            ref={ref}
            className={cn("inline-flex cursor-pointer items-center justify-center gap-2 rounded-[6px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
            {...props}
        >
            {children}
        </button>
    ),
)
TextureButton.displayName = "TextureButton"
```

Before replacing, open the current file and check its variant and size names; if it has one this list lacks, add it to `VARIANT`/`SIZE` with the closest style. Then `rg -n "\[&>div\]" src/components` — callers that styled the old nested `div` (e.g. the phone's round New item) now style the button itself: move those classes off `[&>div]:`.

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npm test`
Expected: PASS. A test that looked for the Texture card's nested `div`s fails: change it to look for the element by role.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/card.tsx src/components/ui/texture-button.tsx src/components/views
git commit -m "Plain cards and buttons in place of the Texture ones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The pages in the sidebar

**Files:** Create `src/components/side-nav.tsx`, `src/components/side-nav.test.tsx`. Delete `src/components/view-dock.tsx`, `src/components/view-dock.test.tsx`, `src/components/view-dock.reduced-motion.test.tsx`, `src/components/ui/magnetic-dock.tsx`. Modify `src/components/top-bar.tsx` (remove `<ViewDock />`).

- [ ] **Step 1: Write the failing test.** Create `src/components/side-nav.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify, setStudyBadge } from "@/bridge"
import { SideNav } from "@/components/side-nav"

// The app is not booted here: the nav only needs the view and setView.
const ui = vi.hoisted(() => ({ view: "week" }))
const setView = vi.hoisted(() => vi.fn())
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))

const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent)

afterEach(() => {
    cleanup()
    setView.mockClear()
    setStudyBadge(null)
    ui.view = "week"
})

describe("the pages in the sidebar", () => {
    it("lists the five pages, the current one marked", () => {
        render(<SideNav />)
        expect(screen.getByRole("navigation", { name: "Pages" })).toBeTruthy()
        expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Week", "Month", "All items", "Study", "Music"])
        expect(current()).toEqual(["Week"])
    })

    it("follows the view after a notify()", () => {
        render(<SideNav />)
        ui.view = "spotify"
        act(() => notify())
        expect(current()).toEqual(["Music"])
    })

    it("asks for a page when one is clicked", () => {
        render(<SideNav />)
        fireEvent.click(screen.getByRole("button", { name: "All items" }))
        expect(setView).toHaveBeenCalledWith("table")
    })

    it("shows the running timer beside Study", () => {
        setStudyBadge("24:13")
        render(<SideNav />)
        expect(screen.getByRole("button", { name: /Study/ }).textContent).toBe("Study24:13")
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/side-nav.test.tsx`
Expected: FAIL, "Failed to resolve import "@/components/side-nav"".

- [ ] **Step 3: Write the nav.** Create `src/components/side-nav.tsx`:

```tsx
// The pages, in the sidebar: Week, Month, All items, Study, Music. The view is the UI
// state's (ui.view); this reads it through the bridge and changes it with setView, the
// same call the 1–5 keys make. It replaces the dock that sat in the top bar.

import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { subscribe, getStudyBadge } from "@/bridge"
import { ui } from "@/data/ui"
import { setView } from "@/data/study-controller"

type View = "week" | "month" | "table" | "spotify" | "study"

export const PAGES: { id: View; label: string; shortcut: string }[] = [
    { id: "week", label: "Week", shortcut: "1" },
    { id: "month", label: "Month", shortcut: "2" },
    { id: "table", label: "All items", shortcut: "3" },
    { id: "study", label: "Study", shortcut: "5" },
    { id: "spotify", label: "Music", shortcut: "4" },
]

const currentView = () => ui.view as View

export function SideNav() {
    const view = useSyncExternalStore(subscribe, currentView)
    const badge = useSyncExternalStore(subscribe, getStudyBadge)
    return (
        <nav aria-label="Pages" className="flex flex-col gap-0.5">
            {PAGES.map((p) => {
                const on = p.id === view
                return (
                    <button
                        key={p.id}
                        type="button"
                        aria-current={on ? "page" : undefined}
                        title={p.label + " (" + p.shortcut + ")"}
                        onClick={() => setView(p.id)}
                        className={cn(
                            "flex h-8 cursor-pointer items-center justify-between rounded-[6px] border-0 px-2.5 text-left text-[14px]",
                            on ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--line)]" : "bg-transparent text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground",
                        )}
                    >
                        {p.label}
                        {p.id === "study" && badge && <span className="font-mono text-[11.5px] text-accent-foreground">{badge}</span>}
                    </button>
                )
            })}
        </nav>
    )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/components/side-nav.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Remove the dock.** Delete the four dock files. In `src/components/top-bar.tsx` delete the `import { ViewDock }` line and the `<div><ViewDock /></div>` line. Then `rg -n "ViewDock|magnetic-dock|VIEWS" src` must print nothing except `side-nav.tsx`'s `PAGES`; if `VIEWS` from the dock was imported elsewhere (e.g. the shortcuts panel), import `PAGES` from `@/components/side-nav` instead and map `label`.

- [ ] **Step 6: Put the nav in the sidebar.** In `src/components/sidebar.tsx`, import `SideNav` and render `<SideNav />` right after the wordmark `div` (Task 6 rewrites the rest of the sidebar).

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS. `top-bar.test.tsx` tests that looked for the dock now fail: delete those cases (the side nav's tests replace them).

- [ ] **Step 8: Commit**

```bash
git add -A src/components
git commit -m "The pages in the sidebar; the dock goes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The sidebar's foot: quote, name, sync, Settings

**Files:** Create `src/components/side-foot.tsx`, `src/components/side-foot.test.tsx`, `src/components/sync-status.tsx`. Modify `src/components/top-bar.tsx` (`SyncStatus` moves out; it and the Settings button leave the bar), `src/components/sidebar.tsx`, `src/components/views/stats.tsx` (the quote tile goes).

- [ ] **Step 1: Write the failing test.** Create `src/components/side-foot.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SideFoot } from "@/components/side-foot"

const toggleSettings = vi.hoisted(() => vi.fn())
const nextQuote = vi.hoisted(() => vi.fn())
vi.mock("@/data/actions", () => ({ toggleSettings, nextQuote, syncNow: vi.fn() }))
vi.mock("@/data/store", () => ({ useProfile: () => ({ displayName: "Alex Rivera", username: "alex" }) }))
vi.mock("@/data/sync", () => ({
    useSyncStatus: () => ({ state: "idle", message: "" }),
    useSyncAnnouncement: () => "",
    syncLabel: () => "Synced",
}))
const quote = vi.hoisted(() => ({ value: { ix: 0, quote: { text: "The good physician treats the disease.", source: "William Osler" } } as null | { ix: number; quote: { text: string; source: string } } }))
vi.mock("@/data/views", () => ({ useStats: () => ({ quote: quote.value, quoteCount: quote.value ? 2 : 0 }) }))

afterEach(() => { cleanup(); toggleSettings.mockClear(); nextQuote.mockClear() })

describe("the sidebar's foot", () => {
    it("shows the quote and who said it; a click turns to the next", () => {
        render(<SideFoot />)
        expect(screen.getByText(/The good physician/)).toBeTruthy()
        expect(screen.getByText("William Osler")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: /The good physician/ }))
        expect(nextQuote).toHaveBeenCalled()
    })

    it("without a quote, points to Settings", () => {
        quote.value = null
        render(<SideFoot />)
        expect(screen.getByText("Add a quote in Settings")).toBeTruthy()
        quote.value = { ix: 0, quote: { text: "The good physician treats the disease.", source: "William Osler" } }
    })

    it("shows the name, the sync state and Settings", () => {
        render(<SideFoot />)
        expect(screen.getByText("Alex Rivera")).toBeTruthy()
        expect(screen.getByRole("button", { name: /Synced/ })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Settings" }))
        expect(toggleSettings).toHaveBeenCalled()
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/side-foot.test.tsx`
Expected: FAIL, cannot resolve `@/components/side-foot`.

- [ ] **Step 3: The sync button in its own file.** Move `SyncStatus` and the `DOT` map out of `src/components/top-bar.tsx` into a new `src/components/sync-status.tsx` (its imports: `cn`, `syncLabel`, `useSyncAnnouncement`, `useSyncStatus` from `@/data/sync`, `syncNow` from `@/data/actions`, `SyncState` from `@/data/types`). Export it as `export function SyncStatus({ className }: { className?: string })` and add `className` to the button's `cn(…)` list. Then delete the `<SyncStatus />` and the Settings `TextureButton` from `TopBar`'s JSX, and the imports `TopBar` no longer uses. (Its own file keeps the sidebar's test from loading the whole top bar.)

- [ ] **Step 4: Write the foot.** Create `src/components/side-foot.tsx`:

```tsx
// The bottom of the sidebar: your quote (a click turns to the next), then your name, the
// sync state and Settings. The quote was a tile above the week; the name, sync and
// Settings were in the top bar.

import { useProfile } from "@/data/store"
import { useStats } from "@/data/views"
import { nextQuote, toggleSettings } from "@/data/actions"
import { SyncStatus } from "@/components/sync-status"

const gear = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
)

export function SideFoot() {
    const profile = useProfile()
    const { quote } = useStats()
    return (
        <div className="flex flex-col gap-3">
            <div className="border-t border-border px-2.5 pt-3.5">
                {quote ? (
                    <button type="button" onClick={(e) => nextQuote(e.currentTarget)} className="flex w-full cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left font-[inherit]">
                        <span className="font-serif text-[14.5px] leading-[1.45] text-[color:color-mix(in_srgb,var(--ink)_85%,transparent)] italic">“{quote.quote.text}”</span>
                        <span className="text-[12px] text-muted-foreground">{quote.quote.source || "Unattributed"}</span>
                    </button>
                ) : (
                    <span className="font-serif text-[14px] text-muted-foreground italic">Add a quote in Settings</span>
                )}
            </div>
            <div className="flex items-center gap-2.5 border-t border-border pt-3 pl-2.5">
                <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="truncate font-medium text-foreground">{profile?.displayName || profile?.username || ""}</span>
                    <SyncStatus className="border-0 bg-transparent px-0 py-0 text-[12px]" />
                </div>
                <button type="button" aria-label="Settings" title="Settings" onClick={toggleSettings}
                    className="grid size-9 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground">
                    {gear}
                </button>
            </div>
        </div>
    )
}
```

If `nextQuote`'s signature in `src/data/actions.ts` takes no argument, call `nextQuote()`.

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run src/components/side-foot.test.tsx`
Expected: 3 passed.

- [ ] **Step 6: The sidebar's order.** Replace `Sidebar()` in `src/components/sidebar.tsx` with:

```tsx
export function Sidebar() {
    const bg = useUi((u) => u.bg)
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex grow flex-col gap-5 px-1 pt-1">
                <div className="flex items-baseline justify-between px-2.5">
                    <span className="font-serif text-[26px] font-semibold tracking-[-.01em]">Term</span>
                    <span className="text-[12px] font-medium text-accent-foreground">{bg === "cs" ? "Computer Science" : "Medicine"}</span>
                </div>
                <SideNav />
                <CourseList />
                <TypeList />
                <div className="mt-auto flex flex-col gap-3.5 pt-2">
                    <Coat />
                    <SidebarPlayer />
                    <SideFoot />
                </div>
            </div>
        </MotionConfig>
    )
}
```

with the imports `import { SideNav } from "./side-nav"` and `import { SideFoot } from "./side-foot"`. In `src/styles/shell.css`: `.app` columns `260px minmax(0,1fr)`; `.side` background `var(--side-bg)`, no `background-image` (delete the weave and the CS dot grid), padding `24px 20px 18px`.

- [ ] **Step 7: The quote tile goes.** In `src/components/views/stats.tsx` delete `QuoteTile`, its `<QuoteTile … />`, `QUOTE_EVERY_MS` and the `useEffect`/`useRef` imports it used. `rg -n "QUOTE_EVERY_MS|QuoteTile" src` and move any test of the quote's timer to `side-foot.test.tsx` (keep the rule: the quote turns by itself every 25s unless hovered, focused or reduced motion; if you move it, move the `useEffect` into `SideFoot` too).

- [ ] **Step 8: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS after updating `top-bar.test.tsx` (Settings and sync are no longer in the bar: move those cases to `side-foot.test.tsx` or delete them if already covered) and `sidebar.test.tsx` (the brand reads "Term").

- [ ] **Step 9: Commit**

```bash
git add -A src
git commit -m "The sidebar's foot: quote, name, sync and Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The top bar

**Files:** Modify `src/components/top-bar.tsx`, `src/components/view-heading.ts`, `src/components/top-bar.test.tsx`, `src/styles/shell.css`.

- [ ] **Step 1: Write the failing test.** Add to `src/components/top-bar.test.tsx` (inside its existing `describe`, using its existing setup):

```tsx
    it("shows the date line over the title, the title in the serif", () => {
        render(<TopBar />)
        const h1 = screen.getByRole("heading", { level: 1 })
        expect(h1.className).toContain("font-serif")
        expect(h1.previousElementSibling?.textContent).toBeTruthy()
    })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/top-bar.test.tsx`
Expected: FAIL (no `font-serif`; the sub line is under the title today).

- [ ] **Step 3: The title block.** In `TopBar`, replace the `<div className="min-w-0">…</div>` holding the `h1` with:

```tsx
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[13px] text-muted-foreground">{heading.sub || " "}</span>
                <h1 className="m-0 truncate font-serif text-[34px] leading-[1.1] font-medium tracking-[-.015em] text-foreground">{heading.title}</h1>
            </div>
```

and delete the spacer `<div className="flex-[1_1_20px]" />`. Keep ‹ Today ›, Search and New item in that order after it. In `src/styles/shell.css`, `.bar`: `padding:28px 40px 0;border-bottom:0;background:var(--bg);backdrop-filter:none;align-items:flex-end;gap:16px` and `.scroll`: `padding:24px 40px 28px;gap:24px`.

- [ ] **Step 4: The date line's words.** Open `src/components/view-heading.ts`. Make the week's `title` the range ("28 Sep – 4 Oct") and its `sub` the day and the school week ("Tuesday 29 September · Fall 2026, week 4 of 14", using the existing school-week label); month: title "October 2026". Add a unit test beside the existing heading tests (`rg -n "viewHeading" src test` to find them) for one week and one month.

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "The top bar: the date line over a serif title

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The four boxes

**Files:** Modify `src/components/views/stats.tsx`, `src/index.css` (`#stats` grid), `src/components/views/views.test.tsx`.

- [ ] **Step 1: Write the failing test.** Add to `src/components/views/views.test.tsx` (in the stats `describe`; use its existing booted fixture):

```tsx
    it("shows four boxes and no emoji", () => {
        render(<Stats />)
        const labels = ["Next exam or quiz", "Open assignments", "Overdue", "Studied today"]
        for (const l of labels) expect(screen.getByText(l)).toBeTruthy()
        expect(document.getElementById("stats")?.textContent ?? document.body.textContent).not.toMatch(/🔥/)
    })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/views/views.test.tsx`
Expected: FAIL ("Next exam or quiz" not found; the label is "Next exam / quiz").

- [ ] **Step 3: The box.** Replace `Tile` in `stats.tsx` with:

```tsx
function Box({ label, value, foot, tone, onClick, title, children }: {
    label: string; value: ReactNode; foot: ReactNode; tone?: "crit" | "good"
    onClick?: () => void; title?: string; children?: ReactNode
}) {
    const body = (
        <>
            <span className="text-[12.5px] text-muted-foreground">{label}</span>
            <span className={cn(
                "font-serif text-[34px] leading-[1.1] font-medium tabular-nums [&_small]:font-sans [&_small]:text-[15px] [&_small]:font-normal [&_small]:text-muted-foreground",
                tone === "crit" ? "text-destructive" : tone === "good" ? "text-[var(--done-ink)]" : "text-foreground",
            )}>{value}</span>
            {children}
            <span className="mt-auto truncate text-[12.5px] text-ink-2">{foot}</span>
        </>
    )
    const box = "flex h-[132px] w-full min-w-0 flex-col gap-1 rounded-[var(--radius)] border border-border bg-card px-[18px] pt-4 pb-3.5 text-left font-[inherit] max-[700px]:flex-[0_0_170px] max-[700px]:snap-start"
    return onClick
        ? <button type="button" onClick={onClick} title={title} className={cn(box, "cursor-pointer")}>{body}</button>
        : <div className={box}>{body}</div>
}
```

and the four uses in `Stats()`:

```tsx
            <Box
                label="Next exam or quiz"
                onClick={exam ? () => openItem(exam.id) : undefined}
                title={exam ? "Open " + exam.title : undefined}
                value={<span className="block truncate text-[21px] leading-[1.15]">{exam ? exam.title + " " + tmeta(exam.type).label.toLowerCase() : "Nothing scheduled"}</span>}
                foot={exam ? (dd === 0 ? "Today" : dd === 1 ? "Tomorrow" : "In " + dd + " days") + (s.prep ? " · " + prepLabel(s.prep) : "") : "Enjoy the quiet"}
            />
            <Box label="Open assignments" value={s.openAssignments} foot={s.dueThisWeek ? s.dueThisWeek + " due this week" : "None due this week"} />
            <Box label="Overdue" tone={s.overdue ? "crit" : "good"} value={s.overdue} foot={s.overdue ? "Needs attention today" : "All caught up"} />
            <Box
                label="Studied today"
                onClick={openStudy}
                title="Open Study"
                value={<>{studyTime(study.minutes)}{study.goal > 0 && <small> of {studyTime(study.goal)}</small>}</>}
                foot={study.goal > 0 ? (study.streak > 0 ? study.streak + "-day streak" : left ? left + " min to your goal" : "Daily goal reached") : "Set a daily goal"}
            >
                {study.goal > 0 && (
                    <span className="mt-auto block h-1 overflow-hidden rounded-full bg-line-2" role="meter" aria-label="Daily goal" aria-valuemin={0} aria-valuemax={study.goal} aria-valuenow={Math.min(study.minutes, study.goal)}>
                        <i className="block h-full rounded-full bg-primary" style={{ width: Math.min(100, Math.round((study.minutes / study.goal) * 100)) + "%" }} />
                    </span>
                )}
            </Box>
```

Delete `Pulse` and the `cs` variable (Stage 2 brings the animations back per theme), the `TextureCard` import, and `hot`.

- [ ] **Step 4: The row.** In `src/index.css`, `#stats`: `grid-template-columns: 1.6fr 1fr 1fr 1.2fr; gap: 16px;` (keep the phone rules).

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS after updating tests that read the old labels ("Next exam / quiz", "Study today", "needs attention today", the 🔥 streak) to the new words.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "The four boxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: A status in words

**Files:** Modify `src/components/views/bits.tsx`. Create `src/components/views/status-text.test.ts`.

The rows' right-hand column: what matters about the entry now, in a word or two, and its tone.

- [ ] **Step 1: Write the failing test.** Create `src/components/views/status-text.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { statusText } from "@/components/views/bits"
import type { Item } from "@/data/types"

const item = (over: Partial<Item>): Item => ({ id: "i", type: "assignment", title: "t", courseId: null, date: "2026-09-29", start: "", end: "", where: "", status: "todo", notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, ...over } as unknown as Item)

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 29, 9, 0)) })
afterEach(() => vi.useRealTimers())

describe("statusText", () => {
    it("a finished item says its status, in the done tone", () => {
        expect(statusText(item({ status: "submitted" }), "2026-09-29")).toEqual({ text: "Submitted", tone: "done" })
    })
    it("an overdue item says so", () => {
        expect(statusText(item({ date: "2026-09-28" }), "2026-09-28")).toEqual({ text: "Overdue", tone: "late" })
    })
    it("due today with no start time: due tonight", () => {
        expect(statusText(item({}), "2026-09-29")).toEqual({ text: "Due tonight", tone: "soon" })
    })
    it("today with a start time: today", () => {
        expect(statusText(item({ type: "tutoring", start: "11:00" }), "2026-09-29")).toEqual({ text: "Today", tone: "soon" })
    })
    it("tomorrow, then in n days", () => {
        expect(statusText(item({ date: "2026-09-30" }), "2026-09-30")).toEqual({ text: "Tomorrow", tone: "" })
        expect(statusText(item({ date: "2026-10-02" }), "2026-10-02")).toEqual({ text: "In 3 days", tone: "" })
    })
    it("a weekly item says which day it repeats", () => {
        expect(statusText(item({ recur: "weekly", weekday: 5, date: "2026-09-04" }), "2026-10-02")).toEqual({ text: "Every Fri", tone: "" })
    })
})
```

(If `Item` has required fields this literal lacks, the cast keeps the test honest about what `statusText` reads: `status`, `date`, `start`, `end`, `recur`, `weekday`, `type`.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/views/status-text.test.ts`
Expected: FAIL, `statusText` is not exported.

- [ ] **Step 3: Write it.** Add to `src/components/views/bits.tsx` (with `import { isComplete, isOverdue, statusLabel, tmeta } from "@/core/model"` and `import { diffDays, today, DOW } from "@/core/dates"`):

```tsx
export type StatusTone = "done" | "late" | "soon" | ""

/** The right-hand word for an entry on `date`: done, overdue, due tonight, today, tomorrow, in n days, every Fri. */
export function statusText(it: Item, date: string): { text: string; tone: StatusTone } {
    if (isComplete(it)) return { text: statusLabel(it), tone: "done" }
    if (it.recur === "weekly") return { text: "Every " + DOW[it.weekday ?? 0], tone: "" }
    if (isOverdue(it)) return { text: "Overdue", tone: "late" }
    const d = diffDays(today(), date)
    if (d === 0) return { text: it.start ? "Today" : "Due tonight", tone: "soon" }
    if (d === 1) return { text: "Tomorrow", tone: "" }
    if (d > 1) return { text: "In " + d + " days", tone: "" }
    return { text: "", tone: "" }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/components/views/status-text.test.ts`
Expected: 6 passed. If "Submitted" fails, check `statusLabel`'s word for `submitted` in `STATUS` (`src/core/model.ts`) and use it in the test.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/bits.tsx src/components/views/status-text.test.ts
git commit -m "statusText: the rows' word for now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The week as rows

**Files:** Modify `src/components/views/week.tsx`, `src/components/views/bits.tsx` (`Steps`), `src/components/views/views.test.tsx`.

- [ ] **Step 1: Write the failing test.** Add to `views.test.tsx` (week `describe`, booted fixture with one completed item and one open item with a checklist; the file's existing fixtures show how to add items):

```tsx
    it("tints a completed row and keeps the checklist bar on an open one", () => {
        render(<WeekView />)
        const done = screen.getByRole("button", { name: /Histology slides/ })
        expect(done.getAttribute("data-done")).toBe("true")
        expect(done.textContent).toMatch(/Done|Attended|Submitted|Taken/)
        const open = screen.getByRole("button", { name: /Case write-up/ })
        expect(open.querySelector("[data-steps]")).toBeTruthy()
    })
```

(Use titles that exist in the fixture; rename them in the test if the fixture's differ.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/views/views.test.tsx`
Expected: FAIL, no `data-done`.

- [ ] **Step 3: The checklist bar in the theme's colours.** Replace `Steps` in `bits.tsx`:

```tsx
/** The checklist's progress: a bar that fills in the theme's completed colours, and "2/5". */
export function Steps({ item }: { item: Item }) {
    const list = item.checklist || []
    if (!list.length) return null
    const done = list.filter((x) => x.done).length
    return (
        <span data-steps className="flex flex-none items-center gap-1.5 text-[11.5px] font-normal text-muted-foreground" title={done + " of " + list.length + " steps"}>
            <span className="h-[5px] w-12 overflow-hidden rounded-full bg-[var(--done-track)]">
                <i className="block h-full rounded-full bg-[linear-gradient(90deg,var(--done-bar-a),var(--done-bar-b))] transition-[width] duration-500" style={{ width: Math.round((done / list.length) * 100) + "%" }} />
            </span>
            {done}/{list.length}
        </span>
    )
}
```

- [ ] **Step 4: The rows.** In `week.tsx`, replace `EntryCard` and `ItemCard` with one `EntryRow`, and the `DayRow` markup:

```tsx
const ROW = "grid w-full grid-cols-[46px_minmax(0,1fr)_84px_124px_92px] items-center gap-3 rounded-[6px] px-2.5 min-h-[34px] text-left text-[14px] max-[720px]:grid-cols-[46px_minmax(0,1fr)_auto]"
const clock = (t: string | null | undefined) => (t ? t.slice(0, 5) : "")

function EntryRow({ entry }: { entry: Entry }) {
    if (entry.kind === "class") {
        const { slot } = entry
        return (
            <div style={accent(slot.course.color)} title={classTitle(slot)} className={cn(ROW, "text-ink-2")}>
                <span className="font-mono text-[12.5px] text-muted-foreground">{clock(slot.mtg.start)}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                    <i aria-hidden="true" className="size-2 flex-none rounded-full border-[1.5px] border-[var(--c)]" />
                    <span className="truncate">{slot.mtg.kind || "Class"}</span>
                </span>
                <span className="text-[12.5px] text-muted-foreground max-[720px]:hidden">Class</span>
                <span className="truncate text-[12.5px] text-muted-foreground max-[720px]:hidden">{slot.course.name || slot.course.code}</span>
                <span className="truncate text-right text-[12.5px] text-muted-foreground">{slot.mtg.room}</span>
            </div>
        )
    }
    const it = entry.inst.item, c = courseOf(it.courseId) as Course | null
    const st = statusText(it, entry.inst.date), done = st.tone === "done"
    const key = !done && isTest(it.type)
    return (
        <button
            type="button"
            onClick={() => openItem(it.id)}
            data-done={done || undefined}
            style={accent(tmeta(it.type).color)}
            className={cn(ROW, "cursor-pointer border-0 font-[inherit] transition-colors hover:brightness-[.975]",
                done ? "bg-[var(--done)] text-[var(--done-ink)]" : "bg-transparent text-foreground")}
        >
            <span className={cn("font-mono text-[12.5px]", done ? "" : "text-muted-foreground")}>{clock(it.start || it.end)}</span>
            <span className={cn("flex min-w-0 items-center gap-2.5", key && "font-semibold")}>
                <i aria-hidden="true" className={cn("size-2 flex-none rounded-[2px]", done ? "bg-[var(--done-ink)]" : "bg-[var(--c)]")} />
                <span className="truncate">{it.title}</span>
                {!done && <Steps item={it} />}
            </span>
            <span className={cn("text-[12.5px] max-[720px]:hidden", done ? "" : "text-muted-foreground")}>{tmeta(it.type).label}</span>
            <span className={cn("truncate text-[12.5px] max-[720px]:hidden", done ? "" : "text-muted-foreground")}>{c?.name || ""}</span>
            <span className={cn("flex items-center justify-end gap-1 text-right text-[12.5px] whitespace-nowrap",
                st.tone === "late" ? "font-medium text-destructive" : st.tone === "soon" ? "font-medium text-[var(--warn)]" : st.tone === "done" ? "font-medium" : "text-muted-foreground")}>
                {done && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>}
                {st.text}
            </span>
        </button>
    )
}
```

In `DayRow`, the band: `grid grid-cols-[64px_minmax(0,1fr)] gap-1 border-t border-line-2 py-2 pr-3 pl-5`; today adds `bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]`. The gutter: `<span className="flex items-baseline gap-1.5"><span className="font-serif text-[21px] leading-none">{day.day}</span><span className="text-[12px] text-muted-foreground">{day.dow}</span></span>`, then `Today` in `text-[11.5px] font-medium text-accent-foreground` when `day.isToday`, then `SchoolTags` and the `+` button as today. Entries: `day.entries.map((e) => <EntryRow key={e.key} entry={e} />)`; with none, "Nothing scheduled" in `px-2.5 text-[13px] text-muted-foreground` (keep the break/day-off rule). Delete `Rule`, `HELIX_A`, `HELIX_B`, `TICKS` and the `<Rule … />`. Import `statusText` from `./bits`; drop imports no longer used (`SoonChip`, `StatusChip`, `TypeChip`, `diffDays`, `dueSoon`, `hhmm` if unused).

- [ ] **Step 5: Tasks tint too.** In `Tasks`, the `li` gets `className={cn("flex items-center gap-2 rounded-[6px] px-2.5 py-1.5", on && "bg-[var(--done)] text-[var(--done-ink)]")}` and the title button drops `line-through`, taking `text-[var(--done-ink)]` when `on`. The panel's header style comes from `Panel` (Task 4).

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS after updating week tests that looked for the old chips ("Soon", the type chip) to the row's words.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "The week as rows; completed rows tint in the theme's colour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Month classes in their course colours

**Files:** Modify `src/components/views/month.tsx`, `src/components/views/views.test.tsx`.

- [ ] **Step 1: Write the failing test.** In the month `describe` of `views.test.tsx`:

```tsx
    it("draws a class in its course's colour", () => {
        render(<MonthView />)
        const chip = document.querySelector("[data-class-chip]") as HTMLElement
        expect(chip).toBeTruthy()
        expect(chip.style.getPropertyValue("--c")).toMatch(/^#[0-9A-F]{6}$/i)
    })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/views/views.test.tsx`
Expected: FAIL, no `[data-class-chip]`.

- [ ] **Step 3: The chip.** In `month.tsx`, find where a class is drawn in a day cell (`rg -n "ClassText" src/components/views/month.tsx`) and wrap it:

```tsx
<span data-class-chip style={accent(slot.course.color)}
    className="flex h-5 min-w-0 items-center gap-1.5 rounded-[4px] bg-[color-mix(in_srgb,var(--c)_12%,var(--panel))] px-1.5 text-[11.5px] font-medium text-[color-mix(in_srgb,var(--c)_85%,var(--ink))]">
    <i aria-hidden="true" className="size-1.5 flex-none rounded-full bg-[var(--c)]" />
    <span className="truncate"><ClassText slot={slot} compact /></span>
</span>
```

Deadlines in a cell: a white chip with `shadow-[inset_0_0_0_1px_var(--line)]` and the type's 6px square; completed ones `bg-[var(--done)] text-[var(--done-ink)]`.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Month: classes in their course's colour, completed deadlines tinted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The name: Rounds becomes Term

**Files:** Modify `index.html`, `public/manifest.webmanifest`, `src/components/sign-in.tsx`, `src/components/sheet/settings-sheet.tsx`, `src/components/sidebar-coat.tsx` (the badge's "ROUNDS"), `src/components/spotify/*.tsx`, `src/components/focus/music-pill.tsx`, `src/data/spotify/*.ts` (the device name), `src/core/db.ts`, `src/core/sync.ts` (messages), their tests.

- [ ] **Step 1: List every place a person reads it**

Run: `rg -n "Rounds" index.html public src worker --glob '!**/*.test.*'`
Expected: the list in the spec. Leave identifiers (`onRoundsIfIdle`, `setRounds`, `studyRounds`, CSS comments) and the Worker's name alone; change strings people see.

- [ ] **Step 2: Change the tests first.** `rg -n "Rounds" src test --glob '**/*.test.*'` and change each expected string to Term (e.g. "Play in Rounds" → "Play in Term").

- [ ] **Step 3: Run them to see them fail**

Run: `npm test`
Expected: the changed tests FAIL.

- [ ] **Step 4: Change the strings** in the files from Step 1: the title and `apple-mobile-web-app-title` in `index.html`, `name` and `short_name` in the manifest, "Rounds" in sign-in, Settings' foot and hints, the badge header, Spotify's labels and the Web Playback device name, the IndexedDB and sync messages ("Close older Term tabs…", "Reload Term to finish the update…"). The sign-in wordmark: drop the `TextGif`; render `<span className="font-serif text-6xl font-semibold tracking-[-.02em]">Term</span>` (and remove `public/wordmark.gif` only if nothing else uses it: `rg -n "wordmark.gif"`).

- [ ] **Step 5: Run everything, including the CSP build**

Run: `npm run check`
Expected: PASS. If the build's CSP hash check fails after editing `index.html`, run `npm run csp:update` and check `index.html` is still LF (`git diff --stat` shows no whole-file change).

- [ ] **Step 6: Commit**

```bash
git add -A index.html public src
git commit -m "Rounds is now Term

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The old look's leftovers

**Files:** Delete `src/components/ornament.tsx` (and its test if any), `src/components/ui/texture-card.tsx` (if unused), `src/components/ui/text-gif.tsx` (if unused). Modify `src/components/app.tsx` (Ornament, Drape), `src/styles/shell.css` (`#orn`, `.drape`, `.bgthumb` art stays until Stage 2 redoes the theme picker), `src/index.css` and `package.json` (Figtree, Spectral).

- [ ] **Step 1: Remove the ornament and the drape.** In `app.tsx` delete `<Ornament />`, `<Drape />`, the `Drape` constant and the `Ornament` import. Delete `ornament.tsx`. `rg -n "ornament|orn-" src` and remove what's left (the `--orn-*` tokens, `#orn` and `.drape` rules, the ornament's signal in `src/data/` if it only served the ornament).

- [ ] **Step 2: Remove unused components.** `rg -n "texture-card|TextureCard|text-gif|TextGif" src`; delete each file that is no longer imported.

- [ ] **Step 3: Remove the old fonts.** `rg -n "Figtree|Spectral" src`; replace each use with `font-sans` or `font-serif` (the coat's embroidery: `font-serif italic`). Then delete their `@import` lines from `src/index.css` and run `npm uninstall @fontsource-variable/figtree @fontsource/spectral`.

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS; `dist/assets` has no `figtree` or `spectral` files.

- [ ] **Step 5: Commit**

```bash
git add -A package.json package-lock.json src
git commit -m "The old look's leftovers go: ornament, drape, textures, Figtree, Spectral

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Look at it, side by side with the prototype

**Files:** none unless something is off.

- [ ] **Step 1: Run it.** Check port 8787 is free (see "How to work" 2), then `npm run dev` and sign in with the local test account from the project's seed/config (`docs/DEPLOYING.md` says how to add one with `npm run user:add` against the local D1).
- [ ] **Step 2: Compare, at 1440×960:** the week, month, table, study and music pages; the sidebar; the top bar; the boxes; a completed row; a checklist bar filling as steps are ticked in the item sheet; the month's class chips. Against the prototype's Medicine week board (canvas "Medicine — week"). Note every difference in a list.
- [ ] **Step 3: Both themes and both modes:** Settings → CS, then dark. Check text is readable everywhere (the contrast check covered the pairs; look for anything drawn with a colour that wasn't a token).
- [ ] **Step 4: The phone width (390px):** the sidebar slides in, the boxes swipe, the rows keep time, title and status (the type and course columns hide), New item floats. Nothing overflows sideways.
- [ ] **Step 5: Keyboard:** Tab through the sidebar pages and the rows; the focus ring shows; 1–5 still switch pages.
- [ ] **Step 6: Fix what the list found**, each fix its own commit with its test where a test can catch it.

---

### Task 15: The owner's review and the release

- [ ] **Step 1: Full checks**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 2: Ask for a review.** Use superpowers:requesting-code-review on `term-1-look` against `term`. Fix what it finds.

- [ ] **Step 3: Show the owner.** Run the production build locally (`npm run dev:built`) and have the owner look: Medicine and CS, light and dark, phone width. Ask the open question from the spec: keep the type filters in the sidebar, or drop them?

- [ ] **Step 4: Merge on a yes.** `git switch term && git merge --no-ff term-1-look`. Then, with the owner's go-ahead to release: `git switch main && git merge --no-ff term`, push, and the Cloudflare Git build deploys. No migration in this stage.

- [ ] **Step 5: Check the live site** at https://rounds.termanitor07.workers.dev: sign in, the week renders, a change syncs. Then write the Stage 2 plan (this file's "What each later stage must cover" is its start).
