# Term Stage 2: Themes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six themes (Medicine, Computer Science, Law, Aviation, Sports, Engineering), each with its sidebar picture carrying the person's name and goal, its colours in light and dark, its next-exam animation, its study word, its dark study colour and its default quote; picked in a rebuilt Settings "You" tab.

**Architecture:** One registry, `src/data/themes.ts`, holds every per-theme word and colour the code needs (ids, labels, goals, quotes, study word, picture label). CSS tokens carry the colours (`:root[data-bg="…"]` blocks). The database only widens a CHECK: the owner asked for a **clean database** instead of a patch migration, so `migrations/0001_schema.sql` is edited in place and the live data is copied into a fresh `rounds-v5` with `scripts/move-db.mjs` at release (as done for v2, v3 and v4). The profile's API field stays `bg`; the goal is stored in the existing `coat.role`.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4, Vitest (jsdom + Workers pool), Cloudflare Workers + D1.

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §5. **Prototype:** `design/term-prototype.dc.html` (read, don't open): `THEMES` line 1507, `STUDY` 1755, `GOALS` 1966, the pictures lines 59–177, the next-exam animations 226–263, Settings' theme and goal sections 1024–1060, the keyframes 21–30.

**Branch:** `term-2-themes` off `term` (`git switch term && git switch -c term-2-themes`).

**What the owner sees at the end:** Settings → You lists six themes as rows; picking one changes the accent, the "today" tint, the completed pink/mint/parchment/sky/peach/yellow, the sidebar's picture (coat, badge, suit, jacket, jersey, vest) with their name and "Headed for *goal*", the animation in the next-exam box, and the study word on the focus screen and dock. Dark mode works for all six. Their data is all still there after the move to `rounds-v5`.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run src/components/sidebar-picture/pictures.test.tsx`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. If the page is blank and titled "Rounds", an old service worker is serving its cache: DevTools → Application → Service workers → Unregister, then reload.
3. **Line endings:** keep every file LF. A CRLF in `index.html` breaks the CSP hash. After editing `index.html`'s inline script run `npm run csp:update`, then check `git diff --stat index.html public/_headers` shows only the lines you meant.
4. **Colours in inline styles** go through React's `style` prop (the CSP allows styles set through the DOM).
5. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `term-2-themes`. Never touch the remote database or push without the owner's yes (Task 13 asks).
6. **Tests find text.** When a task changes a word, `rg -n "<old word>" src test` and update the tests in the same commit.
7. **SVG text:** never put words inside `<svg><text>`: names and goals are HTML spans positioned over the drawing.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `migrations/0001_schema.sql` | modify | `bg` CHECK allows the six ids |
| `test/fixtures/legacy-migrations/*` | replace | the schema `rounds-v4` was built from (today's `0001_schema.sql`), for the move test |
| `worker/validate.js` | modify | `BACKGROUNDS` has the six |
| `src/data/themes.ts` | create | the registry: `Bg`, `BGS`, `THEMES`, `GOALS`, `toBg`, `goalFor` |
| `src/data/theme.ts`, `src/data/ui.ts`, `src/data/types.ts`, `index.html` | modify | accept and apply the six |
| `src/core/model.ts` | modify | Projects shown by default for CS and Engineering |
| `src/styles/tokens.css` | modify | per-theme colour blocks, light and dark; `--motif`; the dark study surfaces |
| `src/components/sidebar-picture/*` | create | one picture per theme, the name helpers, the tests |
| `src/components/sidebar-who.tsx` | create | the picture plus "Headed for *goal*" in the sidebar |
| `src/components/sidebar-coat.tsx` | delete | the old pocket and ID badge |
| `src/components/sidebar.tsx` | modify | the theme's name under the wordmark; `SidebarWho` |
| `src/components/spotify/sidebar-player.tsx` | modify | the coat clip only on Medicine |
| `src/components/sheet/settings-sheet.tsx` | modify | Theme rows, Where you're headed, Your name, Coat colour (Medicine), Appearance |
| `src/styles/shell.css` | modify | drop `.bgthumb` and `.coatpreview` |
| `src/components/views/exam-motif.tsx` | create | the next-exam animation per theme and the countdown |
| `src/components/views/stats.tsx`, `src/index.css` | modify | the motif in the box; the keyframes |
| `src/data/study-timer.ts`, `src/components/focus/focus-screen.tsx`, `src/components/study/study-dock.tsx` | modify | the study word |
| `src/components/side-foot.tsx`, `src/data/views.ts` (quote) | modify | the theme's quote when none are saved |
| `src/components/views/week.tsx` | modify | drop the corner art; the office-hours mark for every theme |
| `src/components/sign-in.tsx`, `index.html`, `public/manifest.webmanifest` | modify | "med-school" wording goes |
| `wrangler.jsonc` | modify (Task 13) | the `DB` binding points at `rounds-v5` |

---

### Task 1: The six themes in the schema and the Worker

**Files:**
- Modify: `migrations/0001_schema.sql:27-28`
- Replace: `test/fixtures/legacy-migrations/` (all six files → one)
- Modify: `worker/validate.js:18`
- Test: `test/validation.test.js`, `test/api.test.js`, `test/database-structure.test.js`

- [ ] **Step 1: Freeze the schema `rounds-v4` was built from as the legacy fixture.** The move test copies from the legacy schema into the new one, so the fixture must be what the live database has now: today's `0001_schema.sql`, before this task edits it.

```bash
git rm -q test/fixtures/legacy-migrations/*.sql
mkdir -p test/fixtures/legacy-migrations
cp migrations/0001_schema.sql test/fixtures/legacy-migrations/0001_schema.sql
git add test/fixtures/legacy-migrations/0001_schema.sql
```

- [ ] **Step 2: Change the tests first.** In `test/validation.test.js`, replace the test "accepts the CS background and rejects anything else" with:

```js
  it('accepts the six backgrounds and rejects anything else', () => {
    for (const bg of ['med', 'cs', 'law', 'pilot', 'sports', 'eng']) expect(validateProfile({ ...profile, bg }).bg).toBe(bg);
    expect(() => validateProfile({ ...profile, bg: 'foo' })).toThrow();
  });
```

In `test/api.test.js`, in "PUT /api/me saves the background…", change `bg: 'cs'` to `bg: 'law'` and `expect(saved.bg).toBe('cs')` to `expect(saved.bg).toBe('law')`.

In `test/database-structure.test.js` "stores project items and a background per user", replace the `'law'` line with:

```js
    await env.DB.prepare("UPDATE users SET bg = 'law' WHERE id = ?").bind(id).run();
    expect(await env.DB.prepare('SELECT bg FROM users WHERE id = ?').bind(id).first()).toEqual({ bg: 'law' });
    await expect(env.DB.prepare("UPDATE users SET bg = 'foo' WHERE id = ?").bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run test/validation.test.js test/api.test.js test/database-structure.test.js`
Expected: FAIL (law rejected by validation, by the API with 400, and by the CHECK).

- [ ] **Step 4: Widen the CHECK and the list.** In `migrations/0001_schema.sql`, replace the two `bg` lines with:

```sql
  -- The theme (Medicine, Computer Science, Law, Aviation, Sports, Engineering),
  -- independent of the light/dark appearance.
  bg             TEXT NOT NULL DEFAULT 'med' CHECK (bg IN ('med', 'cs', 'law', 'pilot', 'sports', 'eng')),
```

In `worker/validate.js` line 18:

```js
const BACKGROUNDS = ['med', 'cs', 'law', 'pilot', 'sports', 'eng'];
```

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: PASS, including `test/move-db.test.js` (it copies from the legacy fixture into the new schema; `scripts/lib/move-db.js` `TABLES` needs no change, since no column was added).

- [ ] **Step 6: Rebuild the local database from the new schema.** Local D1 recorded `0001_schema.sql` as applied, so an edited file is not re-run, and the old local CHECK would refuse `law`. The local data is test data (the `demo` accounts); keep a copy, then rebuild. Look first: `ls .wrangler/state/v3/d1` should hold only `miniflare-D1DatabaseObject`. Then, in PowerShell:

```powershell
Copy-Item -Recurse .wrangler/state/v3/d1 .wrangler/d1-backup-rounds-v4
Remove-Item -Recurse -Force .wrangler/state/v3/d1
npm run db:local
```

and in Git Bash: `printf 'termqa-local-1\ntermqa-local-1\n' | npm run user:add -- termqa --name "Term QA"`. `termqa` is the local test account from here on. The real move (live data) is rehearsed in Task 13.

- [ ] **Step 7: Commit**

```bash
git add migrations/0001_schema.sql worker/validate.js test/validation.test.js test/api.test.js test/database-structure.test.js test/fixtures/legacy-migrations
git commit -m "Six themes in the schema and the Worker; the legacy fixture is rounds-v4's schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The theme registry

**Files:**
- Create: `src/data/themes.ts`
- Test: `src/data/themes.test.ts`

- [ ] **Step 1: Write the failing test** `src/data/themes.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { BGS, GOALS, THEMES, goalFor, toBg } from "./themes"

describe("the themes", () => {
    it("has six, each with its words and six goals", () => {
        expect(BGS).toEqual(["med", "cs", "law", "pilot", "sports", "eng"])
        for (const bg of BGS) {
            expect(THEMES[bg].label).toBeTruthy()
            expect(THEMES[bg].studyWord).toBeTruthy()
            expect(THEMES[bg].quote.text).toBeTruthy()
            expect(GOALS[bg]).toHaveLength(6)
            for (const g of GOALS[bg]) expect(g.length).toBeLessThanOrEqual(22)
        }
    })

    it("reads an unknown or missing id as Medicine", () => {
        expect(toBg("law")).toBe("law")
        expect(toBg("foo")).toBe("med")
        expect(toBg(undefined)).toBe("med")
    })

    it("uses the saved goal, or the theme's first", () => {
        expect(goalFor("med", "  Surgeon ")).toBe("Surgeon")
        expect(goalFor("pilot", "")).toBe("Captain")
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/data/themes.test.ts`
Expected: FAIL, "Cannot find module './themes'".

- [ ] **Step 3: Write `src/data/themes.ts`** (values from the prototype's `THEMES`, `STUDY`, `GOALS`):

```ts
// The six themes: what each one says and the few colours the code needs as values (the
// Settings swatches and the pictures). Every other colour is a CSS token per theme
// (styles/tokens.css, :root[data-bg="…"]). Values from the prototype's THEMES, STUDY, GOALS.

export type Bg = "med" | "cs" | "law" | "pilot" | "sports" | "eng"
export const BGS: readonly Bg[] = ["med", "cs", "law", "pilot", "sports", "eng"]

export interface ThemeInfo {
    label: string
    /** Settings' line under the name */
    desc: string
    /** light-mode accent and completed colour: the Settings swatch and the pictures */
    accent: string
    done: string
    /** "Goes on your coat" */
    wear: string
    /** the picture's accessible name */
    picture: string
    /** the phase word while studying: "On shift · round 1 of 4" */
    studyWord: string
    /** shown in the sidebar until the person saves quotes of their own */
    quote: { text: string; source: string }
}

export const THEMES: Record<Bg, ThemeInfo> = {
    med: { label: "Medicine", desc: "Lab coat · pink when done", accent: "#0F5F58", done: "#FBE8EF", wear: "coat",
        picture: "Lab coat with your name embroidered", studyWord: "On shift",
        quote: { text: "The good physician treats the disease; the great physician treats the patient.", source: "William Osler" } },
    cs: { label: "Computer Science", desc: "ID badge · mint when done", accent: "#2B4FA8", done: "#E3F1E8", wear: "badge",
        picture: "Lanyard ID badge with your name", studyWord: "Compiling",
        quote: { text: "Programs must be written for people to read, and only incidentally for machines to execute.", source: "Harold Abelson" } },
    law: { label: "Law", desc: "Suit and name plate · parchment when done", accent: "#7A2E2E", done: "#F4ECD6", wear: "name plate",
        picture: "Suit jacket with a brass name plate", studyWord: "In session",
        quote: { text: "The life of the law has not been logic: it has been experience.", source: "Oliver Wendell Holmes Jr." } },
    pilot: { label: "Aviation", desc: "Flight jacket · sky blue when done", accent: "#1F3A5F", done: "#DFEBF6", wear: "jacket",
        picture: "Flight jacket with wings and a name tape", studyWord: "In flight",
        quote: { text: "The engine is the heart of an aeroplane, but the pilot is its soul.", source: "Walter Raleigh" } },
    sports: { label: "Sports", desc: "Jersey · peach when done", accent: "#2F6B3A", done: "#FCE8D8", wear: "jersey",
        picture: "Back of a jersey with your name and number", studyWord: "On the clock",
        quote: { text: "Hard work beats talent when talent doesn’t work hard.", source: "Tim Notke" } },
    eng: { label: "Engineering", desc: "Hi-vis vest · yellow when done", accent: "#3F4E5E", done: "#FBF3C8", wear: "vest",
        picture: "Hi-vis safety vest with a name tag", studyWord: "Building",
        quote: { text: "Scientists study the world as it is; engineers create the world that has never been.", source: "Theodore von Kármán" } },
}

export const GOALS: Record<Bg, readonly string[]> = {
    med: ["Neurologist", "Dermatologist", "Cardiologist", "Surgeon", "Pediatrician", "ER physician"],
    cs: ["Team lead", "Software engineer", "Data scientist", "Security engineer", "ML engineer", "Founder"],
    law: ["Litigator", "Judge", "Corporate lawyer", "Prosecutor", "Public defender", "Partner"],
    pilot: ["Captain", "First officer", "Airline pilot", "Flight instructor", "Fighter pilot", "Bush pilot"],
    sports: ["Pro athlete", "Team captain", "Head coach", "Physio", "Strength coach", "Sports scientist"],
    eng: ["Structural eng.", "Mechanical eng.", "Electrical eng.", "Project lead", "Chief engineer", "Aerospace eng."],
}

export const toBg = (v: unknown): Bg => (BGS.includes(v as Bg) ? (v as Bg) : "med")

/** The goal shown on the picture: the one saved in coat.role, else the theme's first. */
export const goalFor = (bg: Bg, role: string) => role.trim() || GOALS[bg][0]
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run src/data/themes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/themes.ts src/data/themes.test.ts
git commit -m "The six themes' words, goals and quotes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Applying a theme

**Files:**
- Modify: `src/data/theme.ts`, `src/data/ui.ts:19`, `src/data/types.ts:54`, `index.html:20`, `src/core/model.ts:92`
- Test: `src/data/ui.test.ts`, `test/model.test.js`

- [ ] **Step 1: Write the failing tests.** Append to `src/data/ui.test.ts` (it already imports vitest; add the imports it lacks):

```ts
import { setBg } from "./theme"

describe("the theme", () => {
    it("applies any of the six to <html>, and Medicine for anything else", () => {
        setBg("law", { persist: false })
        expect(document.documentElement.getAttribute("data-bg")).toBe("law")
        expect(ui.bg).toBe("law")
        setBg("foo", { persist: false })
        expect(document.documentElement.getAttribute("data-bg")).toBe("med")
    })
})
```

If `src/data/ui.test.ts` mocks modules that `theme.ts` needs (`@/core/store`, `@/bridge`), put this test in a new `src/data/theme.test.ts` with `vi.mock("@/core/store", () => ({ data: { profile: null }, saveProfile: vi.fn() }))` and `vi.mock("@/bridge", () => ({ notify: vi.fn() }))`, importing `ui` from `./ui`.

Append to `test/model.test.js`:

```js
describe('projects by theme', () => {
  it('shows Projects by default for Computer Science and Engineering only', () => {
    const hidden = (bg) => typeList(bg).find((t) => t.id === 'project').hidden;
    expect(hidden('cs')).toBe(false);
    expect(hidden('eng')).toBe(false);
    expect(hidden('med')).toBe(true);
    expect(hidden('law')).toBe(true);
  });
});
```

(Import `typeList` from `../src/core/model.ts` if the file doesn't already.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/ui.test.ts test/model.test.js`
Expected: FAIL (law becomes med; eng hides Projects).

- [ ] **Step 3: Accept the six.** `src/data/types.ts` line 54: `bg: Bg`, with `import type { Bg } from "./themes"` at the top.

`src/data/ui.ts` line 19:

```ts
    bg: toBg(typeof window !== "undefined" ? window.__roundsBg : undefined),     /* the theme */
```

with `import { toBg } from "./themes"`.

`src/data/theme.ts`: replace the header comment's "the Med or CS background art" with "the theme (Medicine, CS, Law, Aviation, Sports, Engineering)", the section comment with `/* ═════════ the theme: one of six, independent of light/dark ═════════ */`, and the first line of `setBg` with:

```ts
    ui.bg = toBg(choice)
```

with `import { toBg } from "./themes"`.

`src/core/model.ts` line 92: `(id === 'project' && bg !== 'cs' && bg !== 'eng' || id === 'quiz' && ownQuiz)`.

`index.html` line 20:

```js
    try { var saved = localStorage.getItem('rounds.bg'); if (['med', 'cs', 'law', 'pilot', 'sports', 'eng'].indexOf(saved) >= 0) bg = saved; } catch (e) {}
```

Then `npm run csp:update` and check `git diff --stat` (only `index.html` and `public/_headers`, a few lines each; `file index.html` says no CRLF).

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS; "CSP verified".

- [ ] **Step 5: Commit**

```bash
git add src/data index.html public/_headers src/core/model.ts test/model.test.js
git commit -m "Apply any of the six themes; Projects for CS and Engineering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The colours of six themes

**Files:**
- Modify: `src/styles/tokens.css`

The light values are the prototype's `THEMES` (accent, today → `--accent-soft`, done, doneInk, track, bar → `--done-bar-a/b`, motif). `--accent-ink` is the accent 28% toward black; `--done-2` and `--done-line` are the done colour 6% and 12% toward its ink. Dark values keep each hue and follow the lightness Medicine and CS use (accent L 70%, soft 15%, done 16%, done ink 82%). The study surfaces' `--fx-study-bg` is the prototype's `STUDY[1]`, `--fx-break-bg` is it mixed 30% toward the done ink (the prototype's `mix(STUDY[1], th.doneInk, .3)`).

- [ ] **Step 1: Medicine and CS get `--motif` and their dark study colour.** In the first `:root{` block add `--motif:#B3362B;` after `--accent-ink`. In `:root[data-bg="cs"]{` add `--motif:#2B4FA8;`. In the study block, change Medicine's `--fx-study-bg:#1C0A12` to `--fx-study-bg:#0C2A27` and `--fx-break-bg:#110B22` to `--fx-break-bg:#313438`; CS's `--fx-study-bg:#041B1A` to `#111B36` and `--fx-break-bg:#1A0811` to `#193139`. Leave every other Medicine and CS value as it is.

- [ ] **Step 2: Add the four new themes** after the `:root[data-app="dark"][data-bg="cs"]{…}` block:

```css
/* ════════════════════════════════════════════════
   Law, Aviation, Sports, Engineering: the accent, today's tint and the completed
   colours move; the paper and ink stay. Values: the prototype's THEMES.
   ════════════════════════════════════════════════ */
:root[data-bg="law"]{
  --accent:#7A2E2E; --accent-soft:#F7F0EF; --accent-ink:#582121; --motif:#7A2E2E;
  --done:#F4ECD6; --done-2:#ECE3CB; --done-line:#E3D9C0; --done-ink:#6A511C; --done-track:#EADFC0; --done-bar-a:#EAD49A; --done-bar-b:#B08A2E;
}
:root[data-app="dark"][data-bg="law"]{
  --accent:#D98C8C; --accent-soft:#341919; --accent-ink:#E8B0B0; --on-accent:#200909; --motif:#D98C8C;
  --done:#352D1D; --done-2:#3F3622; --done-line:#4B412A; --done-ink:#EADAB8; --done-track:#4B412A; --done-bar-a:#B08A2E; --done-bar-b:#E2C98D;
}
:root[data-bg="pilot"]{
  --accent:#1F3A5F; --accent-soft:#F0F3F7; --accent-ink:#162A44; --motif:#1F3A5F;
  --done:#DFEBF6; --done-2:#D4E1EE; --done-line:#C9D8E6; --done-ink:#274B70; --done-track:#C9DCEE; --done-bar-a:#B3D2EE; --done-bar-b:#4F83B8;
}
:root[data-app="dark"][data-bg="pilot"]{
  --accent:#8CADD9; --accent-soft:#192434; --accent-ink:#B0C8E8; --on-accent:#091320; --motif:#8CADD9;
  --done:#1D2935; --done-2:#22303F; --done-line:#2A3A4B; --done-ink:#B8D1EA; --done-track:#2A3A4B; --done-bar-a:#4F83B8; --done-bar-b:#8DB7E2;
}
:root[data-bg="sports"]{
  --accent:#2F6B3A; --accent-soft:#EEF5EF; --accent-ink:#224D2A; --motif:#C2571A;
  --done:#FCE8D8; --done-2:#F5DECC; --done-line:#EED4C0; --done-ink:#84420F; --done-track:#F5D6BE; --done-bar-a:#F7C49B; --done-bar-b:#D9722E;
}
:root[data-app="dark"][data-bg="sports"]{
  --accent:#8CD99A; --accent-soft:#19341E; --accent-ink:#B0E8BA; --on-accent:#09200D; --motif:#E2AF8D;
  --done:#35271D; --done-2:#3F2F22; --done-line:#4B392A; --done-ink:#EACEB8; --done-track:#4B392A; --done-bar-a:#D9722E; --done-bar-b:#E2AF8D;
}
:root[data-bg="eng"]{
  --accent:#3F4E5E; --accent-soft:#F0F2F4; --accent-ink:#2D3844; --motif:#D9651A;
  --done:#FBF3C8; --done-2:#F2EABD; --done-line:#E9E0B1; --done-ink:#665509; --done-track:#F1E39A; --done-bar-a:#F4DE74; --done-bar-b:#C9A21C;
}
:root[data-app="dark"][data-bg="eng"]{
  --accent:#8CB1D9; --accent-soft:#192634; --accent-ink:#B0CBE8; --on-accent:#091420; --motif:#F0A060;
  --done:#35311D; --done-2:#3F3A22; --done-line:#4B452A; --done-ink:#EAE1B8; --done-track:#4B452A; --done-bar-a:#C9A21C; --done-bar-b:#E2CF8D;
}
```

Add `--motif:#E86A5E;` to Medicine's `:root[data-app="dark"]` block and `--motif:#8EA2F0;` to CS's dark block (the motif is drawn on a card, so it lifts in dark mode like the accent).

- [ ] **Step 3: Their study colours.** After the last study block (`:root[data-bg="cs"][data-app="dark"]{…}`), add:

```css
/* Law, Aviation, Sports, Engineering: the page's study colour is the completed bar's
   deep end, the break the accent; the dark surfaces are the prototype's STUDY colours. */
:root[data-bg="law"]{
  --study:#B08A2E; --study-soft:#F4ECD6; --study-ink:#6A511C; --study-card:#5A4618; --study-card-2:#6E561E;
  --break:#7A2E2E; --break-soft:#F7F0EF; --break-ink:#582121; --break-card:#4A1C1C; --break-card-2:#5C2424;
  --fx-study-bg:#2A1616; --fx-break-bg:#3D2818; --fx-study:#E19898; --fx-break:#EAD49A;
}
:root[data-bg="pilot"]{
  --study:#4F83B8; --study-soft:#DFEBF6; --study-ink:#274B70; --study-card:#223F5E; --study-card-2:#2A4C70;
  --break:#1F3A5F; --break-soft:#F0F3F7; --break-ink:#162A44; --break-card:#16293F; --break-card-2:#1D344F;
  --fx-study-bg:#0F1B2B; --fx-break-bg:#162940; --fx-study:#98B7E1; --fx-break:#B3D2EE;
}
:root[data-bg="sports"]{
  --study:#D9722E; --study-soft:#FCE8D8; --study-ink:#84420F; --study-card:#6E3A12; --study-card-2:#844718;
  --break:#2F6B3A; --break-soft:#EEF5EF; --break-ink:#224D2A; --break-card:#1E4526; --break-card-2:#26542F;
  --fx-study-bg:#10261A; --fx-break-bg:#332E17; --fx-study:#98E1A6; --fx-break:#F7C49B;
}
:root[data-bg="eng"]{
  --study:#C9A21C; --study-soft:#FBF3C8; --study-ink:#665509; --study-card:#5A4A0C; --study-card-2:#6E5B10;
  --break:#3F4E5E; --break-soft:#F0F2F4; --break-ink:#2D3844; --break-card:#28323D; --break-card-2:#313D4A;
  --fx-study-bg:#1C232B; --fx-break-bg:#323221; --fx-study:#98BCE1; --fx-break:#F4DE74;
}
:root[data-bg="law"][data-app="dark"]{ --study:#E2C98D; --study-soft:#352D1D; --study-ink:#EADAB8; --break:#D98C8C; --break-soft:#341919; --break-ink:#E8B0B0; }
:root[data-bg="pilot"][data-app="dark"]{ --study:#8DB7E2; --study-soft:#1D2935; --study-ink:#B8D1EA; --break:#8CADD9; --break-soft:#192434; --break-ink:#B0C8E8; }
:root[data-bg="sports"][data-app="dark"]{ --study:#E2AF8D; --study-soft:#35271D; --study-ink:#EACEB8; --break:#8CD99A; --break-soft:#19341E; --break-ink:#B0E8BA; }
:root[data-bg="eng"][data-app="dark"]{ --study:#E2CF8D; --study-soft:#35311D; --study-ink:#EAE1B8; --break:#8CB1D9; --break-soft:#192634; --break-ink:#B0CBE8; }

/* The study surfaces' flip cards: a step lighter than the surface, in every theme. */
:root{
  --fx-study-card:color-mix(in srgb,#FFFFFF 8%,var(--fx-study-bg)); --fx-study-card-2:color-mix(in srgb,#FFFFFF 12%,var(--fx-study-bg));
  --fx-break-card:color-mix(in srgb,#FFFFFF 8%,var(--fx-break-bg)); --fx-break-card-2:color-mix(in srgb,#FFFFFF 12%,var(--fx-break-bg));
  --fx-study-glow:color-mix(in srgb,var(--fx-study) 30%,transparent); --fx-break-glow:color-mix(in srgb,var(--fx-break) 32%,transparent);
}
```

Then delete the now-overridden `--fx-study-card`, `--fx-study-card-2`, `--fx-break-card`, `--fx-break-card-2`, `--fx-study-glow`, `--fx-break-glow` declarations from Medicine's and CS's study blocks (the rule above must be the only place they are set, or the earlier theme blocks win by specificity). Keep their `--fx-study` and `--fx-break`.

- [ ] **Step 4: Check the contrast.** Text on its background must be 4.5:1.

```bash
node -e "const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const r=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2)};for(const [a,b] of [['#7A2E2E','#F7F0EF'],['#6A511C','#F4ECD6'],['#1F3A5F','#F0F3F7'],['#274B70','#DFEBF6'],['#2F6B3A','#EEF5EF'],['#84420F','#FCE8D8'],['#3F4E5E','#F0F2F4'],['#665509','#FBF3C8'],['#D98C8C','#341919'],['#EADAB8','#352D1D'],['#8CADD9','#192434'],['#B8D1EA','#1D2935'],['#8CD99A','#19341E'],['#EACEB8','#35271D'],['#8CB1D9','#192634'],['#EAE1B8','#35311D']])console.log(a,b,r(a,b))"
```

Expected: every ratio ≥ 4.5 (they run 5.8 to 10.3).

- [ ] **Step 5: Run the tests and the build**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css
git commit -m "The colours of six themes, light and dark, and their study surfaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The six pictures

**Files:**
- Create: `src/components/sidebar-picture/parts.tsx`, `names.ts`, `coat.tsx`, `badge.tsx`, `suit.tsx`, `jacket.tsx`, `jersey.tsx`, `vest.tsx`, `index.tsx`
- Test: `src/components/sidebar-picture/pictures.test.tsx`

Each picture is the prototype's 220×180 SVG (lines 61–174) with the name and goal as HTML spans over it. Colours are the prototype's; the theme's accent is `THEMES[bg].accent` (the drawing keeps its light colours in dark mode, like a photo would). The coat's fill is `var(--coat)`, the colour Settings sets.

- [ ] **Step 1: Write the failing test** `src/components/sidebar-picture/pictures.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { BGS, THEMES } from "@/data/themes"
import { SidebarPicture } from "./index"
import { coatSize, nameParts } from "./names"

afterEach(cleanup)

describe("the sidebar pictures", () => {
    it.each(BGS)("%s: the name and the goal are text over the drawing", (bg) => {
        render(<SidebarPicture bg={bg} name="Alex Rivera" goal="Neurologist" username="alex" />)
        const pic = screen.getByRole("img")
        expect(pic.getAttribute("aria-label")).toBe(THEMES[bg].picture + ": Alex Rivera, headed for Neurologist")
        expect(pic.textContent).toMatch(/Alex Rivera|RIVERA|Rivera/)
        expect(pic.textContent).toContain("NEUROLOGIST")
        expect(pic.querySelector("svg text")).toBeNull()
    })

    it("the badge shows the username", () => {
        render(<SidebarPicture bg="cs" name="Alex Rivera" goal="Team lead" username="alex" />)
        expect(screen.getByRole("img").textContent).toContain("@alex")
    })
})

describe("names on the pictures", () => {
    it("splits a name into what each picture prints", () => {
        expect(nameParts("Alex Rivera")).toEqual({ first: "Alex", last: "Rivera", initials: "AR", capsShort: "A. RIVERA", capsLast: "RIVERA" })
        expect(nameParts("  Alex  ")).toEqual({ first: "Alex", last: "", initials: "A", capsShort: "ALEX", capsLast: "ALEX" })
    })

    it("fits the embroidered name to the pocket", () => {
        expect(coatSize("Alex Rivera")).toBe(12.5)
        expect(coatSize("Alexandra Montgomery-Riviera")).toBe(5)
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/sidebar-picture/pictures.test.tsx`
Expected: FAIL, "Cannot find module './index'".

- [ ] **Step 3: The shared parts** — `src/components/sidebar-picture/names.ts`:

```ts
// How each picture prints a name: the coat embroiders it whole, the badge in two lines
// with initials, the others "A. RIVERA" or "RIVERA". From the prototype's renderVals.

export function nameParts(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const first = words[0] || "", last = words.length > 1 ? words[words.length - 1] : ""
    return {
        first, last,
        initials: (first[0] || "") + (last[0] || ""),
        capsShort: ((last && first[0] ? first[0] + ". " : "") + (last || first)).toUpperCase(),
        capsLast: (last || first).toUpperCase(),
    }
}

/** The embroidery's font size: 12.5px, smaller for a long name, so it fits the pocket. */
export const coatSize = (name: string) => Math.min(12.5, Math.round(66 / (Math.max(1, name.length) * 0.47) * 10) / 10)
```

`src/components/sidebar-picture/parts.tsx`:

```tsx
// The frame every picture shares: a 220×180 drawing, its words positioned over it as
// HTML (never SVG <text>), and one accessible name for the whole.

import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { THEMES, type Bg } from "@/data/themes"

export interface PictureProps { name: string; goal: string; username: string }

export const Frame = ({ bg, name, goal, children }: { bg: Bg; name: string; goal: string; children: ReactNode }) => (
    <span role="img" aria-label={THEMES[bg].picture + ": " + name + ", headed for " + goal} className="relative mx-auto block h-[180px] w-[220px]">
        {children}
    </span>
)

export const Drawing = ({ children }: { children: ReactNode }) => (
    <svg viewBox="0 0 220 180" width="220" height="180" aria-hidden="true" className="block">{children}</svg>
)

/** Words at (x, y) in the drawing's pixels, centred on x unless `left`. */
export const Tag = ({ x, y, left, className, style, children }: { x: number; y: number; left?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) => (
    <span aria-hidden="true" className={cn("absolute leading-none whitespace-nowrap", className)}
        style={{ left: x, top: y, transform: left ? undefined : "translateX(-50%)", ...style }}>
        {children}
    </span>
)
```

- [ ] **Step 4: The six pictures.** `src/components/sidebar-picture/coat.tsx`:

```tsx
import { Drawing, Frame, type PictureProps } from "./parts"
import { coatSize } from "./names"

/** Medicine: the lab coat, the name embroidered over the pocket, the goal under it, a stethoscope. */
export function Coat({ name, goal }: PictureProps) {
    return (
        <Frame bg="med" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="var(--coat)" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M86 24L110 64L134 24Q110 32 86 24Z" fill="#2F6F6A" />
                <path d="M86 24L110 64L100 106L72 44Z" fill="#000000" fillOpacity=".05" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M134 24L110 64L120 106L148 44Z" fill="#000000" fillOpacity=".05" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M110 106V180" stroke="#CFCBC2" strokeWidth="1.2" />
                <circle cx="116" cy="128" r="2.6" fill="#CFCBC2" />
                <circle cx="116" cy="158" r="2.6" fill="#CFCBC2" />
                <rect x="168" y="103" width="3.5" height="12" rx="1.75" fill="#2B5F8A" />
                <rect x="174" y="105" width="3.5" height="10" rx="1.75" fill="#B3362B" />
                <path d="M140 110h44v32q0 4-4 4h-36q-4 0-4-4Z" fill="var(--coat)" stroke="#CFCBC2" strokeWidth="1.2" />
                <path d="M78 30Q48 82 62 126" stroke="#3A3935" strokeWidth="3" fill="none" strokeLinecap="round" />
                <circle cx="63" cy="133" r="7" fill="#B8BDBC" stroke="#3A3935" strokeWidth="2" />
            </Drawing>
            <span aria-hidden="true" className="absolute flex -translate-x-1/2 flex-col items-center gap-[3px] leading-none whitespace-nowrap text-[#1F4E7A]" style={{ left: 166, top: 76 }}>
                <span className="font-serif font-semibold tracking-[.01em] italic" style={{ fontSize: coatSize(name) }}>{name}</span>
                <span className="text-[6px] font-semibold tracking-[.12em] uppercase opacity-75">{goal}</span>
            </span>
        </Frame>
    )
}
```

`src/components/sidebar-picture/badge.tsx`:

```tsx
import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/* the barcode's bars: [x, width], from the prototype, squashed to the badge's foot */
const BARS = [[64, 2], [68, 1], [71, 3], [76, 1], [79, 2], [84, 1], [87, 3], [92, 1], [95, 2], [99, 1], [102, 3], [107, 2], [111, 1], [114, 2], [118, 3], [123, 1], [126, 2], [130, 1], [133, 3], [138, 1], [141, 2], [145, 3], [150, 1], [153, 3]]

/** Computer Science: a lanyard ID badge, initials for a photo, the name in two lines, the goal on the band. */
export function Badge({ name, goal, username }: PictureProps) {
    const accent = THEMES.cs.accent, n = nameParts(name)
    return (
        <Frame bg="cs" name={name} goal={goal}>
            <Drawing>
                <rect x="102" y="0" width="16" height="52" fill={accent} />
                <rect x="104" y="48" width="12" height="12" rx="2" fill="#9AA3A2" />
                <rect x="52" y="58" width="116" height="118" rx="8" fill="#FFFFFF" stroke="#CFCBC2" />
                <rect x="96" y="66" width="28" height="5" rx="2.5" fill="#E6E3DC" />
                <rect x="52" y="78" width="116" height="4" fill={accent} />
                <rect x="64" y="92" width="36" height="42" rx="3" fill="#E6E3DC" />
                <rect x="52" y="142" width="116" height="16" fill={accent} />
                <g fill="#1C1C1A">{BARS.map(([x, w]) => <rect key={x} x={x} y="164" width={w} height="8.1" />)}</g>
            </Drawing>
            <Tag x={82} y={107.2} className="text-[12px] font-semibold text-[#55534E]">{n.initials}</Tag>
            <Tag x={110} y={94.2} left className="text-[12px] font-semibold text-[#1C1C1A]">{n.first}</Tag>
            <Tag x={110} y={108.2} left className="text-[12px] font-semibold text-[#1C1C1A]">{n.last}</Tag>
            {username && <Tag x={110} y={124} left className="max-w-[54px] overflow-hidden font-mono text-[8.5px] text-ellipsis text-[#6E6B64]">@{username}</Tag>}
            <Tag x={110} y={146.4} className="font-mono text-[8px] tracking-[.8px] text-white uppercase">{goal}</Tag>
        </Frame>
    )
}
```

`src/components/sidebar-picture/suit.tsx`:

```tsx
import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/** Law: a dark suit, the theme's tie, a brass name plate with the goal under it. */
export function Suit({ name, goal }: PictureProps) {
    const accent = THEMES.law.accent
    return (
        <Frame bg="law" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="#2B2D33" />
                <path d="M86 24L110 104L134 24Q110 32 86 24Z" fill="#FFFFFF" />
                <path d="M104 28h12l-2 8h-8Z" fill={accent} />
                <path d="M106 36h8l3 10-5 50-2 4-2-4-5-50Z" fill={accent} />
                <path d="M86 24L110 104L96 112L68 60L80 52L72 42Z" fill="#3A3D45" />
                <path d="M134 24L110 104L124 112L152 60L140 52L148 42Z" fill="#3A3D45" />
                <path d="M110 112V180" stroke="#1A1B1F" strokeWidth="1.2" />
                <circle cx="110" cy="130" r="3" fill="#1A1B1F" />
                <path d="M142 98h34" stroke="#474A53" strokeWidth="2" />
                <path d="M148 98l6-10 5 6 5-8 6 12Z" fill="#FFFFFF" />
                <rect x="36" y="94" width="58" height="16" rx="2" fill="#C9A24A" />
            </Drawing>
            <Tag x={65} y={98.9} className="text-[7.5px] font-semibold tracking-[1px] text-[#2B2410]">{nameParts(name).capsShort}</Tag>
            <Tag x={65} y={116.4} className="text-[6.8px] tracking-[.8px] text-[#C9A24A] uppercase">{goal}</Tag>
        </Frame>
    )
}
```

`src/components/sidebar-picture/jacket.tsx`:

```tsx
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/** Aviation: a leather flight jacket, fleece collar, wings, a name tape with the goal under it. */
export function Jacket({ name, goal }: PictureProps) {
    return (
        <Frame bg="pilot" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="#6B4A34" />
                <path d="M86 24L110 62L134 24Q110 30 86 24Z" fill="#8A9A7B" />
                <path d="M86 24L66 30L56 72L98 60Z" fill="#E7DCC8" />
                <path d="M134 24L154 30L164 72L122 60Z" fill="#E7DCC8" />
                <path d="M110 62V180" stroke="#C9A24A" strokeWidth="2" strokeDasharray="2 2" />
                <rect x="107" y="66" width="6" height="11" rx="1.5" fill="#C9A24A" />
                <path d="M62 96c-6-6-18-7-28-5 8 2 14 5 18 8-6-1-12 0-16 2 8 1 16 2 26-1Z" fill="#C9A24A" />
                <path d="M62 96c6-6 18-7 28-5-8 2-14 5-18 8 6-1 12 0 16 2-8 1-16 2-26-1Z" fill="#C9A24A" />
                <circle cx="62" cy="96" r="3.5" fill="#C9A24A" />
                <rect x="36" y="108" width="52" height="14" rx="1.5" fill="#2E2A22" />
                <rect x="132" y="112" width="44" height="34" rx="3" fill="none" stroke="#523826" strokeWidth="1.5" />
                <path d="M132 112h44v8l-22 6-22-6Z" fill="#5C3F2C" />
            </Drawing>
            <Tag x={62} y={111.4} className="font-mono text-[8px] tracking-[1px] text-[#E7DCC8]">{nameParts(name).capsLast}</Tag>
            <Tag x={62} y={130.4} className="font-mono text-[6.8px] tracking-[.6px] text-[#E7DCC8] uppercase">{goal}</Tag>
        </Frame>
    )
}
```

`src/components/sidebar-picture/jersey.tsx`:

```tsx
import { THEMES } from "@/data/themes"
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/** Sports: the back of a jersey in the theme's colour, the surname, a 7, the goal at the hem. */
export function Jersey({ name, goal }: PictureProps) {
    return (
        <Frame bg="sports" name={name} goal={goal}>
            <Drawing>
                <path d="M62 14Q110 30 158 14L200 32L218 76L190 88L178 64V180H42V64L30 88L2 76L20 32Z" fill={THEMES.sports.accent} />
                <path d="M62 14Q110 30 158 14" stroke="#FFFFFF" strokeWidth="3" fill="none" />
                <path d="M8 72L28 80M212 72L192 80" stroke="#FFFFFF" strokeWidth="3" />
            </Drawing>
            <Tag x={110} y={49.7} className="text-[15px] font-semibold tracking-[2px] text-white">{nameParts(name).capsLast}</Tag>
            <Tag x={110} y={84.6} className="text-[70px] font-semibold text-white">7</Tag>
            <Tag x={110} y={158.6} className="text-[9px] font-semibold tracking-[1.5px] text-white uppercase opacity-85">{goal}</Tag>
        </Frame>
    )
}
```

`src/components/sidebar-picture/vest.tsx`:

```tsx
import { Drawing, Frame, Tag, type PictureProps } from "./parts"
import { nameParts } from "./names"

/** Engineering: a hi-vis vest over a dark shirt, a name tag with the goal. */
export function Vest({ name, goal }: PictureProps) {
    return (
        <Frame bg="eng" name={name} goal={goal}>
            <Drawing>
                <path d="M18 180V70Q18 44 48 36L86 24L110 64L134 24L172 36Q202 44 202 70V180Z" fill="#3F4750" />
                <path d="M86 24L110 64L134 24Q110 32 86 24Z" fill="#2B3138" />
                <path d="M40 40L86 26L104 84V180H40Z" fill="#F07F1E" />
                <path d="M180 40L134 26L116 84V180H180Z" fill="#F07F1E" />
                <path d="M58 36l10-3 12 50h-10Z" fill="#D9DDE0" />
                <path d="M162 36l-10-3-12 50h10Z" fill="#D9DDE0" />
                <rect x="40" y="124" width="64" height="10" fill="#D9DDE0" />
                <rect x="116" y="124" width="64" height="10" fill="#D9DDE0" />
                <rect x="40" y="148" width="64" height="10" fill="#D9DDE0" />
                <rect x="116" y="148" width="64" height="10" fill="#D9DDE0" />
                <rect x="120" y="92" width="64" height="28" rx="2" fill="#FFFFFF" />
                <rect x="52" y="90" width="3" height="18" rx="1.5" fill="#1C1C1A" />
                <rect x="58" y="92" width="3" height="16" rx="1.5" fill="#2B5F8A" />
            </Drawing>
            <Tag x={152} y={97.9} className="text-[7.5px] font-semibold tracking-[1px] text-[#1C1C1A]">{nameParts(name).capsShort}</Tag>
            <Tag x={152} y={110.1} className="text-[6px] font-semibold tracking-[.5px] text-[#D9651A] uppercase">{goal}</Tag>
        </Frame>
    )
}
```

`src/components/sidebar-picture/index.tsx`:

```tsx
// The theme's picture in the sidebar, with the person's name and goal on it.

import type { Bg } from "@/data/themes"
import type { PictureProps } from "./parts"
import { Coat } from "./coat"
import { Badge } from "./badge"
import { Suit } from "./suit"
import { Jacket } from "./jacket"
import { Jersey } from "./jersey"
import { Vest } from "./vest"

const PICTURES: Record<Bg, (p: PictureProps) => React.JSX.Element> = { med: Coat, cs: Badge, law: Suit, pilot: Jacket, sports: Jersey, eng: Vest }

export function SidebarPicture({ bg, ...props }: PictureProps & { bg: Bg }) {
    const Picture = PICTURES[bg]
    return <Picture {...props} />
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/components/sidebar-picture/pictures.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar-picture
git commit -m "The six sidebar pictures, with the name and goal as text over the drawing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The picture in the sidebar

**Files:**
- Create: `src/components/sidebar-who.tsx`
- Delete: `src/components/sidebar-coat.tsx`
- Modify: `src/components/sidebar.tsx`, `src/components/spotify/sidebar-player.tsx:98-99`, `src/styles/tokens.css` (`--pocket-a/b`)
- Test: `src/components/sidebar.test.tsx`

- [ ] **Step 1: Change the tests.** In `src/components/sidebar.test.tsx`, replace the whole `describe("the coat", …)` block with:

```tsx
describe("who this is", () => {
    it("draws the theme's picture with the coat's name or the display name, and the goal", () => {
        render(<Sidebar />)
        const pic = screen.getByRole("img", { name: /Lab coat/ })
        expect(pic.textContent).toContain("Dr Demo")
        expect(screen.getByRole("button", { name: /Headed for/ }).textContent).toBe("Headed forMS2 · Block 3")
    })

    it("says the theme's name under the wordmark and falls back to its first goal", () => {
        fake.ui.bg = "law"
        ;(fake.data.profile as { coat: { role: string } }).coat.role = ""
        render(<Sidebar />)
        expect(screen.getByText("Law")).toBeTruthy()
        expect(screen.getByRole("img", { name: /Suit jacket/ })).toBeTruthy()
        expect(screen.getByRole("button", { name: /Headed for/ }).textContent).toBe("Headed forLitigator")
    })
})
```

The file's `beforeEach` must reset `fake.ui.bg = "med"` and the profile (it sets `fake.data.profile` already; add `fake.ui.bg = "med"` there). Also delete any test that asserts "Edit the name on the coat", the identicon or the barcode (`rg -n "identicon|barcode|Edit the name" src`).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sidebar.test.tsx`
Expected: FAIL (no role img named "Lab coat…").

- [ ] **Step 3: Write `src/components/sidebar-who.tsx`:**

```tsx
// Who this is: the theme's picture with the person's name and goal on it, and "Headed for
// Neurologist" under it. Both open Settings: the picture at the top, the goal at its field.

import { useProfile } from "@/data/store"
import { useUi } from "@/data/ui"
import { openSettings } from "@/data/actions"
import { goalFor } from "@/data/themes"
import { SidebarPicture } from "./sidebar-picture"

export function SidebarWho() {
    const profile = useProfile()
    const bg = useUi((u) => u.bg)
    const name = profile?.coat?.name || profile?.displayName || "Your name"
    const goal = goalFor(bg, profile?.coat?.role ?? "")
    return (
        <div className="flex flex-col gap-1">
            <button type="button" title="Change theme" onClick={() => openSettings()}
                className="block cursor-pointer rounded-lg border-0 bg-transparent p-0">
                <SidebarPicture bg={bg} name={name} goal={goal} username={profile?.username || ""} />
            </button>
            <button type="button" onClick={() => openSettings("o-goal")}
                className="flex cursor-pointer items-baseline gap-1.5 border-0 bg-transparent px-2.5 text-left font-[inherit]">
                <span className="text-[12px] text-muted-foreground">Headed for</span>
                <span className="font-serif text-[15px] font-medium text-[var(--accent)] italic">{goal}</span>
            </button>
        </div>
    )
}
```

- [ ] **Step 4: Use it.** In `src/components/sidebar.tsx`: replace `import { Coat } from "./sidebar-coat"` with `import { SidebarWho } from "./sidebar-who"` and `import { THEMES } from "@/data/themes"`; replace `<Coat />` with `<SidebarWho />`; replace `{bg === "cs" ? "Computer Science" : "Medicine"}` with `{THEMES[bg].label}`; in the header comment, "the lab-coat pocket or ID badge" becomes "the theme's picture and goal". Delete `src/components/sidebar-coat.tsx` (`git rm`), and `--pocket-a`/`--pocket-b` from both blocks of `src/styles/tokens.css` after `rg -n "pocket-" src` shows no other user.

In `src/components/spotify/sidebar-player.tsx` the clip belongs to the coat: replace line 99 with

```tsx
                "[:root:not([data-bg=med])_&]:border-border [:root:not([data-bg=med])_&]:before:hidden",
```

and its comment "CS has no coat" with "only Medicine has a coat".

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/components src/styles/tokens.css
git commit -m "The sidebar wears the theme's picture, with Headed for under it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Settings: theme, goal, name

**Files:**
- Modify: `src/components/sheet/settings-sheet.tsx:142-215`, `src/styles/shell.css` (`.bgthumb`, `.coatpreview`)
- Test: `src/components/sheet/settings-sheet.test.tsx`

The You tab becomes, top to bottom: **Theme** (six radio rows: swatch, name, one line, dot), **Where you're headed** (six goal chips, "Or type your own"), **Your name**, **Coat colour** (Medicine only), **Appearance** (Light, Dark, System, as today), **Quotes** (as today).

- [ ] **Step 1: Change the tests.** In `settings-sheet.test.tsx`, replace "sets the theme and background, and saves the coat" with:

```tsx
    it("picks a theme from six rows, a goal from its chips or typed, and the name", () => {
        render(<SettingsSheet tab="you" focus="" />)
        const rows = within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole("radio")
        expect(rows.map((r) => r.textContent)).toEqual([
            "MedicineLab coat · pink when done", "Computer ScienceID badge · mint when done",
            "LawSuit and name plate · parchment when done", "AviationFlight jacket · sky blue when done",
            "SportsJersey · peach when done", "EngineeringHi-vis vest · yellow when done",
        ])
        expect(rows[0].getAttribute("aria-checked")).toBe("true")
        fireEvent.click(screen.getByRole("radio", { name: /Aviation/ }))
        expect(legacy.setBg).toHaveBeenCalledWith("pilot")

        fireEvent.click(screen.getByRole("radio", { name: "Surgeon" }))
        expect(saveCoat).toHaveBeenCalledWith({ role: "Surgeon" })
        fireEvent.change(screen.getByRole("textbox", { name: "Your own goal" }), { target: { value: "Neurosurgeon" } })
        expect(saveCoat).toHaveBeenCalledWith({ role: "Neurosurgeon" })
        fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Alex" } })
        expect(saveCoat).toHaveBeenCalledWith({ name: "Alex" })

        fireEvent.click(screen.getByRole("button", { name: "Pink coat" }))
        expect(saveCoat).toHaveBeenCalledWith({ color: "#E4749B" })
        fireEvent.click(screen.getByRole("button", { name: "Dark" }))
        expect(legacy.setTheme).toHaveBeenCalledWith("dark")
    })

    it("shows the coat colours only for Medicine", () => {
        fake.ui.bg = "cs"
        render(<SettingsSheet tab="you" focus="" />)
        expect(screen.queryByRole("button", { name: "Pink coat" })).toBeNull()
        fake.ui.bg = "med"
    })
```

Adapt the names to the file's fakes: it mocks `setBg`/`setTheme` as `legacy.*`; find how it mocks `saveCoat` (`rg -n "saveCoat" src/components/sheet/settings-sheet.test.tsx`) and use that mock; find the ui fake's name and use it for `fake.ui.bg`. Import `within` from `@testing-library/react`. The fixture profile has `role: "MS II"`, which is no goal chip, so no chip starts checked and "Your own goal" starts as "MS II".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/settings-sheet.test.tsx`
Expected: FAIL (no radiogroup "Theme").

- [ ] **Step 3: Rebuild the You tab.** In `settings-sheet.tsx`, rename the `THEMES` constant (light/dark/system) to `LOOKS`, delete `BGS`, `CoatFields`, `Coat` and `Badge`, add `import { BGS, GOALS, THEMES, goalFor, type Bg } from "@/data/themes"`, and replace `YouTab` with:

```tsx
function YouTab({ profile }: { profile: Profile }) {
    const theme = useUi((u) => u.theme)
    const bg = useUi((u) => u.bg)
    const dark = document.documentElement.getAttribute("data-app") === "dark"
    return (
        <>
            <Group title="Theme" state={THEMES[bg].label}>
                <Hint>Changes the sidebar, colours and the next-exam animation.</Hint>
                <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-1.5">
                    {BGS.map((id) => {
                        const t = THEMES[id], on = bg === id
                        return (
                            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => setBg(id)}
                                className={cn(
                                    "grid min-h-[60px] cursor-pointer grid-cols-[44px_minmax(0,1fr)_20px] items-center gap-3.5 rounded-lg border px-3.5 py-2 text-left font-[inherit] text-[14px] text-foreground",
                                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                                    on ? "border-foreground bg-[var(--bg)]" : "border-border bg-card",
                                )}>
                                <span aria-hidden="true" className="grid h-8 w-11 grid-cols-2 overflow-hidden rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)]">
                                    <span style={{ background: t.accent }} /><span style={{ background: t.done }} />
                                </span>
                                <span className="flex flex-col gap-px"><span className="font-medium">{t.label}</span><span className="text-[12.5px] text-muted-foreground">{t.desc}</span></span>
                                <span aria-hidden="true" className={cn("size-[18px] rounded-full", on ? "border-[5px] border-foreground" : "border-[1.5px] border-[var(--box-line)]")} />
                            </button>
                        )
                    })}
                </div>
            </Group>
            <Goal key={bg} profile={profile} bg={bg} />
            <NameField profile={profile} />
            {bg === "med" && <CoatColour profile={profile} />}
            <Group title="Appearance" state={themeLabel(theme, dark)}>
                <div className="flex gap-1.5">
                    {LOOKS.map(([id, label, sw]) => (
                        <button key={id} type="button" aria-pressed={theme === id} onClick={() => setTheme(id)}
                            className={cn(
                                "flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-[10px] border border-border bg-muted p-2 font-[inherit] text-[12px] text-ink-2",
                                theme === id && "border-[var(--accent)] bg-accent font-semibold text-accent-foreground",
                            )}>
                            <span className="flex h-5 w-full overflow-hidden rounded-[5px] border border-border">
                                {sw.map((c) => <i key={c} className="flex-1" style={{ background: c }} />)}
                            </span>
                            {label}
                        </button>
                    ))}
                </div>
            </Group>
            <Quotes />
        </>
    )
}

/** The goal: one of the theme's six, or typed. Stored in coat.role; shown on the picture. */
function Goal({ profile, bg }: { profile: Profile; bg: Bg }) {
    const saved = (profile.coat?.role ?? "").trim()
    const [own, setOwn] = useState(saved && !GOALS[bg].includes(saved) ? saved : "")
    const now = goalFor(bg, saved)
    return (
        <Group title="Where you’re headed" id="goalGrp">
            <Hint>Goes on your {THEMES[bg].wear}, so you see what the work is for.</Hint>
            <div role="radiogroup" aria-label="Where you’re headed" className="flex flex-wrap gap-1.5">
                {GOALS[bg].map((g) => (
                    <button key={g} type="button" role="radio" aria-checked={g === now}
                        onClick={() => { setOwn(""); void saveCoat({ role: g }) }}
                        className={cn(
                            "h-[34px] cursor-pointer rounded-full border px-3 font-[inherit] text-[13px]",
                            g === now ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-border bg-card text-foreground",
                        )}>{g}</button>
                ))}
            </div>
            <TextInput id="o-goal" aria-label="Your own goal" placeholder="Or type your own" maxLength={22} value={own}
                onChange={(e) => { setOwn(e.target.value); void saveCoat({ role: e.target.value.trim() }) }} />
        </Group>
    )
}

function NameField({ profile }: { profile: Profile }) {
    const [name, setName] = useState(profile.coat?.name ?? "")
    return (
        <Group title="Your name">
            <Hint>Shown on your coat, badge, name plate, jacket, jersey or vest.</Hint>
            <TextInput id="o-name" aria-label="Your name" value={name} maxLength={28} placeholder={profile.displayName || "Your name"}
                onChange={(e) => { setName(e.target.value); void saveCoat({ name: e.target.value }) }} />
        </Group>
    )
}

function CoatColour({ profile }: { profile: Profile }) {
    const colour = coatColour(profile)
    return (
        <Group title="Coat colour" state={colourName(colour)}>
            <Swatches value={colour} colors={COAT_PALETTE.map((p: { hex: string; name: string }) => ({ ...p, name: p.name + " coat" }))} onChange={(color) => void saveCoat({ color })} />
        </Group>
    )
}
```

`openSettings("o-goal")` must focus the goal box: check how `focus` ids reach the field (`rg -n "focus" src/components/sheet/settings-sheet.tsx | head`); "o-name" already works that way, and "o-goal" is an input id too, so nothing more is needed if focus is by element id.

In `src/styles/shell.css` delete the `.bgthumb…` rules and the `.coatpreview…` rules (`rg -n "bgthumb|coatpreview" src` must then find nothing).

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/sheet src/styles/shell.css
git commit -m "Settings: six themes as rows, where you're headed, your name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The next-exam animation

**Files:**
- Create: `src/components/views/exam-motif.tsx`
- Modify: `src/components/views/stats.tsx`, `src/index.css`
- Test: `src/components/views/exam-motif.test.tsx`

Per theme, under the next exam's "when" line (prototype lines 226–263): Medicine an ECG trace sweeping; CS `$ countdown --next 52:10:03` with a blinking cursor; Law scales swaying beside "3 of 5 topics"; Aviation a plane flying a dotted route; Sports a stopwatch hand with "52:10:03 to go"; Engineering two gears turning beside "3 of 5 topics". All in `var(--motif)`; all still under reduced motion.

- [ ] **Step 1: Write the failing test** `src/components/views/exam-motif.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { BGS } from "@/data/themes"
import { ExamMotif, countdown } from "./exam-motif"

afterEach(cleanup)
const at = new Date(Date.now() + 90061000)      /* 25h 1m 1s away */

describe("the next-exam animation", () => {
    it("counts down in hours, minutes and seconds", () => {
        expect(countdown(90061000)).toBe("25:01:01")
        expect(countdown(-5)).toBe("00:00:00")
    })

    it.each(BGS)("%s draws its own motif, hidden from screen readers", (bg) => {
        const { container } = render(<ExamMotif bg={bg} at={at} steps="3 of 5 topics" />)
        const motif = container.querySelector("[data-motif]")!
        expect(motif.getAttribute("data-motif")).toBe(bg)
        expect(motif.getAttribute("aria-hidden")).toBe("true")
    })

    it("CS and Sports show the countdown; Law and Engineering the topics", () => {
        const text = (bg: typeof BGS[number]) => render(<ExamMotif bg={bg} at={at} steps="3 of 5 topics" />).container.textContent
        expect(text("cs")).toMatch(/countdown --next25:01:0\d/)
        expect(text("sports")).toMatch(/25:01:0\d to go/)
        expect(text("law")).toContain("3 of 5 topics")
        expect(text("eng")).toContain("3 of 5 topics")
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/views/exam-motif.test.tsx`
Expected: FAIL, "Cannot find module './exam-motif'".

- [ ] **Step 3: The keyframes.** Append to `src/index.css`:

```css
/* The next-exam box's animation per theme (components/views/exam-motif.tsx). They stop
   for anyone who asks for less motion. */
@keyframes motif-ecg { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes motif-blink { 50% { opacity: 0; } }
@keyframes motif-sway { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }
@keyframes motif-fly { from { left: 0; } to { left: calc(100% - 20px); } }
@keyframes motif-turn { to { transform: rotate(360deg); } }
@layer components {
  .motif-ecg { animation: motif-ecg 2.6s linear infinite; }
  .motif-blink { animation: motif-blink 1.1s steps(1) infinite; }
  .motif-sway { transform-origin: 15px 5px; animation: motif-sway 3.2s ease-in-out infinite; }
  .motif-fly { animation: motif-fly 6s ease-in-out infinite; }
  .motif-hand { transform-origin: 12px 13.5px; animation: motif-turn 4s steps(40) infinite; }
  .motif-gear-a { transform-origin: 11px 12px; animation: motif-turn 6s linear infinite; }
  .motif-gear-b { transform-origin: 26px 8px; animation: motif-turn 4s linear infinite reverse; }
  @media (prefers-reduced-motion: reduce) {
    .motif-ecg, .motif-blink, .motif-sway, .motif-fly, .motif-hand, .motif-gear-a, .motif-gear-b { animation: none; }
  }
}
```

- [ ] **Step 4: Write `src/components/views/exam-motif.tsx`:**

```tsx
// The next-exam box's animation, one per theme, in --motif (prototype lines 226–263):
// an ECG trace, a terminal countdown, swaying scales, a plane on its route, a stopwatch,
// two gears. The keyframes are in index.css and stop under prefers-reduced-motion.

import { useEffect, useState } from "react"
import type { Bg } from "@/data/themes"

const pad = (n: number) => String(n).padStart(2, "0")

/** "25:01:01": hours (past 24 too), minutes and seconds until then. */
export function countdown(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000))
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60)
}

function useCountdown(at: Date, on: boolean) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!on) return
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [on])
    return countdown(at.getTime() - now)
}

const TRACE = "M0 18h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23"

export function ExamMotif({ bg, at, steps }: { bg: Bg; at: Date; steps: string }) {
    const clock = useCountdown(at, bg === "cs" || bg === "sports")
    const rule = <span className="h-px grow bg-border" />
    return (
        <span data-motif={bg} aria-hidden="true" className="relative mt-auto flex h-[26px] w-full items-center gap-2.5 text-[12px] text-ink-2">
            {bg === "med" && (
                <svg viewBox="0 0 300 26" preserveAspectRatio="none" width="100%" height="26" className="block w-full">
                    <path d={TRACE} fill="none" stroke="var(--motif)" strokeOpacity=".16" strokeWidth="1.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    <path d={TRACE} pathLength={100} fill="none" stroke="var(--motif)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="24 76" vectorEffect="non-scaling-stroke" className="motif-ecg" />
                </svg>
            )}
            {bg === "cs" && (
                <span className="flex items-center gap-2 font-mono text-[12.5px]">
                    <span className="text-[var(--accent)]">$</span>countdown --next<span className="font-medium text-foreground">{clock}</span>
                    <span className="motif-blink h-3.5 w-[7px] bg-[var(--accent)]" />
                </span>
            )}
            {bg === "law" && (
                <>
                    <svg width="30" height="24" viewBox="0 0 30 24" fill="none" stroke="var(--motif)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 4v17M10 21h10" />
                        <g className="motif-sway"><path d="M4 5h22" /><path d="M4 5l-3 8h6zM26 5l-3 8h6z" /></g>
                    </svg>
                    {rule}<span>{steps}</span>
                </>
            )}
            {bg === "pilot" && (
                <span className="relative block h-5 w-full">
                    <span className="absolute top-2.5 right-1 left-1 border-t-[1.5px] border-dashed border-[var(--box-line)]" />
                    <span className="absolute top-[7px] left-0 size-[7px] rounded-full bg-[var(--box-line)]" />
                    <span className="absolute top-[5px] right-0 size-[11px] rounded-full border-2 border-[var(--motif)]" />
                    <svg width="20" height="20" viewBox="0 0 24 24" className="motif-fly absolute top-0 left-0">
                        <path d="M21 12c0-.8-.7-1.5-1.5-1.5H14L9.5 3H7.5l2.5 7.5H5L3.5 8H2l1 4-1 4h1.5L5 13.5h5L7.5 21h2l4.5-7.5h5.5c.8 0 1.5-.7 1.5-1.5z" fill="var(--motif)" />
                    </svg>
                </span>
            )}
            {bg === "sports" && (
                <>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--motif)" strokeWidth="1.6" strokeLinecap="round">
                        <circle cx="12" cy="13.5" r="8" /><path d="M10 2.5h4M12 2.5v3" /><path d="M12 13.5V8.5" className="motif-hand" />
                    </svg>
                    <span className="font-mono text-[13px] font-medium text-foreground">{clock}</span><span>to go</span>
                </>
            )}
            {bg === "eng" && (
                <>
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" stroke="var(--motif)">
                        <g className="motif-gear-a"><circle cx="11" cy="12" r="7" strokeWidth="3.5" strokeDasharray="2.6 2.4" /><circle cx="11" cy="12" r="3" strokeWidth="1.6" /></g>
                        <g className="motif-gear-b"><circle cx="26" cy="8" r="4.5" strokeWidth="2.6" strokeDasharray="1.9 1.6" /><circle cx="26" cy="8" r="1.6" strokeWidth="1.4" /></g>
                    </svg>
                    {rule}<span>{steps}</span>
                </>
            )}
        </span>
    )
}
```

- [ ] **Step 5: Put it in the box.** In `stats.tsx`: import `ExamMotif` and `useUi` is already imported; add `const bg = useUi((u) => u.bg)`. Give `Box` an `art?: ReactNode` prop, rendered last:

```tsx
            {/* the foot sits at the bottom, unless a goal bar or an animation is below it */}
            <span className={cn("truncate text-[12.5px] text-ink-2", !children && !art && "mt-auto")}>{foot}</span>
            {art}
```

and pass it to the next-exam `Box`:

```tsx
                art={exam && exam.date ? <ExamMotif bg={bg} at={new Date(exam.date + "T" + (exam.start || "09:00"))} steps={s.prep ? s.prep.done + " of " + s.prep.total + " topics" : ""} /> : undefined}
```

Add a test to `src/components/views/views.test.tsx` (find the four-boxes test with `rg -n "Next exam or quiz" src/components/views/views.test.tsx`): with the next exam set, `container.querySelector("[data-motif]")` is not null, and with none it is null.

- [ ] **Step 6: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/views src/index.css
git commit -m "The next-exam box's animation, one per theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The study word

**Files:**
- Modify: `src/data/study-timer.ts:72,341`, `src/components/focus/focus-screen.tsx:91,156`, `src/components/study/study-dock.tsx:19`
- Test: `src/data/study-timer.test.ts`

While studying, the phase says the theme's word: "On shift · round 1 of 4", "Compiling", "In session", "In flight", "On the clock", "Building". Breaks stay "Break". The flow editor's steps stay "Study" (they name the kind of step, not the moment).

- [ ] **Step 1: Write the failing test.** Add to `src/data/study-timer.test.ts`:

```ts
describe("the tab title", () => {
    it("says the theme's study word while studying", () => {
        const run = { leftMs: 25 * 60000, kind: "study" } as Parameters<typeof tickTitle>[0]
        expect(tickTitle(run, "On shift")).toBe("25:00 · On shift")
        expect(tickTitle({ ...run!, kind: "break" }, "On shift")).toBe("25:00 · Break")
        expect(tickTitle(null, "On shift")).toBe("Term")
    })
})
```

(Import `tickTitle` if the file doesn't. If `timeText(25 * 60000)` renders differently, use what an existing `tickTitle` test in the file expects.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/data/study-timer.test.ts`
Expected: FAIL ("25:00 · Study").

- [ ] **Step 3: Say the word.** `src/data/study-timer.ts` line 341:

```ts
export const tickTitle = (r: Run | null, word = "Study") => (r ? timeText(r.leftMs) + " · " + (r.kind === "study" ? word : "Break") : "Term")
```

Line 72: `document.title = tickTitle(run, THEMES[ui.bg].studyWord)` with `import { THEMES } from "./themes"` (and `ui` from `./ui` if not imported).

`focus-screen.tsx` and `study-dock.tsx`: add `const bg = useUi((u) => u.bg)` (import `useUi` from `@/data/ui` and `THEMES` from `@/data/themes`) and change `run.kind === "study" ? "Study" : "Break"` to `run.kind === "study" ? THEMES[bg].studyWord : "Break"`. In `focus-screen.tsx` line 156 ("Next · Study 25 min") change it the same way. Hooks go above any early `return` in each component.

`rg -n "Study · round|STUDY · ROUND|>Study<" src --glob '*.test.*'` and update tests that expect "Study" for a running phase to "On shift" (their ui fake's bg is med).

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data src/components/focus src/components/study
git commit -m "The study word per theme: On shift, Compiling, In session, In flight, On the clock, Building

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The theme's quote

**Files:**
- Modify: `src/components/side-foot.tsx:40-55`
- Test: `src/components/side-foot.test.tsx`, `src/components/sidebar.test.tsx:195`

With no quotes saved, the sidebar shows the theme's own ("The good physician treats the disease…" — William Osler) instead of "Add a quote in Settings". Clicking it still opens Settings at the quote field (`nextQuote` does that with fewer than two quotes).

- [ ] **Step 1: Change the tests.** In `side-foot.test.tsx` the test that finds `{ name: "Add a quote in Settings" }` becomes:

```tsx
        const button = screen.getByRole("button", { name: /The good physician treats the disease/ })
        expect(button.textContent).toContain("William Osler")
        expect(button.getAttribute("title")).toBe("Add your own quotes in Settings")
```

(keep the rest of that test: the click opens Settings). In `sidebar.test.tsx` line 195, `getByText("Add a quote in Settings")` becomes `getByText(/The good physician/)`. The ui fakes in both need `bg: "med"`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/side-foot.test.tsx src/components/sidebar.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Show the theme's quote.** In `side-foot.tsx`, add `const bg = useUi((u) => u.bg)` (imports: `useUi` from `@/data/ui`, `THEMES` from `@/data/themes`), and replace the quote button's contents:

```tsx
                    title={quoteCount > 1 ? "Next quote" : "Add your own quotes in Settings"}
                    …
                >
                    {(() => {
                        const q = quote ? quote.quote : THEMES[bg].quote
                        return (
                            <>
                                <span className="line-clamp-4 font-serif text-[14.5px] leading-[1.45] text-[color:color-mix(in_srgb,var(--ink)_85%,transparent)] italic">“{q.text}”</span>
                                <span className="text-[12px] text-muted-foreground">{q.source || "Unattributed"}</span>
                            </>
                        )
                    })()}
```

(The title for one saved quote also becomes "Add your own quotes in Settings", as `nextQuote` opens Settings then too.)

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/side-foot.tsx src/components/side-foot.test.tsx src/components/sidebar.test.tsx
git commit -m "The theme's quote until you add your own

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Stage 1's leftovers

**Files:**
- Modify: `src/components/views/week.tsx:17,134-240`, `src/components/sign-in.tsx`, `index.html`, `public/manifest.webmanifest`
- Test: `src/components/views/views.test.tsx`, `src/components/sign-in.test.tsx`

Three things the Stage 1 look noted for this stage: the Tasks box's corner drawing sits under the "Add a task" field (and exists only for Medicine and CS); the office hours' mark is a stethoscope or a prompt, nothing for the other four; "med-school" is in the sign-in line and the app description.

- [ ] **Step 1: The week.** In `week.tsx`: delete `Corner` and `<Corner cs={cs} />`, and the Tasks panel's `className="relative"` and the input wrapper's `relative z-[1]` if nothing else needs them. Replace `Scope` with a mark every theme shares:

```tsx
/** The next office hour's mark. */
const NextMark = () => (
    <span role="img" aria-label="Next" className="mt-[5px] size-2 flex-none rounded-full bg-[var(--accent)]" />
)
```

and `{i === 0 && <Scope cs={cs} />}` with `{i === 0 && <NextMark />}`. Remove the now unused `cs` prop from `OfficeHours` and `Tasks` and the `cs` constant at line 17 if nothing else reads it (`rg -n "\bcs\b" src/components/views/week.tsx`). Tests that look for the "Next" image keep working (`getByRole("img", { name: "Next" })`).

- [ ] **Step 2: The words.** `sign-in.tsx`: "Your med-school week, in one place." → "Your term, in one place." `index.html` and `public/manifest.webmanifest` description: "A med-school tracker: assignments, exams, labs, tutorials, office hours and tasks." → "A student tracker: assignments, exams, labs, tutorials, office hours and tasks." Update `sign-in.test.tsx` if it checks the line (`rg -n "med-school" src test`). `index.html`'s description is not in the inline script, so the CSP hash is unchanged; `npm run build` confirms.

- [ ] **Step 3: Run everything**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components index.html public/manifest.webmanifest
git commit -m "No corner drawing under Add a task; one office-hours mark; Term is for any student

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Look at all six

**Files:** none unless something is off.

- [ ] **Step 1: Run it.** Check 8787 is free, `npm run dev`, sign in as `termqa` (Task 1 Step 6). Add a course, an exam with a two-step checklist (one ticked) in three days, an assignment done, a task.
- [ ] **Step 2: Each theme, light then dark** (Settings → You → Theme; Appearance → Dark): the sidebar picture and its name and goal fit (try a long name: "Alexandra Montgomery"); "Headed for"; the accent on the nav and buttons; today's tint; the completed row and the checklist bar; the next-exam animation (and that it stops with the OS "reduce motion" on); the Study page's Ready card colour; start a run: the dock and the focus screen say the study word. Against the prototype's pictures and boxes. Note every difference in a list.
- [ ] **Step 3: The goal.** Pick a chip, type your own, switch theme: the typed goal stays; a chip goal from another theme shows as your own text. Reload: all kept.
- [ ] **Step 4: The phone width** (as narrow as the browser allows): the picture fits the drawer; the boxes swipe with the animation inside.
- [ ] **Step 5: Keyboard:** Tab to the theme rows: the focus ring shows; Space picks.
- [ ] **Step 6: Fix what the list found**, each fix its own commit with its test where a test can catch it.

---

### Task 13: Review, the clean database, and the release

- [ ] **Step 1: Full checks.** `npm run check` → PASS.
- [ ] **Step 2: Review.** superpowers:requesting-code-review on `term-2-themes` against `term`. Fix what it finds.
- [ ] **Step 3: Show the owner** `npm run dev:built` (http://127.0.0.1:4173): all six themes, light and dark, a phone width. On a yes: `git switch term && git merge --no-ff term-2-themes`.
- [ ] **Step 4: Rehearse the move locally** with a temporary second binding, as the last three moves did (memory: clean-db-procedure):
  1. `git switch main && git merge --no-ff term` (not pushed yet).
  2. `npx wrangler d1 create rounds-v5` **needs the owner's yes** (it creates a Cloudflare resource). Add it to `wrangler.jsonc` as a second binding `NEW_DB` with `"migrations_dir": "migrations"`, apply locally: `npx wrangler d1 migrations apply NEW_DB --local`.
  3. `node scripts/move-db.mjs --from rounds-v4 --to rounds-v5` (local): it copies, reads both back and compares. Expected: "same rows" and the change head matches.
  4. Check with `node:sqlite` or `npx wrangler d1 execute rounds-v5 --local --command "SELECT sql FROM sqlite_master WHERE name='users'"` that the CHECK lists the six.
- [ ] **Step 5: Ask the owner before the remote steps.** Then, in order, with no pause between copy and deploy:
  1. `npm run build` (build before the copy).
  2. `npx wrangler d1 migrations apply NEW_DB --remote` (the fresh `rounds-v5` only).
  3. `node scripts/move-db.mjs --from rounds-v4 --to rounds-v5 --remote`. Expected: same rows, same head.
  4. `wrangler.jsonc`: point `DB` at `rounds-v5` (its `database_name` and `database_id`), remove `NEW_DB`; `npm run db:check -- --remote`.
  5. Commit ("The database moves to rounds-v5: six themes"), `git push origin main term`: the Cloudflare Git build deploys.
  6. Local dev now reads the local `rounds-v5`, which Step 4 filled from the local `rounds-v4` (Task 1's rebuilt one, holding `termqa`). If `npm run dev` comes up empty, run `npm run db:local` and add `termqa` again (Task 1 Step 6).
  7. Confirm the old database's change head has not moved since the copy: `npx wrangler d1 execute rounds-v4 --remote --command "SELECT max(seq) FROM changes"` equals the number the move printed.
  8. `rounds-v4` stays as the backup until the owner says delete.
- [ ] **Step 6: Check the live site** https://rounds.termanitor07.workers.dev: signs in, the week renders with the owner's data, Settings → Theme → Law saves and survives a reload, a change syncs. Then write the Stage 3 plan (semesters and repeats; its start is the Stage 1 plan's "What each later stage must cover").

---

## Self-review notes

- **Spec §5 coverage:** six themes (T2–T4, T7), pictures with name (T5–T6), accent/today/completed (T4), next-exam animation (T8), study word (T9), dark timer colour (T4 `--fx-study-bg`), default quote (T10), goals with six suggestions or free text stored in `coat_role` (T7), reduced motion (T8 CSS), the `bg` CHECK (T1, clean db per the owner, T13).
- **Deliberately not here:** the third study preset named per theme and the Timer tab layout (Stage 5); the Music page (Stage 6); per-theme demo courses and rows (prototype-only data).
- **Old clients:** a browser still on Stage 1's code reads `bg: "law"` as Medicine and, if it saves the profile before updating, writes `med` back. The service worker updates on the next load; acceptable.
