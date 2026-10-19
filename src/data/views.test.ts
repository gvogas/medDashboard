import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/* The selectors are pure; only the hooks at the end of views.ts touch the store. */
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], quotes: [], study_sessions: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { normalizeCourse, normalizeItem } from "@/core/model"
import { normalizeSchool } from "@/core/school"
import {
    cellLabel, classes, instances, monthCells, officeHours, pickedSource, quoteAt, stats, tableRows, tableView, tasks, timetable, typeCounts, weekDays,
    type Filters, type TableFilters, type ViewInput,
} from "./views"
import type { Course, Item, Schedule, StudySession } from "./types"
import { forStats, type EffectiveItem } from "./effective"

/* Wednesday 23 September 2026; the week runs Mon 21 – Sun 27. */
const TODAY = "2026-09-23"
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

const item = (row: Partial<Item> & { id: string }): Item => normalizeItem({ type: "assignment", title: row.id, date: TODAY, status: "todo", ...row }) as Item
const course = (row: Partial<Course> & { id: string }, i = 0): Course => normalizeCourse({ code: row.id.toUpperCase(), name: row.id, ...row }, i) as Course
const mtg = (id: string, weekday: number, start: string, end: string, room = "") => ({ id, kind: "Lecture", weekday, start, end, room })

const ALL: Filters = { search: "", course: "all" }
const TABLE: TableFilters = { ...ALL, types: {}, show: "all", source: "all" }
const input = (items: Item[], courses: Course[], over: Partial<ViewInput> = {}): ViewInput =>
    ({ items, courses, filters: ALL, schedule: "all", anchor: TODAY, today: TODAY, cal: null, ...over })

const anat = course({ id: "anat", color: "#C2571A", meetings: [mtg("m1", 1, "09:00", "10:30", "Hall B"), mtg("m2", 3, "14:00", "15:00")] })
const phys = course({ id: "phys", color: "#1E628F", meetings: [mtg("m3", 3, "08:00", "09:00")] }, 1)

/* Fall ends on Tuesday 22 September 2026 so the test week holds both semesters. */
const TWO = normalizeSchool({ terms: [
    { name: "Fall 2026", start: "2026-09-01", end: "2026-09-22" },
    { name: "Winter 2027", start: "2026-09-23", end: "2026-12-18" },
] })

describe("filters", () => {
    it("drop other courses and search misses, and never filter by type", () => {
        const items = [item({ id: "a", courseId: "anat" }), item({ id: "b", type: "lab", courseId: "phys" }), item({ id: "c", title: "Renal set" })]
        const ids = (f: Filters) => instances(items, [anat, phys], f, "2026-09-21", "2026-09-27").map((x) => x.item.id)
        expect(ids(ALL)).toEqual(["a", "b", "c"])
        expect(ids({ ...ALL, course: "phys" })).toEqual(["b"])
        expect(ids({ ...ALL, search: "renal" })).toEqual(["c"])
        expect(ids({ ...ALL, search: "PHYS" })).toEqual(["b"])   /* the course's name counts */
    })

    it("find an assignment a project folds into by the project's name", () => {
        const folded = { ...item({ id: "a1", title: "REST API Project" }), team: [{ spaceId: "fire00000001", name: "Fire Response API" }] } as EffectiveItem
        const ids = (f: Filters) => instances([folded, item({ id: "b" })], [], f, "2026-09-21", "2026-09-27").map((x) => x.item.id)
        expect(ids({ ...ALL, search: "fire response" })).toEqual(["a1"])
    })

    it("list classes Monday first, then by start, leaving out archived courses", () => {
        const old = course({ id: "old", archived: true, meetings: [mtg("m9", 1, "07:00", "08:00")] }, 2)
        expect(classes([anat, phys, old], ALL).map((x) => x.mtg.id)).toEqual(["m1", "m3", "m2"])
        expect(classes([anat, phys], { ...ALL, search: "hall b" }).map((x) => x.mtg.id)).toEqual(["m1"])
    })
})

describe("the week", () => {
    const items = [
        item({ id: "late", date: "2026-09-23", end: "23:59" }),
        item({ id: "early", date: "2026-09-23", start: "08:30" }),
        item({ id: "untimed", date: "2026-09-23" }),
        item({ id: "mon", date: "2026-09-21", start: "11:00" }),
        item({ id: "weekly", type: "office", date: "2026-09-01", recur: "weekly", weekday: 5, start: "15:00" }),
        item({ id: "next", date: "2026-09-29" }),
    ]
    const keys = (schedule: Schedule, date = "2026-09-23") =>
        weekDays(input(items, [anat, phys], { schedule })).days.find((d) => d.date === date)!.entries.map((e) => e.kind === "class" ? e.slot.mtg.id : e.inst.item.id)

    it("runs Monday to Sunday and marks today", () => {
        const w = weekDays(input(items, [anat, phys]))
        expect(w.days.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"])
        expect(w.days.filter((d) => d.isToday).map((d) => d.dow)).toEqual(["Wed"])
        expect(w.count).toBe(5)
    })

    it("merges classes and items in time order, untimed last", () => {
        expect(keys("all")).toEqual(["m3", "early", "m2", "late", "untimed"])
        expect(keys("all", "2026-09-25")).toEqual(["weekly"])
    })

    it("shows only what the tab asks for", () => {
        expect(keys("deadlines")).toEqual(["early", "late", "untimed"])
        expect(keys("classes")).toEqual(["m3", "m2"])
        expect(weekDays(input(items, [anat, phys], { schedule: "classes" })).count).toBe(0)
    })

    it("leaves out empty days only while searching", () => {
        expect(weekDays(input(items, [anat, phys])).days).toHaveLength(7)
        const w = weekDays(input(items, [anat, phys], { filters: { ...ALL, search: "early" } }))
        expect(w.days.map((d) => d.date)).toEqual(["2026-09-23"])
        expect(weekDays(input(items, [], { filters: { ...ALL, search: "nothing" } })).any).toBe(false)
    })

    it("follows the school calendar: no classes on a day off, another day's on a swap", () => {
        const cal = normalizeSchool({
            terms: [{ name: "Autumn 2026", start: "2026-09-01", end: "2026-12-18" }],
            days: [{ from: "2026-09-21", kind: "off", label: "Holiday" }, { from: "2026-09-24", kind: "swap", follows: 3 }],
        })
        const w = weekDays(input([], [anat, phys], { cal }))
        expect(w.days[0].info?.kind).toBe("off")
        expect(w.days[0].entries).toEqual([])
        expect(w.days[3].entries.map((e) => e.kind === "class" && e.slot.mtg.id)).toEqual(["m3", "m2"])
    })

    it("shows a course's classes only in its semester; all-year courses in both", () => {
        const fall = course({ ...anat, term: "Fall 2026" }), winter = course({ ...phys, term: "winter 2027" }, 1)
        const w = weekDays(input([], [fall, winter], { cal: TWO }))
        const ids = (i: number) => w.days[i].entries.map((e) => e.kind === "class" && e.slot.mtg.id)
        expect(ids(0)).toEqual(["m1"])          /* Monday is still Fall */
        expect(ids(2)).toEqual(["m3"])          /* Wednesday is Winter: Anatomy's Wednesday class is gone */
        const both = course({ ...anat, term: "" })
        expect(weekDays(input([], [both], { cal: TWO })).days[2].entries).toHaveLength(1)
    })
})

describe("the side panels", () => {
    it("sort office hours Monday first", () => {
        const oh = [
            item({ id: "fri", type: "office", recur: "weekly", weekday: 5, start: "10:00" }),
            item({ id: "sun", type: "office", recur: "weekly", weekday: 0, start: "10:00" }),
            item({ id: "mon", type: "office", recur: "weekly", weekday: 1, start: "12:00" }),
        ]
        expect(officeHours(oh, [], ALL).map((x) => x.id)).toEqual(["mon", "fri", "sun"])
    })

    it("put open tasks first, by date, nine at most", () => {
        const list = Array.from({ length: 12 }, (_, i) => item({ id: "t" + i, type: "task", date: "2026-09-" + String(10 + i), status: i < 2 ? "done" : "todo" }))
        const t = tasks(list, [], ALL)
        expect(t.shown).toHaveLength(9)
        expect(t.shown[0].id).toBe("t2")
        expect(t.open).toBe(10)
        expect(t.total).toBe(12)
    })
})

describe("the month", () => {
    it("puts a course's classes only on days in its semester", () => {
        const fall = course({ ...anat, term: "Fall 2026" })
        const m = monthCells(input([], [fall], { cal: TWO, schedule: "classes" }))
        const cell = (date: string) => m.cells.find((c) => c.date === date)!
        expect(cell("2026-09-16").classes).toBe(1)   /* a Wednesday in Fall */
        expect(cell("2026-09-30").classes).toBe(0)   /* a Wednesday in Winter */
    })

    it("has 42 cells from the Monday on or before the 1st", () => {
        const m = monthCells(input([], [anat]))
        expect(m.cells).toHaveLength(42)
        expect(m.cells[0].date).toBe("2026-08-31")
        expect(m.cells[0].out).toBe(true)
        expect(m.cells.find((c) => c.isToday)?.date).toBe(TODAY)
        expect(m.title).toBe("Classes and deadlines")
    })

    it("puts deadlines before classes, four chips a cell with the rest counted", () => {
        const due = ["a", "b", "c", "d"].map((id) => item({ id, date: "2026-09-23" }))
        const cell = monthCells(input(due, [anat, phys])).cells.find((c) => c.date === "2026-09-23")!
        expect(cell.chips.map((c) => c.kind)).toEqual(["due", "due", "due"])
        expect(cell.more).toBe(3)
        expect(cellLabel(cell)).toBe("Wed 2026-09-23, 4 due, 2 classes")
    })

    it("keeps weekly items and office hours off the grid, and follows the tab", () => {
        const list = [item({ id: "w", type: "task", recur: "weekly", weekday: 3, date: "2026-09-01" }), item({ id: "oh", type: "office", date: TODAY }), item({ id: "x" })]
        const chips = (schedule: Schedule) => monthCells(input(list, [anat], { schedule })).cells.find((c) => c.date === TODAY)!.chips.map((c) => c.key)
        expect(chips("all")).toEqual(["ix", "canatm2"])
        expect(chips("deadlines")).toEqual(["ix"])
        expect(chips("classes")).toEqual(["canatm2"])
        expect(monthCells(input(list, [anat], { schedule: "classes" })).title).toBe("Class schedule")
    })

    it("counts the classes a day off takes away", () => {
        const cal = normalizeSchool({ terms: [{ name: "Autumn 2026", start: "2026-09-01", end: "2026-12-18" }], days: [{ from: TODAY, kind: "off", label: "Holiday" }] })
        const cell = monthCells(input([], [anat, phys], { cal })).cells.find((c) => c.date === TODAY)!
        expect(cell.chips).toEqual([])
        expect(cell.off).toBe(2)
        expect(cellLabel(cell)).toBe("Wed 2026-09-23, Holiday")
    })

    it("names the school weeks shown", () => {
        const cal = normalizeSchool({ terms: [{ name: "Autumn 2026", start: "2026-09-07", end: "2026-12-18" }], days: [] })
        expect(monthCells(input([], [], { cal })).range).toBe("Weeks 1 – 5 · Autumn 2026")
    })

    it("lays out the weekly timetable, Sunday only when a class is on it", () => {
        const t = timetable([anat, phys], ALL)
        expect(t.map((d) => d.dow)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"])
        expect(t[2].slots.map((x) => x.mtg.id)).toEqual(["m3", "m2"])
        expect(t[2].hours).toBe(2)
        const sun = course({ id: "s", meetings: [mtg("m4", 0, "10:00", "11:00")] })
        expect(timetable([sun], ALL).map((d) => d.dow)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sun"])
    })

    it("keeps the timetable to the anchor's semester and all-year courses", () => {
        const fall = course({ ...anat, term: "Fall 2026" }), winter = course({ ...phys, term: "Winter 2027" }, 1)
        const ids = (t: ReturnType<typeof timetable>) => t.flatMap((d) => d.slots.map((x) => x.mtg.id))
        expect(ids(timetable([fall, winter], ALL, TWO, "2026-10-14"))).toEqual(["m3"])
        expect(ids(timetable([fall, winter], ALL, TWO, "2026-09-07"))).toEqual(["m1", "m2"])
        const both = course({ ...anat, term: "" })
        expect(ids(timetable([both, winter], ALL, TWO, "2026-10-14"))).toEqual(["m1", "m3", "m2"])
        expect(ids(timetable([fall, winter], ALL, null, "2026-10-14"))).toEqual(["m1", "m3", "m2"])
    })
})

describe("the table", () => {
    const list = [
        item({ id: "b", title: "beta", date: "2026-09-25", type: "lab", courseId: "phys" }),
        item({ id: "a", title: "Alpha", date: "2026-09-27", courseId: "anat", status: "submitted" }),
        item({ id: "c", title: "gamma", date: "2026-09-21" }),
    ]
    const ids = (key: "title" | "type" | "course" | "date" | "status", dir: 1 | -1 = 1) => tableRows(list, [anat, phys], TABLE, { key, dir }).map((x) => x.id)

    it("sorts by each column, both ways", () => {
        expect(ids("date")).toEqual(["c", "b", "a"])
        expect(ids("date", -1)).toEqual(["a", "b", "c"])
        expect(ids("title")).toEqual(["a", "b", "c"])
        expect(ids("type")).toEqual(["a", "c", "b"])
        expect(ids("course")).toEqual(["a", "b", "c"])   /* no course sorts last */
        expect(ids("status")).toEqual(["c", "b", "a"])   /* Open, Scheduled, Submitted */
    })

    const rows = (f: Partial<TableFilters>) => tableRows(list, [anat, phys], { ...TABLE, ...f }, { key: "date", dir: 1 }).map((x) => x.id)

    it("filters by course and search like the other views", () => {
        expect(rows({ search: "gam" })).toEqual(["c"])
        expect(rows({ course: "phys" })).toEqual(["b"])
    })

    it("drops switched-off types, which the week and month keep", () => {
        expect(rows({ types: { lab: false } })).toEqual(["c", "a"])
        expect(rows({ types: { assignment: false, lab: true } })).toEqual(["b"])
    })

    it("shows the open items, or only the overdue ones", () => {
        /* c is open and two days late; b is open and to come; a is submitted */
        expect(rows({ show: "open" })).toEqual(["c", "b"])
        expect(rows({ show: "overdue" })).toEqual(["c"])
        expect(rows({ show: "overdue", types: { assignment: false } })).toEqual([])
        const weekly = item({ id: "w", recur: "weekly", weekday: 1, date: "2026-09-01" })
        expect(tableRows([...list, weekly], [], { ...TABLE, show: "overdue" }, { key: "date", dir: 1 }).map((x) => x.id)).toEqual(["c"])
    })

    it("filters by source: personal, a class (with your items under it), a project", () => {
        const rows = [
            item({ id: "own" }),
            item({ id: "filed", classId: "webs00000001" }),
            { ...item({ id: "a1" }), key: "c:webs00000001/a1", spaceId: "webs00000001", source: "class" },
            { ...item({ id: "t1", type: "task" }), key: "p:fire00000001/t1", spaceId: "fire00000001", source: "project" },
        ] as EffectiveItem[]
        const ids = (source: string) => tableRows(rows, [], { ...TABLE, source }, { key: "title", dir: 1 }).map((r) => r.id)
        expect(ids("personal")).toEqual(["filed", "own"])
        expect(ids("space:webs00000001")).toEqual(["a1", "filed"])
        expect(ids("space:fire00000001")).toEqual(["t1"])
        expect(ids("all")).toHaveLength(4)
        /* a space you are no longer in (left, removed, deleted) goes back to everything */
        const mine = [{ id: "webs00000001" }, { id: "fire00000001" }]
        expect(pickedSource("space:gone00000001", mine)).toBe("all")
        expect(ids(pickedSource("space:gone00000001", mine))).toHaveLength(4)
        expect(pickedSource("space:fire00000001", mine)).toBe("space:fire00000001")
        expect(pickedSource("personal", [])).toBe("personal")
        expect(pickedSource(undefined, mine)).toBe("all")
    })

    it("counts each type's open and weekly items in the course, for the type chips", () => {
        const more = [...list, item({ id: "w", type: "lab", status: "done", recur: "weekly", weekday: 1, courseId: "phys" })]
        expect(typeCounts(more, "all")).toEqual({ lab: 2, assignment: 1 })
        expect(typeCounts(more, "anat")).toEqual({})
        /* and the Source filter, as the rows do */
        const sourced = [item({ id: "own", type: "lab" }), item({ id: "filed", type: "exam", classId: "webs00000001" })]
        expect(typeCounts(sourced, "all", "space:webs00000001")).toEqual({ exam: 1 })
        expect(typeCounts(sourced, "all", "personal")).toEqual({ lab: 1, exam: 1 })
    })

    it("lists, from a stat tile, only what Stats counts: your tasks, no project's own item", () => {
        const P = "p:fire00000001/"
        const rows = [
            item({ id: "c", date: "2026-09-21" }),
            { ...item({ id: "mine", type: "task", date: "2026-09-21" }), assignees: ["me"], key: P + "mine", spaceId: "fire00000001", source: "project" },
            { ...item({ id: "theirs", type: "task", date: "2026-09-21" }), assignees: ["them"], key: P + "theirs", spaceId: "fire00000001", source: "project" },
            { ...item({ id: "project", type: "project", date: "2026-09-22" }), key: P + "project", spaceId: "fire00000001", source: "project" },
        ] as EffectiveItem[]
        const f = { ...TABLE, show: "overdue" as const }, sort = { key: "date" as const, dir: 1 as const }
        const tile = tableView(rows, [], f, sort, true, "me")
        expect(tile.rows.map((r) => r.id)).toEqual(["c", "mine"])
        expect(tile.overdue).toBe(2)
        expect(tile.overdue).toBe(stats(forStats(rows, "me"), [], null, TODAY).overdue)
        /* the table itself keeps every row */
        const all = tableView(rows, [], f, sort, false, "me")
        expect(all.rows).toHaveLength(4)
        expect(all.overdue).toBe(4)
    })
})

describe("the stat tiles", () => {
    it("find the next exam or quiz, the earlier start on the same day", () => {
        const s = stats([
            item({ id: "past", type: "exam", date: "2026-09-20" }),
            item({ id: "late", type: "exam", date: "2026-09-26", start: "14:00" }),
            item({ id: "quiz", type: "quiz", date: "2026-09-26", start: "09:00", checklist: [{ id: "1", text: "x", done: true }, { id: "2", text: "y", done: false }] }),
            item({ id: "done", type: "quiz", date: "2026-09-24", status: "graded" }),
        ], [], null, TODAY)
        expect(s.nextExam?.id).toBe("quiz")
        expect(s.daysTo).toBe(3)
        expect(s.prep).toMatchObject({ done: 1, total: 2 })
    })

    it("count open assignments, those due this week, and the overdue", () => {
        const s = stats([
            item({ id: "a", date: "2026-09-27" }),
            item({ id: "b", date: "2026-10-02" }),
            item({ id: "c", date: "2026-09-22" }),
            item({ id: "d", date: "2026-09-24", status: "submitted" }),
        ], [], null, TODAY)
        expect(s.openAssignments).toBe(3)
        expect(s.dueThisWeek).toBe(2)
        expect(s.overdue).toBe(1)
        expect(stats([], [], null, TODAY).nextExam).toBeNull()
    })

    it("sum today's study against the goal, with the streak", () => {
        const at = (d: number, h: number) => new Date(2026, 8, d, h).getTime()
        const s = (id: string, startedAt: number, studyMinutes: number) => ({ id, courseId: null, itemId: null, startedAt, studyMinutes, roundsDone: 0, note: "", manual: false }) as StudySession
        const out = stats([], [s("1", at(23, 9), 40), s("2", at(23, 14), 30), s("3", at(22, 9), 20), s("4", at(21, 9), 20)], { goal: 90 }, TODAY)
        expect(out.study).toEqual({ minutes: 70, goal: 90, streak: 3 })
    })

    it("wrap the quote index", () => {
        const q = [{ id: "1", text: "a", source: "" }, { id: "2", text: "b", source: "" }]
        expect(quoteAt(q, 1)?.quote.text).toBe("b")
        expect(quoteAt(q, 5)?.ix).toBe(0)
        expect(quoteAt([], 0)).toBeNull()
    })
})
