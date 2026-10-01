# Term Stage 5: Study in four tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Study page keeps its three tiles (now with serif numbers) and puts everything else behind four tabs: Timer (the Ready card large in the theme's dark colour beside Your flow and a new Today card), History (full width, the week in two columns), Achievements (full width) and Leaderboard (a centred column), keeping every behaviour of today's page.

**Architecture:** No database change. The open tab is `ui.studyTab` (`"timer" | "history" | "achievements" | "leaderboard"`), not synced, remembered on this browser beside `view` and `schedule` in `rounds.ui`, set by `setStudyTab` in `src/data/study.ts`. Only the open tab is drawn. The tab list is a real ARIA tablist; its keys come from `src/components/sheet/radio-keys.ts`, which grows a `tabKeys` beside `radioKeys` (same roving pattern, left/right only). One new pure helper, `todayOf` in `study.ts`, feeds the new `src/components/study/today-card.tsx`. The third Quick start gets the theme's name (`THEMES[bg].preset`), and the flip clock gets a `ready` size with cards 96px high. A run's end lands on the Timer tab; an achievement toast's See lands on the Achievements tab. The focus screen and the dock are not touched.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4, Vitest (jsdom + Workers pool).

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §8, and "Not in this redesign". **Prototype:** `design/term-prototype.dc.html` (read, don't open): the Study page's markup lines 409–690 (tiles 413–426, the tab list 428–430, Timer 432–502, History 503–598, Achievements 599–637, Leaderboard 638–665) and its values in the script (`sv.*` from line 1885; `STUDY` line 1755: word, deep colour, third preset per theme).

**Branch:** `term-5-study` off `term` (`term` and `main` are both at ce25568):
`git switch term && git switch -c term-5-study`.

**What the owner sees at the end:** The Study page shows the three tiles with serif numbers and plain labels ("Streak", "Today", "This term"), then a row of tabs, Timer · History · Achievements · Leaderboard, underlined in the accent. **Timer** (the default): on the left a large card in the theme's dark colour: "On shift · round 1 of 4" (Compiling, In session, In flight, On the clock, Building in the other themes), a four-card clock 96px high showing the first step, "Classic 25/5 · 4 rounds   1h 40m study · 2h 00m total", the round strip, Course and Item side by side, and a white "Start focus" (or "Back to focus" during a run). On the right Your flow, whose third Quick start is named for the theme (LeetCode then read, Brief then outline…) and whose matching preset shows pressed; under it **Today**: "1h 05m of 1h 30m", today's sessions newest first (time, course colour, what, length), and "+ Log study by hand", which opens the session sheet. **History** fills the width; Week shows the total, a taller chart and the course bars on the left and the sessions on the right. **Achievements** fills the width, groups two across. **Leaderboard** sits in a centred column. Arrow keys move between tabs; the tab is remembered after a reload. Ending a run lands on the Timer tab with the new session in Today; an achievement toast's See opens the Achievements tab. Under 900px the Timer tab is one column; on a phone the tabs scroll sideways if they must.

**Not in this stage:** Pause and Stop & log on the Ready card during a run (the prototype has them; the focus screen and the dock keep those jobs, and the Study page shows the focus screen during a run); the idle card's "done at 15:40" (it would go stale on an open page); History's Week / Month / Term switch stays pressed buttons (the prototype draws them as tabs; their tests and behaviour stay); the prototype's restyled achievement medals and leaderboard rows (their look is unchanged; spec §8 asks only for the layout); the phone design pass (the page must keep working at phone width with today's phone frame); Music (Stage 6).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run src/components/study/study.test.tsx`; the folder: `npx vitest run src/components/study`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. Blank page titled "Rounds": unregister the old service worker (DevTools → Application). Local user: `termqa` / `termqa-local-1`.
3. **Line endings and encoding:** keep every file LF and UTF-8. Characters like `·`, `–`, `✕` must be UTF-8: after writing a file, `file <path>` should not say "ISO-8859"; if Vite then serves a stale copy, touch the file.
4. **Commits:** end each message with these two lines (the commit commands below pass them as a second `-m`):
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
   `Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry`
   Commit only on `term-5-study`. Never push or merge to `main` without the owner's yes (Task 10 asks). This stage touches no database.
5. **Tests find text.** When a task changes a word or a role, `rg -n "<old word>" src test` and update the tests in the same commit.
6. **The ui in tests.** Page tests (`study.test.tsx`) use a fake ui through `@/data/fake-ui` (its `rememberUi` does nothing); `timer.test.tsx`, `study-timer.test.ts` and `ui.test.ts` use the real `ui`. A field a component reads must be on the fake (`studyTab` after Task 2).
7. **Colours** go through `style` with `accent(color)` from `src/components/views/bits.tsx` (sets `--c`). In `cn()`, never put two arbitrary `text-[var(…)]` or `border-[var(…)]` classes that must override each other: tailwind-merge can't tell a colour from a size inside `var()`. Choose one with a ternary instead.
8. **Dates** are `YYYY-MM-DD` strings; `dayOf(session)` (`src/core/history.ts`) is its local day; `duration(65)` (`src/lib/time.ts`) is `"1h 05m"`, `duration(40)` is `"40m"`.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/data/types.ts` | modify | `StudyTab`; `Ui.studyTab` |
| `src/data/ui.ts` | modify | `studyTab` starts `"timer"`, read from and saved to `rounds.ui` |
| `src/data/ui.test.ts` | modify | the remembered tab |
| `src/data/study.ts` | modify | `setStudyTab`; `todayOf`, `useTodayStudy` |
| `src/data/study.test.ts` | modify | `setStudyTab`, `todayOf` |
| `src/components/sheet/radio-keys.ts` | modify | `tabKeys` beside `radioKeys` |
| `src/components/study/study-view.tsx` | modify (rewrite) | tiles, the tab list, the open tab's panel |
| `src/components/study/study.test.tsx` | modify | tabs, keys, remembered tab, layouts, Today; old tests open their tab first |
| `src/data/study-timer.ts` | modify | the run's end opens the Timer tab; `presetsFor`, `sameFlow`, `flowName` |
| `src/data/study-timer.test.ts` | modify | the end lands on Timer; presets and the flow's name |
| `src/data/study-controller.ts` | modify | `showAchievement` exported, opens the Achievements tab |
| `src/data/study-controller.test.ts` | create | See opens the Achievements tab |
| `src/components/study/tiles.tsx` | modify | serif numbers, plain labels |
| `src/data/themes.ts`, `src/data/themes.test.ts` | modify | `preset`: the third Quick start's name per theme |
| `src/components/study/flip-clock.tsx`, `flip-clock.test.tsx`, `src/index.css` | modify | the `ready` size (96px cards) in place of the unused `mid` |
| `src/components/study/timer-cards.tsx` | modify | the Timer tab's layout, the large Ready card, the themed presets |
| `src/components/study/timer.test.tsx` | modify | the Ready card's words, themed presets |
| `src/components/study/today-card.tsx` | create | the Today card |
| `src/components/focus/focus-screen.test.tsx` | modify | its actions fake gains `openSession` |
| `src/components/study/history.tsx` | modify | the week in two columns, a taller chart, narrower session rows |

---

### Task 1: The Study tab in the UI state

**Files:**
- Modify: `src/data/types.ts`, `src/data/ui.ts`, `src/data/study.ts`
- Test: `src/data/ui.test.ts`, `src/data/study.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/data/ui.test.ts`, change the last expectation of `"keeps a saved tab, and saves it in place of the old toggle"` to:

```ts
        expect(JSON.parse(localStorage.getItem("rounds.ui")!)).toEqual({ view: "week", schedule: "deadlines", studyTab: "timer" })
```

and add after `describe("the remembered schedule tab", …)`:

```ts
describe("the remembered Study tab", () => {
    it("starts on Timer, keeps a saved tab, and ignores one it does not know", async () => {
        expect((await load({})).ui.studyTab).toBe("timer")
        expect((await load({ studyTab: "leaderboard" })).ui.studyTab).toBe("leaderboard")
        expect((await load({ studyTab: "music" })).ui.studyTab).toBe("timer")
    })

    it("is saved with the view", async () => {
        const state = await load({ studyTab: "history" })
        state.ui.studyTab = "achievements"
        state.rememberUi()
        expect(JSON.parse(localStorage.getItem("rounds.ui")!)).toEqual({ view: "week", schedule: "all", studyTab: "achievements" })
    })
})
```

In `src/data/study.test.ts`: change the hoisted fake to

```ts
const fake = vi.hoisted(() => ({
    ui: { studyTab: "timer", hist: { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null as string | null, undo: null as unknown } },
}))
```

change the `afterEach` to

```ts
afterEach(() => {
    fake.ui.studyTab = "timer"
    Object.assign(fake.ui.hist, { weekOffset: 0, tab: "week", monthOffset: 0, focusDay: null, undo: null })
})
```

add `setStudyTab` to the import from `"./study"`, and append:

```ts
describe("the Study page's tabs", () => {
    it("open the tab asked for", () => {
        setStudyTab("history")
        expect(fake.ui.studyTab).toBe("history")
        setStudyTab("leaderboard")
        expect(fake.ui.studyTab).toBe("leaderboard")
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/ui.test.ts src/data/study.test.ts`
Expected: FAIL: `studyTab` is undefined, the saved object has no `studyTab`, `setStudyTab` is not a function.

- [ ] **Step 3: The type**

In `src/data/types.ts`, after the `HistTab` line add:

```ts
/** The Study page's four tabs. */
export type StudyTab = "timer" | "history" | "achievements" | "leaderboard"
```

and in `interface Ui`, replace

```ts
    /* the Study page: the History card and the leaderboard */
    hist: Hist
```

with

```ts
    /* the Study page: its tab (remembered on this browser), the History card and the leaderboard */
    studyTab: StudyTab
    hist: Hist
```

- [ ] **Step 4: The state, read and saved**

In `src/data/ui.ts`:

Replace the file's first two comment lines

```ts
// UI state: what is open, what is filtered, how the table is sorted. Never synced. The
// view and the week and month's schedule are remembered per browser as a convenience, and
```

with

```ts
// UI state: what is open, what is filtered, how the table is sorted. Never synced. The
// view, the week and month's schedule and the Study page's tab are remembered per browser
// as a convenience, and
```

(the next line, "the theme and background too, …", stays).

After the `study: { courseId: null, itemId: null },` line add:

```ts
    studyTab: "timer",       /* the Study page's tab: Timer, History, Achievements or Leaderboard */
```

Replace the `try { … } catch {}` block that reads the saved state with:

```ts
try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as { view?: string; schedule?: string; monthDeadlines?: boolean; studyTab?: string }
    if (["week", "month", "table", "spotify", "study"].includes(saved.view!)) ui.view = saved.view as Ui["view"]
    if (["all", "deadlines", "classes"].includes(saved.schedule!)) ui.schedule = saved.schedule as Ui["schedule"]
    else if (saved.monthDeadlines === false) ui.schedule = "classes"   /* the month's old Deadlines toggle */
    if (["timer", "history", "achievements", "leaderboard"].includes(saved.studyTab!)) ui.studyTab = saved.studyTab as Ui["studyTab"]
} catch {}
```

and in `rememberUi`, replace the first line with:

```ts
    try { localStorage.setItem(KEY, JSON.stringify({ view: ui.view, schedule: ui.schedule, studyTab: ui.studyTab })) } catch {}
```

- [ ] **Step 5: `setStudyTab`**

In `src/data/study.ts`, change `import { ui } from "./ui"` to `import { rememberUi, ui } from "./ui"`, add `StudyTab` to the `import type { … } from "./types"` list, and add before `setHistTab`:

```ts
/** Open a Study tab; the tab is remembered on this browser, like the page. */
export function setStudyTab(tab: StudyTab) {
    if (ui.studyTab === tab) return
    ui.studyTab = tab
    rememberUi()
    notify()
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/data/ui.test.ts src/data/study.test.ts`
Expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/data/types.ts src/data/ui.ts src/data/ui.test.ts src/data/study.ts src/data/study.test.ts
git commit -m "The Study page's tab in the UI state, remembered on this browser" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 2: The tab list

**Files:**
- Modify: `src/components/sheet/radio-keys.ts`
- Modify (rewrite): `src/components/study/study-view.tsx`
- Modify: `src/components/study/study.test.tsx`

- [ ] **Step 1: Write the failing tests and move the old ones behind their tabs**

In `src/components/study/study.test.tsx`:

In the hoisted `fake.ui`, change the line `view: "study", focus: false, bg: "med", search: "", types: {}, course: "all",` to

```ts
        view: "study", focus: false, bg: "med", search: "", types: {}, course: "all", studyTab: "timer",
```

In `afterEach`, change `Object.assign(fake.ui, { view: "study", focus: false, lb: null, lbTab: "week" })` to

```ts
    Object.assign(fake.ui, { view: "study", focus: false, lb: null, lbTab: "week", studyTab: "timer" })
```

Replace `show` with one that can open a tab (the page is loaded lazily, so the tab is clicked after the first wait):

```ts
/* the page, and a tab opened as a person would; the waits are the page's lazy load and the leaderboard's first load */
const show = async (tab?: string) => {
    const r = render(<ViewsHost><Views /></ViewsHost>)
    await act(async () => {})
    if (tab) {
        fireEvent.click(screen.getByRole("tab", { name: tab }))
        await act(async () => {})
    }
    return r
}
```

After `const history = () => region("History")` add:

```ts
const tab = (name: string) => screen.getByRole("tab", { name })
const tabs = () => within(screen.getByRole("tablist", { name: "Study" })).getAllByRole("tab")
```

Replace the whole `describe("the Study page", …)` block with:

```ts
describe("the Study page", () => {
    it("shows the tiles, then four tabs with Timer open: the Ready card and Your flow", async () => {
        await show()
        for (const name of ["Streak", "Today", "This term"]) expect(tile(name)).toBeTruthy()
        expect(tabs().map((t) => t.textContent)).toEqual(["Timer", "History", "Achievements", "Leaderboard"])
        expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"])
        expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
        const panel = screen.getByRole("tabpanel", { name: "Timer" })
        expect(tab("Timer").getAttribute("aria-controls")).toBe(panel.id)
        for (const name of ["Ready", "Your flow"]) expect(within(panel).getByRole("region", { name })).toBeTruthy()
        for (const name of ["History", "Achievements", "Leaderboard"]) expect(screen.queryByRole("region", { name })).toBeNull()
    })

    it("opens a tab on a click, and keeps it in the ui", async () => {
        await show()
        fireEvent.click(tab("History"))
        expect(fake.ui.studyTab).toBe("history")
        expect(tab("History").getAttribute("aria-selected")).toBe("true")
        expect(within(screen.getByRole("tabpanel", { name: "History" })).getByRole("region", { name: "History" })).toBeTruthy()
        expect(screen.queryByRole("region", { name: "Ready" })).toBeNull()
        fireEvent.click(tab("Achievements"))
        expect(region("Achievements")).toBeTruthy()
        fireEvent.click(tab("Leaderboard"))
        await act(async () => {})
        expect(region("Leaderboard")).toBeTruthy()
        expect(fake.api.leaderboard).toHaveBeenCalledTimes(1)   /* asked for once its tab opened */
    })

    it("opens on the tab last shown", async () => {
        fake.ui.studyTab = "achievements"
        await show()
        expect(tab("Achievements").getAttribute("aria-selected")).toBe("true")
        expect(region("Achievements")).toBeTruthy()
    })

    it("moves between tabs with the left and right arrows, Home and End", async () => {
        await show()
        act(() => tab("Timer").focus())
        fireEvent.keyDown(tab("Timer"), { key: "ArrowRight" })
        expect(document.activeElement).toBe(tab("History"))
        expect(fake.ui.studyTab).toBe("history")
        fireEvent.keyDown(document.activeElement!, { key: "End" })
        await act(async () => {})
        expect(document.activeElement).toBe(tab("Leaderboard"))
        expect(tab("Leaderboard").tabIndex).toBe(0)
        fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })   /* round to the first */
        expect(document.activeElement).toBe(tab("Timer"))
        fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" })
        await act(async () => {})
        expect(fake.ui.studyTab).toBe("leaderboard")
        fireEvent.keyDown(document.activeElement!, { key: "Home" })
        expect(fake.ui.studyTab).toBe("timer")
        fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" })   /* a row of tabs: down does nothing */
        expect(fake.ui.studyTab).toBe("timer")
    })

    it("lays Achievements full width with the groups two across, and centres the leaderboard", async () => {
        await show("Achievements")
        const groups = within(region("Achievements")).getByRole("group", { name: "Study hours" }).parentElement!
        expect(groups.className).toContain("grid-cols-2")
        fireEvent.click(tab("Leaderboard"))
        await act(async () => {})
        expect(region("Leaderboard").closest(".max-w-\\[760px\\]")!.className).toContain("mx-auto")
    })

    it("is not drawn on the focus screen", async () => {
        fake.ui.focus = true
        await show()
        expect(screen.queryByRole("region", { name: "Ready" })).toBeNull()
        expect(document.getElementById("views")!.hidden).toBe(true)
    })
})
```

Then open each old test's tab:
- in `describe("History", …)`, replace every `await show()` with `await show("History")` (6 places);
- in `describe("achievements", …)`, replace every `await show()` with `await show("Achievements")` (2 places);
- in `describe("the leaderboard", …)`, replace every `await show()` with `await show("Leaderboard")` (8 places).

`describe("the tiles", …)` stays on Timer: the tiles are above the tabs.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/study/study.test.tsx`
Expected: FAIL: no `tablist` named "Study", no tab named "History" (the History, achievements and leaderboard tests fail at the click); the tiles tests pass.

- [ ] **Step 3: `tabKeys`**

Replace `src/components/sheet/radio-keys.ts` with:

```ts
// The ARIA keyboard patterns for a row of options with one Tab stop: a radio group (the
// checked option, or the first when none is checked) and a tab list (the selected tab).
// The arrow keys, Home and End move to an option and select it.

import type { KeyboardEvent } from "react"

/** tabIndex for option `i`: the checked one, or the first when nothing is checked. */
export const rovingTab = (i: number, checked: number) => (i === (checked < 0 ? 0 : checked) ? 0 : -1)

/* onKeyDown for a group of `role` options: focus and click the one the key points to.
   With `upDown` the up and down arrows move too (a radio group); a row of tabs takes left and right only. */
function moveKeys(role: string, upDown: boolean) {
    return (e: KeyboardEvent<HTMLElement>) => {
        const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="' + role + '"]'))
        const at = opts.indexOf(document.activeElement as HTMLElement)
        if (at < 0 || !opts.length) return
        const n = opts.length
        const to = e.key === "ArrowRight" || (upDown && e.key === "ArrowDown") ? (at + 1) % n
            : e.key === "ArrowLeft" || (upDown && e.key === "ArrowUp") ? (at + n - 1) % n
            : e.key === "Home" ? 0
            : e.key === "End" ? n - 1
            : -1
        if (to < 0) return
        e.preventDefault()
        opts[to].focus()
        opts[to].click()
    }
}

/** onKeyDown for the role="radiogroup" element: focus and click the option the key points to. */
export const radioKeys = moveKeys("radio", true)

/** onKeyDown for the role="tablist" element: left and right, Home and End open the tab they reach. */
export const tabKeys = moveKeys("tab", false)
```

- [ ] **Step 4: The page with tabs**

Replace `src/components/study/study-view.tsx` with:

```tsx
// The Study page, in #views: the three tiles, then four tabs. Timer is the Ready card large
// beside Your flow and Today (timer-cards.tsx); History and Achievements fill the width;
// the Leaderboard is a centred column. Only the open tab is drawn, so the leaderboard
// loads when its tab opens. The tab is ui.studyTab, remembered on this browser; the arrow
// keys, Home and End move between tabs (radio-keys.ts).

import { cn } from "@/lib/utils"
import { useUi } from "@/data/ui"
import { setStudyTab } from "@/data/study"
import { tabKeys } from "@/components/sheet/radio-keys"
import type { StudyTab } from "@/data/types"
import { StudyTiles } from "./tiles"
import { TimerCards } from "./timer-cards"
import { HistoryCard } from "./history"
import { AchievementsCard } from "./achievements"
import { LeaderboardCard } from "./leaderboard"

const TABS: readonly [StudyTab, string][] = [["timer", "Timer"], ["history", "History"], ["achievements", "Achievements"], ["leaderboard", "Leaderboard"]]

export function StudyView() {
    const open = useUi((u) => u.studyTab)
    return (
        <div className="grid gap-4 pb-1.5">
            <StudyTiles />
            <div role="tablist" aria-label="Study" onKeyDown={tabKeys}
                className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
                {TABS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        id={"study-tab-" + id}
                        aria-selected={open === id}
                        aria-controls={open === id ? "study-panel" : undefined}
                        tabIndex={open === id ? 0 : -1}
                        onClick={() => setStudyTab(id)}
                        className={cn(
                            "-mb-px h-[42px] flex-none cursor-pointer border-0 border-b-2 bg-transparent px-3.5 font-[inherit] text-[13.5px] max-[520px]:px-2.5",
                            open === id ? "border-primary font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div role="tabpanel" id="study-panel" aria-labelledby={"study-tab-" + open} className="min-w-0">
                {open === "timer" && <TimerCards />}
                {open === "history" && <HistoryCard />}
                {open === "achievements" && <AchievementsCard />}
                {open === "leaderboard" && <LeaderboardCard className="mx-auto w-full max-w-[760px]" />}
            </div>
        </div>
    )
}
```

Notes for the implementer: the tabs activate as they take focus (each panel is cheap to draw), which is why `tabKeys` clicks. `aria-controls` is only on the open tab because the other panels aren't in the page. `border-primary` is the accent (`--color-primary: var(--accent)` in `index.css`). The achievements' groups are already two across (`grid-cols-2 @max-[520px]:grid-cols-1` in `achievements.tsx`); full width is all they need.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/study src/components/sheet/settings-sheet.test.tsx`
Expected: PASS (settings' radio groups use the rewritten `radioKeys`; its arrow, Home and End tests still pass).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/components/sheet/radio-keys.ts src/components/study/study-view.tsx src/components/study/study.test.tsx
git commit -m "The Study page in four tabs: Timer, History, Achievements, Leaderboard, with arrow keys and the last tab remembered" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 3: A run's end and an achievement's See open the right tab

**Files:**
- Modify: `src/data/study-timer.ts`, `src/data/study-controller.ts`
- Modify: `src/data/study-timer.test.ts`
- Create: `src/data/study-controller.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/data/study-timer.test.ts`, replace the test `"opens the focus screen on Start, and goes to the Study page when it ends"` with:

```ts
    it("opens the focus screen on Start, and goes to the Study page's Timer tab when it ends", async () => {
        ui.view = "week"
        ui.focus = false
        ui.studyTab = "achievements"
        await begin(CLASSIC)
        expect(ui.focus).toBe(true)
        expect(redraw).toHaveBeenCalled()
        await act(() => stopRun())
        expect(ui).toMatchObject({ focus: false, view: "study", studyTab: "timer" })   /* Today lists the session */
    })
```

Create `src/data/study-controller.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { stubMatchMedia } from "@/components/test-media"

/* A fake ui; the run, the timer and the fireworks are fakes. */
const fake = vi.hoisted(() => ({ ui: { view: "week", studyTab: "timer", hist: { undo: null } } }))
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], study_sessions: [], achievements: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/run", () => ({ active: () => false }))
vi.mock("@/data/study-timer", () => ({ openFocus: vi.fn() }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))

import { showAchievement } from "./study-controller"

afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ""
    Object.assign(fake.ui, { view: "week", studyTab: "timer" })
})

describe("an achievement toast's See", () => {
    it("opens the Study page on its Achievements tab, and brings the medal into view with a pop", () => {
        stubMatchMedia({ reducedMotion: true })
        vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 0 })
        const medal = document.createElement("li")
        medal.id = "ach-hours-1"
        medal.scrollIntoView = vi.fn()
        document.body.append(medal)
        showAchievement("hours-1")
        expect(fake.ui).toMatchObject({ view: "study", studyTab: "achievements" })
        expect(medal.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" })
        expect(medal.classList.contains("pop")).toBe(true)
    })

    it("opens the Achievements tab from another Study tab too", () => {
        stubMatchMedia({ reducedMotion: false })
        vi.stubGlobal("requestAnimationFrame", () => 0)
        Object.assign(fake.ui, { view: "study", studyTab: "history" })
        showAchievement("days-first")
        expect(fake.ui.studyTab).toBe("achievements")
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/study-timer.test.ts src/data/study-controller.test.ts`
Expected: FAIL: `studyTab` stays `"achievements"` after the run; `showAchievement` is not exported.

- [ ] **Step 3: The run's end**

In `src/data/study-timer.ts`, replace

```ts
/* What a run does to the page: Start opens the focus screen; a new Study step pulls you
   back into it (unless a sheet is open); Stop & log, or the flow's end, goes to the
   Study page, where the session now shows. */
focus.onTick((s: { kind: StepKind } | null, event: string) => {
    let moved = false
    if (event === "start") { ui.focus = true; moved = true }
    else if (event === "end") {
        ui.focus = false
        ui.view = "study"
        rememberUi()
```

with

```ts
/* What a run does to the page: Start opens the focus screen; a new Study step pulls you
   back into it (unless a sheet is open); Stop & log, or the flow's end, goes to the
   Study page's Timer tab, whose Today card now lists the session. */
focus.onTick((s: { kind: StepKind } | null, event: string) => {
    let moved = false
    if (event === "start") { ui.focus = true; moved = true }
    else if (event === "end") {
        ui.focus = false
        ui.view = "study"
        ui.studyTab = "timer"
        rememberUi()
```

- [ ] **Step 4: See**

In `src/data/study-controller.ts`, replace the whole `function showAchievement(id: string) { … }` with:

```ts
/** An achievement toast's See: the Study page's Achievements tab, the medal brought into view with a pop. */
export function showAchievement(id: string) {
    if (ui.view !== "study" || ui.studyTab !== "achievements") {
        ui.view = "study"
        ui.studyTab = "achievements"
        rememberUi()
        notify()
    }
    /* the tab is drawn by the next frame when it was not showing */
    requestAnimationFrame(() => {
        const el = document.getElementById("ach-" + id)
        if (!el) return
        el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
        el.classList.remove("pop")
        void el.offsetWidth
        el.classList.add("pop")
    })
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/study-timer.test.ts src/data/study-controller.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/study-timer.ts src/data/study-timer.test.ts src/data/study-controller.ts src/data/study-controller.test.ts
git commit -m "A run's end lands on the Timer tab, and an achievement's See on the Achievements tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 4: The tiles with serif numbers

**Files:**
- Modify: `src/components/study/tiles.tsx`

The tiles keep their words and numbers (the tests read those); only the type changes, as in the prototype's tiles (lines 413–426): the label in plain small text instead of spaced capitals (spec §1 drops uppercase labels), the number in Source Serif at 28px.

- [ ] **Step 1: Restyle `Tile` and `Icon`**

In `src/components/study/tiles.tsx`, replace the `Tile` function with:

```tsx
function Tile({ label, icon, value, sub, className }: { label: string; icon: ReactNode; value: ReactNode; sub: ReactNode; className?: string }) {
    return (
        <Card className={cn("min-w-0", className)}>
            <div role="group" aria-label={label} className="flex min-h-[84px] items-center gap-4 px-5 py-3 max-[520px]:min-h-0 max-[520px]:gap-3 max-[520px]:px-3.5 max-[520px]:py-2.5">
                {icon}
                <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[12.5px] text-muted-foreground">{label}</span>
                    <b className="font-serif text-[28px] leading-none font-medium text-foreground tabular-nums max-[520px]:text-[24px] [&_small]:text-[15px] [&_small]:font-normal [&_small]:text-muted-foreground">{value}</b>
                    <span className="text-[12px] text-ink-2">{sub}</span>
                </span>
            </div>
        </Card>
    )
}
```

replace the `Icon` component's class string

```tsx
        "grid size-12 flex-none place-items-center rounded-[13px] max-[520px]:size-10 [&_svg]:size-6",
```

with

```tsx
        "grid size-11 flex-none place-items-center rounded-[8px] max-[520px]:size-10 [&_svg]:size-5",
```

and in `StudyTiles`, give the goal ring the tile's size: change `icon={goal ? <GoalRing part={t.today.minutes} whole={goal} /> : <Icon><Calendar /></Icon>}` to

```tsx
                icon={goal ? <GoalRing part={t.today.minutes} whole={goal} className="size-12 max-[520px]:size-10" /> : <Icon><Calendar /></Icon>}
```

Update the file's top comment to: `// The Study page's three tiles: the streak, today against the daily goal, and the term` / `// so far (the last 12 weeks with no term start), the numbers in serif. With no goal,` / `// Today offers to set one.` (three lines, `//` each).

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/components/study`
Expected: PASS (the tiles' tests read text, which is unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/components/study/tiles.tsx
git commit -m "The study tiles: plain labels and serif numbers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 5: The theme's Quick start, the flow's name, the clock's Ready size

**Files:**
- Modify: `src/data/themes.ts`, `src/data/themes.test.ts`
- Modify: `src/data/study-timer.ts`, `src/data/study-timer.test.ts`
- Modify: `src/components/study/flip-clock.tsx`, `src/components/study/flip-clock.test.tsx`, `src/index.css`
- Modify: `src/components/study/timer-cards.tsx` (the Quick start row only), `src/components/study/timer.test.tsx`

Today the third preset is "Anki then read" in every theme (`FLOW_PRESETS` in `src/core/model.ts`); the prototype names it per theme (`STUDY[2]`). The flow saved stays the same 20 / 5 / 40 / 15 × 2 in every theme; only the name changes.

- [ ] **Step 1: Write the failing tests**

In `src/data/themes.test.ts`, add inside `describe("the themes", …)`:

```ts
    it("names the third Quick start for each theme", () => {
        expect(BGS.map((bg) => THEMES[bg].preset)).toEqual(["Anki then read", "LeetCode then read", "Brief then outline", "Charts then sim", "Film then drills", "Problems then read"])
    })
```

In `src/data/study-timer.test.ts`, add `flowName, presetsFor, sameFlow` to the import from `"./study-timer"`, and add after `describe("the flow's totals", …)`:

```ts
describe("the presets and the flow's name", () => {
    const READ: Flow = { steps: [["study", 20], ["break", 5], ["study", 40], ["break", 15]], rounds: 2 }

    it("name the third preset for the theme, with the same flow in every theme", () => {
        expect(presetsFor("med").map(([name]) => name)).toEqual(["Classic 25/5", "Deep 50/10", "Anki then read"])
        expect(presetsFor("cs")[2]).toEqual(["LeetCode then read", READ])
        expect(presetsFor("eng")[0]).toEqual(["Classic 25/5", CLASSIC])
    })

    it("tell flows apart by their steps and rounds", () => {
        expect(sameFlow(CLASSIC, { steps: [["study", 25], ["break", 5]], rounds: 4 })).toBe(true)
        expect(sameFlow(CLASSIC, { ...CLASSIC, rounds: 3 })).toBe(false)
        expect(sameFlow(CLASSIC, { steps: [["study", 25], ["study", 5]], rounds: 4 })).toBe(false)
        expect(sameFlow(CLASSIC, { steps: [["study", 25]], rounds: 4 })).toBe(false)
    })

    it("call the flow by its preset and rounds, else Your flow", () => {
        expect(flowName(CLASSIC, "med")).toBe("Classic 25/5 · 4 rounds")
        expect(flowName(READ, "law")).toBe("Brief then outline · 2 rounds")
        expect(flowName({ ...CLASSIC, rounds: 3 }, "med")).toBe("Your flow · 3 rounds")
        expect(flowName({ steps: [["study", 25]], rounds: 1 }, "med")).toBe("Your flow · 1 round")
    })
})
```

In `src/components/study/flip-clock.test.tsx`, replace the first lines of `"does not flip on its first draw"`:

```tsx
        render(<FlipClock ms={5 * MIN} running size="mid" />)
        expect(flipping()).toEqual([false, false, false, false])
```

with

```tsx
        render(<FlipClock ms={5 * MIN} running size="ready" />)
        expect(screen.getByRole("timer").className).toContain("fc-ready")
        expect(flipping()).toEqual([false, false, false, false])
```

In `src/components/study/timer.test.tsx`, in `beforeEach` change `Object.assign(ui, { focus: false, view: "study", study: { courseId: null, itemId: null } })` to

```ts
    Object.assign(ui, { focus: false, view: "study", bg: "med", study: { courseId: null, itemId: null } })
```

and add inside `describe("the flow card", …)`:

```ts
    it("names the third Quick start for the theme, and presses the preset the flow is", async () => {
        ui.bg = "cs"
        cards()
        const card = within(region("Your flow"))
        const pressed = (name: string) => card.getByRole("button", { name }).getAttribute("aria-pressed")
        expect(card.queryByRole("button", { name: "Anki then read" })).toBeNull()
        expect([pressed("Classic 25/5"), pressed("Deep 50/10"), pressed("LeetCode then read")]).toEqual(["true", "false", "false"])
        fireEvent.click(card.getByRole("button", { name: "LeetCode then read" }))
        await settle()
        expect(flow()).toEqual({ steps: [["study", 20], ["break", 5], ["study", 40], ["break", 15]], rounds: 2 })
        expect([pressed("Classic 25/5"), pressed("LeetCode then read")]).toEqual(["false", "true"])
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/themes.test.ts src/data/study-timer.test.ts src/components/study/flip-clock.test.tsx src/components/study/timer.test.tsx`
Expected: FAIL: `preset` undefined; `presetsFor`, `sameFlow`, `flowName` not exported; no `fc-ready` class; "Anki then read" shown in CS and no `aria-pressed` on the presets. (TypeScript may also flag `size="ready"`; Vitest still runs.)

- [ ] **Step 3: The theme's preset name**

In `src/data/themes.ts`, add to `ThemeInfo` after `studyWord`:

```ts
    /** the third Quick start's name: "Anki then read" */
    preset: string
```

and add a `preset` to each theme, after its `studyWord`:

```ts
        picture: "Lab coat with your name embroidered", studyWord: "On shift", preset: "Anki then read",
```
```ts
        picture: "Lanyard ID badge with your name", studyWord: "Compiling", preset: "LeetCode then read",
```
```ts
        picture: "Suit jacket with a brass name plate", studyWord: "In session", preset: "Brief then outline",
```
```ts
        picture: "Flight jacket with wings and a name tape", studyWord: "In flight", preset: "Charts then sim",
```
```ts
        picture: "Back of a jersey with your name and number", studyWord: "On the clock", preset: "Film then drills",
```
```ts
        picture: "Hi-vis safety vest with a name tag", studyWord: "Building", preset: "Problems then read",
```

(each replaces the theme's existing `picture: …, studyWord: …,` line).

- [ ] **Step 4: The presets as a theme names them, and the flow's name**

In `src/data/study-timer.ts`, change `import { THEMES } from "./themes"` to `import { THEMES, type Bg } from "./themes"`, and add after `applyPreset`:

```ts
/** The Quick start presets as a theme names them: the third is the theme's own ("LeetCode then read"). */
export const presetsFor = (bg: Bg): [string, Flow][] =>
    PRESETS.map(([name, f], i): [string, Flow] => [i === 2 ? THEMES[bg].preset : name, f])

/** Whether two flows have the same steps and rounds. */
export const sameFlow = (a: Flow, b: Flow) =>
    a.rounds === b.rounds && a.steps.length === b.steps.length && a.steps.every(([k, m], i) => k === b.steps[i][0] && m === b.steps[i][1])

/** The Ready card's name for the flow: "Classic 25/5 · 4 rounds", or "Your flow · 1 round" when it is no preset. */
export function flowName(f: Flow, bg: Bg): string {
    const preset = presetsFor(bg).find(([, p]) => sameFlow(p, f))
    return (preset ? preset[0] : "Your flow") + " · " + f.rounds + (f.rounds === 1 ? " round" : " rounds")
}
```

- [ ] **Step 5: The clock's Ready size**

`mid` is used only by the Ready card, and spec §8 asks for cards 96px high; `mid` tops out at 82px (58 × 1.42). Replace it.

In `src/components/study/flip-clock.tsx`, change `export type ClockSize = "big" | "mid" | "mini"` to

```ts
export type ClockSize = "big" | "ready" | "mini"
```

In `src/index.css`, replace the line

```css
  .fc-mid { --flip-w: clamp(40px, 5vw, 58px); }
```

with

```css
  /* the Study page's Ready card: cards 96px high (spec §8), smaller on a phone */
  .fc-ready { --flip-w: 68px; --flip-h: 96px; }
  @media (max-width: 520px) { .fc-ready { --flip-w: 50px; --flip-h: 71px; } }
```

(`.fc-ready` comes after `.fc-clock` with the same specificity, so its `--flip-h` wins over the `* 1.42` default.)

In `src/components/study/timer-cards.tsx`, change `size="mid"` to `size="ready"` (the Ready card's `FlipClock`; Task 6 rewrites the card around it).

- [ ] **Step 6: The Quick start row**

In `src/components/study/timer-cards.tsx`:
- in the import from `"@/data/study-timer"`, remove `PRESETS` and add `presetsFor, sameFlow`;
- add `import { useUi } from "@/data/ui"` after the `openCourse` import;
- in `FlowCard`, add `const bg = useUi((u) => u.bg)` after `const studies = …`;
- replace the Quick start row's map

```tsx
                    {PRESETS.map(([name], i) => (
                        <button key={name} type="button" onClick={() => void applyPreset(i)}
                            className="cursor-pointer rounded-full border border-border bg-card px-[11px] py-1 font-[inherit] text-[12px] font-semibold text-ink-2 hover:border-muted-foreground hover:text-foreground">
                            {name}
                        </button>
                    ))}
```

with

```tsx
                    {presetsFor(bg).map(([name, preset], i) => {
                        const on = sameFlow(preset, flow)
                        return (
                            <button key={i} type="button" aria-pressed={on} onClick={() => void applyPreset(i)}
                                className={cn(
                                    "cursor-pointer rounded-full border px-[11px] py-1 font-[inherit] text-[12px] font-semibold",
                                    on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-ink-2 hover:border-muted-foreground hover:text-foreground",
                                )}>
                                {name}
                            </button>
                        )
                    })}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/data/themes.test.ts src/data/study-timer.test.ts src/components/study src/components/focus`
Expected: PASS. The old `"replaces the flow with a Quick start preset"` test still finds "Anki then read" (Medicine).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors (`rg -n '"mid"' src` finds nothing left).

```bash
git add src/data/themes.ts src/data/themes.test.ts src/data/study-timer.ts src/data/study-timer.test.ts src/components/study/flip-clock.tsx src/components/study/flip-clock.test.tsx src/index.css src/components/study/timer-cards.tsx src/components/study/timer.test.tsx
git commit -m "The third Quick start is named for the theme, the preset in use shows pressed, and the clock gets a 96px Ready size" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 6: The Timer tab: the Ready card large beside Your flow

**Files:**
- Modify: `src/components/study/timer-cards.tsx` (everything above `/* ── Your flow ── */`)
- Modify: `src/components/study/timer.test.tsx`, `src/components/study/study.test.tsx`

The card follows the prototype's lines 435–476: the theme's dark colour flat (no glow), the phase line in the theme's word, the clock and the flow's name under it, the strip, Course and Item side by side, a white Start. It stays a `section` named "Ready" (tests and screen readers know it by that).

- [ ] **Step 1: Write the failing tests**

In `src/components/study/timer.test.tsx`, in `"shows the first step on the clock, the rounds, the course and item to log against, and Start"`, replace

```ts
        expect(ready.getByText("Ready")).toBeTruthy()
```

with

```ts
        expect(ready.getByText("On shift · round 1 of 4")).toBeTruthy()
```

and

```ts
        expect(ready.getByText("Round 1 of 4")).toBeTruthy()
```

with

```ts
        expect(ready.getByText("Classic 25/5 · 4 rounds")).toBeTruthy()
```

In `"repeats 1 to 12 rounds, and the totals follow"`, replace

```ts
        expect(within(region("Ready")).getByText("Round 1 of 2")).toBeTruthy()
```

with

```ts
        expect(within(region("Ready")).getByText("On shift · round 1 of 2")).toBeTruthy()
        expect(within(region("Ready")).getByText("Your flow · 2 rounds")).toBeTruthy()
```

and add inside `describe("the Ready card", …)`:

```ts
    it("says the theme's study word in the phase", () => {
        ui.bg = "law"
        cards()
        expect(within(region("Ready")).getByText("In session · round 1 of 4")).toBeTruthy()
    })
```

In `src/components/study/study.test.tsx`, add inside `describe("the Study page", …)`:

```ts
    it("lays the Timer tab out as the Ready card beside Your flow, one column under 900px", async () => {
        await show()
        const layout = region("Ready").parentElement!
        expect(layout.className).toContain("[grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)]")
        expect(layout.className).toContain("max-[900px]:[grid-template-columns:minmax(0,1fr)]")
        expect(layout.firstElementChild).toBe(region("Ready"))
        expect(layout.children[1].contains(region("Your flow"))).toBe(true)
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/study/timer.test.tsx src/components/study/study.test.tsx`
Expected: FAIL: the card says "Ready" and "Round 1 of 4", no flow name; the layout test finds the old column.

- [ ] **Step 3: Rewrite the top of `timer-cards.tsx`**

Replace everything in `src/components/study/timer-cards.tsx` above the line `/* ── Your flow ── */` with:

```tsx
// The Study page's Timer tab: the Ready card large on the left, in the theme's dark colour
// so starting feels like stepping into the focus screen (the phase in the theme's word,
// the flip clock on the first step, the flow's name, the round strip, the course and item
// picked, and Start); on the right Your flow (the steps, the rounds and the Quick start
// presets; every change saves the flow to the profile, study-timer.ts). Under 900px, one
// column.

import { useState, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { Panel, HeadNote } from "@/components/views/bits"
import { RemoveButton } from "@/components/sheet/fields"
import { openCourse } from "@/data/actions"
import { useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import {
    addStep, applyPreset, delStep, flowName, flowTotals, MAX_MINUTES, MAX_ROUNDS, MAX_STEPS, openFocus, pickCourse, pickItem, presetsFor,
    sameFlow, setRounds, setStepKind, setStepMinutes, startRun, stripSegments, useFlow, useRun, useStudyPick,
} from "@/data/study-timer"
import type { Flow } from "@/data/types"
import { FlipClock } from "./flip-clock"
import { PhaseLabel, PlayIcon, RoundStrip } from "./timer-bits"

const MIN = 60_000

export function TimerCards({ className }: { className?: string }) {
    const flow = useFlow()
    return (
        <div className={cn("grid items-stretch gap-4 [grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)] max-[900px]:[grid-template-columns:minmax(0,1fr)]", className)}>
            <ReadyCard flow={flow} />
            <div className="flex min-w-0 flex-col gap-4">
                <FlowCard flow={flow} />
            </div>
        </div>
    )
}

/* ── Ready ── */

const PICK = "h-[38px] w-full min-w-0 cursor-pointer rounded-md border border-white/20 bg-white/[.06] px-2 font-[inherit] text-[13px] text-[var(--fx-ink)] outline-none hover:border-white/30 focus-visible:border-[var(--ph)] focus-visible:shadow-[0_0_0_3px_var(--ph-soft)] [&_option]:bg-card [&_option]:text-foreground"

function ReadyCard({ flow }: { flow: Flow }) {
    const pick = useStudyPick()
    const running = useRun() !== null
    const bg = useUi((u) => u.bg)
    const totals = flowTotals(flow)
    return (
        <section
            aria-label="Ready"
            className="study-fx flex min-w-0 flex-col justify-center gap-6 rounded-[10px] bg-[var(--fx-bg)] px-11 py-9 text-[var(--fx-ink)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)] max-[520px]:gap-5 max-[520px]:px-5 max-[520px]:py-6"
        >
            <PhaseLabel className="text-[12px] font-medium tracking-[.04em] normal-case">
                {THEMES[bg].studyWord} · round 1 of {flow.rounds}
            </PhaseLabel>
            <div className="flex flex-col items-start gap-3.5">
                <FlipClock ms={flow.steps[0][1] * MIN} running={false} size="ready" />
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-[var(--fx-ink-2)] tabular-nums">
                    <span>{flowName(flow, bg)}</span>
                    <span>{duration(totals.study)} study · {duration(totals.total)} total</span>
                </div>
            </div>
            <RoundStrip rows={stripSegments(flow, null)} className="max-w-[520px]" />
            {pick.courses.length ? (
                <>
                    <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                        <select aria-label="Course" value={pick.courseId ?? ""} onChange={(e) => pickCourse(e.target.value)} className={PICK}>
                            {pick.courses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                        </select>
                        <select aria-label="Item (optional)" value={pick.itemId ?? ""} onChange={(e) => pickItem(e.target.value || null)} className={PICK}>
                            <option value="">No item</option>
                            {pick.items.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {running
                            ? <GoButton onClick={openFocus}>Back to focus</GoButton>
                            : <GoButton onClick={() => void startRun()}><PlayIcon />Start focus</GoButton>}
                        <p className="m-0 text-[12.5px] text-[var(--fx-ink-2)]">Opens the focus screen: the clock and your music, nothing else.</p>
                    </div>
                </>
            ) : (
                <div className="flex flex-col items-start gap-3">
                    <p className="m-0 text-[12.5px] text-[var(--fx-ink-2)]">Add a course first; study time is logged against one.</p>
                    <GoButton onClick={() => openCourse(null)}>Add a course</GoButton>
                </div>
            )}
        </section>
    )
}

/* white on the dark card, as in the prototype */
const GoButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
    <button
        type="button"
        onClick={onClick}
        className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border-0 bg-white px-6 font-[inherit] text-[15px] font-semibold text-[#1C1C1A] hover:bg-white/90 active:bg-white/80 [&_svg]:size-3"
    >
        {children}
    </button>
)

```

Notes for the implementer:
- `PhaseLabel` keeps its dot and its `--ph-ink` colour; only size, weight, tracking and case are overridden (all safe in `cn()`).
- `--fx-bg` is the theme's dark study colour (`--fx-study-bg` per theme in `src/styles/tokens.css`), set by `.study-fx` in `index.css`.
- `useState` and `KeyboardEvent` are still used by `NumberBox` below; `Button` is dropped from the `fields` import (it was unused).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/study src/components/focus`
Expected: PASS. (`focus-screen.test.tsx` renders `TimerCards` and clicks "Start focus"; the button keeps its name.)

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/components/study/timer-cards.tsx src/components/study/timer.test.tsx src/components/study/study.test.tsx
git commit -m "The Timer tab: the Ready card large in the theme's dark colour, the phase in the theme's word, beside Your flow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 7: Today

**Files:**
- Modify: `src/data/study.ts`, `src/data/study.test.ts`
- Create: `src/components/study/today-card.tsx`
- Modify: `src/components/study/timer-cards.tsx`, `src/components/study/study.test.tsx`, `src/components/study/timer.test.tsx`, `src/components/focus/focus-screen.test.tsx`

Today lists the sessions logged today, as the Today tile counts them (a run in progress is not a session yet; a delete waiting for Undo is hidden, as everywhere). Each row says what it was: the item, else the session's note, else the course. Editing and deleting stay in History.

- [ ] **Step 1: Write the failing tests for the helper**

In `src/data/study.test.ts`, add `todayOf` to the import from `"./study"`, add `Course` to the `import type` list, and append:

```ts
describe("today", () => {
    it("lists today's sessions newest first: the time, the course and its colour, what, how long; and the total against the goal", () => {
        const items = [normalizeItem({ id: "q1", type: "quiz", title: "Plexus quiz", courseId: "anat", date: "2026-10-01" }) as Item]
        const courses = [{ id: "anat", name: "Anatomy", color: "#C2571A" }, { id: "phys", name: "Physiology", color: "#1E628F" }] as Course[]
        const quiz = { ...at(TODAY, 25, "anat", 9), itemId: "q1", note: "Ch. 3" }   /* the item wins over the note */
        const cards = { ...at(TODAY, 40, "phys", 14), note: "Anki, 120 cards" }
        const plain = at(TODAY, 15, "phys", 11)
        const none = at(TODAY, 10, null, 7)
        const t = todayOf([quiz, cards, plain, none, at("2026-09-22", 60)], items, courses, 90, TODAY)
        expect(t.rows).toEqual([
            { id: cards.id, at: "14:00", courseId: "phys", color: "#1E628F", what: "Anki, 120 cards", minutes: 40 },
            { id: plain.id, at: "11:00", courseId: "phys", color: "#1E628F", what: "Physiology", minutes: 15 },
            { id: quiz.id, at: "09:00", courseId: "anat", color: "#C2571A", what: "Plexus quiz", minutes: 25 },
            { id: none.id, at: "07:00", courseId: null, color: undefined, what: "No course", minutes: 10 },
        ])
        expect([t.total, t.goal]).toEqual([90, 90])
    })

    it("is empty with nothing logged today", () => {
        expect(todayOf([at("2026-09-22", 60)], [], [], 0, TODAY)).toEqual({ rows: [], total: 0, goal: 0 })
    })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/data/study.test.ts`
Expected: FAIL: `todayOf` is not a function.

- [ ] **Step 3: The helper and its hook**

In `src/data/study.ts`, change the file's first comment line to `// What the Study page shows: the three tiles, Today on the Timer tab, the History card's` and the second to `// week, month and term, and the achievements, worked out from the logged sessions.` and the third to `// core/history.ts and core/achievements.ts do the arithmetic; the selectors here shape it` and the fourth to `// for the page. Pure: each takes the sessions, the prefs and today, so it can be tested on` and the fifth to `// its own. The hooks and the page's actions are at the end.` (five lines in place of today's five).

Add before `/* ── History: the week ── */`:

```ts
/* ── the Timer tab's Today ── */

export interface TodayRow { id: string; at: string; courseId: string | null; color: string | undefined; what: string; minutes: number }
export interface TodayStudy { rows: TodayRow[]; total: number; goal: number }

/** "09:05": when a session started. */
const startTime = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") }

/**
 * Today's sessions, newest first, as the Today card lists them: when each started, its
 * course and the course's colour, what it was (the item, else the note, else the course)
 * and how long; and today's total against the goal (0 with none).
 */
export function todayOf(sessions: StudySession[], items: Item[], courses: Course[], goal: number, today: string): TodayStudy {
    const list = sessions.filter((s) => dayOf(s) === today).sort((a, b) => b.startedAt - a.startedAt)
    return {
        rows: list.map((s) => {
            const course = courses.find((c) => c.id === s.courseId)
            return {
                id: s.id, at: startTime(s.startedAt), courseId: s.courseId, color: course?.color,
                what: items.find((x) => x.id === s.itemId)?.title || s.note || course?.name || "No course",
                minutes: s.studyMinutes,
            }
        }),
        total: sum(list),
        goal,
    }
}
```

and after `useBadges`:

```ts
/** The Timer tab's Today card. */
export const useTodayStudy = () => {
    const input = useStudyInput(), items = useItems(), courses = useCourses()
    return useMemo(() => todayOf(input.sessions, items, courses, input.prefs.goal, input.today), [input, items, courses])
}
```

(`dayOf`, `Course`, `Item`, `useItems`, `useCourses` are already imported in `study.ts`.)

Run: `npx vitest run src/data/study.test.ts` — expected: PASS.

- [ ] **Step 4: Write the failing tests for the card**

In `src/components/study/study.test.tsx`, add to `"lays the Timer tab out as the Ready card beside Your flow, one column under 900px"` (Task 6), at its end:

```ts
        expect(layout.children[1].contains(region("Today"))).toBe(true)
        expect(region("Your flow").compareDocumentPosition(region("Today")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
```

and add after `describe("the tiles", …)`:

```ts
describe("Today", () => {
    it("lists today's sessions newest first, with the total of the goal", async () => {
        fake.data.study_sessions = [
            ...fake.data.study_sessions,
            session("t1", 23, 8, 25, { courseId: "phys", manual: true, note: "Flashcards" }),
            session("t2", 23, 10, 40, { itemId: "e1" }),
        ]
        await show()
        const today = region("Today")
        const rows = within(within(today).getByRole("list", { name: "Sessions today" })).getAllByRole("listitem")
        expect(rows.map((r) => r.textContent)).toEqual(["10:00Brachial plexus quiz40m", "08:00Flashcards25m"])
        expect(within(today).getByRole("heading", { name: "Today" }).parentElement!.textContent).toBe("Today1h 05m of 1h 00m")
    })

    it("says when nothing is logged, shows the total alone without a goal, and logs study by hand", async () => {
        fake.data.profile = null
        await show()
        const today = region("Today")
        expect(today.textContent).toContain("Nothing logged today yet.")
        expect(within(today).getByRole("heading", { name: "Today" }).parentElement!.textContent).toBe("Today0m")
        fireEvent.click(within(today).getByRole("button", { name: "Log study by hand" }))
        expect(actions.openSession).toHaveBeenCalledWith(null)
    })
})
```

In `src/components/study/timer.test.tsx`, change the actions fake to

```ts
const actions = vi.hoisted(() => ({ openCourse: vi.fn(), openSettings: vi.fn(), openSession: vi.fn() }))
```

and in `src/components/focus/focus-screen.test.tsx` change its `vi.mock("@/data/actions", …)` line to

```ts
vi.mock("@/data/actions", () => ({ openCourse: vi.fn(), openSettings: vi.fn(), openSession: vi.fn(), newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
```

(both render `TimerCards`, which now holds Today; its button imports `openSession`.)

- [ ] **Step 5: Run them to make sure they fail**

Run: `npx vitest run src/components/study/study.test.tsx`
Expected: FAIL: no region "Today".

- [ ] **Step 6: The card**

Create `src/components/study/today-card.tsx`:

```tsx
// The Timer tab's Today card: today's total against the daily goal, today's sessions
// newest first (when, the course's colour, what, how long), and Log study by hand, which
// opens the session sheet. Editing and deleting a session stay in History.

import { duration } from "@/lib/time"
import { accent, Panel } from "@/components/views/bits"
import { openSession } from "@/data/actions"
import { useTodayStudy } from "@/data/study"

/* a session with no course, or a course since deleted, is grey, as in History */
const NO_COURSE = "#7D8A99"

export function TodayCard() {
    const t = useTodayStudy()
    return (
        <Panel
            label="Today"
            title="Today"
            head={
                <span className="text-[12.5px] text-ink-2 tabular-nums">
                    <b className="font-semibold text-foreground">{duration(t.total)}</b>{t.goal > 0 && " of " + duration(t.goal)}
                </span>
            }
        >
            <div className="flex flex-col px-5 pt-1 pb-2">
                {t.rows.length ? (
                    <ul aria-label="Sessions today" className="m-0 flex list-none flex-col p-0">
                        {t.rows.map((r) => (
                            <li key={r.id} className="grid h-10 grid-cols-[44px_8px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-line-2 text-[13px] text-foreground first:border-t-0">
                                <span className="font-mono text-[12px] text-muted-foreground">{r.at}</span>
                                <span aria-hidden="true" style={accent(r.color) ?? accent(NO_COURSE)} className="size-2 rounded-[2px] bg-[var(--c)]" />
                                <span className="truncate">{r.what}</span>
                                <span className="font-mono text-[12.5px]">{duration(r.minutes)}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="m-0 py-2.5 text-[13px] text-ink-2">Nothing logged today yet.</p>
                )}
                <button
                    type="button"
                    onClick={() => openSession(null)}
                    className="mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 font-[inherit] text-[13px] font-medium text-accent-foreground hover:underline hover:underline-offset-2"
                >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="size-[11px]"><path d="M8 3v10M3 8h10" /></svg>
                    Log study by hand
                </button>
            </div>
        </Panel>
    )
}
```

In `src/components/study/timer-cards.tsx`, add `import { TodayCard } from "./today-card"` after the `timer-bits` import, and in `TimerCards` replace

```tsx
            <div className="flex min-w-0 flex-col gap-4">
                <FlowCard flow={flow} />
            </div>
```

with

```tsx
            <div className="flex min-w-0 flex-col gap-4">
                <FlowCard flow={flow} />
                <TodayCard />
            </div>
```

and in the file's top comment change "on the right Your flow (the steps, the rounds and the Quick start" / "presets; every change saves the flow to the profile, study-timer.ts)." to "on the right Your flow (the steps, the rounds and the Quick start" / "presets; every change saves the flow to the profile, study-timer.ts) and Today (today-card.tsx)."

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/study src/components/focus src/data/study.test.ts`
Expected: PASS. `region("Today")` is the card (a `section`); the Today tile is a `group`, so the two never clash.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/data/study.ts src/data/study.test.ts src/components/study/today-card.tsx src/components/study/timer-cards.tsx src/components/study/study.test.tsx src/components/study/timer.test.tsx src/components/focus/focus-screen.test.tsx
git commit -m "Today on the Timer tab: today's sessions, the total of the goal, and Log study by hand" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 8: History full width, the week in two columns

**Files:**
- Modify: `src/components/study/history.tsx`
- Modify: `src/components/study/study.test.tsx`

The History card already fills its tab. When the card is at least 880px wide (a container query on the card's body, which is already `@container`), Week puts the total, a taller chart (210px) and the course bars on the left and the sessions on the right, as the prototype does (lines 509–553). Narrower, it stacks as today. The sessions column is its own container, so its rows take their two-line layout when the column is narrow; the rows get slightly narrower columns so they fit one line in a 534px column (a 1440px screen).

- [ ] **Step 1: Write the failing test**

In `src/components/study/study.test.tsx`, add inside `describe("History", …)`:

```ts
    it("puts the week in two columns when wide: the total, chart and courses beside the sessions", async () => {
        await show("History")
        const h = history()
        const left = h.querySelector<HTMLElement>('[data-col="chart"]')!, right = h.querySelector<HTMLElement>('[data-col="sessions"]')!
        expect(left.parentElement).toBe(right.parentElement)
        expect(left.parentElement!.className).toContain("@min-[880px]:grid-cols-2")
        expect(left.textContent).toContain("1h 00m goal")
        expect(within(left).getByText("ANAT")).toBeTruthy()   /* the course bars */
        expect(within(right).getAllByRole("listitem").map((li) => li.dataset.session)).toEqual(["s1", "s2"])
        expect(right.className).toContain("@container")
    })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/study/study.test.tsx -t "two columns"`
Expected: FAIL: no `[data-col]`.

- [ ] **Step 3: The two-column week**

In `src/components/study/history.tsx`, replace the whole `function WeekPane(…) { … }` with:

```tsx
function WeekPane({ w, goal, onDelete }: { w: WeekHist; goal: number; onDelete: (id: string) => void }) {
    return (
        <div className="grid items-start gap-x-8 gap-y-3.5 @min-[880px]:grid-cols-2">
            <div data-col="chart" className="flex min-w-0 flex-col gap-3.5">
                <div className="flex flex-wrap items-baseline gap-2">
                    <b className="font-mono text-[28px] font-extrabold tracking-[-.02em] text-foreground">{duration(w.total)}</b>
                    <span className="text-[12.5px] text-ink-2">{w.summary}</span>
                </div>
                <div>
                    <div className="relative mb-1.5 h-[130px] @min-[880px]:h-[210px]">
                        <div aria-hidden="true" className="grid h-full grid-cols-7 gap-2">
                            {w.days.map((d) => (
                                <span key={d.date} title={d.title} className={cn(
                                    "box-border flex h-full flex-col-reverse gap-0.5 rounded-md",
                                    d.future ? "border-[1.5px] border-dashed border-border" : "bg-[repeating-linear-gradient(to_top,var(--line-2)_0_1px,transparent_1px_25%)]",
                                )}>
                                    {d.bars.map((b) => <i key={b.courseId} style={{ ...courseColour(b.courseId || null), height: b.height + "%" }} className="block min-h-0.5 rounded bg-[var(--c)]" />)}
                                </span>
                            ))}
                        </div>
                        {w.goalLine !== null && (
                            <span aria-hidden="true" style={{ bottom: w.goalLine + "%" }}
                                className="pointer-events-none absolute right-0 left-0 border-t-[1.5px] border-dashed border-[color-mix(in_srgb,var(--study)_60%,transparent)]">
                                <em className="absolute -top-[17px] right-0 rounded bg-card px-1 text-[11px] font-semibold text-[var(--study-ink)] not-italic">{duration(goal)} goal</em>
                            </span>
                        )}
                    </div>
                    <ol className="m-0 grid list-none grid-cols-7 gap-2 p-0 text-center text-[11px] text-ink-2 tabular-nums">
                        {w.days.map((d) => (
                            <li key={d.date} className="flex min-w-0 flex-col gap-px">
                                <b className={cn("text-[11.5px] font-semibold text-foreground", d.isToday && "font-extrabold text-[var(--study-ink)]")}>{d.label}</b>
                                {d.isToday && <span className="sr-only">today</span>}
                                {d.total > 0 && duration(d.total)}
                            </li>
                        ))}
                    </ol>
                </div>
                {w.perCourse.length > 0 && <CourseBars list={w.perCourse} />}
            </div>
            {/* its own container: the rows take two lines when this column is narrow */}
            <div data-col="sessions" className="@container flex min-w-0 flex-col gap-3.5">
                <SubHead note="newest first">Sessions</SubHead>
                {w.sessions.length
                    ? <Sessions list={w.sessions} withDay onDelete={onDelete} />
                    : <Hint>No study logged this week.</Hint>}
            </div>
        </div>
    )
}
```

In `SessionRow`, replace

```tsx
            "[grid-template-columns:108px_84px_minmax(0,1fr)_64px_70px_auto]",
```

with

```tsx
            "[grid-template-columns:108px_72px_minmax(0,1fr)_56px_64px_auto]",
```

and change every `@max-[560px]:` in `SessionRow` and `RowButton` to `@max-[520px]:` (eight lines; nothing else in the file uses `@max-[560px]`):

```bash
sed -i 's/@max-\[560px\]:/@max-[520px]:/g' src/components/study/history.tsx
```

Update the file's top comment to:

```tsx
// The History card on the Study page's History tab: Week, Month and Term. The week is a
// bar a day, split by course, against the goal, beside its sessions when the card is wide;
// the month a calendar whose days open their sessions; the term a heatmap from its start,
// whose days open their month. A deleted session waits in the card's foot for Undo,
// whichever tab is showing.
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/study`
Expected: PASS, the History tests included (the sessions keep their `data-session` and buttons).

- [ ] **Step 5: Commit**

```bash
git add src/components/study/history.tsx src/components/study/study.test.tsx
git commit -m "History fills its tab: the week's chart, taller, and courses beside the sessions when wide" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

---

### Task 9: Look at it, side by side with the prototype

**Files:**
- Modify: whatever the look needs among `src/components/study/*.tsx` and `src/index.css` (spacing and colours only; behaviour is covered by tests)

- [ ] **Step 1: Look**

Start the dev server (see "How to work", 2), sign in as `termqa`, log two sessions by hand for today, and compare with the prototype's Study board in the canvas (https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV). Check at 1440px, 1024px and 390px wide, in the light theme and in one dark one, and in Medicine and one other theme (CS: "Compiling", "LeetCode then read"):
- the tiles: serif numbers, the ring and icons the same size, three across, two then one when narrow;
- the tab list: the open tab underlined in the accent, the others quiet; Tab reaches only the open tab; ← → Home End move and open; on a phone the four tabs fit or scroll sideways with no scrollbar showing and no page-wide horizontal scroll;
- Timer: the Ready card in the theme's dark colour, taller than or as tall as the right column, its clock cards 96px high (DevTools: `.fc-card` height), left-aligned, the strip no wider than 520px, the selects side by side, the white Start; at 1024px the two columns still fit (the clock must not overflow the card); under 900px Ready above Your flow above Today; at 390px the clock's smaller size fits inside the card;
- Your flow: the pressed preset dark; switching theme renames the third;
- Today: rows 40px with a hairline between, the colour square, long names cut with an ellipsis; "Log study by hand" opens the session sheet, and saving it adds a row;
- History: Week in two columns at 1440px, the chart 210px; one column at 1024px with the 130px chart; Month and Term as before; Undo still in the foot;
- Achievements: full width, groups two across, one across on a phone; an unlock toast's See lands on the tab with the medal popping (to get a toast, sign up a fresh local user and log a 60-minute session by hand: "First hour" unlocks);
- Leaderboard: a centred column at most 760px wide;
- ending a run (Stop & log on the focus screen) lands on Timer with the session in Today;
- reload: the tab last open is open again.

Fix what's off in the same files. Then run `npm run check`; expected: typecheck, all tests and the build pass.

- [ ] **Step 2: Commit**

```bash
git add -A src/components/study src/index.css
git commit -m "The Study tabs checked against the prototype at desktop, tablet and phone widths" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01V6M7AJuzanf8ULa7hQxDry"
```

(If nothing needed fixing, skip the commit.)

---

### Task 10: The owner's review and the release

- [ ] **Step 1: Final review**

Request a code review of `git diff term...term-5-study` (superpowers:requesting-code-review). Fix what holds up, commit on the branch.

- [ ] **Step 2: Show the owner**

Run the dev server and tell the owner what to look at (the "What the owner sees" paragraph above), and the choices to confirm: the tab is remembered after a reload; the leaderboard now loads when its tab opens rather than with the page; the idle phase reads "On shift · round 1 of 4" where the prototype says "Ready"; the clock's cards are 96px high as the spec says (the prototype's are 140px with 96px digits). Fix what they ask for, on the branch, with tests where behaviour changes.

- [ ] **Step 3: Merge and release — only on the owner's yes**

```bash
git switch term && git merge --no-ff term-5-study -m "Merge term-5-study: Stage 5, Study in four tabs"
git switch main && git merge --no-ff term -m "Merge term: Stage 5, Study in four tabs"
git push origin main term
```

No migration in this stage, so nothing to run on the remote database. The Cloudflare Git build deploys `main`. After it finishes, open the live site, open Study, switch through the four tabs and check the Timer tab's card and Today load.
