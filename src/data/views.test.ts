import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/* The selectors are pure; only the hooks at the end of views.ts touch the store. */
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], quotes: [], study_sessions: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/legacy/js/query.js", () => ({ schoolCal: () => null }))

import { normalizeCourse, normalizeItem } from "@/core/model"
import { normalizeSchool } from "@/core/school"
import {
    cellLabel, classes, instances, monthCells, officeHours, quoteAt, stats, tableRows, tasks, timetable, weekDays,
    type Filters, type ViewInput,
} from "./views"
import type { Course, Item, Schedule, StudySession } from "./types"

/* Wednesday 23 September 2026; the week runs Mon 21 – Sun 27. */
const TODAY = "2026-09-23"
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

const item = (row: Partial<Item> & { id: string }): Item => normalizeItem({ type: "assignment", title: row.id, date: TODAY, status: "todo", ...row }) as Item
const course = (row: Partial<Course> & { id: string }, i = 0): Course => normalizeCourse({ code: row.id.toUpperCase(), name: row.id, ...row }, i) as Course
const mtg = (id: string, weekday: number, start: string, end: string, room = "") => ({ id, kind: "Lecture", weekday, start, end, room })

const ALL: Filters = { search: "", types: {}, course: "all" }
const input = (items: Item[], courses: Course[], over: Partial<ViewInput> = {}): ViewInput =>
    ({ items, courses, filters: ALL, schedule: "all", anchor: TODAY, today: TODAY, cal: null, ...over })

const anat = course({ id: "anat", color: "#C2571A", meetings: [mtg("m1", 1, "09:00", "10:30", "Hall B"), mtg("m2", 3, "14:00", "15:00")] })
const phys = course({ id: "phys", color: "#1E628F", meetings: [mtg("m3", 3, "08:00", "09:00")] }, 1)

describe("filters", () => {
    it("drop switched-off types, other courses and search misses", () => {
        const items = [item({ id: "a", courseId: "anat" }), item({ id: "b", type: "lab", courseId: "phys" }), item({ id: "c", title: "Renal set" })]
        const ids = (f: Filters) => instances(items, [anat, phys], f, "2026-09-21", "2026-09-27").map((x) => x.item.id)
        expect(ids(ALL)).toEqual(["a", "b", "c"])
        expect(ids({ ...ALL, types: { lab: false } })).toEqual(["a", "c"])
        expect(ids({ ...ALL, course: "phys" })).toEqual(["b"])
        expect(ids({ ...ALL, search: "renal" })).toEqual(["c"])
        expect(ids({ ...ALL, search: "PHYS" })).toEqual(["b"])   /* the course's name counts */
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
})

describe("the table", () => {
    const list = [
        item({ id: "b", title: "beta", date: "2026-09-25", type: "lab", courseId: "phys" }),
        item({ id: "a", title: "Alpha", date: "2026-09-27", courseId: "anat", status: "submitted" }),
        item({ id: "c", title: "gamma", date: "2026-09-21" }),
    ]
    const ids = (key: "title" | "type" | "course" | "date" | "status", dir: 1 | -1 = 1) => tableRows(list, [anat, phys], ALL, { key, dir }).map((x) => x.id)

    it("sorts by each column, both ways", () => {
        expect(ids("date")).toEqual(["c", "b", "a"])
        expect(ids("date", -1)).toEqual(["a", "b", "c"])
        expect(ids("title")).toEqual(["a", "b", "c"])
        expect(ids("type")).toEqual(["a", "c", "b"])
        expect(ids("course")).toEqual(["a", "b", "c"])   /* no course sorts last */
        expect(ids("status")).toEqual(["c", "b", "a"])   /* Open, Scheduled, Submitted */
    })

    it("filters like the other views", () => {
        expect(tableRows(list, [anat, phys], { ...ALL, search: "gam" }, { key: "date", dir: 1 }).map((x) => x.id)).toEqual(["c"])
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
