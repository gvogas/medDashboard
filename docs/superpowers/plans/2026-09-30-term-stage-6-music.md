# Term Stage 6: Music — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Spotify page becomes the **Music** page, restyled to the prototype: the player on the left (a square cover, the title in the serif, the progress, shuffle · previous · play · next · repeat, the device and the volume, then Up next / Recent) and the browser on the right (search, a pick for the theme at the top, Liked Songs and the playlists, an opened playlist with Play all, Shuffle and a filter, ▶ and + on every track). The focus screen's music pill and side panel get the same look on glass. Every behaviour of today's music stays.

**Architecture:** No database change, no Worker change, **no change to the Spotify engine** (`src/data/spotify/` is read-only in this stage). Only `src/components/spotify/*`, `src/components/focus/music-panel.tsx`, `music-pill.tsx`, one class list in `focus-screen.tsx`, the top bar's title (`src/components/view-heading.ts`) and the themes table (`src/data/themes.ts`) change. The internal names stay (`ui.view === "spotify"`, `ui.spotify`, the `spotify/` folder, `SpotifyPage`): spec §1 keeps internal names. One new component, `src/components/spotify/for-theme.tsx`, draws the theme's pick from a new `music` entry per theme in `THEMES`. The icons become one 24-unit set in `bits.tsx` (the prototype's paths); emoji go (🔈 💻 📱 ♥ ▶ as glyphs). Track rows in an opened list on the page get numbers and the prototype's columns through a container query (`@container` on the browser's scroller), so the same rows work in the narrow focus panel.

**The theme's pick (decided here).** The prototype's "For the night shift — Picked for the Medicine theme" card is a playlist Term made ("Night shift", 10 songs, ▶). Term has no playlists of its own, and since November 2024 Spotify no longer gives new apps its editorial playlists, so a hard-coded playlist id would be fragile and its name and cover unknown without new engine calls. **The pick is a Spotify search per theme**, run through the engine's existing `search()`: the card says "For the night shift · Picked for the Medicine theme", shows "Search on Spotify", the name "Night shift" in the serif and "Playlists and tracks for “night shift study”", and clicking it opens the results exactly as typing that search would (‹ Library returns). It has no ▶ (there is nothing to play until a result is picked) and no cover art (a square in the accent with the search icon). The words and queries are in `THEMES[bg].music` so the owner can change them in one place:

| Theme | "For …" | Name | Query |
|---|---|---|---|
| Medicine | the night shift | Night shift | night shift study |
| Computer Science | deep work | Deep work | deep work focus |
| Law | library hours | Library hours | library study |
| Aviation | the cockpit | Cruising altitude | cruising altitude chill |
| Sports | game day | Pre-game | pre-game hype |
| Engineering | the workshop | Workshop | workshop focus |

(The words and names are the prototype's `themeWord` and `FEAT`, lines 1416 and 2161; the queries are new.)

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4 (container queries), Vitest (jsdom + Workers pool).

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §9, and "Not in this redesign". **Prototype:** `design/term-prototype.dc.html` (read, don't open). The Music page is lines 660–797: the grid 662 (400px and the rest), the Player 664–716 (cover 667–669, title and equaliser 670–676, progress 677–680, controls 681–687, device and volume 688–699, the device list 691–698, Up next / Recent 700–716), the browser 718–795 (search 720–724, the theme's pick 729–737, Library 738–753, an opened list 756–793 with its head 758–772, filter 774–776, column header 778, rows 779–790). The focus screen's pill is line 1150; its panel 1155–1205 (head 1156–1160, now playing 1161–1179, the pills 1180–1182, the lists 1183–1204). Values: `lists(key)` line 1415 (the per-theme name `FEAT` 1416), `mu` from line 2135 (`themeWord` 2161, `feature` 2162), `sv.fmTabs` 1916 (the pills' colours), `fmShuffleBg` 1915.

**Branch:** `term-6-music` off `term` (`term` and `main` are both at 941dd41; the branch exists).

**What the owner sees at the end:** "Music" in the top bar (with "Playing on MacBook" under it, as today). On the left a white card: the cover as a 240px square with a soft shadow, the title in the serif (22px) with the artist and album under it and the accent equaliser beside it while it plays, a 4px progress line in the accent with the times in mono, then shuffle · previous · a 60px play button in the accent · next · repeat (shuffle and repeat show a soft accent circle when on; repeat-one shows a small "1"), the device button with Spotify's green dot and the volume with a speaker icon. Under a rule, Up next / Recent as a small segmented switch with "2 queued" or "Last 8" beside it, and the rows. On the right a white card: a round search box with a magnifier, a dark Search button and "Spotify" with its mark; under it **For the night shift** (the theme's pick, in the theme's soft tint) and **Library** with "N playlists", the covers four or more across, Liked Songs in the accent with a heart. An opened playlist shows its cover (132px), "Playlist", the name in the serif (30px), "30 tracks", Play all in the accent and a round Shuffle, the filter "Filter this list", a "# Title Artist Time" header and numbered rows (the playing one tinted, with the equaliser in place of its number) with ▶ and + at the end. On the focus screen, the pill is a soft white pill with the green dot on the device; ▴ Music opens a floating glass panel with a 16px corner, "Music" and ✕, the cover beside the title, white controls with a white play button, Up next · Recent · Library as pills, search, and the lists; the clock re-centres as today. Under 760px the page is one column with the pill on top (▴ Music opens the player), as today; on a phone the panel is the bottom sheet, as today. No emoji anywhere in the music.

**Not in this stage:**
- **The theme's pick as a playlist with its own cover and ▶** — it is a search (above); the engine has no featured or editorial playlists.
- **"Playing" on the library tile of the playlist that plays** (prototype line 747) — the engine's `PlayerState` does not carry the playing context.
- **Removing a track from Up next** (the ✕ on prototype line 711) — Spotify's API does not allow it; the note "Spotify lets apps add to the queue and skip, but not remove or reorder" stays.
- **A playlist's length in time** ("10 songs · 52m · Spotify") — Spotify gives a count, not a length, without loading every track; the line stays "30 tracks".
- **"Open Music page" in the focus panel** (prototype line 1158) — a new way out of focus mode; spec §9 keeps today's behaviour. Leave and Music in the sidebar do it. Ask the owner (Task 9).
- **The panel's library tiles playing on click** (prototype 1197) — ours open the playlist, with ▶ on the cover, as today.
- **The device list as a floating popover** (prototype 692) — it stays in the flow under the device button, so it fits the focus panel.
- **The Up next / Recent switch as an ARIA tablist** (prototype 702) — it stays pressed buttons like the panel's pills (a search result belongs to no tab), as Stage 5 kept History's switch.
- **Search results as one list of songs** — ours keep Tracks, Artists, Albums and Playlists, each with Show more.
- **The prototype's drawn covers** — real cover art; a muted square with the Spotify mark where Spotify has none.
- **The sidebar player** — the prototype's sidebar has none, but removing it would take the controls away from every other page (spec §1: nothing is removed without a place to go). It stays; only its colours follow (accent, no gradient). Ask the owner (Task 9).
- **The phone design pass** — the page and the panel keep today's phone behaviour, restyled with the same tokens.
- Import with AI (Stage 7).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run src/components/spotify/spotify-page.test.tsx`; the music: `npx vitest run src/components/spotify src/components/focus`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. Blank page titled "Rounds": unregister the old service worker (DevTools → Application). Local user: `termqa` / `termqa-local-1`. The local Worker has Spotify's client keys in `.dev.vars`.
3. **Line endings and encoding:** keep every file LF and UTF-8. Characters like `·`, `“ ”`, `‹`, `✓`, `✕`, `▴`, `▾`, `…`, `—` must be UTF-8: after writing a file, `file <path>` should not say "ISO-8859" or "CRLF"; if Vite then serves a stale copy, touch the file.
4. **Commits:** end each message with these two lines (the commit commands below pass them as a second `-m`):
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
   `Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry`
   Commit only on `term-6-music`. Never push or merge to `main` without the owner's yes (Task 9 asks). This stage touches no database.
5. **Tests find text.** When a task changes a word or a role, `rg -n "<old word>" src test` and update the tests in the same commit. The music's tests run the **real engine** over a fake Worker: `fakeApi()`, `resetEngine()`, `setPlayer()` in `src/components/spotify/test-spotify.ts`; they use the real `ui` (`@/data/ui`).
6. **The engine is read-only.** Nothing in `src/data/spotify/` changes. If a task seems to need it, stop and put the feature under "Not in this stage".
7. **Colours** go through tokens: Tailwind's `bg-primary` (`--accent`), `bg-secondary` (`--accent-soft`), `text-foreground`, `text-ink-2`, `text-muted-foreground` (`--ink-3`), `border-border` (`--line`), `bg-line-2`, `bg-card`, `bg-[var(--spotify)]` for Spotify's green dot only. A colour that comes from data goes through `style` (as `accent()` in `src/components/views/bits.tsx`). In `cn()`, never put two arbitrary `text-[var(…)]`, `bg-[var(…)]` or `border-[var(…)]` classes that must override each other: tailwind-merge can't tell a colour from a size inside `var()`. Choose one with a ternary instead.
8. **The glass.** On the focus screen the music draws inside `FX` (`src/components/spotify/bits.tsx`), which re-points the tokens at the dark palette: there `text-foreground` is near-white, `bg-foreground` a white button, `text-background` the deep study colour, `--panel-2` a 10% white. Light-only tokens (`--chip-bg`) are not re-pointed: don't use them in what the panel draws.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/view-heading.ts` | modify | the title "Music" |
| `src/components/top-bar.test.tsx` | modify | expects "Music" |
| `src/data/themes.ts`, `src/data/themes.test.ts` | modify | `music`: the theme's pick (word, name, query) |
| `src/components/spotify/bits.tsx` | modify | one 24-unit icon set; the equaliser in the accent; plain sub-headings; no device emoji; "Pick something on the Music page" |
| `src/components/spotify/devices.tsx` | modify (rewrite) | the device button with the green dot, the list with a tick, the volume with an icon |
| `src/components/spotify/now-playing.tsx` | modify (rewrite) | the player, large on the page, compact on glass |
| `src/components/spotify/sidebar-player.tsx` | modify | the progress and bars in the accent, no gradient |
| `src/components/spotify/spotify-page.tsx` | modify (rewrite) | the page's two cards, 400px player column, phone fold |
| `src/components/spotify/music-browser.tsx` | modify | the tabs (segment / pills), the search form, the heads, Up next / Recent's note |
| `src/components/spotify/for-theme.tsx` | create | the theme's pick |
| `src/components/spotify/lists.tsx` | modify | the library with its heading and the pick; an opened list's head, Play all, filter, columns |
| `src/components/spotify/rows.tsx` | modify | track rows (numbered in an opened list), the tiles, ▶ as an icon |
| `src/components/spotify/spotify-page.test.tsx` | modify | the page's new look, the pick, the rows; words that changed |
| `src/components/focus/music-panel.tsx` | modify (rewrite) | the panel as the prototype's |
| `src/components/focus/music-pill.tsx` | modify | the soft pill, the green dot |
| `src/components/focus/focus-screen.tsx` | modify | the panel floats (margin, 16px corner); the pill's background is its own |
| `src/components/focus/music.test.tsx`, `focus-screen.test.tsx` | modify | the panel and pill's look |

---

### Task 1: Music by name, and the theme's pick in the themes table

**Files:**
- Modify: `src/components/view-heading.ts`, `src/components/top-bar.test.tsx`
- Modify: `src/data/themes.ts`, `src/data/themes.test.ts`
- Modify: `src/components/spotify/bits.tsx` (one message), `src/components/spotify/spotify-page.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/top-bar.test.tsx`, in the test that shows each view's title, replace

```ts
        show("spotify")
        expect(title()).toBe("Spotify")
```

with

```ts
        show("spotify")
        expect(title()).toBe("Music")
```

In `src/data/themes.test.ts`, add inside `describe("the themes", …)`:

```ts
    it("picks a Spotify search for the Music page per theme", () => {
        expect(BGS.map((bg) => THEMES[bg].music.name)).toEqual(["Night shift", "Deep work", "Library hours", "Cruising altitude", "Pre-game", "Workshop"])
        expect(BGS.map((bg) => THEMES[bg].music.word)).toEqual(["the night shift", "deep work", "library hours", "the cockpit", "game day", "the workshop"])
        expect(THEMES.med.music.query).toBe("night shift study")
        for (const bg of BGS) expect(THEMES[bg].music.query.trim().length).toBeGreaterThan(2)
    })
```

In `src/components/spotify/spotify-page.test.tsx`, add inside `describe("the sidebar player", …)`:

```ts
    it("sends a person with nothing to resume to the Music page", () => {
        render(<SidebarPlayer />)
        setPlayer({ error: "nothing_to_resume" })
        expect(within(badge()).getByRole("status").textContent).toBe("Pick something on the Music page")
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/top-bar.test.tsx src/data/themes.test.ts src/components/spotify/spotify-page.test.tsx`
Expected: FAIL: the title is "Spotify"; `THEMES.med.music` is undefined; the message says "Pick something in the Spotify view".

- [ ] **Step 3: The title**

In `src/components/view-heading.ts`, in `case "spotify":`, change `title: "Spotify",` to `title: "Music",` (the line under it, "Playing on …", stays).

- [ ] **Step 4: The theme's pick**

In `src/data/themes.ts`, in `interface ThemeInfo`, after the `preset` field add:

```ts
    /** the Music page's first card: "For the night shift", a Spotify search picked for the theme */
    music: { word: string; name: string; query: string }
```

and add a `music` entry to each theme, after its `preset` (keep each object's other fields as they are):

```ts
    med:    … preset: "Anki then read",     music: { word: "the night shift", name: "Night shift", query: "night shift study" },
    cs:     … preset: "LeetCode then read", music: { word: "deep work", name: "Deep work", query: "deep work focus" },
    law:    … preset: "Brief then outline", music: { word: "library hours", name: "Library hours", query: "library study" },
    pilot:  … preset: "Charts then sim",    music: { word: "the cockpit", name: "Cruising altitude", query: "cruising altitude chill" },
    sports: … preset: "Film then drills",   music: { word: "game day", name: "Pre-game", query: "pre-game hype" },
    eng:    … preset: "Problems then read", music: { word: "the workshop", name: "Workshop", query: "workshop focus" },
```

Change the file's third comment line to say where these come from: `// (styles/tokens.css, :root[data-bg="…"]). Values from the prototype's THEMES, STUDY, GOALS; the music's words from its lists() and themeWord.`

- [ ] **Step 5: The message**

In `src/components/spotify/bits.tsx`, in `CONTROL_ERRORS`, change

```ts
    nothing_to_resume: "Pick something in the Spotify view",
```

to

```ts
    nothing_to_resume: "Pick something on the Music page",
```

In the comments that name the page (`spotify-page.tsx` line 1, `music-browser.tsx` lines 1 and 155, `music-pill.tsx` lines 4 and 28, `src/components/views/views.tsx` line 1, `src/components/shell.tsx` line 43), say "Music page" for "Spotify page" / "Spotify view". Comments only; no identifiers change.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/components/top-bar.test.tsx src/data/themes.test.ts src/components/spotify/spotify-page.test.tsx`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/view-heading.ts src/components/top-bar.test.tsx src/data/themes.ts src/data/themes.test.ts src/components/spotify src/components/focus/music-pill.tsx src/components/views/views.tsx src/components/shell.tsx
git commit -m "The Spotify page is called Music; each theme has its music pick" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 2: The music's icons and the device row

**Files:**
- Modify: `src/components/spotify/bits.tsx`
- Modify (rewrite): `src/components/spotify/devices.tsx`
- Modify: `src/components/spotify/spotify-page.test.tsx`

The icons are the prototype's (lines 682–690, 721, 733–775, 1159): filled for play, pause, previous, next and the heart; stroked (1.8) for the rest. The device button shows Spotify's green dot (line 689), the device list a tick on the device that plays (line 696), the volume a speaker (line 690). The emoji go.

- [ ] **Step 1: Write the failing tests**

In `src/components/spotify/spotify-page.test.tsx`, add

```ts
import { Icon } from "./bits"
```

after the `import { SidebarPlayer } from "./sidebar-player"` line. Add inside `describe("the Spotify page", …)`:

```ts
    it("marks the device with Spotify's dot and the one playing with a tick, and draws no emoji", async () => {
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        api.spotifyDevices.mockResolvedValue({ devices: [
            { id: "mac", name: "MacBook", type: "Computer", active: true, restricted: false },
            { id: "rounds", name: "Term", type: "Computer", active: false, restricted: false },
        ] })
        show()
        const player = card("Player")
        const button = player.getByRole("button", { name: "MacBook" })
        expect(button.querySelector("span[aria-hidden]")!.className).toContain("bg-[var(--spotify)]")
        fireEvent.click(button)
        const list = within(await player.findByRole("dialog", { name: "Choose a device" }))
        await list.findByText("This tab")
        const mac = list.getByRole("button", { name: /MacBook/ })
        expect(mac.getAttribute("aria-current")).toBe("true")
        expect(mac.querySelector("svg")).toBeTruthy()
        expect(list.getByRole("button", { name: /This tab/ }).querySelector("svg")).toBeNull()
        expect(player.getByTitle("Volume on MacBook").querySelector("svg")).toBeTruthy()
        expect(player.textContent).not.toMatch(/[🔈🔉🔊🔇💻📱📺🎮🚗]/u)
    })
```

and at the end of the file:

```ts
describe("the music's icons", () => {
    it("draw on a 24-unit box, filled or stroked, hidden from screen readers", () => {
        const { container } = render(<><Icon name="play" /><Icon name="shuffle" /></>)
        const [play, shuffle] = container.querySelectorAll("svg")
        expect(play.getAttribute("viewBox")).toBe("0 0 24 24")
        expect(play.getAttribute("fill")).toBe("currentColor")
        expect(shuffle.getAttribute("fill")).toBe("none")
        expect(shuffle.getAttribute("stroke")).toBe("currentColor")
        for (const svg of [play, shuffle]) expect(svg.getAttribute("aria-hidden")).toBe("true")
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/spotify/spotify-page.test.tsx`
Expected: FAIL: the device button has a 🔈 and no dot; the list rows have emoji icons and no tick; the icon's box is `0 0 12 12`; there is no `shuffle` icon.

- [ ] **Step 3: The icons, the equaliser and the small parts in `bits.tsx`**

Replace the file's first three comment lines with:

```ts
// Small pieces the music shares: the Spotify mark, the icons (the prototype's, on a
// 24-unit box), a cover, the equaliser, the empty and loading lines, Show more and ↻,
// the short note, and the glass tokens that turn any of it dark for the focus screen.
```

Replace the `PATHS` object and the `Icon` component with:

```tsx
/* The prototype's icons. Filled: the transport and the heart; stroked: the rest. */
const FILLED = {
    prev: "M6 5h2v14H6zM20 5v14L9 12z",
    next: "M16 5h2v14h-2zM4 5v14l11-7z",
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    heart: "M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.4 1 4.2 2.3h2C13.8 6 15.2 5 17.2 5c3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z",
}
const STROKED = {
    shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
    repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
    volume: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7",
    mute: "M11 5 6 9H3v6h3l5 4zM16 9.5l5 5M21 9.5l-5 5",
    search: "M17.25 10.5a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0zM15.75 15.75l4.5 4.5",
    filter: "M4 6h16M7 12h10M10 18h4",
    check: "m4.5 12.75 4.5 4.5 10.5-10.5",
    down: "m6 9 6 6 6-6",
    close: "m6 6 12 12M18 6 6 18",
    arrow: "M5 12h14M13 6l6 6-6 6",
}
export type IconName = keyof typeof FILLED | keyof typeof STROKED

export function Icon({ name, className }: { name: IconName; className?: string }) {
    const filled = name in FILLED
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill={filled ? "currentColor" : "none"}
            stroke={filled ? undefined : "currentColor"}
            strokeWidth={filled ? undefined : 1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn("size-3 flex-none", className)}
        >
            <path d={filled ? FILLED[name as keyof typeof FILLED] : STROKED[name as keyof typeof STROKED]} />
        </svg>
    )
}
```

In `Eq`, change the bar's colour `bg-[var(--spotify)]` to `bg-primary` (the prototype's equaliser is in the accent; on the glass `--accent` is the phase colour).

Replace `Sub` and `Count` (no uppercase labels any more):

```tsx
/** A small heading inside a list, with a count or a button at its end. */
export const Sub = ({ children, end }: { children: ReactNode; end?: ReactNode }) => (
    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1 text-[12px] font-semibold text-muted-foreground">
        {children}
        {end}
    </div>
)

export const Count = ({ n }: { n: number }) => (
    <em className="ml-auto text-[12px] font-normal text-muted-foreground not-italic">{n}</em>
)
```

Replace `chipButton` with the prototype's back button (line 762):

```ts
/** A pill-shaped text button, like ‹ Back. */
export const chipButton = "inline-flex h-7 flex-none cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[12px] whitespace-nowrap text-ink-2 hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-45"
```

Delete `DEVICE_ICON` and `deviceIcon` at the end of the file (`rg -n deviceIcon src` must then find only `devices.tsx`, which Step 4 rewrites).

- [ ] **Step 4: Rewrite `devices.tsx`**

```tsx
// Where the music plays and how loud: the device button (Spotify's green dot, the device,
// ▾), its "Play on" list (this tab as "This tab", a tick on the device that plays, devices
// that take no commands disabled), and the volume. The prototype's lines 688–699.

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { activate, closeDevices, pickDevice, setVolume, toggleDevices, type SpotifySnapshot } from "@/data/spotify"
import { Empty, Icon, Loading } from "./bits"

/** The device button with the volume beside it (`beside`), and the list under both when open. */
export function Devices({ s, cooling, beside }: { s: SpotifySnapshot; cooling: boolean; beside?: ReactNode }) {
    const list = s.cache.devices, open = !!list
    const box = useRef<HTMLDivElement>(null)
    const button = useRef<HTMLButtonElement>(null)

    /* A click anywhere else, or Escape, closes the list. Escape is taken before the page's
       own keys (capture), which then leave it alone. */
    useEffect(() => {
        if (!open) return
        const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) closeDevices() }
        const esc = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented) return
            e.preventDefault()
            closeDevices()
            button.current?.focus()
        }
        document.addEventListener("pointerdown", away, true)
        document.addEventListener("keydown", esc, true)
        return () => {
            document.removeEventListener("pointerdown", away, true)
            document.removeEventListener("keydown", esc, true)
        }
    }, [open])

    return (
        <div ref={box} className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-3">
                <button
                    ref={button}
                    type="button"
                    aria-expanded={open}
                    title="Choose where Spotify plays"
                    onClick={() => toggleDevices()}
                    className={cn(
                        "inline-flex h-[34px] max-w-[190px] min-w-0 flex-none cursor-pointer items-center gap-2 rounded-full border bg-card px-3 text-[12.5px] whitespace-nowrap text-foreground hover:border-primary",
                        open ? "border-primary" : "border-border",
                    )}
                >
                    <span aria-hidden="true" className="size-2 flex-none rounded-full bg-[var(--spotify)]" />
                    <span className="min-w-0 truncate">{s.player.device || "Choose a device"}</span>
                    <Icon name="down" className="size-2.5" />
                </button>
                {beside}
            </div>
            {list && (
                <div role="dialog" aria-label="Choose a device" className="overflow-hidden rounded-[10px] border border-border bg-card py-1.5 shadow-[var(--shadow-2)]">
                    <div className="px-3.5 pt-1 pb-1.5 text-[11px] font-semibold text-muted-foreground">Play on</div>
                    {s.busy.has("devices") && !list.length
                        ? <Loading what="Devices" cooling={cooling} />
                        : !list.length
                            ? <Empty>No devices. Open Spotify on your phone, computer or speaker.</Empty>
                            : list.map((d) => {
                                const here = d.id === s.web.deviceId
                                return (
                                    <button
                                        key={d.id}
                                        type="button"
                                        disabled={d.restricted}
                                        title={d.restricted ? "This device does not take commands" : undefined}
                                        aria-current={d.active || undefined}
                                        onClick={() => { activate(); void pickDevice(d.id) }}
                                        className={cn(
                                            "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border-0 px-3.5 text-left disabled:cursor-default disabled:opacity-50",
                                            d.active ? "bg-secondary" : "bg-transparent hover:bg-[var(--line-2)] disabled:hover:bg-transparent",
                                        )}
                                    >
                                        <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                                            <span className={cn("truncate text-[13px] text-foreground", d.active && "font-semibold")}>{here ? "This tab" : d.name}</span>
                                            <small className="truncate text-[11.5px] text-muted-foreground">{d.active ? "Playing here" : here ? "Term, in this browser" : d.type}</small>
                                        </span>
                                        {d.active && <Icon name="check" className="size-3.5 text-primary" />}
                                    </button>
                                )
                            })}
                </div>
            )}
        </div>
    )
}

/** The volume, where the device takes it from here; the number follows the slider at once. */
export function Volume({ s, className }: { s: SpotifySnapshot; className?: string }) {
    const p = s.player, vol = s.volume
    const can = p.connected && p.supportsVolume && vol != null
    return (
        <div
            title={can ? "Volume on " + p.device : p.device ? "This device does not take volume from here" : "Nothing is playing"}
            className={cn("flex min-w-0 flex-1 items-center gap-2 text-[12px] text-muted-foreground", !can && "opacity-55", className)}
        >
            <Icon name={vol === 0 ? "mute" : "volume"} className="size-[15px]" />
            <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={vol ?? 50}
                disabled={!can}
                aria-label="Volume"
                onChange={(e) => setVolume(+e.target.value)}
                className="m-0 h-4 min-w-[60px] flex-1 accent-[var(--accent)]"
            />
            <span className="w-[26px] flex-none text-right font-mono text-[11.5px]">{vol == null ? "—" : vol}</span>
        </div>
    )
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/components/spotify src/components/focus`
Expected: PASS (the device and volume tests from before still pass: the names, "This tab", "Playing here", "Term, in this browser", the disabled title, the volume's number and titles are unchanged).
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/spotify/bits.tsx src/components/spotify/devices.tsx src/components/spotify/spotify-page.test.tsx
git commit -m "The music's icons from the prototype; the device with Spotify's green dot and a tick, no emoji" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 3: The player

**Files:**
- Modify (rewrite): `src/components/spotify/now-playing.tsx`
- Modify: `src/components/spotify/sidebar-player.tsx` (two class lists)
- Modify: `src/components/spotify/spotify-page.test.tsx`

The page's player follows the prototype's lines 666–687: the cover a 240px square, the title in the serif with the accent equaliser beside it while it plays, a 4px progress line in the accent (now a `progressbar` for screen readers), shuffle (40px) · previous (44px) · play (60px, the accent) · next · repeat (40px), shuffle and repeat with the soft accent behind them when on and a small "1" for repeat-one. `compact` (the focus panel) follows lines 1162–1176: a 64px cover beside the title, a 3px white line, a 52px white play button.

- [ ] **Step 1: Write the failing tests**

In `src/components/spotify/spotify-page.test.tsx`, in `"plays, pauses, skips, shuffles and repeats"`, after `expect(shuffle.getAttribute("aria-pressed")).toBe("true")` add

```ts
        expect(shuffle.className).toContain("bg-secondary")
```

and replace

```ts
        expect(player.getByRole("button", { name: "Repeating this track" }).textContent).toBe("↻¹")
```

with

```ts
        expect(player.getByRole("button", { name: "Repeating this track" }).textContent).toBe("1")
        expect(player.getByRole("button", { name: "Repeating this track" }).getAttribute("data-mode")).toBe("track")
```

Add inside `describe("the Spotify page", …)`:

```ts
    it("draws the player as the prototype: a square cover, the title in the serif, the progress as a progressbar, play in the accent", () => {
        show()
        const player = card("Player")
        const now = within(player.getByRole("region", { name: "Now playing" }))
        const bar = now.getByRole("progressbar", { name: "Track progress" })
        expect(bar.getAttribute("aria-valuenow")).toBe("191")
        expect(bar.getAttribute("aria-valuemax")).toBe("489")
        expect(bar.getAttribute("aria-valuetext")).toBe("3:11 of 8:09")
        expect(bar.querySelector("i")!.style.width).toBe((191000 / 489000) * 100 + "%")
        expect(now.getByRole("link", { name: "Weightless" }).className).toContain("font-serif")
        expect(now.getByRole("img", { name: "Playing" })).toBeTruthy()
        expect(now.getByRole("button", { name: "Pause" }).className).toContain("bg-primary")
        expect(now.getByRole("button", { name: "Shuffle" }).querySelector("svg")).toBeTruthy()
        expect(now.getByRole("button", { name: "Repeat is off" }).querySelector("svg")).toBeTruthy()
        /* paused, the equaliser goes */
        setPlayer({ playing: false })
        expect(now.queryByRole("img", { name: "Playing" })).toBeNull()
    })
```

In `describe("the sidebar player", …)`, in `"shows the track, its progress, the controls and the device"`, after the line that checks the width add:

```ts
        expect(badge().querySelector<HTMLElement>("i[style]")!.className).toContain("bg-primary")
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/spotify/spotify-page.test.tsx`
Expected: FAIL: no progressbar, the title is not in the serif, no equaliser by the title, Pause is `bg-foreground`, shuffle and repeat are glyphs (`⤮`, `↻¹`), the sidebar's line is a gradient.

- [ ] **Step 3: Rewrite `now-playing.tsx`**

```tsx
// What plays and how: the cover, the title and artist (the equaliser beside them while it
// plays), the progress (not seekable), shuffle, previous, play or pause, next, repeat, the
// device and the volume. The Music page shows it large, as the prototype's player (lines
// 666–699); the focus panel `compact`, the cover beside the title, white on the glass
// (lines 1161–1179).

import { cn } from "@/lib/utils"
import {
    activate, control, cycleRepeat, playHere, previous, toggleShuffle, useSpotify,
} from "@/data/spotify"
import { Art, controlError, Eq, Icon, mmss, REPEAT_LABEL, SpotifyMark } from "./bits"
import { Devices, Volume } from "./devices"
import { useCooling } from "./use-music"

/** Whole seconds, for the progressbar's values. */
const secs = (ms: number | undefined) => Math.round((ms || 0) / 1000)

export function NowPlaying({ compact = false }: { compact?: boolean }) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const p = s.player, t = p.track
    const live = !!p.device
    const canPlay = !!t || s.target === "here"
    const pct = t && t.durationMs ? Math.min(100, (t.progressMs / t.durationMs) * 100) : 0
    const error = controlError(p.error)
    const moving = !!t && p.playing && !p.stale

    const titleCls = compact
        ? "block truncate text-[15px] font-semibold text-foreground"
        : "block truncate font-serif text-[22px] leading-[1.2] font-medium text-foreground"
    const title = t
        ? t.url
            ? <a href={t.url} target="_blank" rel="noopener" title="Open in Spotify" className={cn(titleCls, "no-underline hover:text-primary hover:underline")}>{t.title}</a>
            : <b className={titleCls}>{t.title}</b>
        : <b className={titleCls}>Nothing playing</b>
    const sub = t ? t.artists + (t.album ? " · " + t.album : "") : "Pick something to play from your library, or search."

    const coverCls = compact
        ? "size-16 rounded-[6px]"
        : "aspect-square w-[240px] max-w-full self-center rounded-[8px] shadow-[0_10px_30px_rgba(28,28,26,.14)]"
    const cover = t?.art
        ? <Art src={t.art} className={coverCls} />
        : (
            <span aria-hidden="true" className={cn("grid flex-none place-items-center bg-muted", coverCls)}>
                <SpotifyMark className={compact ? "size-6" : "size-12"} />
            </span>
        )

    const progress = (
        <div className={cn("flex flex-col", compact ? "gap-1" : "gap-[5px]", !t && "invisible")}>
            <span
                role="progressbar"
                aria-label="Track progress"
                aria-valuemin={0}
                aria-valuemax={secs(t?.durationMs)}
                aria-valuenow={secs(t?.progressMs)}
                aria-valuetext={mmss(t?.progressMs ?? 0) + " of " + mmss(t?.durationMs ?? 0)}
                className={cn("block overflow-hidden rounded-full", compact ? "h-[3px] bg-white/15" : "h-1 bg-line-2")}
            >
                <i className={cn("block h-full rounded-full", compact ? "bg-foreground" : "bg-primary")} style={{ width: pct + "%" }} />
            </span>
            <span className={cn("flex justify-between font-mono text-muted-foreground", compact ? "text-[11px]" : "text-[11.5px]")}>
                <span>{mmss(t?.progressMs ?? 0)}</span>
                <span>{mmss(t?.durationMs ?? 0)}</span>
            </span>
        </div>
    )

    /* shuffle and repeat: a soft circle behind them when on (the accent's on the page, white on the glass) */
    const mode = (on: boolean) => cn(
        "relative grid flex-none cursor-pointer place-items-center rounded-full border-0 p-0 disabled:cursor-default disabled:opacity-40",
        compact ? "size-[38px]" : "size-10",
        on
            ? compact ? "bg-white/20 text-foreground" : "bg-secondary text-primary"
            : compact ? "bg-transparent text-foreground hover:bg-white/10" : "bg-transparent text-ink-2 hover:text-primary",
    )
    const skip = "grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-foreground hover:text-primary disabled:cursor-default disabled:opacity-40"
    const icon = compact ? "size-4" : "size-[17px]"
    const skipIcon = compact ? "size-[18px]" : "size-5"

    return (
        <section aria-label="Now playing" className={cn("flex min-w-0 flex-col", compact ? "gap-3" : "gap-3.5", p.stale && "opacity-60")}>
            {compact
                ? (
                    <div className="flex min-w-0 items-center gap-3.5">
                        {cover}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {title}
                            <span className="block truncate text-[12.5px] text-ink-2">{sub}</span>
                        </div>
                        {moving && <Eq className="flex-none" />}
                    </div>
                )
                : <>
                    {cover}
                    <div className="flex min-w-0 items-start gap-2.5">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {title}
                            <span className="block truncate text-[13px] text-ink-2">{sub}</span>
                        </div>
                        {moving && <Eq className="mt-2 flex-none" />}
                    </div>
                </>}

            {progress}

            <div className="flex items-center justify-between">
                <button type="button" onClick={() => void toggleShuffle()} disabled={!live} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle" className={mode(p.shuffle)}>
                    <Icon name="shuffle" className={icon} />
                </button>
                <button type="button" aria-label="Previous" disabled={!t} className={skip} onClick={() => { activate(); void previous() }}>
                    <Icon name="prev" className={skipIcon} />
                </button>
                <button
                    type="button"
                    disabled={!canPlay}
                    aria-label={p.playing ? "Pause" : t ? "Play" : "Play in Term"}
                    onClick={() => { activate(); void control(p.playing ? "pause" : "play") }}
                    className={cn(
                        "grid flex-none cursor-pointer place-items-center rounded-full border-0 p-0 disabled:cursor-default disabled:opacity-40",
                        compact
                            ? "size-[52px] bg-foreground text-background hover:brightness-90"
                            : "size-[60px] bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(28,28,26,.18)] hover:brightness-110",
                    )}
                >
                    <Icon name={p.playing ? "pause" : "play"} className={compact ? "size-5" : "size-[22px]"} />
                </button>
                <button type="button" aria-label="Next" disabled={!t} className={skip} onClick={() => { activate(); void control("next") }}>
                    <Icon name="next" className={skipIcon} />
                </button>
                <button type="button" onClick={() => void cycleRepeat()} disabled={!live} data-mode={p.repeat} title={REPEAT_LABEL[p.repeat]} aria-label={REPEAT_LABEL[p.repeat]}
                    className={mode(p.repeat !== "off")}>
                    <Icon name="repeat" className={icon} />
                    {p.repeat === "track" && <span aria-hidden="true" className="absolute top-[5px] right-1.5 text-[9px] leading-none font-bold">1</span>}
                </button>
            </div>

            <Devices s={s} cooling={cooling} beside={<Volume s={s} />} />

            {(s.target === "offer" || error) && (
                <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                    {s.target === "offer" && (
                        <span>
                            Playing on <b className="font-medium text-ink-2">{p.device}</b> ·{" "}
                            <button type="button" title="Move the music into this tab" onClick={() => void playHere()}
                                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-primary underline underline-offset-2">Play here</button>
                        </span>
                    )}
                    {error && <span role="status" className="rounded-[6px] border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-1.5 text-[var(--warn-ink)]">{error}</span>}
                </div>
            )}
        </section>
    )
}
```

- [ ] **Step 4: The sidebar player's colours**

In `src/components/spotify/sidebar-player.tsx`:
- in `bar`, change `bg-[var(--spotify)]` to `bg-primary`;
- change the progress line's `<i className="block h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--spotify))]" …>` to `<i className="block h-full rounded-full bg-primary" …>` (keep its `style`).

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/components/spotify src/components/focus`
Expected: PASS. (`music.test.tsx`'s panel tests find "Weightless", the controls and the devices by the same names; the reduced-motion test now also counts the equaliser by the title, still with `motion-reduce:animate-none`.)
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/spotify/now-playing.tsx src/components/spotify/sidebar-player.tsx src/components/spotify/spotify-page.test.tsx
git commit -m "The player as the prototype's: a square cover, the serif title, the accent play button, the progress as a progressbar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 4: The page: two cards, Up next and Recent

**Files:**
- Modify (rewrite): `src/components/spotify/spotify-page.tsx`
- Modify: `src/components/spotify/music-browser.tsx` (`Tabs` and `UpNextRecent` only)
- Modify: `src/components/spotify/spotify-page.test.tsx`

The prototype's grid (line 662) is a 400px player beside the browser. Between 761px and 1280px the player takes 36% (at least 280px) so the browser keeps room; from 1280px it is 400px. Under 760px it is today's one column: the page's pill on top, ▴ Music unfolds the player card. Up next / Recent (lines 700–716) is a small segmented switch with "2 queued" or "Last 8" beside it.

- [ ] **Step 1: Write the failing tests**

In `src/components/spotify/spotify-page.test.tsx`, in `"checks the connection, then offers to connect"`, after the `getAttribute("href")` line add:

```ts
        expect(screen.getByRole("link", { name: "Connect Spotify" }).className).not.toContain("gradient")
        expect(screen.getByRole("link", { name: "Connect Spotify" }).className).toContain("bg-primary")
```

In `"switches the left card between Up next and Recent"`, replace

```ts
        expect(player.getByText("2 next")).toBeTruthy()
```

with

```ts
        expect(player.getByText("2 queued")).toBeTruthy()
        expect(player.getByRole("group", { name: "Show" }).className).toContain("bg-[var(--chip-bg)]")
```

and after `expect(await player.findByText("Holocene")).toBeTruthy()` add

```ts
        expect(player.getByText("Last 1")).toBeTruthy()
        expect(player.queryByText("2 queued")).toBeNull()
```

Add inside `describe("the Spotify page", …)`:

```ts
    it("lays the page out as the prototype: the player 400px wide beside the browser when wide, one column on a phone", () => {
        show()
        const grid = screen.getByRole("region", { name: "Player" }).closest(".grid")!
        expect(grid.className).toContain("[grid-template-columns:minmax(280px,36%)_minmax(0,1fr)]")
        expect(grid.className).toContain("min-[1280px]:[grid-template-columns:400px_minmax(0,1fr)]")
        expect(grid.className).toContain("max-[760px]:flex-col")
        expect(grid.children[0].contains(screen.getByRole("region", { name: "Now playing" }))).toBe(true)
        expect(grid.children[1].contains(screen.getByRole("region", { name: "Find music" }))).toBe(true)
    })

    it("on a phone, keeps the player folded behind the pill until ▴ Music", () => {
        show()
        const playerCard = screen.getByRole("region", { name: "Player" }).parentElement!
        expect(playerCard.className).toContain("max-[760px]:hidden")
        fireEvent.click(within(screen.getByRole("region", { name: "Music" })).getByRole("button", { name: "▴ Music" }))
        expect(playerCard.className).not.toContain("max-[760px]:hidden")
        expect(within(screen.getByRole("region", { name: "Music" })).getByRole("button", { name: "▾ Music" }).getAttribute("aria-expanded")).toBe("true")
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/spotify/spotify-page.test.tsx`
Expected: FAIL: the Connect link has the gradient; "2 next" in place of "2 queued", no "Last 1"; the switch is `bg-muted`; the grid's columns are `minmax(260px,34%)`. (The phone test may already pass: it guards today's behaviour through the rewrite.)

- [ ] **Step 3: Rewrite `spotify-page.tsx`**

```tsx
// The Music page, in #views: two white cards, the player on the left (<NowPlaying>, then
// Up next or Recent) and <MusicBrowser> on the right, as the prototype's lines 660–797:
// the player 400px wide from 1280px, 36% (at least 280px) below that. Under 760px one
// column: the pill on top (▴ Music unfolds the player card), the browser under it. Space
// plays or pauses and / goes to the search box, when nothing is being typed. Not
// connected: Connect Spotify.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { MusicPill } from "@/components/focus/music-pill"
import { activate, control, cooldownMessage, useSpotify } from "@/data/spotify"
import { getSheet } from "@/data/overlay"
import { keysOpen } from "@/data/keys"
import { getBusy } from "@/data/ai-read"
import { getScreen } from "@/data/signin"
import { Notice, SpotifyMark } from "./bits"
import { NowPlaying } from "./now-playing"
import { MusicBrowser, UpNextRecent } from "./music-browser"
import { useCooling, useFollowTrack } from "./use-music"

/* Keys go to a control or a box when one has focus: Space presses a button, / is typed. */
const OWN_KEYS = /^(input|textarea|select|button|a)$/i

export function SpotifyPage() {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    useFollowTrack(s)
    const [playerOpen, setPlayerOpen] = useState(false)
    const root = useRef<HTMLDivElement>(null)
    const latest = useRef(s)
    useEffect(() => { latest.current = s })

    /* Before data/keyboard.ts (capture), which leave a key this took alone. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.key !== "/" && e.key !== " ") || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
            const el = e.target as HTMLElement | null
            if (el && (OWN_KEYS.test(el.tagName) || el.isContentEditable)) return
            if (getSheet() || keysOpen() || getBusy() || getScreen() !== "app") return
            if (e.key === "/") {
                const box = root.current?.querySelector<HTMLInputElement>("[data-music-search]")
                if (!box) return
                e.preventDefault()
                box.focus()
                box.select()
                return
            }
            const p = latest.current.player
            if (!p.connected || e.repeat) return
            e.preventDefault()
            activate()
            void control(p.playing ? "pause" : "play")
        }
        document.addEventListener("keydown", onKey, true)
        return () => document.removeEventListener("keydown", onKey, true)
    }, [])

    if (!s.player.loaded || !s.player.connected) {
        return (
            <div ref={root} className="min-w-0">
                <Card className="min-w-0">
                    <div className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                        {!s.player.loaded
                            ? <><b className="mb-1 block font-serif text-[20px] font-medium text-foreground">Spotify</b>Checking your connection…</>
                            : <>
                                <SpotifyMark className="mx-auto mb-3 size-8" />
                                <b className="mb-1 block font-serif text-[20px] font-medium text-foreground">Spotify is not connected</b>
                                Connect your account to search, browse your playlists, see the queue and set the volume from here.
                                <br />
                                <a href="/api/spotify/connect" className="mt-4 inline-flex h-10 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground no-underline hover:brightness-110">Connect Spotify</a>
                            </>}
                    </div>
                </Card>
            </div>
        )
    }

    return (
        <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} className="flex-none" />
            <div className="flex-none min-[761px]:hidden">
                <MusicPill tone="page" open={playerOpen} onOpen={() => setPlayerOpen((o) => !o)} />
            </div>
            <div className={cn(
                "grid min-h-0 flex-1 gap-4 [grid-template-rows:minmax(0,1fr)]",
                "[grid-template-columns:minmax(280px,36%)_minmax(0,1fr)] min-[1280px]:[grid-template-columns:400px_minmax(0,1fr)]",
                "max-[760px]:flex max-[760px]:flex-col max-[760px]:overflow-y-auto",
            )}>
                <MusicCard label="Player" className={cn(!playerOpen && "max-[760px]:hidden")}>
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                        <div className="flex-none border-b border-line-2 px-[22px] pt-5 pb-4 max-[560px]:px-4">
                            <NowPlaying />
                        </div>
                        <div className="px-[22px] pt-3 pb-3 max-[560px]:px-4">
                            <UpNextRecent />
                        </div>
                    </div>
                </MusicCard>
                <MusicCard label="Browse music">
                    <MusicBrowser />
                </MusicCard>
            </div>
        </div>
    )
}

/** A card whose inside fills the height left, and scrolls its own rows. */
function MusicCard({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
    return (
        <Card className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-[760px]:flex-none", className)}>
            <section aria-label={label} className="flex min-h-0 flex-1 flex-col">{children}</section>
        </Card>
    )
}
```

- [ ] **Step 4: The switch and Up next / Recent in `music-browser.tsx`**

Replace `Tabs` with one that draws the page's segmented switch (prototype line 702) or, `tone="pills"`, the focus panel's pills (line 1181; Task 7 uses them):

```tsx
/** A row of tabs as pressed buttons: a segmented switch on the page, pills on the focus screen. */
export function Tabs<T extends string>({ tabs, value, onPick, label, tone = "segment" }: {
    tabs: TabDef<T>[]; value: T | null; onPick: (id: T) => void; label: string; tone?: "segment" | "pills"
}) {
    const pills = tone === "pills"
    return (
        <div role="group" aria-label={label} className={cn("flex flex-none", pills ? "gap-1" : "gap-0.5 rounded-[6px] bg-[var(--chip-bg)] p-0.5")}>
            {tabs.map((t) => {
                const on = value === t.id
                return (
                    <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onPick(t.id)}
                        className={cn(
                            "cursor-pointer border-0 text-[12.5px] whitespace-nowrap",
                            pills ? "h-[30px] rounded-full px-3" : "h-[26px] rounded-[4px] px-2.5",
                            on
                                ? pills ? "bg-white/[.18] font-semibold text-foreground" : "bg-card font-semibold text-foreground shadow-[0_0_0_1px_var(--line)]"
                                : "bg-transparent text-ink-2 hover:text-foreground",
                        )}
                    >
                        {t.label}
                    </button>
                )
            })}
        </div>
    )
}
```

Replace `UpNextRecent` with:

```tsx
/** The Music page's left card, under <NowPlaying>: Up next or Recently played, with how many beside. */
export function UpNextRecent() {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const [side, setSide] = useState<Side>("queue")
    const note = side === "queue"
        ? s.cache.queue ? s.cache.queue.queue.length + " queued" : null
        : s.cache.recent?.items.length ? "Last " + s.cache.recent.items.length : null
    return (
        <section aria-label="Up next and recent" className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 pb-2">
                <Tabs label="Show" tabs={SIDE_TABS} value={side} onPick={setSide} />
                <span className="ml-auto flex items-center gap-2">
                    {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
                    {side === "queue" ? <QueueActions /> : <RecentActions s={s} />}
                </span>
            </div>
            <div className="-mx-3">
                {side === "queue" ? <QueueList s={s} cooling={cooling} /> : <RecentList s={s} cooling={cooling} />}
            </div>
        </section>
    )
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/components/spotify src/components/focus src/components/views`
Expected: PASS. (`music.test.tsx` still finds the panel's "Up next", "Recent" and "Library" by name with `aria-pressed`; `views.test.tsx` still finds "Checking your connection…".)
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/spotify/spotify-page.tsx src/components/spotify/music-browser.tsx src/components/spotify/spotify-page.test.tsx
git commit -m "The Music page's cards: the player 400px beside the browser, Up next and Recent as a small switch with how many" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 5: The browser: search, the theme's pick, the library

**Files:**
- Create: `src/components/spotify/for-theme.tsx`
- Modify: `src/components/spotify/music-browser.tsx` (`SearchBox`, `MusicBrowser`, `Heading`)
- Modify: `src/components/spotify/lists.tsx` (`Library`, `LibraryHead`)
- Modify: `src/components/spotify/rows.tsx` (the tiles only: `PlayOnCover`, `LikedTile`, `PlaylistTile`)
- Modify: `src/components/spotify/spotify-page.test.tsx`, `src/components/focus/music.test.tsx`

The prototype's lines 720–753: a round search box with a magnifier, a dark Search button and "Spotify" with its mark; then, on the page, the theme's pick (729–737) and "Library" with the count (739), the covers in a grid, Liked Songs in the accent with a heart (741–744). The focus panel keeps its three covers across and its fixed "Library" head.

- [ ] **Step 1: Write the failing tests**

In `src/components/spotify/spotify-page.test.tsx`, add `import { ui } from "@/data/ui"` after the `showApp` import, and change the `afterEach` to

```ts
afterEach(() => { cleanup(); vi.useRealTimers(); ui.bg = "med" })
```

Add inside `describe("the Spotify page", …)`:

```ts
    it("puts a search picked for the theme above the library, and runs it", async () => {
        api.spotifySearch.mockResolvedValue(results("", { playlists: [playlist("pl7", "Night Shift Study")] }))
        show()
        const music = card("Browse music")
        const pick = within(music.getByRole("region", { name: "For the night shift" }))
        expect(pick.getByText("Picked for the Medicine theme")).toBeTruthy()
        expect(pick.getByText("Night shift").className).toContain("font-serif")
        fireEvent.click(pick.getByRole("button", { name: /Night shift/ }))
        await waitFor(() => expect(api.spotifySearch).toHaveBeenCalledWith("night shift study", null, 0))
        expect(await music.findByText("Night Shift Study")).toBeTruthy()
        expect(music.getByText("for “night shift study”")).toBeTruthy()
        expect((music.getByRole("searchbox", { name: "Search Spotify" }) as HTMLInputElement).value).toBe("night shift study")
        fireEvent.click(music.getByRole("button", { name: "‹ Library" }))
        expect(await music.findByRole("region", { name: "For the night shift" })).toBeTruthy()
    })

    it("names the pick for the theme in use", () => {
        ui.bg = "cs"
        show()
        const pick = within(card("Browse music").getByRole("region", { name: "For deep work" }))
        expect(pick.getByText("Picked for the Computer Science theme")).toBeTruthy()
        expect(pick.getByText("Deep work")).toBeTruthy()
    })

    it("draws the search and the library as the prototype", async () => {
        show()
        const music = card("Browse music")
        const form = within(music.getByRole("search"))
        expect(form.getByRole("button", { name: "Search" }).className).toContain("bg-foreground")
        expect(form.getByText("Spotify")).toBeTruthy()
        expect(music.getByRole("heading", { name: "Library" })).toBeTruthy()
        const liked = await music.findByRole("button", { name: "Open Liked Songs" })
        expect(liked.querySelector("svg")).toBeTruthy()
        expect(liked.textContent).not.toContain("♥")
        expect(liked.querySelector("span[aria-hidden]")!.className).toContain("bg-primary")
        expect((await music.findByRole("button", { name: "Play Study mix" })).querySelector("svg")).toBeTruthy()
    })
```

In `src/components/focus/music.test.tsx`, in the panel's `"shows what plays, and the library three across"`, add at the end:

```ts
        /* the theme's pick is the page's */
        expect(panel().queryByRole("region", { name: /^For / })).toBeNull()
        expect(panel().getByRole("heading", { name: "Library" })).toBeTruthy()
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/spotify/spotify-page.test.tsx src/components/focus/music.test.tsx`
Expected: FAIL: no "For the night shift" region; the Search button is `bg-primary`; no "Spotify" beside it; Liked Songs is a ♥ on a gradient; ▶ on a cover is a glyph. (The panel's lines pass already: they guard it.)

- [ ] **Step 3: Create `for-theme.tsx`**

```tsx
// The library's first card on the Music page: music picked for the theme ("For the night
// shift · Picked for the Medicine theme"), the prototype's lines 729–737. Spotify gives
// apps no editorial playlists to feature and Term has none of its own, so the pick is a
// search: the card runs the theme's query (THEMES[bg].music) and the results open as any
// search does; ‹ Library comes back here.

import { search } from "@/data/spotify"
import { useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import { Icon } from "./bits"
import { openRoot } from "./use-music"

export function ForTheme() {
    const bg = useUi((u) => u.bg)
    const theme = THEMES[bg], m = theme.music
    return (
        <section aria-label={"For " + m.word} className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <h3 className="m-0 text-[14px] font-semibold text-foreground">For {m.word}</h3>
                <span className="truncate text-[12px] text-muted-foreground max-[560px]:hidden">Picked for the {theme.label} theme</span>
            </div>
            <button
                type="button"
                onClick={() => openRoot(() => search(m.query))}
                className="grid cursor-pointer grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-[18px] rounded-[10px] border-0 bg-secondary p-3.5 text-left font-[inherit] hover:brightness-[.98] max-[560px]:grid-cols-[64px_minmax(0,1fr)] max-[560px]:gap-3"
            >
                <span aria-hidden="true" className="grid aspect-square w-full place-items-center rounded-[6px] bg-primary text-primary-foreground">
                    <Icon name="search" className="size-1/3" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[12px] text-ink-2">Search on Spotify</span>
                    <span className="truncate font-serif text-[26px] leading-[1.15] font-medium text-foreground max-[560px]:text-[20px]">{m.name}</span>
                    <span className="truncate text-[13px] text-ink-2">Playlists and tracks for “{m.query}”</span>
                </span>
                <span aria-hidden="true" className="grid size-[52px] place-items-center rounded-full bg-primary text-primary-foreground max-[560px]:hidden">
                    <Icon name="arrow" className="size-[18px]" />
                </span>
            </button>
        </section>
    )
}
```

- [ ] **Step 4: The search form and the heads in `music-browser.tsx`**

Change the import from `"./bits"` to `import { chipButton, Icon, SpotifyMark } from "./bits"`.

Replace `SearchBox` with:

```tsx
/** The search box. What is typed searches after a pause; Enter at once. On the page (`page`)
    the / hint and "Spotify" beside it. */
function SearchBox({ q, page }: { q: string; page: boolean }) {
    const [value, setValue] = useState(q)
    const box = useRef<HTMLInputElement>(null)
    /* a search started elsewhere (the other place the browser shows, the theme's pick) fills the box, unless it is being typed in */
    useEffect(() => { if (document.activeElement !== box.current) setValue(q) }, [q])

    return (
        <form
            role="search"
            onSubmit={(e) => {
                e.preventDefault()
                typed("")                                   /* no delayed search after this one */
                openRoot(() => search(value))
            }}
            className="flex min-w-0 flex-1 basis-[240px] items-center gap-2"
        >
            <label className="group/search flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3.5 text-muted-foreground focus-within:border-primary">
                <Icon name="search" className="size-[15px]" />
                <input
                    ref={box}
                    type="search"
                    name="q"
                    data-music-search=""
                    placeholder="Songs, artists, albums, playlists"
                    aria-label="Search Spotify"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); typed(e.target.value) }}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                {page && <kbd title="Press / to search" className="flex-none rounded border border-border px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground group-focus-within/search:hidden">/</kbd>}
            </label>
            <button type="submit" className="h-10 flex-none cursor-pointer rounded-full border-0 bg-foreground px-[18px] text-[13px] font-medium text-background hover:bg-primary hover:text-primary-foreground">Search</button>
            {page && <span className="ml-1.5 flex flex-none items-center gap-1.5 text-[12px] text-ink-2 max-[560px]:hidden"><SpotifyMark className="size-4" />Spotify</span>}
        </form>
    )
}
```

In `MusicBrowser`:
- change `if (what === "library") head = <Heading title="Library"><LibraryHead s={s} /></Heading>` to

```tsx
    /* on the page the library heads its own list, under the theme's pick */
    if (what === "library") head = compact ? <Heading title="Library"><LibraryHead s={s} /></Heading> : null
```

- replace the returned JSX with:

```tsx
    return (
        <section aria-label="Find music" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className={cn("flex flex-none flex-col gap-2.5 border-b border-line-2", compact ? "px-5 pt-3 pb-2.5" : "px-[18px] py-3.5 max-[560px]:px-3.5")}>
                {compact && <Tabs label="Music" tabs={TABS} value={tab} onPick={pick} />}
                <SearchBox q={s.place.q} page={!compact} />
                {head}
            </div>
            <div
                ref={scroller}
                onScroll={(e) => { scrolls.current.set(key, e.currentTarget.scrollTop) }}
                className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
                {what === "open" && <OpenList s={s} cooling={cooling} />}
                {what === "search" && <Results s={s} cooling={cooling} />}
                {what === "queue" && <QueueList s={s} cooling={cooling} />}
                {what === "recent" && <RecentList s={s} cooling={cooling} />}
                {what === "library" && <Library s={s} cooling={cooling} compact={compact} />}
            </div>
        </section>
    )
```

In `Heading`, change the `h3`'s classes to `"m-0 text-[14px] font-semibold text-foreground"` and the note's to `"min-w-0 truncate text-[12px] text-muted-foreground"`.

- [ ] **Step 5: The library in `lists.tsx`**

Add `import { ForTheme } from "./for-theme"` after the `./rows` import. Replace `Library` and `LibraryHead` with:

```tsx
/** Liked Songs and the playlists as covers: three across `compact` (the focus panel, whose
    head says "Library"); on the page as many as fit, under the theme's pick and a heading. */
export function Library({ s, cooling, compact }: ListProps & { compact: boolean }) {
    useEffect(() => { if (!document.hidden) ensurePlaylists() }, [s, cooling])
    const pl = s.cache.playlists
    const tiles = (
        <div className={compact ? "grid grid-cols-3 gap-3 px-5 py-3" : "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3.5"}>
            <LikedTile total={s.cache.tracks.liked ? s.cache.tracks.liked.total : null} />
            {pl?.items.map((p) => <PlaylistTile key={p.id} p={p} openable={canOpen(p, s.cache.me)} />)}
        </div>
    )
    const after = !pl
        ? s.busy.has("playlists") ? <Loading what="Playlists" cooling={cooling} /> : null
        : !pl.items.length
            ? <Empty>No playlists yet.</Empty>
            : pl.next && <More onClick={() => more("playlists")} left={pl.total - pl.items.length} />
    if (compact) return <>{tiles}{after}</>
    return (
        <div className="flex flex-col gap-[22px] p-[18px] max-[560px]:p-3.5">
            <ForTheme />
            <section aria-label="Your library" className="flex flex-col gap-2.5">
                <div className="flex min-h-7 items-center gap-2">
                    <h3 className="m-0 text-[14px] font-semibold text-foreground">Library</h3>
                    <LibraryHead s={s} />
                </div>
                {tiles}
                {after}
            </section>
        </div>
    )
}

/** The library's heading: how many playlists, and ↻. */
export const LibraryHead = ({ s }: { s: SpotifySnapshot }) => (
    <>
        {s.cache.playlists && <em className="ml-auto text-[12px] text-muted-foreground not-italic">{s.cache.playlists.total} playlists</em>}
        <span className={cn(!s.cache.playlists && "ml-auto")}><Refresh onClick={() => refresh("playlists")} label="Refresh playlists" /></span>
    </>
)
```

- [ ] **Step 6: The tiles in `rows.tsx`**

Change the import from `"./bits"` to `import { Art, Eq, Icon, mmss } from "./bits"`. Replace everything from `/* ── the library's cover grid ── */` to the end of the file with:

```tsx
/* ── the library's cover grid (the prototype's lines 740–752) ── */

const tile = "group/tile relative flex min-w-0 flex-col text-left"
const tileButton = "flex min-w-0 cursor-pointer flex-col gap-2 rounded-[6px] border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
const cover = "aspect-square w-full rounded-[6px]"
const tileName = "truncate text-[13px] font-semibold text-foreground"
const tileLine = "truncate text-[12px] text-muted-foreground"

/* ▶ sits on the cover's corner: a square over the tile's top, the button in its corner */
function PlayOnCover({ name, onPlay }: { name: string; onPlay: () => void }) {
    return (
        <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-square items-end justify-end p-2">
            <button
                type="button"
                title={"Play " + name}
                aria-label={"Play " + name}
                onClick={onPlay}
                className="pointer-events-auto grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-primary p-0 text-primary-foreground opacity-0 shadow-[0_6px_14px_-4px_rgba(0,0,0,.5)] group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >
                <Icon name="play" className="size-3.5" />
            </button>
        </span>
    )
}

/** Liked Songs: a heart on the accent, opening the saved tracks; `total` once they are loaded. */
export const LikedTile = memo(function LikedTile({ total }: { total: number | null }) {
    return (
        <div className={tile}>
            <button type="button" aria-label="Open Liked Songs" className={tileButton} onClick={() => openFrom(() => openPlaylist("liked", "Liked Songs"))}>
                <span aria-hidden="true" className={cn(cover, "grid place-items-center bg-primary text-primary-foreground")}>
                    <Icon name="heart" className="size-10" />
                </span>
                <span className="flex min-w-0 flex-col">
                    <b className={tileName}>Liked Songs</b>
                    <span className={tileLine}>{total == null ? "Your saved tracks" : total + " songs"}</span>
                </span>
            </button>
            {/* Liked Songs has no context: it plays the tracks loaded, so only once they are */}
            {!!total && <PlayOnCover name="Liked Songs" onPlay={() => playNow(null, null, "liked")} />}
        </div>
    )
})

/** A playlist: opens it when Spotify lets Term, else plays it. */
export const PlaylistTile = memo(function PlaylistTile({ p, openable }: { p: Playlist; openable: boolean }) {
    const sub = [p.owner, p.count == null ? "" : String(p.count)].filter(Boolean).join(" · ")
    return (
        <div className={tile}>
            <button
                type="button"
                aria-label={(openable ? "Open " : "Play ") + p.name}
                title={openable ? undefined : "Spotify only lets Term open playlists you made or collaborate on; this one plays."}
                className={tileButton}
                onClick={() => openable ? openFrom(() => openPlaylist(p.id, p.name)) : playNow(null, p.uri)}
            >
                <Art src={p.art} className={cover} />
                <span className="flex min-w-0 flex-col">
                    <b className={tileName}>{p.name}</b>
                    <span className={tileLine}>{sub || " "}</span>
                </span>
            </button>
            {openable && <PlayOnCover name={p.name} onPlay={() => playNow(null, p.uri)} />}
        </div>
    )
})
```

(The covers no longer lift on hover; the reduced-motion test's loop over `group-hover/tile:-translate-y` then finds nothing, which is right.)

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/components/spotify src/components/focus`
Expected: PASS. (Earlier tests still find "2 playlists", "Open Study mix", "Play Deep Focus", the search box by name, and `.grid-cols-3` in the panel.)
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/spotify/for-theme.tsx src/components/spotify/music-browser.tsx src/components/spotify/lists.tsx src/components/spotify/rows.tsx src/components/spotify/spotify-page.test.tsx src/components/focus/music.test.tsx
git commit -m "The music browser: the prototype's search, a Spotify search picked for the theme above the library, Liked Songs with a heart" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 6: An opened list and the track rows

**Files:**
- Modify: `src/components/spotify/lists.tsx` (`Tracks`, the queue's wording stays; `OpenHead`, `PlayAll`, `Filter`, `TrackPane`, `OpenList`)
- Modify: `src/components/spotify/rows.tsx` (`TrackRow`, `AlbumRow`, `ArtistRow`, `PlaylistRow`)
- Modify: `src/components/spotify/music-browser.tsx` (one line: `OpenList` gets `compact`)
- Modify: `src/components/spotify/spotify-page.test.tsx`, `src/components/focus/music.test.tsx`

An opened list follows the prototype's lines 758–790: the cover (132px), the kind ("Playlist", "Your saved tracks", "Album", "Artist"), the name in the serif (30px), the line, Play all in the accent with a round Shuffle; the filter with its icon; on the page a "# Title Artist Time" header and numbered rows in those columns, the playing row tinted with the equaliser in place of its number, ▶ and + at the end of every row. The columns narrow through a container query on the browser's scroller (`@container` from Task 5): under 560px of list the artist column goes. In the focus panel (`compact`) the head is small (64px cover, 20px name) and the rows stay unnumbered. All other rows (Up next, Recent, search results, albums, artists, playlists) lose their rules and become rounded, tinted when playing, with their buttons always shown.

- [ ] **Step 1: Write the failing tests**

In `src/components/spotify/spotify-page.test.tsx`, in `"opens a playlist, filters it, plays it and goes back"`, replace

```ts
        fireEvent.click(music.getByRole("button", { name: "▶ Play all" }))
```

with

```ts
        fireEvent.click(music.getByRole("button", { name: "Play all" }))
```

and change the comment `/* the track playing shows the equaliser in place of its length */` to `/* the track playing shows the equaliser in place of its number */`.

Add inside `describe("the Spotify page", …)`:

```ts
    it("opens a playlist as the prototype: its cover, kind and name in the serif, numbered rows with ▶ and +", async () => {
        api.spotifyPlaylists.mockResolvedValue(page([playlist("pl1", "Study mix", { art: "https://i.scdn.co/image/pl1" })]))
        api.spotifyPlaylistTracks.mockResolvedValue(page([track("s0", { title: "Song 0" }), WEIGHTLESS, track("s2", { title: "Song 2" })]))
        show()
        const music = card("Browse music")
        fireEvent.click(await music.findByRole("button", { name: "Open Study mix" }))
        await music.findByText("Song 0")
        expect(music.getByText("Playlist")).toBeTruthy()
        expect(music.getByRole("heading", { name: "Study mix" }).className).toContain("font-serif")
        expect(document.querySelector('img[src="https://i.scdn.co/image/pl1"]')).toBeTruthy()
        expect(music.getByRole("button", { name: "Play all" }).querySelector("svg")).toBeTruthy()
        expect(music.getByText("Title")).toBeTruthy()       /* the columns' header */

        const row = music.getByText("Song 2").closest("[class*='grid-template-columns']") as HTMLElement
        expect(within(row).getByText("3")).toBeTruthy()
        expect(within(row).getByRole("button", { name: "Play Song 2" }).querySelector("svg")).toBeTruthy()
        expect(within(row).getByRole("button", { name: "Queue Song 2" }).textContent).toBe("+")
        /* the track playing: tinted, the equaliser in place of its number */
        const now = music.getByText("Weightless", { selector: "b" }).closest("[data-now]") as HTMLElement
        expect(now.className).toContain("bg-secondary")
        expect(within(now).getByRole("img", { name: "Playing" })).toBeTruthy()
        expect(within(now).queryByText("2")).toBeNull()
    })

    it("opens Liked Songs with the heart for a cover and says what it is", async () => {
        api.spotifyPlaylistTracks.mockResolvedValue(page([track("l1"), track("l2")]))
        show()
        const music = card("Browse music")
        fireEvent.click(await music.findByRole("button", { name: "Open Liked Songs" }))
        await music.findByText("l1")
        expect(music.getByText("Your saved tracks")).toBeTruthy()
        expect(music.getByRole("heading", { name: "Liked Songs" })).toBeTruthy()
    })
```

In `src/components/focus/music.test.tsx`, in `"opens a playlist and goes back, queues a track, and searches"`, after `expect(await panel().findByText("Song one")).toBeTruthy()` add:

```ts
        /* the panel's opened list: the kind, no columns' header, unnumbered rows */
        expect(panel().getByText("Playlist")).toBeTruthy()
        expect(panel().queryByText("Title")).toBeNull()
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/spotify/spotify-page.test.tsx src/components/focus/music.test.tsx`
Expected: FAIL: the button says "▶ Play all"; no kind line, no cover, the name not in the serif, no header or numbers; the playing row is tinted with `--spotify`.

- [ ] **Step 3: The rows in `rows.tsx`**

Replace the file's first three comment lines with:

```ts
// The rows of the music's lists: a track, an album, an artist, a playlist, and the cover
// tiles of the library. Each is memoised on what it shows: the progress line moves every
// second while music plays, and a long playlist must not redraw with it. A track in an
// opened list on the Music page has its number (`n`) and the list's columns (the
// prototype's lines 779–790); under 560px of list (a container query) the artist goes.
```

Replace the constants `row` … `act` with:

```ts
const row = "group/row mx-2 flex h-12 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px]"
const rowHover = "hover:bg-[var(--line-2)]"
const what = "min-w-0 flex-1 leading-[1.3]"
const line1 = "block truncate font-normal text-foreground"
const line2 = "block truncate text-[12px] text-muted-foreground"
const acts = "flex flex-none justify-end gap-0.5"
const act = "grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[15px] leading-none text-foreground hover:bg-[var(--line-2)] hover:text-primary pointer-coarse:size-10"
/* an opened list's columns: #, title, artist, time, the buttons; the header in lists.tsx uses the same */
export const COLUMNS = "[grid-template-columns:28px_minmax(0,1fr)_minmax(0,.7fr)_52px_72px] @max-[560px]:[grid-template-columns:28px_minmax(0,1fr)_44px_72px]"
```

Add `n?: number` to `TrackRowProps` (comment: `/* its number in an opened list on the Music page: the columns' layout */`) and replace `TrackRow` with:

```tsx
export const TrackRow = memo(function TrackRow({ t, now, playing, queued, contextUri = null, list = null, hidden = false, n }: TrackRowProps) {
    const sub = t.artists + (t.album ? " · " + t.album : "")
    const buttons = (
        <span className={acts}>
            <button type="button" title="Play" aria-label={"Play " + t.title} className={act} onClick={() => playNow(t.uri, contextUri, list)}>
                <Icon name="play" className="size-3" />
            </button>
            <button
                type="button"
                title="Add to queue"
                aria-label={"Queue " + t.title}
                disabled={queued}
                onClick={() => { if (t.uri) void queueAdd(t.uri) }}
                className={cn(act, queued && "cursor-default text-[var(--good)] hover:bg-transparent hover:text-[var(--good)]")}
            >
                {queued ? "✓" : "+"}
            </button>
        </span>
    )
    if (n != null) {
        return (
            <div hidden={hidden} data-now={now || undefined} className={cn(
                "group/row mx-2 grid h-12 items-center gap-3 rounded-[6px] px-2.5", COLUMNS,
                now ? "bg-secondary" : rowHover,
                hidden && "hidden",
            )}>
                <span className={cn("font-mono text-[12px]", now ? "text-primary" : "text-muted-foreground")}>{now && playing ? <Eq /> : n}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                    <Art src={t.art} className="size-8 rounded-[4px]" />
                    <b className={cn("truncate text-[13.5px]", now ? "font-semibold text-primary" : "font-normal text-foreground")}>{t.title}</b>
                </span>
                <span className="truncate text-[13px] text-ink-2 @max-[560px]:hidden">{sub}</span>
                <span className="text-right font-mono text-[12px] text-muted-foreground">{mmss(t.durationMs)}</span>
                {buttons}
            </div>
        )
    }
    return (
        <div hidden={hidden} data-now={now || undefined} className={cn(row, now ? "bg-secondary" : rowHover, hidden && "hidden")}>
            <Art src={t.art} className="size-9 rounded-[4px]" />
            <div className={what}>
                <b className={cn(line1, now && "font-semibold text-primary")}>{t.title}</b>
                <span className={line2}>{sub}</span>
            </div>
            <span className="w-10 flex-none text-right font-mono text-[11.5px] text-muted-foreground">
                {now && playing ? <Eq /> : mmss(t.durationMs)}
            </span>
            {buttons}
        </div>
    )
})
```

In `AlbumRow`, `ArtistRow` and `PlaylistRow`: change `className={row}` to `className={cn(row, rowHover)}`, the `Art`'s `className="size-[34px]"` to `className="size-9 rounded-[4px]"` (for `ArtistRow`, `round className="size-9"`), and each `>▶</button>` to `><Icon name="play" className="size-3" /></button>` (their `aria-label`s and titles stay).

- [ ] **Step 4: The opened list in `lists.tsx`**

Change the imports from `"./bits"` and `"./rows"` to:

```ts
import { Art, chipButton, Count, Empty, Icon, Loading, More, Refresh, Sub } from "./bits"
import { AlbumRow, ArtistRow, COLUMNS, LikedTile, PlaylistRow, PlaylistTile, TrackRow } from "./rows"
```

(`ghost` is no longer used here.) Change `Tracks` to pass numbers when asked:

```tsx
/** Rows of tracks; `filter` hides those it does not match (they stay loaded); `numbered` on the page's opened lists. */
function Tracks({ s, items, contextUri = null, list = null, filter = "", numbered = false }: {
    s: SpotifySnapshot; items: Track[]; contextUri?: string | null; list?: string | null; filter?: string; numbered?: boolean
}) {
    const nowUri = s.player.track?.uri ?? null, playing = s.player.playing
    return <>{items.map((t, i) => (
        <TrackRow
            key={(t.uri || "") + ":" + i}
            t={t}
            now={!!nowUri && t.uri === nowUri}
            playing={playing}
            queued={!!t.uri && s.queued(t.uri)}
            contextUri={contextUri}
            list={list}
            hidden={!matchesFilter(t, filter)}
            n={numbered ? i + 1 : undefined}
        />
    ))}</>
}
```

Replace everything from `/** The header over an opened list: ‹ Back, its name and line, then its buttons. */` down to (not including) `/* An opened list kept when the page is drawn again later:` with:

```tsx
/** A playlist's cover from what the session has seen of it: the library or a search. */
const playlistArt = (c: SpotifySnapshot["cache"], id: string) =>
    c.playlists?.items.find((p) => p.id === id)?.art ?? c.results?.playlists.find((p) => p.id === id)?.art ?? null

const coverBox = "size-full rounded-[6px] shadow-[0_8px_24px_rgba(28,28,26,.14)]"
const LikedCover = () => (
    <span aria-hidden="true" className={cn(coverBox, "grid place-items-center bg-primary text-primary-foreground")}>
        <Icon name="heart" className="size-1/3" />
    </span>
)

/** The header over an opened list: its cover, ‹ Back, its kind, name and line, then its buttons. */
function OpenHead({ compact, kind, name, line, cover, children }: {
    compact: boolean; kind: string; name: string; line?: ReactNode; cover: ReactNode; children?: ReactNode
}) {
    return (
        <div className={cn("flex flex-wrap items-end", compact ? "gap-3 px-5 pt-3 pb-2" : "gap-[18px] px-[18px] pt-[18px] pb-3 max-[560px]:gap-3 max-[560px]:px-3.5")}>
            <span className={cn("flex-none", compact ? "size-16" : "size-[132px] max-[560px]:size-24")}>{cover}</span>
            <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-1.5">
                <button type="button" onClick={goBack} className={cn(chipButton, "self-start")}>‹ Back</button>
                <span className="text-[12px] text-muted-foreground">{kind}</span>
                <h3 className={cn("m-0 truncate font-serif leading-[1.1] font-medium text-foreground", compact ? "text-[20px]" : "text-[30px] max-[560px]:text-[22px]")}>{name}</h3>
                {line && <span className="truncate text-[13px] text-ink-2">{line}</span>}
            </div>
            <span className="flex flex-none items-center gap-2">{children}</span>
        </div>
    )
}

/** Play the whole list, with shuffle beside it (the prototype's lines 768–771). */
function PlayAll({ s, label, run }: { s: SpotifySnapshot; label: string; run: () => void }) {
    const p = s.player
    return (
        <>
            <button type="button" onClick={() => { activate(); run() }}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:brightness-110">
                <Icon name="play" className="size-3" />{label}
            </button>
            <button type="button" onClick={() => void toggleShuffle()} disabled={!p.device} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle"
                className={cn(
                    "grid size-10 cursor-pointer place-items-center rounded-full border border-border p-0 hover:border-primary disabled:cursor-default disabled:opacity-45",
                    p.shuffle ? "bg-secondary text-primary" : "bg-transparent text-ink-2 hover:text-primary",
                )}>
                <Icon name="shuffle" className="size-4" />
            </button>
        </>
    )
}

/** The filter inside a list of eight tracks or more, and how many it shows. */
function Filter({ s, items }: { s: SpotifySnapshot; items: Track[] }) {
    const f = s.place.filter || ""
    if (items.length < 8) return null
    const shown = f.trim() ? items.filter((t) => matchesFilter(t, f)).length : 0
    return (
        <label className="mx-4 mb-2 flex h-9 items-center gap-2 rounded-[6px] border border-border px-3 text-[12px] text-muted-foreground focus-within:border-primary">
            <Icon name="filter" className="size-[13px]" />
            <input
                type="search"
                placeholder="Filter this list"
                aria-label="Filter tracks"
                autoComplete="off"
                value={f}
                onChange={(e) => setFilter(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="flex-none font-mono text-[11px]">{f.trim() ? shown + " of " + items.length + " loaded" : ""}</span>
        </label>
    )
}

function TrackPane({ s, cooling, keyName, page, contextUri, list, emptyText, numbered }: ListProps & {
    keyName: string; page: Page<Track> | undefined; contextUri: string | null; list?: string | null; emptyText: string; numbered: boolean
}) {
    if (!page) return <Loading what={s.cache.names[keyName] || "Tracks"} cooling={cooling} />
    if (!page.items.length) return <Empty>{emptyText}</Empty>
    return (
        <>
            <Filter s={s} items={page.items} />
            {numbered && (
                <div aria-hidden="true" className={cn("mx-2 grid h-[30px] items-center gap-3 border-b border-line-2 px-2.5 text-[11.5px] text-muted-foreground", COLUMNS)}>
                    <span>#</span><span>Title</span><span className="@max-[560px]:hidden">Artist</span><span className="text-right">Time</span><span />
                </div>
            )}
            <Tracks s={s} items={page.items} contextUri={contextUri} list={list} filter={s.place.filter} numbered={numbered} />
            {page.next && <More onClick={() => more("tracks")} left={page.total - page.items.length} />}
        </>
    )
}
```

Replace `OpenList` with:

```tsx
/** The playlist, album or artist open now, with its header; `compact` in the focus panel. */
export function OpenList({ s, cooling, compact = false }: ListProps & { compact?: boolean }) {
    useReopen(s, cooling)
    const place = s.place, c = s.cache

    if (place.pane === "playlist") {
        const id = place.playlistId || "", t = c.tracks[id], liked = id === "liked", ctx = liked ? null : "spotify:playlist:" + id
        return (
            <>
                <OpenHead compact={compact} kind={liked ? "Your saved tracks" : "Playlist"} name={c.names[id] || "Playlist"} line={t ? t.total + " tracks" : null}
                    cover={liked ? <LikedCover /> : <Art src={playlistArt(c, id)} className={coverBox} />}>
                    <Refresh onClick={() => refresh("list")} />
                    {t && t.items.length > 0 && <PlayAll s={s} label="Play all" run={() => void play(null, ctx, liked ? "liked" : null)} />}
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={id} page={t} contextUri={ctx} list={liked ? "liked" : null} emptyText="Nothing in here yet." numbered={!compact} />
            </>
        )
    }
    if (place.pane === "album") {
        const id = place.albumId || "", a = c.albums[id] || { name: "Album", uri: "spotify:album:" + id, artists: "", art: null }, t = c.tracks["album:" + id]
        return (
            <>
                <OpenHead compact={compact} kind="Album" name={a.name} line={a.artists || null} cover={<Art src={a.art} className={coverBox} />}>
                    <Refresh onClick={() => refresh("list")} />
                    <PlayAll s={s} label="Play album" run={() => void play(null, a.uri)} />
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={"album:" + id} page={t} contextUri={a.uri} emptyText="This album has no tracks Spotify will play." numbered={!compact} />
            </>
        )
    }
    const id = place.artistId || "", a = c.artists[id] || { name: "Artist", uri: "spotify:artist:" + id, art: null }, list = c.artistAlbums[id]
    return (
        <>
            <OpenHead compact={compact} kind="Artist" name={a.name} cover={<Art src={a.art} className={cn(coverBox, "rounded-full")} />}>
                <PlayAll s={s} label="Play" run={() => void play(null, a.uri)} />
            </OpenHead>
            {!list
                ? <Loading what={a.name} cooling={cooling} />
                : !list.items.length
                    ? <Empty>No albums here.</Empty>
                    : <>
                        <Sub>Albums and singles</Sub>
                        {list.items.map((x) => <AlbumRow key={x.id} a={x} />)}
                        {list.next && <More onClick={() => more("artist")} left={list.total - list.items.length} />}
                    </>}
        </>
    )
}
```

In `QueueList`, change the closing note's classes to `"m-0 mx-2 mt-2 border-t border-line-2 px-2.5 pt-2.5 pb-3.5 text-[12px] text-muted-foreground"` (its words stay).

- [ ] **Step 5: The panel's opened list in `music-browser.tsx`**

Change `{what === "open" && <OpenList s={s} cooling={cooling} />}` to `{what === "open" && <OpenList s={s} cooling={cooling} compact={compact} />}`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/components/spotify src/components/focus`
Expected: PASS. (The filter test still reads "1 of 9 loaded" and finds the hidden row; "Show more · 21 left", "‹ Back", "‹ Library", "Queue Night Owl" with "✓" then "+", "Marconi Union · Ágætis byrjun" and "Albums and singles" are unchanged.)
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/spotify/rows.tsx src/components/spotify/lists.tsx src/components/spotify/music-browser.tsx src/components/spotify/spotify-page.test.tsx src/components/focus/music.test.tsx
git commit -m "An opened list as the prototype's: the cover, the serif name, Play all and Shuffle, numbered rows in columns with play and queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 7: The focus panel and the pill

**Files:**
- Modify (rewrite): `src/components/focus/music-panel.tsx`
- Modify: `src/components/focus/music-pill.tsx`
- Modify: `src/components/focus/focus-screen.tsx` (the `MusicPanel`'s and `MusicPill`'s class lists only)
- Modify: `src/components/spotify/music-browser.tsx` (one line: the panel's pills)
- Modify: `src/components/focus/music.test.tsx`, `src/components/focus/focus-screen.test.tsx`

The panel follows the prototype's lines 1155–1205: a floating glass card with a 16px corner, 12px from the screen's edge; a 56px head with "Music" and ✕ as an icon; the now playing block (Task 3's `compact`) under a hairline; Up next · Recent · Library as pills (white 18% when on, line 1917). The pill follows line 1150: a soft white pill (10%), Spotify's green dot on the device. On a phone the panel stays the bottom sheet over the lower 70%, and the stage still re-centres beside or above it.

- [ ] **Step 1: Write the failing tests**

In `src/components/focus/music.test.tsx`:

In `"shows the track, its progress and the device, and its controls work"`, after `expect(pill().getByText("MacBook")).toBeTruthy()` add:

```ts
        expect((pill().getByText("MacBook").previousElementSibling as HTMLElement).className).toContain("bg-[var(--spotify)]")
        expect(screen.getByRole("region", { name: "Music" }).textContent).not.toMatch(/🔈/u)
        expect(screen.getByRole("region", { name: "Music" }).className).toContain("bg-white/10")
```

Add inside `describe("the panel", …)`:

```ts
    it("is drawn as the prototype: ✕ as an icon, the white play button, the tabs as pills", () => {
        render(<MusicPanel onClose={() => {}} />)
        const close = panel().getByRole("button", { name: "Close music" })
        expect(close.querySelector("svg")).toBeTruthy()
        expect(close.textContent).toBe("")
        expect(panel().getByRole("button", { name: "Pause" }).className).toContain("bg-foreground")
        expect(tab("Library").className).toContain("rounded-full")
        expect(panel().getByRole("group", { name: "Music" }).className).not.toContain("bg-[var(--chip-bg)]")
    })
```

In `"offers to connect when Spotify is not"`, add:

```ts
        expect(panel().getByRole("link", { name: "Connect Spotify" }).className).toContain("bg-foreground")
```

In `src/components/focus/focus-screen.test.tsx`, in `"▴ Music opens the side panel and ✕ shuts it; the pill makes way"`, after `expect(panel()).not.toBeNull()` add:

```ts
        /* it floats, 12px in from the edge, with the prototype's corner; a sheet on a phone */
        expect(panel()!.className).toContain("rounded-2xl")
        expect(panel()!.className).toContain("m-3")
        expect(panel()!.className).toContain("max-[700px]:m-0")
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/focus`
Expected: FAIL: the pill's device has 🔈 and its own glass; ✕ is a glyph; the panel's tabs are the segmented switch; the Connect link is `bg-primary`; the panel has no margin or corner.

- [ ] **Step 3: Rewrite `music-panel.tsx`**

```tsx
// The focus screen's music, opened: "Music" and ✕ over <NowPlaying compact> and a compact
// <MusicBrowser> (Up next, Recent and Library as pills, and search), on glass, as the
// prototype's panel (design/term-prototype.dc.html lines 1155–1205). The focus screen
// places it (a floating side panel, a bottom sheet on a phone) and owns Esc and M; ✕
// calls `onClose`.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { cooldownMessage, useSpotify } from "@/data/spotify"
import { FX, GLASS, Icon, Notice, SpotifyMark } from "@/components/spotify/bits"
import { NowPlaying } from "@/components/spotify/now-playing"
import { MusicBrowser } from "@/components/spotify/music-browser"
import { useCooling, useFollowTrack } from "@/components/spotify/use-music"

export interface MusicPanelProps {
    /** ✕: close the panel. */
    onClose: () => void
    className?: string
}

export function MusicPanel({ onClose, className }: MusicPanelProps) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    useFollowTrack(s)
    const p = s.player

    return (
        <aside aria-label="Music" className={cn(FX, GLASS, "flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
            <div className="flex h-14 flex-none items-center gap-2 border-b border-white/10 pr-2.5 pl-5">
                <h2 className="m-0 flex-1 text-[14px] font-semibold text-foreground">Music</h2>
                <button type="button" onClick={onClose} aria-label="Close music" title="Close (Esc)"
                    className="grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-foreground hover:bg-white/10">
                    <Icon name="close" className="size-[15px]" />
                </button>
            </div>
            {!p.loaded
                ? <Message title="Spotify">Checking your connection…</Message>
                : !p.connected
                    ? (
                        <Message title="Spotify is not connected">
                            Connect your account to search, browse your playlists, see the queue and set the volume from here.
                            <br />
                            <a href="/api/spotify/connect" className="mt-4 inline-flex h-9 items-center rounded-full bg-foreground px-4 text-[12.5px] font-semibold text-background no-underline hover:brightness-90">Connect Spotify</a>
                        </Message>
                    )
                    : <>
                        <div className="flex flex-none flex-col gap-3 border-b border-white/10 px-5 py-4">
                            <Notice text={cooling ? cooldownMessage(s.retryAt) : s.note?.text} ok={!cooling && !!s.note?.ok} />
                            <NowPlaying compact />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">
                            <MusicBrowser compact />
                        </div>
                    </>}
        </aside>
    )
}

function Message({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
            <SpotifyMark className="mx-auto mb-3 size-8" />
            <b className="mb-1 block text-[15px] font-semibold text-foreground">{title}</b>
            {children}
        </div>
    )
}
```

- [ ] **Step 4: The pills in `music-browser.tsx`**

Change `{compact && <Tabs label="Music" tabs={TABS} value={tab} onPick={pick} />}` to

```tsx
                {compact && <Tabs label="Music" tone="pills" tabs={TABS} value={tab} onPick={pick} />}
```

and give the head `div` the glass's rule in the panel: replace its opening tag with

```tsx
            <div className={cn(
                "flex flex-none flex-col gap-2.5 border-b",
                compact ? "border-white/10 px-5 pt-3 pb-2.5" : "border-line-2 px-[18px] py-3.5 max-[560px]:px-3.5",
            )}>
```

- [ ] **Step 5: The pill in `music-pill.tsx`**

- Change the `shell`'s tone line from

```ts
        tone === "glass" ? cn(FX, GLASS) : "border border-border bg-card text-foreground shadow-[var(--shadow-1)]",
```

to

```ts
        tone === "glass" ? cn(FX, "bg-white/10 backdrop-blur-[14px]") : "border border-border bg-card text-foreground shadow-[var(--shadow-1)]",
```

and remove `GLASS` from the import from `"@/components/spotify/bits"`.
- Change `chip`'s `bg-[var(--panel)]` to `bg-transparent` (the prototype's pill has no chips in boxes; the border stays as the hit area).
- In both device chips, replace `<span aria-hidden="true">🔈</span>` with `<span aria-hidden="true" className="size-2 flex-none rounded-full bg-[var(--spotify)]" />`.
- In the line under the title, change the progress `<i className="block h-full rounded-full bg-foreground" …>` to keep `bg-foreground` (white on the glass, ink on the page) — no change — and change its track `bg-line-2` to `bg-white/15` when `tone === "glass"`: `className={cn("mt-1 block h-[3px] overflow-hidden rounded-full", tone === "glass" ? "bg-white/15" : "bg-line-2")}`.

The words, the buttons' names and `aria-expanded` stay ("▴ Music", "▾ Music", "Pick something to play ▴", "Play in Term", "Connect Spotify", "Spotify is not connected", the note after " · ").

- [ ] **Step 6: Where the focus screen places them, in `focus-screen.tsx`**

Change the `MusicPill`'s `className` from `"max-w-[560px] bg-[color-mix(in_srgb,var(--fx-bg)_78%,transparent)]"` to `"max-w-[560px]"` (the pill's own soft white is the prototype's).

Replace the `MusicPanel`'s `className={cn(…)}` with:

```tsx
                    className={cn(
                        "relative z-[1] m-3 ml-0 w-[38%] max-w-[560px] min-w-[320px] flex-none rounded-2xl bg-[color-mix(in_srgb,var(--fx-bg)_70%,transparent)]",
                        "animate-[focus-panel-in_.28s_ease-out] motion-reduce:animate-none",
                        /* a phone: a sheet over the lower 70%, the clock line above it */
                        "max-[700px]:absolute max-[700px]:inset-x-0 max-[700px]:bottom-0 max-[700px]:m-0 max-[700px]:h-[70dvh] max-[700px]:w-auto max-[700px]:max-w-none max-[700px]:min-w-0",
                        "max-[700px]:rounded-t-[18px] max-[700px]:rounded-b-none max-[700px]:border-x-0 max-[700px]:border-t max-[700px]:border-b-0",
                        "max-[700px]:animate-[focus-sheet-in_.28s_ease-out] motion-reduce:max-[700px]:animate-none",
                    )}
```

(Nothing else in the focus screen changes: the stage still takes the rest of the width, and its clock shrinks and re-centres while `music` is open, as today.)

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run src/components/focus src/components/spotify`
Expected: PASS (M, /, Esc, ✕ and "stays open for the session" are unchanged).
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/focus/music-panel.tsx src/components/focus/music-pill.tsx src/components/focus/focus-screen.tsx src/components/spotify/music-browser.tsx src/components/focus/music.test.tsx src/components/focus/focus-screen.test.tsx
git commit -m "The focus screen's music as the prototype's: a floating glass panel with pills, a soft pill with Spotify's dot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 8: Look at it, side by side with the prototype

**Files:**
- Modify: whatever the look needs among `src/components/spotify/*.tsx` and `src/components/focus/music-*.tsx` (spacing and colours only; behaviour is covered by tests)

- [ ] **Step 1: Look**

Start the dev server (see "How to work", 2), sign in as `termqa`, open Music (5) and connect Spotify (the local Worker has the client keys in `.dev.vars`; if Spotify refuses the local redirect, stop and ask the owner to connect it, and meanwhile check the "Checking your connection…" and "Spotify is not connected" states). Play something on a device. Compare with the prototype's Music board and the focus board in the canvas (https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV). Check at 1440px, 1024px and 390px wide, in light and dark, and in Medicine and one other theme (CS: "For deep work", the CS accent):
- the top bar says Music, with "Playing on …" under it;
- the player: the 240px square cover centred (smaller when the column is narrower, never overflowing), the serif title and the equaliser, the 4px accent line and mono times, the five controls spread across with the 60px accent play, shuffle and repeat tinted when on and "1" on repeat-one, the device button's green dot and the volume; the device list with the tick, "This tab", the disabled speaker; in dark mode every part readable;
- Up next / Recent: the small switch, "N queued" / "Last N", the rows rounded with no rules, the playing one tinted;
- the browser: the round search with the magnifier, the dark Search, "Spotify" with the mark (hidden on a phone); "For the night shift" in the soft tint with the accent square and arrow, "Picked for the Medicine theme"; clicking it shows the results for "night shift study" and ‹ Library comes back; Library with the count and ↻; the covers at least four across at 1440px, Liked Songs in the accent with the heart, ▶ on a cover on hover;
- an opened playlist: the 132px cover, "Playlist", the 30px serif name, "N tracks", Play all and the round Shuffle, the filter, the "# Title Artist Time" header lined up with the rows, the numbers, the playing row tinted with the equaliser; at 1024px the artist column goes when the list is under 560px wide; the filter still hides rows and counts "N of M loaded";
- an album and an artist (from a search): their covers (the artist's round), "Album" / "Artist";
- phone (390px): the page's pill on top, ▴ Music unfolds the player, the browser below scrolls; no page-wide horizontal scroll; the theme's pick fits (64px square, no arrow);
- the focus screen: the soft pill with the green dot; ▴ Music (or M) opens the floating glass panel 12px from the edges with its 16px corner; the clock re-centres; "Music" and ✕; the 64px cover, the white controls and white play button; the pills; search; an opened playlist small and unnumbered; Esc shuts the panel, then leaves; on a phone the bottom sheet over 70%;
- the sidebar player: the progress line and bars in the accent;
- Space plays or pauses and / goes to the search box on the Music page.

Fix what's off in the same files. Then run `npm run check`; expected: typecheck, all tests and the build pass.

- [ ] **Step 2: Commit**

```bash
git add -A src/components/spotify src/components/focus
git commit -m "The Music page and the focus panel checked against the prototype at desktop, tablet and phone widths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

(If nothing needed fixing, skip the commit.)

---

### Task 9: The owner's review and the release

- [ ] **Step 1: Final review**

Request a code review of `git diff term...term-6-music` (superpowers:requesting-code-review). Check also that `git diff term...term-6-music -- src/data/spotify` is empty. Fix what holds up, commit on the branch.

- [ ] **Step 2: Show the owner**

Run the dev server and tell the owner what to look at (the "What the owner sees" paragraph above), and the choices to confirm:
- the theme's pick is a **Spotify search** ("night shift study" and the others in the table above), not a playlist: no ▶ and no cover on the card; the words and queries are in `THEMES[bg].music` and easy to change;
- the **sidebar player stays** (the prototype has none; removing it would lose the controls on other pages) — keep it, or remove it?
- "**Open Music page**" in the focus panel (the prototype has it; it would leave focus mode) — add it, or leave it out?
- the player column is 36% below 1280px wide and 400px from 1280px;
- "Up next / Recent" says "N queued" / "Last N" (was "N next").

Fix what they ask for, on the branch, with tests where behaviour changes.

- [ ] **Step 3: Merge and release — only on the owner's yes**

```bash
git switch term && git merge --no-ff term-6-music -m "Merge term-6-music: Stage 6, Music" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
git switch main && git merge --no-ff term -m "Merge term: Stage 6, Music" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
git push origin main term
```

No migration in this stage, so nothing to run on the remote database. The Cloudflare Git build deploys `main`. After it finishes, open the live site, open Music, play a playlist from it, open the theme's pick, and open the focus screen's panel during a run.
