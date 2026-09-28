import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

/* A store in memory: saving replaces the row, as a reload does. */
const fake = vi.hoisted(() => ({ items: [] as { id: string }[], saved: [] as unknown[] }))
vi.mock("@/core/store", () => ({
    data: { get items() { return fake.items } },
    item: (id: string) => fake.items.find((x) => x.id === id) || null,
    saveItem: async (row: { id: string }) => { fake.saved.push(row); fake.items = fake.items.map((x) => (x.id === row.id ? row : x)) },
    subscribe: () => () => {},
}))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))

import { httpUrl, normalizeCourse, normalizeItem } from "@/core/model"
import { autoTitleFor, countdown, deriveEdit, editNow, flush, linkUrl, pendingFor, typeInto, TYPING_MS } from "./item-edit"
import { courseChanged, forSaving, newCourse } from "./course-edit"
import type { Course, Item } from "./types"

const item = (row: Partial<Item>) => normalizeItem({ id: "i1", type: "assignment", title: "", date: "2026-09-23", status: "todo", ...row }) as Item
const anat = normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", instructor: "Dr. Alvarez",
    meetings: [{ id: "m1", kind: "Lecture", weekday: 3, start: "09:00", end: "11:00", room: "Hall B" }] }, 0) as Course
const phys = normalizeCourse({ id: "phys", code: "PHYS", name: "Physiology", meetings: [] }, 1) as Course
const courseOf = (id: string | null) => (id === "anat" ? anat : id === "phys" ? phys : null)

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { fake.saved = [] })

describe("what an edit brings along", () => {
    it("names office hours, exams, quizzes and tutorials after the course, unless typed by hand", () => {
        expect(autoTitleFor("office", anat)).toBe("Dr. Alvarez — office hours")
        expect(autoTitleFor("exam", anat)).toBe("Exam — Anatomy")
        expect(autoTitleFor("assignment", anat)).toBe("")
        expect(deriveEdit(item({ type: "exam" }), "courseId", "anat", courseOf).title).toBe("Exam — Anatomy")
        expect(deriveEdit(item({ type: "exam", title: "Exam — Anatomy", courseId: "anat" }), "courseId", "phys", courseOf).title).toBe("Exam — Physiology")
        expect(deriveEdit(item({ type: "exam", title: "Midterm", courseId: "anat" }), "courseId", "phys", courseOf).title).toBe("Midterm")
    })

    it("moves the end with the start, and puts back a status the new type lacks", () => {
        expect(deriveEdit(item({ start: "09:00", end: "10:30" }), "start", "13:00", courseOf)).toMatchObject({ start: "13:00", end: "14:30" })
        const p = deriveEdit(item({ type: "assignment", status: "submitted" }), "type", "task", courseOf)
        expect(p).toMatchObject({ type: "task", status: "todo", completedAt: null })
        expect(deriveEdit(item({ status: "submitted" }), "type", "exam", courseOf).status).toBe("todo")
    })

    it("holds an exam in the class's room that day, unless a room was typed", () => {
        expect(deriveEdit(item({ type: "exam", courseId: "anat" }), "start", "09:30", courseOf).where).toBe("Hall B")
        expect(deriveEdit(item({ type: "exam", where: "Gym" }), "courseId", "anat", courseOf)).not.toHaveProperty("where")
    })

    it("keeps the weekday with the date on a weekly item, and sets it when it starts repeating", () => {
        expect(deriveEdit(item({ recur: "weekly", weekday: 3 }), "date", "2026-09-25", courseOf).weekday).toBe(5)
        expect(deriveEdit(item({}), "recur", true, courseOf)).toMatchObject({ recur: "weekly", weekday: 3 })
        expect(deriveEdit(item({ recur: "weekly", weekday: 3, recurUntil: "2026-12-01" }), "recur", false, courseOf)).toMatchObject({ recur: null, weekday: null, recurUntil: null })
    })

    it("reads weights and grades", () => {
        expect(deriveEdit(item({}), "weight", "150", courseOf).weight).toBe(100)
        expect(deriveEdit(item({}), "weight", "0", courseOf).weight).toBeNull()
        expect(deriveEdit(item({}), "grade", "", courseOf).grade).toBeNull()
        expect(deriveEdit(item({}), "status", "graded", courseOf).completedAt).toBe(Date.now())
    })

    it("counts down to the date", () => {
        expect(countdown(item({ date: "2026-09-23" }))).toBe("today")
        expect(countdown(item({ date: "2026-09-24" }))).toBe("tomorrow")
        expect(countdown(item({ date: "2026-09-26" }))).toBe("in 3 days")
        expect(countdown(item({ date: "2026-09-22" }))).toBe("1 day ago")
        expect(countdown(item({ recur: "weekly", weekday: 2 }))).toBe("every Tue")
    })

    it("turns what is typed into a web link, or nothing", () => {
        expect(linkUrl("example.com/a b", httpUrl)).toBe("https://example.com/a%20b")
        expect(linkUrl("http://x.org", httpUrl)).toBe("http://x.org")
        expect(linkUrl("javascript:alert(1)", httpUrl)).toBeNull()
        expect(linkUrl("  ", httpUrl)).toBeNull()
    })
})

describe("saving as you type", () => {
    it("waits for typing to pause, and saves what came before an edit that saves at once", async () => {
        fake.items = [item({ title: "Old" })]
        typeInto("i1", { title: "Ne" })
        typeInto("i1", { title: "New" })
        expect(pendingFor("i1")).toEqual({ title: "New" })
        expect(fake.saved).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(TYPING_MS)
        expect(fake.saved).toHaveLength(1)
        expect(fake.items[0]).toMatchObject({ title: "New" })

        typeInto("i1", { notes: "read ch. 4" })
        await editNow("i1", { status: "submitted" })
        expect(fake.saved).toHaveLength(2)
        expect(fake.items[0]).toMatchObject({ notes: "read ch. 4", status: "submitted" })
        expect(pendingFor("i1")).toBeNull()
    })

    it("saves at once on flush", async () => {
        fake.items = [item({})]
        typeInto("i1", { where: "Lab 4" })
        await flush()
        expect(fake.items[0]).toMatchObject({ where: "Lab 4" })
    })
})

describe("a course draft", () => {
    it("has changes when it differs from the stored course, or, new, has anything in it", () => {
        const fresh = newCourse(0)
        expect(courseChanged(fresh, null)).toBe(false)
        expect(courseChanged({ ...fresh, name: "Renal" }, null)).toBe(true)
        expect(courseChanged(structuredClone(anat), anat)).toBe(false)
        expect(courseChanged({ ...anat, room: "x" } as Course, anat)).toBe(false)
        expect(courseChanged({ ...anat, term: "2027" }, anat)).toBe(true)
    })

    it("gets a code from its name when saved without one", () => {
        expect(forSaving({ ...newCourse(0), name: "Pharmacology" }).code).toBe("PHAR")
    })
})
