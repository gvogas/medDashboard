import { describe, expect, it } from "vitest"
import { widgetData } from "./widgets"
import type { Course, Item } from "./types"

const course = (over: Partial<Course> = {}): Course => ({
    id: "c1", code: "BIO101", name: "Biology", color: "#17B3AE", instructor: "", term: "", archived: false, target: null,
    meetings: [
        { id: "m1", kind: "Lecture", weekday: 3, start: "09:00", end: "10:00", room: "B12" },   /* Wednesday */
        { id: "m2", kind: "Lab", weekday: 3, start: "14:00", end: "16:00", room: "" },
        { id: "m3", kind: "Lecture", weekday: 4, start: "09:00", end: "10:00", room: "B12" },
    ],
    ...over,
} as Course)
const item = (over: Partial<Item>): Item => ({
    id: "i1", type: "assignment", title: "Essay", courseId: "c1", date: "2026-10-16", start: "", end: "", where: "", status: "todo",
    grade: null, weight: null, notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "", completedAt: null,
    ...over,
} as Item)

const base = { sessions: [], studyPrefs: { goal: 60 }, cal: null, pro: true, accent: "#0F5F58", now: 1 }

describe("widget data", () => {
    it("today's classes in time order, the next exam, and what is due this week", () => {
        const w = widgetData({
            ...base, today: "2026-10-14",
            courses: [course()],
            items: [
                item({ id: "e1", type: "exam", title: "Midterm", date: "2026-10-20", start: "10:00" }),
                item({ id: "q1", type: "quiz", title: "Quiz 3", date: "2026-10-12" }),            /* past */
                item({ id: "a2", title: "Lab report", date: "2026-10-15", start: "23:59" }),
                item({ id: "a1", title: "Essay", date: "2026-10-16" }),
                item({ id: "a3", title: "Done", date: "2026-10-15", status: "done" }),
                item({ id: "a4", title: "Far away", date: "2026-11-30" }),
            ],
        })
        expect(w.classes.map((c) => [c.course, c.kind, c.start, c.room])).toEqual([["BIO101", "Lecture", "09:00", "B12"], ["BIO101", "Lab", "14:00", ""]])
        expect(w.nextExam).toEqual({ title: "Midterm", course: "BIO101", type: "Exam", date: "2026-10-20", start: "10:00" })
        expect(w.due.map((d) => d.title)).toEqual(["Lab report", "Essay"])
        expect(w.due[0].color).toBe("#17B3AE")
        expect(w.study).toMatchObject({ minutes: 0, goal: 60 })
        expect(w).toMatchObject({ v: 1, today: "2026-10-14", pro: true })
    })

    it("an archived course has no classes, and an empty term is empty, not broken", () => {
        const w = widgetData({ ...base, today: "2026-10-14", courses: [course({ archived: true })], items: [] })
        expect(w.classes).toEqual([])
        expect(w.nextExam).toBeNull()
        expect(w.due).toEqual([])
    })
})
