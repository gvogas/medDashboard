import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

/* The rows are pure; only the hooks touch the store. */
vi.mock("@/core/store", () => ({ data: { items: [], courses: [], quotes: [], study_sessions: [], profile: null }, subscribe: () => () => {} }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { normalizeCourse, normalizeItem } from "@/core/model"
import { agendaRows, agendaStart, gapLabel, setWeekLayout, weekLayout, type AgendaRow } from "./agenda"
import type { Filters, ViewInput } from "./views"
import type { Course, Item } from "./types"

/* Wednesday 23 September 2026 */
const TODAY = "2026-09-23"
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

const item = (row: Partial<Item> & { id: string }): Item => normalizeItem({ type: "assignment", title: row.id, date: TODAY, status: "todo", ...row }) as Item
const ALL: Filters = { search: "", course: "all" }
const input = (items: Item[], courses: Course[] = [], over: Partial<ViewInput> = {}): ViewInput =>
    ({ items, courses, filters: ALL, schedule: "all", anchor: TODAY, today: TODAY, cal: null, ...over })
const shape = (rows: AgendaRow[]) => rows.map((r) => (r.kind === "day" ? r.day.date : "gap " + r.from + ".." + r.to + " → " + r.until))

describe("agendaStart", () => {
    it("is today in this week, else the Monday the arrows moved to", () => {
        expect(agendaStart(TODAY, TODAY)).toBe(TODAY)
        expect(agendaStart("2026-09-21", TODAY)).toBe(TODAY)
        expect(agendaStart("2026-10-01", TODAY)).toBe("2026-09-28")
        expect(agendaStart("2026-09-16", TODAY)).toBe("2026-09-14")
    })
})

describe("agendaRows", () => {
    it("keeps today and the days with something on them, and folds the empty days between", () => {
        const a = agendaRows(input([item({ id: "x", date: "2026-09-26" }), item({ id: "y", date: "2026-10-02" })]), TODAY)
        expect(a.to).toBe("2026-10-06")
        expect(a.count).toBe(2)
        expect(shape(a.rows)).toEqual([
            "2026-09-23",
            "gap 2026-09-24..2026-09-25 → 2026-09-26",
            "2026-09-26",
            "gap 2026-09-27..2026-10-01 → 2026-10-02",
            "2026-10-02",
            "gap 2026-10-03..2026-10-06 → null",
        ])
        const last = a.rows.at(-1) as Extract<AgendaRow, { kind: "gap" }>
        expect(gapLabel(last)).toMatch(/^Nothing else through /)
        expect(gapLabel(a.rows[1] as Extract<AgendaRow, { kind: "gap" }>)).toMatch(/^Nothing until /)
    })

    it("shows a weekly class on each of its days across weeks", () => {
        const c = normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", meetings: [{ id: "m", kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "" }] }, 0) as Course
        const a = agendaRows(input([], [c]), TODAY)
        const days = a.rows.filter((r) => r.kind === "day").map((r) => (r as Extract<AgendaRow, { kind: "day" }>).day.date)
        expect(days).toEqual([TODAY, "2026-09-28", "2026-10-05"])
    })

    it("runs as long as asked", () => {
        expect(agendaRows(input([]), TODAY, 28).to).toBe("2026-10-20")
    })
})

describe("the layout", () => {
    const narrow = (on: boolean) => { window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia }

    it("is always the Week on a wide screen, the Agenda by default on a phone, then the person's choice", () => {
        narrow(false)
        expect(weekLayout()).toBe("week")
        narrow(true)
        expect(weekLayout()).toBe("agenda")
        setWeekLayout("week")
        expect(weekLayout()).toBe("week")
        narrow(false)
        expect(weekLayout()).toBe("week")
        narrow(true)
        setWeekLayout("agenda")
        expect(weekLayout()).toBe("agenda")
    })
})
