# Term Stage 4: The item card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The item sheet becomes the prototype's card: a large serif title, the type as buttons, a list of property rows with icons and borderless fields, a Week / Month date picker with busy dots, and Checklist, Notes and Links folded until wanted, keeping every behaviour of today's sheet.

**Architecture:** No database change, no change to what an edit does: `deriveEdit`, `typeInto`, `editNow`, drafts and `celebrate` in `src/data/item-edit.ts` stay as they are; only the drawing changes. One new component, `src/components/sheet/date-picker.tsx`, with two small pure helpers (`weekOf`, `monthDays`) and its own tests. New pieces in `fields.tsx` for the card (`QUIET`, `Props`, `Prop`, `Chips`, `AddButton`) and the row icons in `prop-icons.tsx`. The sheet frame is 460px with a 16px radius for items only; the other sheets keep 420px until their stages.

**Tech Stack:** Vite, React 19, TypeScript, Tailwind 4, Vitest (jsdom + Workers pool).

**Spec:** `docs/superpowers/specs/2026-09-29-term-redesign-design.md` §7. **Prototype:** `design/term-prototype.dc.html` (read, don't open): the card's markup lines 850–1016, its script lines 2262–2343 (`nw.*`, `nw.cal.*`).

**Branch:** `term-4-item-card` off `term` (already fast-forwarded to `main`, dfb7071):
`git switch term && git switch -c term-4-item-card`.

**What the owner sees at the end:** Pressing + or an item opens a 460px card. "New assignment · in 3 days · ✕" at the top; "What is it called?" in large serif; "Anatomy meets Wed 09:00 · Hall B  [Edit course]" when a course is picked. A row of type buttons (Assignment, Exam, Quiz, Lab, Tutorial, Project, Task, and the person's own types), the chosen one tinted in its colour. Then rows with an icon: Course (with its colour square), Date, Time, Room, Status, Repeat (labs, tutorials, office hours), Weight (exams, quizzes, assignments), Grade once graded, Studied when studied, Dept for office hours. Date reads "Wed 23 Sep · today" with Today and a Week | Month switch; Week shows Mon–Sun as seven buttons with ‹ ›; Month shows "September 2026" with ‹ › and a grid; picking a day there goes back to Week. Today is ringed; days with another open item have a dot. Under the rows: "+ Checklist" (or "+ Topics"), "+ Notes", "+ Links", each opening its part; an item that already has steps, notes or links shows them open. The foot is unchanged in words.

**Not in this stage:** the other sheets' new look (course, settings, sessions: later); the phone design pass (the card must still work at phone width with today's phone frame); weekly items skipping breaks (still open from Stage 3).

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build` (CSP checks). `npm run check` runs all three. One file: `npx vitest run src/components/sheet/date-picker.test.tsx`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787. First run `Get-NetTCPConnection -LocalPort 8787 -State Listen` in PowerShell and stop any leftover `vite.js` on it. Don't run `npm run build` while it runs. Blank page titled "Rounds": unregister the old service worker (DevTools → Application). Local user: `termqa` / `termqa-local-1`.
3. **Line endings and encoding:** keep every file LF and UTF-8. Characters like `·`, `‹`, `›`, `–` must be UTF-8: after writing a file, `file <path>` should not say "ISO-8859"; if Vite then serves a stale copy, touch the file.
4. **Commits:** end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only on `term-4-item-card`. Never push or merge to `main` without the owner's yes (Task 8 asks). This stage touches no database.
5. **Tests find text.** When a task changes a word or a role, `rg -n "<old word>" src test` and update the tests in the same commit.
6. **Dates** are `YYYY-MM-DD` strings. Helpers in `src/core/dates.ts`: `iso`, `parse`, `addDays`, `monday`, `shortDate("2026-09-23")` = `"Wed 23 Sep"`, `MON`, `DOW`, `today()`.
7. **Colours** go through `style` with `accent(color)` from `src/components/views/bits.tsx` (sets `--c`), never a `style={{ color }}` string in a class.
8. **Buttons that press** use `aria-pressed` inside a `role="group"` with an `aria-label` (as `Segmented` does), not `role="radio"`: the tests and the rest of the app use that.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/components/sheet/date-picker.tsx` | create | `weekOf`, `monthDays`, `pickedLabel`, `<DatePicker>` |
| `src/components/sheet/date-picker.test.tsx` | create | helper tests and the picker's behaviour |
| `src/data/item-edit.ts` | modify | `busyDays(items, exceptId)` for the dots |
| `src/data/item-edit.test.ts` | modify | `busyDays` test |
| `src/components/sheet/prop-icons.tsx` | create | the rows' 15px line icons |
| `src/components/sheet/fields.tsx` | modify | `QUIET`, `Props`, `Prop`, `Chips`, `AddButton`; `SheetBody` takes a `className` |
| `src/components/sheet/sheet.tsx` | modify | the item card's frame: 460px, 16px radius |
| `src/components/sheet/item-sheet.tsx` | modify (rewrite of `ItemSheet`) | the card |
| `src/components/sheet/sheet.test.tsx` | modify | the card's tests |

---

### Task 1: The date picker's helpers

**Files:**
- Create: `src/components/sheet/date-picker.tsx`
- Create: `src/components/sheet/date-picker.test.tsx`

- [ ] **Step 1: Write the failing tests**

`src/components/sheet/date-picker.test.tsx`:

```tsx
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { monthDays, pickedLabel, weekOf } from "./date-picker"

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })   /* Wed 23 Sep 2026 */
afterAll(() => { vi.useRealTimers() })
afterEach(() => cleanup())

describe("the date picker's days", () => {
    it("lays out a week Monday first", () => {
        expect(weekOf("2026-09-23")).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"])
        expect(weekOf("2026-09-27")[0]).toBe("2026-09-21")   /* a Sunday is the week's last day */
        expect(weekOf("2026-09-28")[0]).toBe("2026-09-28")
    })

    it("lays out a month in whole weeks, Monday first", () => {
        const sep = monthDays(2026, 8)   /* 1 Sep is a Tuesday, 30 Sep a Wednesday */
        expect(sep.length).toBe(35)
        expect(sep[0]).toBe("2026-08-31")
        expect(sep.at(-1)).toBe("2026-10-04")
        const feb = monthDays(2027, 1)   /* 1 Feb 2027 is a Monday, 28 Feb a Sunday */
        expect(feb.length).toBe(28)
        expect([feb[0], feb.at(-1)]).toEqual(["2027-02-01", "2027-02-28"])
        const oct = monthDays(2026, 9)   /* crosses the end of summer time */
        expect([oct[0], oct.at(-1), oct.length]).toEqual(["2026-09-28", "2026-11-01", 35])
    })

    it("names the chosen day, today and tomorrow said so", () => {
        expect(pickedLabel("2026-09-23")).toBe("Wed 23 Sep · today")
        expect(pickedLabel("2026-09-24")).toBe("Thu 24 Sep · tomorrow")
        expect(pickedLabel("2026-10-02")).toBe("Fri 2 Oct")
    })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/sheet/date-picker.test.tsx`
Expected: FAIL, cannot resolve `./date-picker`.

- [ ] **Step 3: Write the helpers**

`src/components/sheet/date-picker.tsx`:

```tsx
// The item card's date: the chosen day in words, Today, and a Week / Month switch. Week is
// the chosen day's week as seven buttons with ‹ › (the day a week back or on); Month is a
// calendar with ‹ October 2026 ›, and picking a day there goes back to Week. Today is
// ringed; a day that already has something due has a dot.

import { addDays, diffDays, iso, monday, parse, shortDate, today } from "@/core/dates"

/** The seven days, Monday first, of the week holding `date`. */
export const weekOf = (date: string): string[] => {
    const m = monday(parse(date))
    return Array.from({ length: 7 }, (_, i) => iso(addDays(m, i)))
}

/** A month (0–11) as whole weeks, Monday first: days of the months around it fill the first and last rows. */
export function monthDays(year: number, month: number): string[] {
    const first = iso(monday(new Date(year, month, 1)))
    const n = diffDays(first, iso(new Date(year, month + 1, 0))) + 1
    return Array.from({ length: Math.ceil(n / 7) * 7 }, (_, i) => iso(addDays(parse(first), i)))
}

/** "Wed 23 Sep · today", "Thu 24 Sep · tomorrow", "Fri 2 Oct". */
export function pickedLabel(date: string, now = today()): string {
    const d = diffDays(now, date)
    return shortDate(date) + (d === 0 ? " · today" : d === 1 ? " · tomorrow" : "")
}
```

(`diffDays` rounds, so the hour lost or gained when summer time ends doesn't shorten a month.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/sheet/date-picker.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/date-picker.tsx src/components/sheet/date-picker.test.tsx
git commit -m "The date picker's days: a week and a month Monday first, and the chosen day in words"
```

---

### Task 2: The date picker

**Files:**
- Modify: `src/components/sheet/date-picker.tsx`
- Modify: `src/components/sheet/date-picker.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `date-picker.test.tsx`, change the testing-library import to `import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"`, add `import { useState } from "react"`, change the `./date-picker` import to `import { DatePicker, monthDays, pickedLabel, weekOf } from "./date-picker"`, and append:

```tsx
/* the picker as the card holds it: the date in state, every pick reported */
const picks: string[] = []
function Held({ start = "2026-09-23", busy = [] as string[] }) {
    const [date, setDate] = useState(start)
    return <DatePicker value={date} busy={new Set(busy)} onChange={(d) => { picks.push(d); setDate(d) }} />
}
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed")

describe("the date picker", () => {
    afterEach(() => { picks.length = 0 })

    it("shows the chosen week and picks a day in it", () => {
        render(<Held />)
        expect(screen.getByText("Wed 23 Sep · today")).toBeTruthy()
        const days = within(screen.getByRole("group", { name: "Days" })).getAllByRole("button")
        expect(days.map((b) => b.getAttribute("aria-label"))).toEqual(["Mon 21 Sep", "Tue 22 Sep", "Wed 23 Sep", "Thu 24 Sep", "Fri 25 Sep", "Sat 26 Sep", "Sun 27 Sep"])
        expect(pressed("Wed 23 Sep")).toBe("true")
        fireEvent.click(screen.getByRole("button", { name: "Fri 25 Sep" }))
        expect(picks).toEqual(["2026-09-25"])
        expect(pressed("Fri 25 Sep")).toBe("true")
        expect(screen.getByText("Fri 25 Sep")).toBeTruthy()
    })

    it("moves the day a week back or on with ‹ ›", () => {
        render(<Held />)
        fireEvent.click(screen.getByRole("button", { name: "Next week" }))
        expect(picks).toEqual(["2026-09-30"])
        expect(screen.getByRole("button", { name: "Mon 28 Sep" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
        fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
        expect(picks.at(-1)).toBe("2026-09-16")
    })

    it("opens the month, moves through months, and goes back to Week on a pick", () => {
        render(<Held start="2026-10-02" />)
        const show = screen.getByRole("group", { name: "Show" })
        fireEvent.click(within(show).getByRole("button", { name: "Month" }))
        expect(screen.getByText("October 2026")).toBeTruthy()
        expect(screen.queryByRole("group", { name: "Days" })).toBeNull()
        const grid = screen.getByRole("group", { name: "October 2026" })
        expect(within(grid).getAllByRole("button").length).toBe(35)
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(screen.getByText("November 2026")).toBeTruthy()
        expect(picks).toEqual([])   /* moving the month picks nothing */
        fireEvent.click(screen.getByRole("button", { name: "Tue 10 Nov" }))
        expect(picks).toEqual(["2026-11-10"])
        expect(within(show).getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true")
        expect(screen.getByRole("group", { name: "Days" })).toBeTruthy()
    })

    it("goes to today with Today, and rings today", () => {
        render(<Held start="2026-11-10" />)
        expect(screen.queryByRole("button", { name: "Wed 23 Sep" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Today" }))
        expect(picks).toEqual(["2026-09-23"])
        expect(screen.getByRole("button", { name: "Wed 23 Sep" }).getAttribute("aria-current")).toBe("date")
        expect(screen.getByRole("button", { name: "Thu 24 Sep" }).getAttribute("aria-current")).toBeNull()
    })

    it("marks the days that already have something due", () => {
        render(<Held busy={["2026-09-25", "2026-10-14"]} />)
        expect(screen.getByRole("button", { name: "Fri 25 Sep, something due" })).toBeTruthy()
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        expect(screen.getByRole("button", { name: "Fri 25 Sep, something due" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(screen.getByRole("button", { name: "Wed 14 Oct, something due" })).toBeTruthy()
    })
})
```

(`act` is imported for later tasks' habits; drop it if the linter complains it is unused.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/date-picker.test.tsx`
Expected: FAIL, `DatePicker` is not exported.

- [ ] **Step 3: Write the component**

Append to `date-picker.tsx`, and extend its imports to:

```tsx
import { useState } from "react"
import { cn } from "@/lib/utils"
import { addDays, diffDays, iso, MON, monday, parse, shortDate, today } from "@/core/dates"
import { Segmented } from "./fields"
```

```tsx
const MODES = [["week", "Week"], ["month", "Month"]] as const
const HEADS = ["M", "T", "W", "T", "F", "S", "S"]

const Chevron = ({ back }: { back?: boolean }) => (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={back ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} />
    </svg>
)
const ARROW = "grid cursor-pointer place-items-center rounded-lg border-0 bg-transparent p-0 text-ink-2 hover:bg-muted hover:text-foreground"

/** The day's name for a screen reader: "Fri 25 Sep", ", something due" when it has a dot. */
const dayName = (d: string, busy: ReadonlySet<string>) => shortDate(d) + (busy.has(d) ? ", something due" : "")

export function DatePicker({ value, onChange, busy }: { value: string; onChange: (date: string) => void; busy: ReadonlySet<string> }) {
    const [mode, setMode] = useState<"week" | "month">("week")
    /* the month shown: the chosen day's when Month opens, then wherever ‹ › take it */
    const [shown, setShown] = useState(() => { const d = parse(value); return [d.getFullYear(), d.getMonth()] as const })
    const now = today()
    const pick = (d: string) => { if (d !== value) onChange(d); setMode("week") }
    const openMode = (m: "week" | "month") => {
        if (m === "month") { const d = parse(value); setShown([d.getFullYear(), d.getMonth()]) }
        setMode(m)
    }
    const moveMonth = (by: number) => { const d = new Date(shown[0], shown[1] + by, 1); setShown([d.getFullYear(), d.getMonth()]) }
    const title = MON[shown[1]] + " " + shown[0]

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex h-8 items-center gap-1">
                <span className="flex-1 text-[14px] font-semibold">{pickedLabel(value, now)}</span>
                <button type="button" onClick={() => pick(now)} className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2.5 font-[inherit] text-[12px] text-ink-2 hover:bg-muted hover:text-foreground">Today</button>
                <Segmented label="Show" value={mode} options={MODES} onChange={openMode} />
            </div>

            {mode === "week" ? (
                <div className="grid grid-cols-[26px_repeat(7,minmax(0,1fr))_26px] items-center gap-1">
                    <button type="button" aria-label="Previous week" onClick={() => onChange(iso(addDays(parse(value), -7)))} className={cn(ARROW, "h-[46px] w-[26px]")}><Chevron back /></button>
                    <div role="group" aria-label="Days" className="col-span-7 grid grid-cols-7 gap-1">
                        {weekOf(value).map((d) => {
                            const on = d === value
                            return (
                                <button key={d} type="button" aria-pressed={on} aria-label={dayName(d, busy)} aria-current={d === now ? "date" : undefined}
                                    onClick={() => pick(d)}
                                    className={cn(
                                        "relative flex h-[46px] cursor-pointer flex-col items-center justify-center gap-px rounded-lg border p-0 font-[inherit]",
                                        on ? "border-foreground bg-foreground text-background"
                                            : d === now ? "border-[var(--accent)] bg-[var(--accent-soft)] text-foreground"
                                            : "border-border bg-card text-foreground hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))]",
                                    )}>
                                    <span className="text-[10.5px] opacity-80">{d === now ? "Today" : shortDate(d).slice(0, 3)}</span>
                                    <span className="text-[15px] font-semibold tabular-nums">{parse(d).getDate()}</span>
                                    {busy.has(d) && !on && <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-[var(--accent)]" />}
                                </button>
                            )
                        })}
                    </div>
                    <button type="button" aria-label="Next week" onClick={() => onChange(iso(addDays(parse(value), 7)))} className={cn(ARROW, "h-[46px] w-[26px]")}><Chevron /></button>
                </div>
            ) : (
                <div className="flex flex-col gap-1 rounded-[10px] border border-line-2 bg-[var(--panel-2)] p-2.5">
                    <div className="flex items-center justify-between">
                        <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className={cn(ARROW, "size-[30px] rounded-full")}><Chevron back /></button>
                        <span aria-live="polite" className="text-[13px] font-semibold">{title}</span>
                        <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className={cn(ARROW, "size-[30px] rounded-full")}><Chevron /></button>
                    </div>
                    <div aria-hidden="true" className="grid grid-cols-7 gap-0.5">
                        {HEADS.map((h, i) => <span key={i} className="grid h-[22px] place-items-center text-[11px] text-muted-foreground">{h}</span>)}
                    </div>
                    <div role="group" aria-label={title} className="grid grid-cols-7 gap-0.5">
                        {monthDays(shown[0], shown[1]).map((d) => {
                            const on = d === value, inMonth = parse(d).getMonth() === shown[1]
                            return (
                                <button key={d} type="button" aria-pressed={on} aria-label={dayName(d, busy)} aria-current={d === now ? "date" : undefined}
                                    onClick={() => pick(d)}
                                    className={cn(
                                        "relative h-8 cursor-pointer rounded-full border-0 p-0 font-[inherit] text-[12.5px] tabular-nums",
                                        on ? "bg-foreground font-semibold text-background"
                                            : cn("bg-transparent hover:bg-muted", inMonth ? "text-foreground" : "text-muted-foreground",
                                                d === now && "font-semibold shadow-[inset_0_0_0_1.5px_var(--accent)]"),
                                    )}>
                                    {parse(d).getDate()}
                                    {busy.has(d) && !on && <span aria-hidden="true" className="absolute bottom-[3px] left-1/2 -ml-0.5 size-1 rounded-full bg-[var(--accent)]" />}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
```

Notes for the implementer: `Segmented` calls `onChange` only when the pressed value changes, so Week → Week does nothing. The "Today" in the week strip is the visible text only; the button's name stays "Wed 23 Sep" (the `aria-label`), which is what the tests look up. `--accent-soft`, `--panel-2`, `--line-2` exist in `src/styles/tokens.css` for every theme.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/sheet/date-picker.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/components/sheet/date-picker.tsx src/components/sheet/date-picker.test.tsx
git commit -m "The date picker: the chosen week as seven days with a week back and on, a month calendar, Today, busy dots"
```

---

### Task 3: The busy days

**Files:**
- Modify: `src/data/item-edit.ts`
- Modify: `src/data/item-edit.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/data/item-edit.test.ts`, add `busyDays` to the import from `"./item-edit"`, and append:

```ts
describe("the date picker's dots", () => {
    it("are the days other open items fall on", () => {
        const items = [
            item({ id: "a", date: "2026-09-25" }),
            item({ id: "b", date: "2026-09-26", status: "submitted" }),   /* finished: no dot */
            item({ id: "c", date: "2026-09-27", status: "missed" }),      /* closed: no dot */
            item({ id: "i1", date: "2026-09-28" }),                       /* the item itself */
            item({ id: "d", date: "2026-09-25" }),
        ]
        expect([...busyDays(items, "i1")]).toEqual(["2026-09-25"])
    })
})
```

(Check in `src/core/model.ts` that `isOpen` is false for `submitted` and `missed` on an assignment: `CLOSED` lists them. If `submitted` counts as open there, change that line's expectation and comment to match `isOpen`, not the other way round.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/data/item-edit.test.ts`
Expected: FAIL, `busyDays` is not a function.

- [ ] **Step 3: Write it**

In `src/data/item-edit.ts`, add `isOpen` to the import from `"@/core/model"`, and add after `countdown`:

```ts
/** The days other open items fall on: the date picker's dots. */
export const busyDays = (items: Item[], except: string): Set<string> =>
    new Set(items.filter((x) => x.id !== except && isOpen(x)).map((x) => x.date))
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/data/item-edit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/item-edit.ts src/data/item-edit.test.ts
git commit -m "The days other open items fall on, for the date picker's dots"
```

---

### Task 4: The card's parts: rows, icons, type buttons, folded extras

**Files:**
- Create: `src/components/sheet/prop-icons.tsx`
- Modify: `src/components/sheet/fields.tsx`
- Modify: `src/components/sheet/sheet.tsx`

These are drawn pieces with no behaviour of their own; Task 5's tests cover them through the card.

- [ ] **Step 1: The icons**

`src/components/sheet/prop-icons.tsx` (paths from the prototype's rows; grade, studied and dept are new):

```tsx
// The item card's row icons: 15px line drawings in the label's colour.

import type { ReactNode } from "react"

const Icon = ({ children }: { children: ReactNode }) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)

export const ICONS = {
    course: <Icon><path d="M4 19V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h14" /></Icon>,
    date: <Icon><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></Icon>,
    time: <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>,
    room: <Icon><path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></Icon>,
    status: <Icon><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></Icon>,
    repeat: <Icon><path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" /></Icon>,
    weight: <Icon><path d="M5 19 19 5M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /></Icon>,
    grade: <Icon><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></Icon>,
    studied: <Icon><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" /></Icon>,
    dept: <Icon><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18" /></Icon>,
}
```

- [ ] **Step 2: The parts in `fields.tsx`**

Change `SheetBody` to take a class:

```tsx
export const SheetBody = ({ className, children }: { className?: string; children: ReactNode }) => (
    <div className={cn("flex flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pt-4 pb-[26px]", className)}>{children}</div>
)
```

After `CONTROL`, add:

```tsx
/** A control with no well until hovered or focused: the item card's rows. Put it after CONTROL in cn(). */
export const QUIET = "bg-transparent hover:bg-muted focus-visible:bg-card"
```

After `Fields`/`Label`, add:

```tsx
/** The item card's property list, a line between rows. */
export const Props = ({ children }: { children: ReactNode }) => (
    <div className="flex flex-col border-t border-line-2 text-[13px]">{children}</div>
)

/** One property: an icon and its name on the left, the control on the right. `top` lines the
    name up with the first line of a tall control (Date, Repeat). */
export function Prop({ icon, label, htmlFor, top = false, children }: { icon: ReactNode; label: string; htmlFor?: string; top?: boolean; children: ReactNode }) {
    const name = cn("flex items-center gap-2 text-[13px] text-muted-foreground", top && "h-8")
    return (
        <div className={cn("grid min-h-12 grid-cols-[104px_minmax(0,1fr)] gap-x-2 border-b border-line-2", top ? "items-start py-2.5" : "items-center py-1.5")}>
            {htmlFor ? <label htmlFor={htmlFor} className={name}>{icon}{label}</label> : <span className={name}>{icon}{label}</span>}
            <div className="min-w-0">{children}</div>
        </div>
    )
}

/** Buttons in a row, one pressed, each with its colour: the item's type. */
export function Chips({ label, value, options, onChange }: {
    label: string; value: string; options: readonly { id: string; label: string; color: string }[]; onChange: (id: string) => void
}) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map((o) => (
                <button
                    key={o.id}
                    type="button"
                    style={accent(o.color)}
                    aria-pressed={o.id === value}
                    onClick={() => { if (o.id !== value) onChange(o.id) }}
                    className={cn(
                        "flex h-8 cursor-pointer items-center gap-[7px] rounded-full border border-border bg-card px-3 font-[inherit] text-[12.5px] text-foreground transition-colors hover:border-[var(--c)]",
                        o.id === value && "border-[var(--c)] bg-[color-mix(in_srgb,var(--c)_10%,var(--panel))] font-semibold",
                    )}
                >
                    <span aria-hidden="true" className="size-[7px] rounded-[2px] bg-[var(--c)]" />{o.label}
                </button>
            ))}
        </div>
    )
}

/** A dashed "+ Notes" that opens a folded part. Give it an aria-label that starts "Add". */
export const AddButton = ({ className, children, ...props }: ComponentProps<"button">) => (
    <button
        type="button"
        {...props}
        className={cn("flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[var(--box-line)] bg-transparent px-3 font-[inherit] text-[12.5px] text-ink-2 hover:border-[var(--accent)] hover:text-foreground", className)}
    >
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
        {children}
    </button>
)
```

Update the file's top comment's last sentence to: "The item card adds its rows (Props, Prop), its type buttons (Chips) and the folded parts' buttons (AddButton)."

- [ ] **Step 3: The card's frame**

In `src/components/sheet/sheet.tsx`, inside `Sheet()` before `return`:

```tsx
    /* the item card is wider, with a smaller radius (spec §7); the other sheets keep theirs */
    const card = shown?.kind === "item" || shown?.kind === "new-item"
```

and in the dialog's `className` replace

`"fixed top-2.5 right-2.5 bottom-2.5 z-50 flex w-[420px] max-w-[calc(100%-20px)] flex-col overflow-hidden rounded-[20px] border border-border outline-none",`

with

```tsx
                "fixed top-2.5 right-2.5 bottom-2.5 z-50 flex max-w-[calc(100%-20px)] flex-col overflow-hidden border border-border outline-none",
                card ? "w-[460px] rounded-2xl" : "w-[420px] rounded-[20px]",
```

and the phone line's `max-[700px]:w-[min(420px,calc(100%-12px))]` with `max-[700px]:w-[min(460px,calc(100%-12px))]` (a phone is narrower than either, so this only matters on a 430–470px screen).

- [ ] **Step 4: Check and commit**

Run: `npm run typecheck && npx vitest run src/components/sheet`
Expected: no type errors; the sheet tests still pass (nothing uses the new parts yet).

```bash
git add src/components/sheet/prop-icons.tsx src/components/sheet/fields.tsx src/components/sheet/sheet.tsx
git commit -m "The item card's parts: property rows with icons, quiet fields, type buttons, + buttons, the wider frame"
```

---

### Task 5: The card: title, type buttons and the property rows

**Files:**
- Modify: `src/components/sheet/item-sheet.tsx` (the `ItemSheet` function and the imports; `Checklist` and `Links` wait for Task 6)
- Modify: `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/components/sheet/sheet.test.tsx`, inside `describe("the item sheet", …)`, add:

```tsx
    it("picks the type with a button, the person's own types too", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const type = screen.getByRole("group", { name: "Type" })
        for (const name of ["Assignment", "Exam", "Quiz", "Lab", "Tutorial", "Project", "Task"]) expect(within(type).getByRole("button", { name })).toBeTruthy()
        expect(within(type).getByRole("button", { name: "Assignment" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(within(type).getByRole("button", { name: "Exam" })))
        expect(fake.data.items[0]).toMatchObject({ type: "exam" })
        expect(within(screen.getByRole("group", { name: "Type" })).getByRole("button", { name: "Exam" }).getAttribute("aria-pressed")).toBe("true")
    })

    it("picks the date in the week strip, and in the month", async () => {
        show()
        open({ kind: "item", id: "i1" })   /* due Wed 23 Sep, today */
        expect(screen.getByText("Wed 23 Sep · today")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fri 25 Sep" })))
        expect(fake.data.items[0]).toMatchObject({ date: "2026-09-25" })
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fri 2 Oct" })))
        expect(fake.data.items[0]).toMatchObject({ date: "2026-10-02" })
        expect(screen.getByRole("group", { name: "Days" })).toBeTruthy()
    })

    it("dots the days other open items fall on", () => {
        fake.data.items = [...fake.data.items, item({ id: "i2", title: "Quiz 3", date: "2026-09-24" })]
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.getByRole("button", { name: "Thu 24 Sep, something due" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Wed 23 Sep" })).toBeTruthy()   /* its own day: no dot */
    })

    it("says when the course meets, and opens the course", () => {
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.getByText(/Anatomy meets Wed 09:00 · Hall B/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Edit course" }))
        expect(actions.openCourse).toHaveBeenCalledWith("anat")
    })

    it("keeps every row: course, time, room, status, weight, grade once graded", async () => {
        show()
        open({ kind: "item", id: "i1" })
        expect((screen.getByRole("combobox", { name: "Course" }) as HTMLSelectElement).value).toBe("anat")
        expect(screen.getByRole("textbox", { name: "Start time" })).toBeTruthy()
        expect(screen.getByRole("textbox", { name: "Room" })).toBeTruthy()
        await act(async () => fireEvent.change(screen.getByRole("spinbutton", { name: "Weight" }), { target: { value: "15" } }))
        expect(fake.data.items[0]).toMatchObject({ weight: 15 })
        expect(screen.queryByRole("spinbutton", { name: "Grade" })).toBeNull()
        await act(async () => fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Graded" })))
        expect(screen.getByRole("spinbutton", { name: "Grade" })).toBeTruthy()
    })
```

Before writing these, check two facts and adjust the test (not the code) if they differ: the assignment's statuses in `statusesFor("assignment")` (`src/core/model.ts`) include one labelled "Graded"; `deriveEdit` turns the weight text "15" into the number `15` (see the `weight` branch in `src/data/item-edit.ts`).

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/sheet.test.tsx`
Expected: the five new tests FAIL (no "Type" group, no "Days" group, the meets line says "ANAT meets"); the old ones pass.

- [ ] **Step 3: Rewrite `ItemSheet`**

In `src/components/sheet/item-sheet.tsx`:

Imports — replace the `item-edit`, `fields` and `time-field` imports and add the new ones:

```tsx
import { busyDays, celebrate, chainReview, countdown, deriveEdit, editNow, flush, linkUrl, REPEAT_CHOICES, REPEATS, typeInto, untilLabel, useItemView, type ItemField } from "@/data/item-edit"
import { accent, StatusChip } from "@/components/views/bits"
import {
    AddButton, Button, Chips, DateInput, IconButton, Meter, Note, NumberInput, Prop, Props, QUIET, RemoveButton, Section, Segmented, Select,
    SheetBody, SheetFoot, SheetHead, TextArea, TextInput, TitleArea, CONTROL,
} from "./fields"
import { TimeField } from "./time-field"
import { DatePicker } from "./date-picker"
import { ICONS } from "./prop-icons"
```

(`TypeChip` and `Fields`/`Label` are no longer used here; remove them from the imports. `AddButton` is used in Task 6; if the linter flags it now, add it in Task 6 instead.)

Replace the file's top comment with:

```tsx
// An item in the card: its title, the type as buttons, the property rows (course, date,
// time, room, status, repeat, weight…), then the checklist (topics for an exam), notes and
// links, folded until wanted. A stored item saves as it is edited (text once typing
// pauses); a new one is a draft until Save. The rules for what an edit brings along are in
// data/item-edit.ts.
```

In the body of `ItemSheet`, change `useItems()   /* the type list counts items; topics read them */` to

```tsx
    const items = useItems()   /* the type list counts items; topics and the date's dots read them */
```

and replace everything from `return (` down to the closing `</SheetBody>` (lines 87–200 today) with the following. The foot (`{isNew ? (<SheetFoot …` to the end of the function) stays as it is until Task 7.

```tsx
    const busy = busyDays(items, it.id)
    const gradable = GRADABLE.includes(baseOf(it.type))

    return (
        <>
            <SheetHead color={m.color} kind={isNew ? "New " + m.label.toLowerCase() : m.label} onClose={closeSheet}>
                {!isNew && <StatusChip item={it} />}
                <span className="font-mono text-[11px] text-muted-foreground">{countdown(it)}</span>
                {prep && (
                    <span title="Topics done · topics a day to finish before the exam"
                        className={cn("rounded-full bg-[var(--chip-bg)] px-2 py-px font-mono text-[10.5px] font-semibold tabular-nums", prep.hot ? "text-destructive" : "text-[var(--chip-ink)]")}>
                        {prepLabel(prep)}
                    </span>
                )}
            </SheetHead>

            <SheetBody className="gap-[22px] px-6 pt-2 pb-7">
                <div className="flex flex-col gap-1.5">
                    <TitleArea
                        value={it.title}
                        maxLength={140}
                        aria-label="Title"
                        placeholder={isNew ? "What is it called?" : "Untitled item"}
                        autoFocus={isNew}
                        onChange={(e) => set("title", e.target.value)}
                        onBlur={() => void flush()}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (isNew) void save() } }}
                        className="font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"
                    />
                    {c && next && (
                        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
                            {c.name} meets {DOW[next.weekday]} {hhmm(next.start)} · {next.room || "room not set"}
                            <IconButton className="px-1.5 py-px text-[11px]" onClick={() => openCourse(c.id)}>Edit course</IconButton>
                        </div>
                    )}
                </div>

                <Chips label="Type" value={it.type} options={types} onChange={(v) => set("type", v)} />

                <Props>
                    <Prop icon={ICONS.course} label="Course" htmlFor={f + "course"}>
                        <span style={accent(c?.color)} className="flex items-center gap-2">
                            <span aria-hidden="true" className="size-[9px] flex-none rounded-[3px] bg-[var(--c,var(--line))]" />
                            <Select id={f + "course"} className={QUIET} value={it.courseId ?? ""} onChange={(e) => set("courseId", e.target.value)}>
                                <option value="">No course</option>
                                {courses.filter((x) => !x.archived || x.id === it.courseId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </Select>
                        </span>
                    </Prop>

                    <Prop icon={ICONS.date} label="Date" top>
                        <DatePicker value={it.date} busy={busy} onChange={(d) => set("date", d)} />
                    </Prop>

                    <Prop icon={ICONS.time} label="Time" htmlFor={f + "start"}>
                        <span className="flex items-center gap-1.5">
                            <TimeField id={f + "start"} label="Start time" className={QUIET} value={it.start} onChange={(v) => set("start", v)} />
                            <span className="text-[12px] text-muted-foreground">to</span>
                            <TimeField label="End time" className={QUIET} value={it.end} onChange={(v) => set("end", v)} />
                        </span>
                    </Prop>

                    <Prop icon={ICONS.room} label="Room" htmlFor={f + "where"}>
                        <TextInput id={f + "where"} className={QUIET} value={it.where} maxLength={80} placeholder="Add a room or place" onChange={(e) => set("where", e.target.value)} onBlur={() => void flush()} />
                    </Prop>

                    <Prop icon={ICONS.status} label="Status">
                        <span className="flex"><Segmented label="Status" value={it.status} options={statuses} onChange={(v, el) => set("status", v, el)} /></span>
                    </Prop>

                    {REPEATS.includes(it.type) && (
                        <Prop icon={ICONS.repeat} label="Repeat" top>
                            <div className="flex flex-col items-start gap-2">
                                <Segmented label="Repeat" value={it.recur === "weekly" ? "weekly" : "once"} options={REPEAT_CHOICES} onChange={(v) => set("recur", v === "weekly")} />
                                {it.recur === "weekly" && (
                                    <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
                                        <label htmlFor={f + "until"}>Until</label>
                                        {ends.length
                                            ? <Select id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)}>
                                                {ends.map((x) => <option key={x.end} value={x.end}>{untilLabel(x)}</option>)}
                                                {it.recurUntil && !ends.some((x) => x.end === it.recurUntil) && <option value={it.recurUntil}>{shortDate(it.recurUntil)}</option>}
                                                <option value="">no end</option>
                                            </Select>
                                            : <DateInput id={f + "until"} className={cn(QUIET, "w-auto")} value={it.recurUntil ?? ""} onChange={(e) => set("recurUntil", e.target.value)} />}
                                    </span>
                                )}
                            </div>
                        </Prop>
                    )}

                    {it.type === "office" && (
                        <Prop icon={ICONS.dept} label="Dept" htmlFor={f + "dept"}>
                            <TextInput id={f + "dept"} className={QUIET} value={it.dept} maxLength={40} placeholder="Cardiology" onChange={(e) => set("dept", e.target.value)} onBlur={() => void flush()} />
                        </Prop>
                    )}

                    {gradable && (
                        <Prop icon={ICONS.weight} label="Weight" htmlFor={f + "weight"}>
                            <span className="flex items-center gap-1">
                                <NumberInput id={f + "weight"} className={cn(QUIET, "w-16")} min={0} max={100} step="any" placeholder="—" value={it.weight ?? ""} onChange={(e) => set("weight", e.target.value)} />
                                <span className="text-muted-foreground">% of the course grade</span>
                            </span>
                        </Prop>
                    )}

                    {it.status === "graded" && (
                        <Prop icon={ICONS.grade} label="Grade" htmlFor={f + "grade"}>
                            <span className="flex items-center gap-1">
                                <NumberInput id={f + "grade"} className={cn(QUIET, "w-16")} min={0} max={100} placeholder="—" value={it.grade ?? ""} onChange={(e) => set("grade", e.target.value)} />
                                <span className="text-muted-foreground">%</span>
                            </span>
                        </Prop>
                    )}

                    {studied > 0 && (
                        <Prop icon={ICONS.studied} label="Studied">
                            <span className="font-mono text-[12.5px] text-ink-2">{duration(studied)}</span>
                        </Prop>
                    )}
                </Props>

                <Section title="Notes">
                    <TextArea aria-label="Notes" value={it.notes} maxLength={5000} placeholder="What to revise, what the lecturer said, page numbers."
                        onChange={(e) => set("notes", e.target.value)} onBlur={() => void flush()} />
                </Section>

                <Checklist
                    item={it}
                    /* a step typed waits for the pause like other text; a tick, an add or a remove saves at once */
                    onChange={(list, typing) => { if (typing || isNew) set("checklist", list); else void editNow(it.id, { checklist: list }) }}
                    fill={!isNew && isTest(it.type) && lectures ? () => {
                        const r = fillTopics(it, c, store.data.items, termStart(), schoolCal())
                        if (r.added) void editNow(it.id, { checklist: r.checklist })
                        setFillNote(r.added
                            ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the 50-step limit." : "")
                            : r.left ? "The list is full: 50 steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
                    } : null}
                    fillNote={fillNote}
                />

                <Links item={it} onChange={(links) => set("links", links)} />
            </SheetBody>
```

`types` already exists above the return (`typeList(bg, store.data.items).filter(…)`); it is an `ItemType[]`, which has `id`, `label` and `color`, so `Chips` takes it as is. Remove its now-pointless `(t: { id: string; label: string })` annotations if TypeScript asks for none.

Notes for the implementer:
- The Weight and Grade inputs get their names from their `<label htmlFor>` in `Prop`: "Weight" and "Grade". The Notes textarea keeps `aria-label="Notes"`.
- The time field's own width (`w-[72px]`) wins over nothing in `QUIET`, so the time boxes stay 72px.
- `Segmented` stretches its buttons (`flex-1`); wrapping it in `<span className="flex">` keeps the status row to its content's width, as in the prototype.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/sheet/sheet.test.tsx`
Expected: all pass, the new five included. If "Repeat" tests fail on the `Until` combobox's name, check it is the `<label htmlFor>` (an `aria-label` on a `<label>` wrapping the select would add the chosen option's words to the name).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/components/sheet/item-sheet.tsx src/components/sheet/sheet.test.tsx
git commit -m "The item card: a serif title, the type as buttons, and the properties as rows with the week and month date picker"
```

---

### Task 6: Checklist, Notes and Links folded until wanted

**Files:**
- Modify: `src/components/sheet/item-sheet.tsx`
- Modify: `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: Write the failing tests and fix the one that types notes**

In `sheet.test.tsx`, in `"saves the title once typing pauses, and at once on close"`, insert before the line that changes the `Notes` textbox:

```tsx
        fireEvent.click(screen.getByRole("button", { name: "Add notes" }))
```

Add to `describe("the item sheet", …)`:

```tsx
    it("folds the checklist, notes and links until wanted, and opens what the item has", () => {
        fake.data.items = [item({ id: "e1", type: "exam", title: "Midterm" })]
        show()
        open({ kind: "item", id: "e1" })
        expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull()
        expect(screen.queryByRole("textbox", { name: "Add a step" })).toBeNull()
        expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull()

        fireEvent.click(screen.getByRole("button", { name: "Add topics" }))   /* an exam's checklist is its topics */
        expect(screen.getByRole("textbox", { name: "Add a step" })).toBe(document.activeElement)
        expect(screen.queryByRole("button", { name: "Add topics" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Add notes" }))
        expect(screen.getByRole("textbox", { name: "Notes" })).toBe(document.activeElement)
        fireEvent.click(screen.getByRole("button", { name: "Add links" }))
        expect(screen.getByRole("textbox", { name: "Link label" })).toBe(document.activeElement)
    })

    it("shows an item's steps, notes and links open, and keeps notes open when emptied", async () => {
        fake.data.items = [item({ id: "i3", title: "Essay", notes: "p. 12", checklist: [{ id: "s", text: "Outline", done: false }], links: [{ label: "Brief", url: "https://x.org" }] })]
        show()
        open({ kind: "item", id: "i3" })
        expect(screen.queryByRole("button", { name: "Add a checklist" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Add notes" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Add links" })).toBeNull()
        const notes = screen.getByRole("textbox", { name: "Notes" })
        fireEvent.change(notes, { target: { value: "" } })
        await act(() => vi.advanceTimersByTimeAsync(TYPING_MS))
        expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy()
    })

    it("fills an exam's topics from the lectures once Topics is open", () => {
        fake.data.items = [item({ id: "e2", type: "exam", title: "Final", courseId: "anat", date: "2026-10-14" })]
        show()
        open({ kind: "item", id: "e2" })
        expect(screen.queryByRole("button", { name: "Fill topics from lectures" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Add topics" }))
        expect(screen.getByRole("button", { name: "Fill topics from lectures" })).toBeTruthy()
    })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/components/sheet/sheet.test.tsx`
Expected: the three new tests and the edited title test FAIL (no "Add notes" button; Notes always shown).

- [ ] **Step 3: Fold them**

In `ItemSheet`, after `const f = useId()` (before the effects and the `if (!it) return null`, since it is a hook):

```tsx
    /* Checklist, Notes and Links start folded; one the item has opens by itself and stays
       open while the card is, even emptied. `focus` is the part a + just opened. */
    const [unfolded, setUnfolded] = useState(() => ({
        steps: !!it?.checklist?.length, notes: !!it?.notes, links: !!it?.links?.length,
    }))
    const [focus, setFocus] = useState<"steps" | "notes" | "links" | null>(null)
```

After `const gradable = …` (added in Task 5):

```tsx
    const show = {
        steps: unfolded.steps || (it.checklist || []).length > 0,
        notes: unfolded.notes || !!it.notes,
        links: unfolded.links || (it.links || []).length > 0,
    }
    const unfold = (part: "steps" | "notes" | "links") => { setUnfolded((u) => ({ ...u, [part]: true })); setFocus(part) }
    const test = isTest(it.type)
```

Replace the `<Section title="Notes">…</Section>`, `<Checklist …/>` and `<Links …/>` in the body with (Checklist first, as in the prototype):

```tsx
                {show.steps && (
                    <Checklist
                        item={it}
                        autoFocus={focus === "steps"}
                        /* a step typed waits for the pause like other text; a tick, an add or a remove saves at once */
                        onChange={(list, typing) => { if (typing || isNew) set("checklist", list); else void editNow(it.id, { checklist: list }) }}
                        fill={!isNew && test && lectures ? () => {
                            const r = fillTopics(it, c, store.data.items, termStart(), schoolCal())
                            if (r.added) void editNow(it.id, { checklist: r.checklist })
                            setFillNote(r.added
                                ? "Added " + r.added + " lecture" + (r.added === 1 ? "" : "s") + "." + (r.left ? " " + r.left + " more did not fit under the 50-step limit." : "")
                                : r.left ? "The list is full: 50 steps is the most an item can hold." : "Every lecture before this " + m.label.toLowerCase() + " is already listed.")
                        } : null}
                        fillNote={fillNote}
                    />
                )}

                {show.notes && (
                    <Section title="Notes">
                        <TextArea aria-label="Notes" autoFocus={focus === "notes"} value={it.notes} maxLength={5000} placeholder="What to revise, what the lecturer said, page numbers."
                            onChange={(e) => set("notes", e.target.value)} onBlur={() => void flush()} />
                    </Section>
                )}

                {show.links && <Links item={it} autoFocus={focus === "links"} onChange={(links) => set("links", links)} />}

                {!(show.steps && show.notes && show.links) && (
                    <div className="flex flex-wrap gap-2">
                        {!show.steps && <AddButton aria-label={test ? "Add topics" : "Add a checklist"} onClick={() => unfold("steps")}>{test ? "Topics" : "Checklist"}</AddButton>}
                        {!show.notes && <AddButton aria-label="Add notes" onClick={() => unfold("notes")}>Notes</AddButton>}
                        {!show.links && <AddButton aria-label="Add links" onClick={() => unfold("links")}>Links</AddButton>}
                    </div>
                )}
```

In `Checklist`, add `autoFocus` to its props (`{ item, onChange, fill, fillNote, autoFocus = false }` and `autoFocus?: boolean` in the type) and put `autoFocus={autoFocus}` on the "Add a step" `<input>`. In `Links`, add the same prop and put `autoFocus={autoFocus}` on the "Link label" `<input>`.

Note: React's `autoFocus` focuses on mount only, which is when a + opens the part. The Sheet's own focus (`sheet.tsx`, a `requestAnimationFrame` that focuses the panel) only runs when the focus is outside the panel, so it doesn't steal it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/sheet/sheet.test.tsx`
Expected: all pass. The old "ticks, edits, adds and removes steps…" test still passes because `i1` has a step and links, so both open by themselves.

- [ ] **Step 5: Commit**

```bash
git add src/components/sheet/item-sheet.tsx src/components/sheet/sheet.test.tsx
git commit -m "The checklist, notes and links start folded behind + buttons, and open by themselves when the item has any"
```

---

### Task 7: The foot, then the card side by side with the prototype

**Files:**
- Modify: `src/components/sheet/item-sheet.tsx`
- Modify: `src/components/sheet/sheet.test.tsx`

- [ ] **Step 1: The test for the foot's words**

Add to `describe("the item sheet", …)`:

```tsx
    it("says in the foot what saving needs", () => {
        show()
        open({ kind: "new-item", draft: item({ id: "n2", title: "" }) })
        expect(screen.getByRole("status").textContent).toBe("Give it a name to save")
        fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Lab report" } })
        expect(screen.getByRole("status").textContent).toBe("Ready to save")
        act(() => closeSheet())
        open({ kind: "item", id: "i1" })
        expect(screen.getByRole("status").textContent).toBe("Edits save as you type")
    })
```

If `getByRole("status")` finds more than one (another live region in the page), scope it: `within(dialog()).getByRole("status")`.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/components/sheet/sheet.test.tsx -t "foot"`
Expected: PASS already (the words don't change). It guards Step 3.

- [ ] **Step 3: "Ready to save" in the done colour**

In `ItemSheet`'s foot, change `hint={it.title.trim() ? "Ready to save" : "Give it a name to save"}` to

```tsx
hint={it.title.trim() ? <span className="text-[var(--done-ink)]">Ready to save</span> : "Give it a name to save"}
```

Run: `npx vitest run src/components/sheet` — expected: all pass.

- [ ] **Step 4: Look at it**

Start the dev server (see "How to work", 2), sign in as `termqa`, and compare with the prototype's new-item board in the canvas (https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV). Check, at 1440px and at 390px wide, in the light theme and in one dark one:
- a new item from + and an existing exam, lab and office hour;
- the type buttons wrap without overflow; a person's own type shows with its colour;
- Week strip: seven equal days with ‹ ›; Month: ‹ October 2026 ›, the days around the month muted, today ringed, dots on busy days, picking returns to Week;
- the rows have no wells until hovered; focus rings show on Tab;
- + Checklist / + Notes / + Links open and focus their field; an item with notes opens with Notes shown;
- the card scrolls inside itself on a short window; the foot stays put.

Fix what's off in the same files (spacing and colours only; behaviour is covered by tests). Then run `npm run check`; expected: typecheck, all tests and the build pass.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/sheet
git commit -m "The item card's foot says Ready to save in the done colour; spacing checked against the prototype"
```

---

### Task 8: The owner's review and the release

- [ ] **Step 1: Final review**

Request a code review of `git diff term...term-4-item-card` (superpowers:requesting-code-review). Fix what holds up, commit on the branch.

- [ ] **Step 2: Show the owner**

Run the dev server and tell the owner what to look at (the "What the owner sees" paragraph above). Fix what they ask for, on the branch, with tests where behaviour changes.

- [ ] **Step 3: Merge and release — only on the owner's yes**

```bash
git switch term && git merge --no-ff term-4-item-card -m "Merge term-4-item-card: Stage 4, the item card"
git switch main && git merge --no-ff term -m "Merge term: Stage 4, the item card"
git push origin main term
```

No migration in this stage, so nothing to run on the remote database. The Cloudflare Git build deploys `main`. After it finishes, open the live site and open an item to check the card loads.
