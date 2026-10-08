# Collaboration Stage 9: Projects in the views — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This is **Stage 9** of the master plan `docs/superpowers/plans/2026-10-02-collaboration.md` (the "Stages 8–10" outline and the hand-offs Stage 8 recorded). It is written on 2026-10-07, **before Stages 5–8 are built**, against the code as it will be once they are merged: Stage 8's `src/data/projects.ts` (`projectsShown`, `tasksOf`, `projectItem`, `canEdit`, `canFinish`, `canClaim`, `setDone`, `saveTask`, `claim`, `assigneeNames`, `openProject`), `src/components/sheet/project-sheet.tsx` and `task-row.tsx`, `src/components/sidebar-projects.tsx`, `PROJECTS_IN_VIEWS` in `src/data/effective.ts`; Stage 5's `data.removed_items` (class tombstones kept out of `data.shared_items`). **Start Stage 9 only after Stage 8 is merged to `main`.** If an earlier stage changed a name this plan uses, follow that stage's code.

**Goal:** Team projects join the rest of Term (still for admins until Stage 10): the Week and the Month show each project's due date and the tasks assigned to you or to everyone (a project linked to a class assignment with the same date folds into the assignment's chip, "Team · Fire Response API"); ticking a task there completes it for the team; Stats count your open tasks; achievements count the tasks you completed; All items gains a **Source** filter, and choosing a project lists all its tasks with who has them; a task opens in the item card with a **Team** section and **Yours**; the project sheet shows **progress** ("12 / 18 · 67%"), each member's **workload** beside the assignee picker, and, for members who hold the class, the linked assignment's date with **Use this date** when the two drift apart; the sidebar's Projects group gains a progress ring and the eye.

**Architecture:** No Worker change. `effective.ts` lets project rows in (`PROJECTS_IN_VIEWS = true`) and gains pure functions for the calendar and the counts: `forCalendar` (your tasks only, folding), `forStats`, `forAchievements`. `src/data/projects.ts` gains `progress`, `workload`, `assignmentOf`, `toggleTeamTask`. A new `task-sheet.tsx` is the item card for a project's task. Everything is worked out on the device from synced rows (spec §10).

**Tech Stack:** React 19 + TypeScript + Vite, IndexedDB, Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-02-shared-classes-design.md`: §8 (Week, Month, All items, Stats, Achievements, Study), §9 (no duplicates: chip folding; labels: team glyph and the "assigned to you" pip; visibility; colours), §10 (Course → Assignment → Project; **Use this date**; "Linked assignment removed"; progress and workload), §15 (sidebar Projects group with progress ring; the project sheet; the item card's Team section), §21 steps 12–16.

**UI reference:** the prototype George approved (artifact https://claude.ai/artifact/NsegZJE8Wu4A6MvsvWx6HE): the progress ring, the project sheet's progress and workload, "Use this date", the Team section of the card.

---

## How to work in this repo (read before any task)

1. **Checks:** `npm run typecheck`, `npm test`, `npm run build`; `npm run check` runs all three. The jsdom tests alone: `npm run test:ui`. One file: `npx vitest run src/data/effective.test.ts`.
2. **Dev server:** `npm run dev` → http://127.0.0.1:8787; check `Get-NetTCPConnection -LocalPort 8787 -State Listen` first and stop a leftover `vite.js`. Don't run `npm run build` while it runs.
3. **Line endings:** LF. **Non-ASCII** (·, —, ✓): Edit/Write tools only; `npm run build` after a commit that adds any; `iconv -f utf-8 -t utf-8 <file> >/dev/null` on a sub-agent's files.
4. **Deploying:** no migration, no Worker change.
5. **Commits:** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; only on `collab-9-project-views`; never push or merge without George's yes.
6. **The suite stays green after every task**; a task that changes a behaviour an older test spells out updates that test in the same task.

```bash
git checkout main && git pull --ff-only && git checkout -b collab-9-project-views
```

---

## Decisions this plan takes

1. **What each view holds** (spec §8):

   | View | Project rows |
   |---|---|
   | Week, Month (and the Week's tasks panel) | each project's own item (its due date), unless folded; its tasks **assigned to you or to everyone**. Unassigned tasks and others' tasks are left out |
   | All items | every project row you can see; the **Source** filter picks Personal, a class or a project; a project's tasks show who has them |
   | Stats | open and overdue: your tasks (assigned to you or everyone); a project's own item is not counted |
   | Grades | nothing (project rows carry no weight; the CHECK says so) |
   | Achievements | "Tasks done" counts a project task or project only when **you** completed it (`completedBy`) |
   | Study pickers | your tasks, like any item (sessions get `space_id` through `refOf`) |
2. **Folding** (spec §9): in the Week and the Month, a project's own item is left out when its linked assignment is on your calendar on the **same date**; the assignment then carries `team: [{spaceId, name}]` and its chip shows the team glyph with "Team · Fire Response API". Different dates show both. Only the calendar folds; All items lists both.
3. **Hidden sources**: the eye on a project's sidebar row writes `space:<sid>` like a class's (Stage 4's `hidden_sources`), so the Week and the Month leave the project out; Stats still count it (spec §9).
4. **Completing from the Week** (spec §10): ticking a project task in the Week, the Month or the tasks panel sets the team's status (`setDone`), which a member may do only for a task assigned to them or to everyone; otherwise a toast says why. A personal or class task is ticked as before.
5. **The task card** (spec §15): a project task opens `TaskSheet`. **Team** (date, times, assignees, done, subtasks, notes, links: editable by owners and editors; a member may tick done on their own or everyone's tasks, claim or unclaim, and read the rest), with "Edited by Sam · 2h ago"; **Yours** (your notes, Hide). A project's own item opens the project sheet instead.
6. **Progress and workload** (spec §10): progress is live tasks done over live tasks ("12 / 18 · 67%"; "No tasks yet" at 0). Workload is each member's **open** tasks dated from today to 14 days ahead (a task for everyone counts for each), shown beside each name in the assignee picker ("Sam · 3 in the next 2 weeks").
7. **The linked assignment** (spec §10): shown only to someone who holds that class. Same date: "For Web Services · REST API Project". Different: "Assignment due 18 Oct" with **Use this date** (owners and editors; an ordinary write of the project item's date). The assignment gone from your device while you still hold the class (deleted, or kept only as removed): "Linked assignment removed", and the owner may relink (Stage 8's link select).
8. **Colours** (spec §9): item chips are coloured by type, as now; a project's colour shows on its sidebar ring: the linked class's colour when you hold it, else your prefs' colour for the project.
9. **Still admin-only**: `projectsShown()` (Stage 8) gates the sidebar group and the + menu; project rows reach the views only of people in a project, who are admins until Stage 10.

## File map

| File | Change |
|---|---|
| `src/data/effective.ts` | `PROJECTS_IN_VIEWS = true`; `EffectiveItem.team`; `forCalendar`, `forStats`, `forAchievements` |
| `src/data/views.ts` | the calendar input uses `forCalendar`; `useStats` uses `forStats`; the Source filter in `tableRows` and `tableFiltersOf` |
| `src/data/ui.ts` | `ui.source` |
| `src/data/study.ts`, `src/data/study-controller.ts` | achievements read `forAchievements` |
| `src/data/projects.ts` | `progress`, `workload`, `assignmentOf`, `takeAssignmentDate`, `toggleTeamTask`, `projectColour` |
| `src/data/actions.ts` | `toggleTask` routes `p:` keys; `openItem` opens a project's own item as the project sheet; `setSource` |
| `src/components/views/source-mark.tsx` | the team glyph, "assigned to you", the folded "Team · …" |
| `src/components/views/table-filters.tsx`, `src/components/views/table.tsx` | the Source select; who has a project's task |
| `src/components/sheet/task-sheet.tsx` | new: the task card |
| `src/components/sheet/sheet.tsx` | `p:` keys open the task card |
| `src/components/sheet/project-sheet.tsx` | progress, the assignment line, **Use this date** |
| `src/components/sheet/task-row.tsx` | workload in the editor; a row opens the card |
| `src/components/progress-ring.tsx` | new |
| `src/components/sidebar-projects.tsx`, `src/components/sidebar.tsx` | ring, eye (exported from `sidebar.tsx`), dimmed when hidden |
| `docs/PROJECT-OVERVIEW.md`, master plan | Stage 9 row, hand-offs |
| Tests | `src/data/effective.test.ts`, `src/data/projects.test.ts`, `src/data/views.test.ts`, `src/components/sheet/project.test.tsx`, `src/components/views/views.test.tsx` |

---

### Task 1: Project rows in the effective lists, the calendar, Stats and achievements

**Files:**
- Modify: `src/data/effective.ts`, `src/data/views.ts`, `src/data/study.ts`, `src/data/study-controller.ts`
- Test: `src/data/effective.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `src/data/effective.test.ts`; change Stage 8's "keeps project rows out" case to expect them in, as below)

```ts
import { forAchievements, forCalendar, forStats, mergeItems, type EffectiveItem } from "./effective"
import type { Item, Space } from "./types"

const P = "p:fire00000001", C = "c:webs00000001"
const row = (o: Partial<EffectiveItem>): EffectiveItem => ({
    id: "x", type: "task", title: "T", courseId: null, date: "2026-10-20", start: "", end: "", where: "", status: "todo", grade: null, weight: null,
    notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "", completedAt: null, classId: null, revision: 1, ...o,
} as EffectiveItem)
const team = (o: Partial<EffectiveItem>) => row({ scope: P, key: P + "/" + (o.id ?? "x"), source: "project", spaceId: "fire00000001", assignees: [], ...o } as Partial<EffectiveItem>)
const spaces = [{ id: "fire00000001", scope: P, kind: "project", name: "Fire Response API", parent: { space: "webs00000001", item: "a1" } }] as Space[]

describe("project rows in the views (Stage 9 plan, Decisions 1-2)", () => {
    it("lets project rows into the effective list, with only your notes as your layer", () => {
        const shared = [{ ...team({ id: "t1", status: "done", notes: "team notes" }), scope: P }] as (Item & { scope: string })[]
        const [t] = mergeItems([], shared, true)
        expect(t).toMatchObject({ key: P + "/t1", source: "project", status: "done", notes: "", classNotes: "team notes" })
    })

    it("keeps on the calendar only the tasks assigned to you or to everyone", () => {
        const items = [team({ id: "mine", assignees: ["u-me"] }), team({ id: "all", assignees: ["*"] }), team({ id: "theirs", assignees: ["u-sam"] }), team({ id: "nobody" }), row({ id: "own" })]
        expect(forCalendar(items, "u-me", spaces).map((i) => i.id)).toEqual(["mine", "all", "own"])
    })

    it("folds a project into its assignment on the same date, and shows both on different dates", () => {
        const a1 = row({ id: "a1", type: "assignment", scope: C, key: C + "/a1", source: "class", spaceId: "webs00000001", date: "2026-10-15" } as Partial<EffectiveItem>)
        const same = team({ id: "project", type: "project", date: "2026-10-15" })
        const folded = forCalendar([a1, same], "u-me", spaces)
        expect(folded.map((i) => i.id)).toEqual(["a1"])
        expect(folded[0].team).toEqual([{ spaceId: "fire00000001", name: "Fire Response API" }])
        expect(forCalendar([a1, { ...same, date: "2026-10-30" }], "u-me", spaces).map((i) => i.id)).toEqual(["a1", "project"])
    })

    it("returns the list itself when it holds no project row", () => {
        const items = [row({ id: "own" })]
        expect(forCalendar(items, "u-me", spaces)).toBe(items)
        expect(forStats(items, "u-me")).toBe(items)
    })

    it("counts in Stats only your tasks, never the project's own item", () => {
        const items = [team({ id: "mine", assignees: ["u-me"] }), team({ id: "theirs", assignees: ["u-sam"] }), team({ id: "project", type: "project" }), row({ id: "own" })]
        expect(forStats(items, "u-me").map((i) => i.id)).toEqual(["mine", "own"])
    })

    it("counts towards achievements only what you completed yourself", () => {
        const items = [team({ id: "byme", status: "done", completedBy: "u-me" } as Partial<EffectiveItem>), team({ id: "bysam", status: "done", completedBy: "u-sam" } as Partial<EffectiveItem>), row({ id: "own", status: "done" })]
        expect(forAchievements(items, "u-me").map((i) => i.id)).toEqual(["byme", "own"])
    })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/effective.test.ts`
Expected: FAIL (`forCalendar` is not exported; the project row is filtered out).

- [ ] **Step 3: `src/data/effective.ts`**

`export const PROJECTS_IN_VIEWS = true` (and its comment: "Project rows are in the views (Stage 9): the calendar keeps only your tasks (forCalendar)."). `EffectiveItem` gains:

```ts
    /** a class assignment that a project of yours folds into on the calendar (spec §9) */
    team?: { spaceId: string; name: string }[]
    /** a project row's: its assignees and who completed it (the team's) */
    assignees?: string[]; completedBy?: string | null
```

Below `onCalendar`, add:

```ts
const yours = (it: EffectiveItem, me: string) => (it.assignees ?? []).includes(me) || (it.assignees ?? []).includes("*")
const isProjectRow = (it: EffectiveItem) => it.source === "project"

/**
 * The Week's and the Month's rows (Stage 9 plan, Decisions 1-2): a project's tasks only when
 * they are yours or everyone's; a project's own item folded into its linked assignment when
 * that is on the calendar the same day, the assignment then naming the team. With no
 * project row, the list itself.
 */
export function forCalendar<I extends EffectiveItem>(items: I[], me: string, spaces: Pick<Space, "id" | "name" | "parent">[]): I[] {
    if (!items.some(isProjectRow)) return items
    const kept = items.filter((it) => !isProjectRow(it) || it.type !== "task" || yours(it, me))
    const byKey = new Map(kept.map((it) => [keyOf(it), it]))
    const folds = new Map<string, { spaceId: string; name: string }[]>()
    const out: I[] = []
    for (const it of kept) {
        if (isProjectRow(it) && it.type === "project") {
            const s = spaces.find((x) => x.id === it.spaceId), p = s?.parent
            const a = p ? byKey.get("c:" + p.space + "/" + p.item) : undefined
            if (s && a && a.date === it.date) { folds.set(keyOf(a), [...(folds.get(keyOf(a)) ?? []), { spaceId: s.id, name: s.name }]); continue }
        }
        out.push(it)
    }
    return folds.size ? out.map((it) => (folds.has(keyOf(it)) ? { ...it, team: folds.get(keyOf(it)) } : it)) : out
}

/** Stats' rows (Decision 1): your tasks only; a project's own item is not counted. With no project row, the list itself. */
export function forStats<I extends EffectiveItem>(items: I[], me: string): I[] {
    if (!items.some(isProjectRow)) return items
    return items.filter((it) => !isProjectRow(it) || (it.type === "task" && yours(it, me)))
}

/** Achievements' rows (spec §8): a project row counts only when you completed it. */
export function forAchievements<I extends EffectiveItem>(items: I[], me: string): I[] {
    if (!items.some(isProjectRow)) return items
    return items.filter((it) => !isProjectRow(it) || it.completedBy === me)
}
```

Import `Space` with the other types. `withMark` already passes `assignees` and `completedBy` through (it spreads the shared row).

- [ ] **Step 4: Use them**

`src/data/views.ts`, in `useViewInput`: after `onCalendar(…)`, when `calendar`, apply `forCalendar(shown.items, profile?.id ?? "", data.spaces)` (import `data` from `@/core/store` and `forCalendar` from `./effective`); keep `total: items.length`. In `useStats`, call `stats(forStats(items, profile?.id ?? ""), …)`.

`src/data/study.ts` line ~324 (`badges(input.sessions, keyedItems(items), …)`): `keyedItems(forAchievements(items, data.profile?.id ?? ""))`. `src/data/study-controller.ts` line ~105 (`achievements(sessions, items, …)`): pass the same filtered list (find where `items` comes from there and wrap it).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/effective.test.ts src/data/views.test.ts src/data/study.test.ts src/data/study-controller.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/effective.ts src/data/effective.test.ts src/data/views.ts src/data/study.ts src/data/study-controller.ts
git commit -m "Stage 9: project rows in the views: your tasks on the calendar, folding, Stats, achievements

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ticking a task from the views; opening project rows

**Files:**
- Modify: `src/data/projects.ts` (`toggleTeamTask`), `src/data/actions.ts` (`toggleTask`, `openItem`)
- Test: `src/data/projects.test.ts`

- [ ] **Step 1: Write the failing test** (append; the file's `space`/`task` fixtures are Stage 8's)

```ts
import { teamTaskTick } from "./projects"

describe("ticking a team task from the Week (Decision 4)", () => {
    it("completes or reopens what you may, and says why when you may not", () => {
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-me"] }), "u-me")).toEqual({ done: true })
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-me"], status: "done", completedAt: 5 }), "u-me")).toEqual({ done: false })
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-sam"] }), "u-me")).toEqual({ why: "Only its assignees and the project's editors can complete this task." })
        expect(teamTaskTick(space({ role: "owner", archived: true }), task({}), "u-me")).toEqual({ why: "This project is archived, so it is read-only." })
    })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/data/projects.test.ts`
Expected: FAIL (`teamTaskTick` is not exported).

- [ ] **Step 3: `src/data/projects.ts`**

```ts
/** What ticking a team task does (Stage 9 plan, Decision 4): {done} to set, or {why} not. */
export function teamTaskTick(s: Space | null | undefined, t: SharedItem, me: string): { done: boolean } | { why: string } {
    if (!s) return { why: "This project isn't on this device any more." }
    if (s.archived) return { why: "This project is archived, so it is read-only." }
    if (!canFinish(s, t, me)) return { why: "Only its assignees and the project's editors can complete this task." }
    return { done: t.status !== "done" }
}

/** Tick a team task from a view by its key, '<scope>/<id>'. */
export async function toggleTeamTask(key: string): Promise<void> {
    const at = key.indexOf("/"), scope = key.slice(0, at), id = key.slice(at + 1)
    const t = data.shared_items.find((i) => i.scope === scope && i.id === id)
    if (!t) return
    const r = teamTaskTick(data.spaces.find((s) => s.scope === scope), t, data.profile?.id ?? "")
    if ("why" in r) { toast(r.why); return }
    await setDone(t, r.done)
}
```

- [ ] **Step 4: `src/data/actions.ts`**

In `toggleTask`, before the class line: `if (isSharedKey(key) && key.startsWith("p:")) { await toggleTeamTask(key); notify(); return }` (import `toggleTeamTask, openProject` from `./projects`; a cycle with `projects.ts` → `classes.ts` → … is fine because each side calls the other only later; if the build complains, import lazily). `openItem` becomes:

```ts
/** Open an item's card; a project's own item opens the project's sheet. */
export const openItem = (id: string) => {
    const m = /^p:([a-z0-9]{12})\/project$/.exec(id)
    if (m) { openProject(m[1]); return }
    openSheet({ kind: "item", id })
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/projects.test.ts src/data/data.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/projects.ts src/data/projects.test.ts src/data/actions.ts
git commit -m "Stage 9: ticking a team task from the views sets the team's status; a project row opens its sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Chip labels; the All items Source filter

**Files:**
- Modify: `src/components/views/source-mark.tsx`, `src/data/ui.ts`, `src/data/views.ts` (`TableFilters`, `tableRows`, `tableFiltersOf`), `src/data/actions.ts` (`setSource`), `src/components/views/table-filters.tsx`, `src/components/views/table.tsx`
- Test: `src/data/views.test.ts`, `src/components/views/views.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/data/views.test.ts` (it already builds `TableFilters`; add `source: "all"` to its existing fixtures in this step):

```ts
it("filters All items by source: personal, a class (with your items under it), a project", () => {
    const rows = [
        { ...item("own"), key: "own" },
        { ...item("filed"), classId: "webs00000001" },
        { ...item("a1"), key: "c:webs00000001/a1", spaceId: "webs00000001", source: "class" },
        { ...item("t1"), key: "p:fire00000001/t1", spaceId: "fire00000001", source: "project" },
    ] as EffectiveItem[]
    const ids = (source: string) => tableRows(rows, [], { search: "", course: "all", types: {}, show: "all", source }, { key: "date", dir: 1 }).map((r) => r.id)
    expect(ids("personal")).toEqual(["own", "filed"])
    expect(ids("space:webs00000001")).toEqual(["filed", "a1"])
    expect(ids("space:fire00000001")).toEqual(["t1"])
    expect(ids("all")).toHaveLength(4)
})
```

(`item(id)`: the file's item fixture; if it has another name, use it.)

Append to `src/components/views/views.test.tsx` (with its render helpers and a seeded project in which you are an assignee):

```tsx
it("marks a team task and a folded project on their chips", async () => {
    // seed: project p:fire00000001 'Fire Response API' linked to class item a1 (same date as the project item); task t1 assigned to you
    // render the Week
    expect(screen.getByRole("img", { name: "Team task · assigned to you" })).toBeTruthy()
    expect(screen.getByRole("img", { name: "Team · Fire Response API" })).toBeTruthy()
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/views.test.ts src/components/views/views.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `SourceMark` (`src/components/views/source-mark.tsx`)**

```tsx
// Where a chip comes from (spec §9): the two-person glyph on a class's item ("Shared · Web
// Services"), the team glyph on a project's row ("Team task · assigned to you", "Team · Fire
// Response API"), the team glyph again on an assignment a project folds into, and a "you" pip
// on an item of yours filed under a class. Your other items have none.

import { SharedGlyph, TeamGlyph } from "@/components/shared-glyph"
import { data } from "@/core/store"
import type { EffectiveItem } from "@/data/effective"

const mark = (label: string, glyph: React.ReactNode) => (
    <span role="img" aria-label={label} title={label} className="inline-flex flex-none text-muted-foreground">{glyph}</span>
)

export function SourceMark({ item, course }: { item: EffectiveItem; course: { name: string } | null }) {
    const name = course?.name || "a class"
    if (item.source === "project") {
        const me = data.profile?.id ?? "", mine = (item.assignees ?? []).includes(me) || (item.assignees ?? []).includes("*")
        if (item.type === "task") return mark(mine ? "Team task · assigned to you" : "Team task", <TeamGlyph className="size-3" />)
        return mark("Team · " + (data.spaces.find((s) => s.id === item.spaceId)?.name ?? "a project"), <TeamGlyph className="size-3" />)
    }
    if (item.source === "class") return (
        <>
            {mark("Shared · " + name, <SharedGlyph className="size-3" />)}
            {item.team?.map((t) => <span key={t.spaceId}>{mark("Team · " + t.name, <TeamGlyph className="size-3" />)}</span>)}
        </>
    )
    if (item.classId) return (
        <span role="img" aria-label={"Yours, under " + name} title={"Yours, under " + name}
            className="flex-none rounded-full bg-[var(--chip-bg)] px-1 text-[9.5px] leading-[14px] font-semibold text-[var(--chip-ink)]">you</span>
    )
    return null
}
```

(Import `type React` or use `ReactNode` from `react` as the file's neighbours do.)

- [ ] **Step 4: The Source filter**

`src/data/ui.ts`: beside `show: "all"`, add `source: "all"` with the comment "the All items table's Source filter: 'all', 'personal' or 'space:<id>'" (and its type in the ui's interface, `source: string`).

`src/data/views.ts`: `TableFilters` gains `source: string`; `tableFiltersOf` returns `source: tile ? "all" : ui.source || "all"`; in `tableRows`, filter first with:

```ts
/* the Source filter (Stage 9 plan): your rows (also those under a class), a class's (and yours under it), a project's */
const fromSource = (it: EffectiveItem, source: string) =>
    source === "all" ? true : source === "personal" ? !it.spaceId : it.spaceId === source.slice(6) || it.classId === source.slice(6)
```

`src/data/actions.ts`: `export function setSource(source: string) { ui.source = source; rememberUi(); notify() }` (copy how `setShow` stores its value; if `setShow` also resets something, do the same).

`src/components/views/table-filters.tsx`: after the Show group, a labelled select:

```tsx
<label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
    Source
    <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
        <option value="all">Everything</option>
        <option value="personal">Personal</option>
        {spaces.map((s) => <option key={s.id} value={"space:" + s.id}>{s.name}</option>)}
    </Select>
</label>
```

with `const source = useUi((u) => u.source || "all")` and `const spaces = useSpaces()` (only shown when `spaces.length`); use the select the file's other controls use, or `Select` from `../sheet/fields`.

`src/components/views/table.tsx`: in the title cell, after `<SourceMark …/>`, for a project task: `{it.source === "project" && it.type === "task" && <span className="text-[11px] text-muted-foreground"> · {assigneeNames(it as SharedItem, space, me)}</span>}` with `space` looked up from `useSpaces()` by `it.spaceId` and `me` from `useProfile()`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/data/views.test.ts src/components/views/views.test.tsx src/components/views/table-filters.test.tsx && npm run typecheck`
Expected: PASS (fill in the component test's seed with the file's helpers).

- [ ] **Step 6: Commit**

```bash
git add src/components/views/source-mark.tsx src/data/ui.ts src/data/views.ts src/data/views.test.ts src/data/actions.ts src/components/views/table-filters.tsx src/components/views/table.tsx src/components/views/views.test.tsx
git commit -m "Stage 9: team glyphs on chips; All items filters by source and shows who has a task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Progress, workload, the linked assignment

**Files:**
- Modify: `src/data/projects.ts`
- Test: `src/data/projects.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { assignmentOf, progress, workload } from "./projects"

describe("progress, workload and the linked assignment (spec §10)", () => {
    it("counts done tasks over live ones", () => {
        expect(progress([task({ status: "done" }), task({}), task({ status: "done" })])).toEqual({ done: 2, total: 3, label: "2 / 3 · 67%", frac: 2 / 3 })
        expect(progress([])).toEqual({ done: 0, total: 0, label: "No tasks yet", frac: 0 })
    })
    it("counts each member's open tasks in the next 14 days, everyone's for each", () => {
        const ts = [task({ assignees: ["u-a"], date: "2026-10-10" }), task({ assignees: ["u-a", "u-b"], date: "2026-10-23" }), task({ assignees: ["*"], date: "2026-10-12" }),
            task({ assignees: ["u-a"], date: "2026-10-25" }), task({ assignees: ["u-a"], date: "2026-10-11", status: "done" }), task({ assignees: ["u-b"], date: "2026-10-09" })]
        expect(workload(ts, ["u-a", "u-b"], "2026-10-10")).toEqual(new Map([["u-a", 3], ["u-b", 2]]))
    })
    it("shows the assignment only to someone holding its class; flags drift and removal", () => {
        const s = space({ parent: { space: "webs00000001", item: "a1" } })
        const project = task({ id: "project", type: "project", date: "2026-10-15" })
        const a1 = task({ id: "a1", scope: "c:webs00000001", type: "assignment", title: "REST API Project", date: "2026-10-18" })
        const cls = { id: "webs00000001", name: "Web Services" }
        expect(assignmentOf(s, project, [a1], [cls])).toEqual({ state: "drift", label: "Web Services · REST API Project", date: "2026-10-18" })
        expect(assignmentOf(s, { ...project, date: "2026-10-18" }, [a1], [cls])).toMatchObject({ state: "same" })
        expect(assignmentOf(s, project, [], [cls])).toEqual({ state: "removed" })
        expect(assignmentOf(s, project, [a1], [])).toEqual({ state: "none" })
        expect(assignmentOf(space(), project, [a1], [cls])).toEqual({ state: "none" })
    })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/data/projects.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/data/projects.ts`**

```ts
/** Done over live tasks (spec §10): "12 / 18 · 67%". */
export function progress(tasks: SharedItem[]): { done: number; total: number; label: string; frac: number } {
    const total = tasks.length, done = tasks.filter((t) => t.status === "done").length
    return { done, total, frac: total ? done / total : 0, label: total ? `${done} / ${total} · ${Math.round((done / total) * 100)}%` : "No tasks yet" }
}

/** Each member's open tasks dated today to 14 days ahead (spec §10); a task for everyone counts for each. */
export function workload(tasks: SharedItem[], members: string[], today: string): Map<string, number> {
    const end = iso(addDays(parse(today), 14))
    const out = new Map(members.map((m) => [m, 0]))
    for (const t of tasks) {
        if (t.status === "done" || t.date < today || t.date > end) continue
        for (const m of members) if (t.assignees.includes("*") || t.assignees.includes(m)) out.set(m, out.get(m)! + 1)
    }
    return out
}

export type Assignment = { state: "none" } | { state: "removed" } | { state: "same" | "drift"; label: string; date: string }
/**
 * The class assignment a project belongs to, as this person may see it (spec §10): nothing
 * unless they hold that class; "removed" when they do but the assignment is no longer live
 * on this device; else its label and date, and whether the project's date has drifted from it.
 */
export function assignmentOf(s: Pick<Space, "parent">, project: Pick<SharedItem, "date">, items: SharedItem[] = data.shared_items,
    spaces: Pick<Space, "id" | "name">[] = data.spaces): Assignment {
    const p = s.parent
    const cls = p && spaces.find((x) => x.id === p.space)
    if (!p || !cls) return { state: "none" }
    const a = items.find((i) => i.scope === "c:" + p.space && i.id === p.item && !i.deletedAt)
    if (!a) return { state: "removed" }
    return { state: a.date === project.date ? "same" : "drift", label: cls.name + " · " + a.title, date: a.date }
}

/** Use this date (spec §10): the project's due date becomes the assignment's; an ordinary editor write. */
export const takeAssignmentDate = (project: SharedItem, date: string) => saveTask(project, { date })

/** A project's colour (spec §9): its linked class's, when you hold it, else your own for the project. */
export function projectColour(s: Pick<Space, "id" | "parent">, prefs = data.space_prefs ?? []): string | null {
    return (s.parent && prefs.find((p) => p.spaceId === s.parent!.space)?.color) || prefs.find((p) => p.spaceId === s.id)?.color || null
}
```

Import `iso, addDays, parse` from `@/core/dates` (check their names: `grep -n "export function addDays\|export function parse\|export const parse" src/core/dates.ts`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/data/projects.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/projects.ts src/data/projects.test.ts
git commit -m "Stage 9: a project's progress, each member's workload, its linked assignment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The project sheet's header and workload; the sidebar ring and eye

**Files:**
- Create: `src/components/progress-ring.tsx`
- Modify: `src/components/sheet/project-sheet.tsx`, `src/components/sheet/task-row.tsx`, `src/components/sidebar-projects.tsx`, `src/components/sidebar.tsx`
- Test: `src/components/sheet/project.test.tsx`

- [ ] **Step 1: Write the failing tests** (append to `project.test.tsx`)

```tsx
it("shows progress, the assignment's drift with Use this date, and workload in the picker", async () => {
    // seed: you are an editor of p:fire00000001 (due 2026-10-15, parent webs00000001/a1); you hold c:webs00000001 'Web Services' whose a1 'REST API Project' is due 2026-10-18;
    //       tasks: 3, one done; t2 assigned to Sam, dated within 14 days of today
    openProject("fire00000001")
    expect(await screen.findByText("1 / 3 · 33%")).toBeTruthy()
    expect(screen.getByText(/Assignment due 18 Oct/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Use this date" }))
    // the store's project item now has date 2026-10-18, with a pending put naming only date
    expect(await screen.findByText(/For Web Services · REST API Project/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole("button", { name: /^Edit / })[0])
    expect(screen.getByText(/Sam · 1 in the next 2 weeks/)).toBeTruthy()
})

it("says when the linked assignment is gone", async () => {
    // seed: as above but a1 is not in shared_items (you still hold the class)
    openProject("fire00000001")
    expect(await screen.findByText("Linked assignment removed")).toBeTruthy()
})

it("puts a ring and an eye on the sidebar's project row", async () => {
    // seed: as the first case
    render(<Sidebar />)
    const group = screen.getByRole("region", { name: "Projects" })
    expect(within(group).getByRole("img", { name: "1 of 3 tasks done" })).toBeTruthy()
    fireEvent.click(within(group).getByRole("button", { name: "Hide Fire Response API on your calendar" }))
    // the profile's hiddenSources now holds 'space:fire00000001'
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/project.test.tsx`
Expected: the three new cases FAIL.

- [ ] **Step 3: `src/components/progress-ring.tsx`**

```tsx
// A small progress ring (spec §15): a project's tasks done, in its colour.

export function ProgressRing({ frac, color, label, size = 14 }: { frac: number; color: string | null; label: string; size?: number }) {
    const r = 5.5, c = 2 * Math.PI * r
    return (
        <svg role="img" aria-label={label} viewBox="0 0 14 14" width={size} height={size} className="shrink-0 -rotate-90">
            <circle cx="7" cy="7" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
            <circle cx="7" cy="7" r={r} fill="none" stroke={color ?? "var(--accent)"} strokeWidth="2" strokeLinecap="round"
                strokeDasharray={`${c * Math.min(1, Math.max(0, frac))} ${c}`} />
        </svg>
    )
}
```

- [ ] **Step 4: The project sheet (`src/components/sheet/project-sheet.tsx`)**

Under the title, replace Stage 8's `<Note>Due …</Note>` with:

```tsx
const p = progress(tasks), a = assignmentOf(space, project)
…
<div className="flex flex-col gap-1 px-[18px] pt-1 text-[12.5px] text-ink-2">
    <span>Due {dayMonth(project.date)} · {p.label}{space.archived ? " · Archived: read-only" : ""}</span>
    {a.state === "same" && <span className="text-muted-foreground">For {a.label}</span>}
    {a.state === "drift" && (
        <span className="flex items-center gap-2 text-muted-foreground">
            For {a.label} · Assignment due {dayMonth(a.date)}
            {canEdit(space) && <Button variant="ghost" onClick={() => void takeAssignmentDate(project, a.date)}>Use this date</Button>}
        </span>
    )}
    {a.state === "removed" && <span className="text-muted-foreground">Linked assignment removed{space.role === "owner" ? ". Relink it below." : ""}</span>}
</div>
```

(import `progress`, `assignmentOf`, `takeAssignmentDate` and `dayMonth`; not named `use…`, which the hooks lint rule would take for a hook.)

- [ ] **Step 5: Workload in the picker (`src/components/sheet/task-row.tsx`)**

`TaskRow` takes `load: Map<string, number>` (the project sheet passes `workload(tasks, space.members.map((m) => m.userId), today())` once for all rows) and hands it to `TaskEditor`, whose member labels become `{m.name}<span className="text-muted-foreground"> · {load.get(m.userId) ?? 0} in the next 2 weeks</span>`. The task's title in the row becomes a button that opens the card: `onClick={() => openItem(task.scope + "/" + task.id)}`.

- [ ] **Step 6: The sidebar (`src/components/sidebar-projects.tsx`, `src/components/sidebar.tsx`)**

Export `Eye` from `src/components/sidebar.tsx` (`export function Eye`). In `ProjectsGroup`, each row becomes, like a course row, a `group` div holding the button and the eye:

```tsx
const hidden = useProfile()?.hiddenSources ?? []
const items = useSharedItems()
…
{projects.map((p) => {
    const source = "space:" + p.id, off = hidden.includes(source), prog = progress(tasksOf(p.id, items))
    return (
        <div key={p.id} className="group flex items-center rounded-[9px] hover:bg-muted">
            <button type="button" onClick={() => openProject(p.id)}
                className={cn("flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium", off ? "text-muted-foreground" : "text-ink-2")}>
                <ProgressRing frac={prog.frac} color={projectColour(p)} label={`${prog.done} of ${prog.total} tasks done`} />
                <span className="min-w-0 truncate">{p.name}</span>
                <span aria-hidden="true" className="text-muted-foreground"><TeamGlyph /></span>
                {p.archived && <span className="shrink-0 text-[11px] text-muted-foreground">Archived</span>}
            </button>
            <Eye source={source} name={p.name} off={off} />
        </div>
    )
})}
```

(Imports: `cn`, `useSharedItems`, `progress`, `tasksOf`, `projectColour`, `ProgressRing`, `Eye`.) The header comment drops "Stage 9 adds…" and says what the ring and the eye do.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/components/sheet/project.test.tsx src/components/sidebar.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/progress-ring.tsx src/components/sheet/project-sheet.tsx src/components/sheet/task-row.tsx src/components/sidebar-projects.tsx src/components/sidebar.tsx src/components/sheet/project.test.tsx
git commit -m "Stage 9: project progress and the linked assignment's date with Use this date; workload; the sidebar's ring and eye

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The task card

**Files:**
- Create: `src/components/sheet/task-sheet.tsx`
- Modify: `src/components/sheet/sheet.tsx`
- Test: `src/components/sheet/project.test.tsx`

- [ ] **Step 1: Write the failing tests** (append)

```tsx
it("opens a team task in the card: Team for the team, Yours for you", async () => {
    // seed: you are a member of p:fire00000001; t1 'Create incidents endpoint' assigned to you, updatedBy Sam 2h ago
    openItem("p:fire00000001/t1")
    expect(await screen.findByRole("heading", { name: "Create incidents endpoint" })).toBeTruthy()
    expect(screen.getByText(/Edited by Sam · 2 h ago/)).toBeTruthy()
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull()                 // a member reads the team's facts
    fireEvent.click(screen.getByRole("checkbox", { name: "Done" }))                       // but completes their own task
    fireEvent.change(screen.getByRole("textbox", { name: "Your notes" }), { target: { value: "ask Sam about auth" } })
    // after the typing pause: a pending mark p:… with notes, and a pending put on t1 naming status and completedAt
})

it("lets an editor change the team's facts and delete the task", async () => {
    // seed: you are an editor
    openItem("p:fire00000001/t1")
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "Incidents endpoint" } })
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }))
    // the task is gone from the store with a pending delete
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/components/sheet/project.test.tsx`
Expected: FAIL (the class card opens, or nothing).

- [ ] **Step 3: `src/components/sheet/task-sheet.tsx`**

Build it on the class card's pieces (`class-item-sheet.tsx`: read its whole body first; this card is its smaller sibling):

```tsx
// A team project's task in the card (spec §15). **Team**: the task as the whole team sees it:
// date, times, who has it, done, subtasks, notes and links, changed by owners and editors (a
// member ticks done on their own or everyone's tasks, and claims or unclaims), with who changed
// it last. **Yours**: your notes and Hide, which only you see. Opened by '<scope>/<id>'.

import { useEffect, useId } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { closeSheet, beforeSheetClose } from "@/data/overlay"
import { useMarks, useProfile, useSharedItems, useSpaces } from "@/data/store"
import { editedBy, editRow, flushTyping, markIdOf, pendingMark, pendingRow, setHidden, typeMark, typeRow, useTyping } from "@/data/marks"
import { splitKey } from "@/data/refs"
import { assigneeNames, canClaim, canEdit, canFinish, claim, deleteTask, openProject, setDone } from "@/data/projects"
import { toast } from "@/data/toast"
import { StatusChip } from "@/components/views/bits"
import { TeamGlyph } from "@/components/shared-glyph"
import { Button, Checkbox, DateInput, Note, Prop, Props, Section, SheetBody, SheetFoot, SheetHead, TextArea, TitleArea } from "./fields"
import { TimeField } from "./time-field"
import { ICONS } from "./prop-icons"
import { Checklist, Links } from "./item-parts"

const TITLE = "font-serif text-[30px] leading-[1.15] font-[500] tracking-[-.015em]"

export function TaskSheet({ itemKey }: { itemKey: string }) {
    const { scope, id } = splitKey(itemKey)
    useTyping()
    const row = useSharedItems().find((it) => it.scope === scope && it.id === id) ?? null
    const space = useSpaces().find((s) => s.scope === scope) ?? null
    const stored = useMarks().find((m) => m.id === markIdOf(itemKey)) ?? null
    const me = useProfile()?.id ?? ""
    const f = useId()
    useEffect(() => {
        const save = () => { void flushTyping() }
        beforeSheetClose.add(save)
        return () => { beforeSheetClose.delete(save) }
    }, [])
    useEffect(() => { if (!row || !space) closeSheet() }, [row, space])
    if (!row || !space) return null

    const t = { ...row, ...pendingRow(itemKey) }
    const notes = { ...(stored ?? {}), ...pendingMark(itemKey) }.notes ?? ""
    const editor = canEdit(space), m = tmeta("task"), claimAct = canClaim(space, t, me)
    return (
        <>
            <SheetHead color={m.color} kind="Team task" onClose={closeSheet}>
                <StatusChip item={t} />
                <button type="button" onClick={() => openProject(space.id)}
                    className="inline-flex items-center gap-1 rounded-full border-0 bg-muted px-2 py-px text-[10.5px] font-semibold text-ink-2">
                    <TeamGlyph className="size-3" /> {space.name}
                </button>
            </SheetHead>
            <SheetBody className="gap-[22px] px-6 pt-2 pb-7 max-[700px]:px-4">
                {editor
                    ? <TitleArea value={t.title} maxLength={140} aria-label="Title" className={cn("shrink-0", TITLE)}
                        onChange={(e) => typeRow(itemKey, { title: e.target.value })} onBlur={() => void flushTyping()} />
                    : <h2 className={cn("m-0", TITLE)}>{t.title}</h2>}
                <Section title={<><TeamGlyph /> Team</>} note={editedBy(row, space, me) || "Everyone in the project sees these"}>
                    <Props>
                        <Prop icon={ICONS.status} label="Done">
                            <Checkbox aria-label="Done" checked={t.status === "done"} disabled={!canFinish(space, t, me)} onChange={(e) => void setDone(row, e.target.checked)} />
                        </Prop>
                        <Prop icon={ICONS.date} label="Date">
                            {editor ? <DateInput id={f + "date"} value={t.date} onChange={(v: string) => void editRow(itemKey, { date: v })} /> : <span>{t.date}</span>}
                        </Prop>
                        <Prop icon={ICONS.time} label="Time">
                            {editor ? <TimeField start={t.start} end={t.end} onChange={(start: string, end: string) => void editRow(itemKey, { start, end })} /> : <span>{t.start ? t.start + (t.end ? "–" + t.end : "") : "—"}</span>}
                        </Prop>
                        <Prop icon={ICONS.people ?? ICONS.course} label="Who">
                            <span>{assigneeNames(t, space, me)}</span>
                            {claimAct && <Button variant="ghost" onClick={() => void claim(row, me, claimAct === "claim")}>{claimAct === "claim" ? "Claim" : "Unclaim"}</Button>}
                        </Prop>
                    </Props>
                    <Checklist item={t} readOnly={!editor} onChange={(checklist) => void editRow(itemKey, { checklist })} />
                    {editor
                        ? <TextArea aria-label="Team notes" value={t.notes} onChange={(e) => typeRow(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                        : t.notes && <Note>{t.notes}</Note>}
                    <Links item={t} readOnly={!editor} onChange={(links) => void editRow(itemKey, { links })} />
                </Section>
                <Section title="Yours" note="Only you see these">
                    <TextArea aria-label="Your notes" value={notes} onChange={(e) => typeMark(itemKey, { notes: e.target.value })} onBlur={() => void flushTyping()} />
                    <Button variant="ghost" onClick={async () => { await setHidden(itemKey, true); toast("Hidden from your views. Show it again from the project."); closeSheet() }}>Not mine: hide it</Button>
                </Section>
            </SheetBody>
            <SheetFoot hint="">
                {editor && <Button variant="ghost" aria-label="Delete task" onClick={() => { closeSheet(); void deleteTask(row) }}>Delete</Button>}
                <Button onClick={closeSheet}>Done</Button>
            </SheetFoot>
        </>
    )
}
```

The prop names of `DateInput`, `TimeField`, `Checklist`, `Links`, `Prop` and the icon keys are guesses from their use in `class-item-sheet.tsx`: copy the exact props from there (`grep -n "<DateInput\|<TimeField\|<Checklist\|<Links\|ICONS\." src/components/sheet/class-item-sheet.tsx`). Wrap it with the maintenance gate as `ClassItemSheet` does (an outer `TaskSheet` and an inner card).

Hidden project rows: Stage 4's `hiddenIn(scope, …)` lists hidden items of a scope; add the same **Hidden** list with **Show again** under the project sheet's Tasks (copy the class sheet's "items you hid" block, which uses `hiddenIn` and `setHidden(key, false)`).

- [ ] **Step 4: Route it (`src/components/sheet/sheet.tsx`)**

`{shown?.kind === "item" && (isSharedKey(shown.id) ? (shown.id.startsWith("p:") ? <TaskSheet key={shown.id} itemKey={shown.id} /> : <ClassItemSheet … />) : <ItemSheet … />)}`; `sheetLabel` for a `p:` key: `"Team task"`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/sheet/project.test.tsx src/components/sheet/class-item-sheet.test.tsx src/components/sheet/sheet.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Build** — `npm run build` (·, –).

- [ ] **Step 7: Commit**

```bash
git add src/components/sheet/task-sheet.tsx src/components/sheet/sheet.tsx src/components/sheet/project-sheet.tsx src/components/sheet/project.test.tsx
git commit -m "Stage 9: a team task in the item card: Team and Yours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

- [ ] **Step 1: `docs/PROJECT-OVERVIEW.md`**: history "Stage 9 (projects in the views, admins only), <date>"; repo map: `task-sheet.tsx`, `progress-ring.tsx`.
- [ ] **Step 2: The master plan**: Stage 9's plan cell becomes `` `docs/superpowers/plans/2026-10-07-collab-stage-9-project-views.md` ``; **Hand-offs from Stage 9**: "Projects are in the views for their members. Stage 10 adds them to the ICS feed (the project's own item unless folded is not a feed concern: the feed lists both, since calendar apps have no chips; your tasks and everyone's) and clears `PROJECTS_ADMINS_ONLY` / `PROJECTS_ADMIN_ONLY`."
- [ ] **Step 3: Commit** (`docs: Stage 9`), with the attribution line.

---

### Task 8: Full check, browser check, merge (George's yes)

- [ ] **Step 1:** `npm run check` passes.
- [ ] **Step 2: By hand** with `qaa` (owner) and `qab` (editor, then member), one class both hold, one project linked to its assignment:
1. Same date: the Week shows the assignment once, with the team glyph "Team · …"; change the project's date: both show.
2. `qaa` moves the assignment (class sheet): `qab`'s project header shows "Assignment due …" and **Use this date**; pressing it moves the project and the header now says "For …".
3. Tasks: one for `qab`, one for Everyone, one for `qaa`, one unassigned. `qab`'s Week shows the first two only; ticking one completes it for both (after sync); ticking `qaa`'s from All items (Source: the project) as a member shows the toast.
4. Stats on `qab`: overdue/open count their tasks only. Study: a task is in the picker.
5. The sidebar ring moves as tasks are done; the eye hides the project from the Week and Month, not from All items or Stats.
6. A task card: member reads Team, ticks done, writes "Your notes", hides it; it shows under the project sheet's Hidden list with **Show again**.
7. Delete the assignment (class sheet) while holding the class: "Linked assignment removed".
- [ ] **Step 3: Ask George**; on his yes merge `collab-9-project-views` into `main` with `--no-ff` and push. No migration.

---

## Self-review against the spec and the outline

- §8 Week/Month/All items/Stats/Grades/Study/Achievements for projects: Task 1 (Decisions 1, 3), Task 3 (Source filter), Task 2 (ticking).
- §9: no duplicates via folding (Task 1); team glyph and "assigned to you" labels (Task 3); visibility via the eye (Task 5); colours (Decision 8, Task 5).
- §10: progress and workload (Tasks 4, 5); the linked assignment shown only to class holders, **Use this date**, "Linked assignment removed" (Tasks 4, 5).
- §15: the Projects group's progress ring and eye (Task 5); the project sheet's progress, workload, linked assignment (Task 5); the item card's Team section (Task 6).
- §21 steps 12–16 are Task 8's hand check (3, 2).
- Not here on purpose: the ICS feed and opening projects to everyone (Stage 10).
- Task 6's component props are taken from the class card at build time; the step says so and gives the grep, since that card's props were set by Stage 4's code rather than a plan this one can quote.
