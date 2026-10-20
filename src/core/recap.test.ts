import { describe, expect, it } from "vitest"
import { defaultRange, termRecap } from "./recap"

/* local noon on a day, so the session's day is that day in any zone */
const at = (d: string) => new Date(d + "T12:00:00").getTime()
const s = (d: string, m: number, courseId: string | null = "anat") => ({ startedAt: at(d), studyMinutes: m, courseId })
const it_ = (id: string, over: Record<string, unknown>) => ({ id, type: "assignment", status: "todo", date: "2026-09-10", courseId: "anat", grade: null, weight: null, ...over }) as never

const FROM = "2026-09-01", TO = "2026-12-18", TODAY = "2026-10-20"

describe("termRecap", () => {
    it("adds up the study inside the range, up to today", () => {
        const r = termRecap([
            s("2026-08-31", 600),                       /* before the term */
            s("2026-09-01", 30), s("2026-09-01", 30, "phys"),
            s("2026-09-02", 90), s("2026-09-03", 20, null),
            s("2026-10-21", 500),                       /* after today */
        ], [], FROM, TO, TODAY, { dayMin: 15 })
        expect(r.minutes).toBe(170)
        expect(r.sessions).toBe(4)
        expect(r.daysStudied).toBe(3)
        expect(r.best).toEqual({ date: "2026-09-02", minutes: 90 })
        expect(r.longestStreak).toBe(3)
        expect(r.byCourse).toEqual([{ courseId: "anat", minutes: 120 }, { courseId: "phys", minutes: 30 }, { courseId: null, minutes: 20 }])
    })

    it("counts what was completed by type, the tests taken, and each course's grade", () => {
        const r = termRecap([], [
            it_("a", { status: "done" }),
            it_("b", { status: "submitted" }),
            it_("c", { type: "exam", status: "graded", grade: 80, weight: 40 }),
            it_("d", { type: "quiz", status: "missed", weight: 10 }),
            it_("e", { type: "quiz", status: "todo", date: "2026-11-01" }),   /* not yet */
            it_("f", { status: "done", date: "2026-08-20" }),                  /* before the term */
            it_("g", { type: "lab", status: "done", courseId: "phys" }),
        ], FROM, TO, TODAY)
        expect(r.completed).toEqual([{ type: "assignment", count: 2 }, { type: "exam", count: 1 }, { type: "lab", count: 1 }])
        expect(r.completedTotal).toBe(4)
        expect(r.tests).toBe(1)
        expect(r.grades).toEqual([{ courseId: "anat", current: 64 }])
    })

    it("counts a course's grade categories, dropping the lowest as the grade panel does", () => {
        const items = [
            it_("q1", { type: "quiz", status: "graded", grade: 50, weight: 10, category: "q" }),
            it_("q2", { type: "quiz", status: "graded", grade: 90, weight: 10, category: "q" }),
            it_("q3", { type: "quiz", status: "graded", grade: 70, weight: 10, category: "q" }),
        ]
        expect(termRecap([], items, FROM, TO, TODAY).grades).toEqual([{ courseId: "anat", current: 70 }])
        const cats = (id: string) => (id === "anat" ? [{ id: "q", name: "Quizzes", weight: 100, drop: 1 }] : null)
        expect(termRecap([], items, FROM, TO, TODAY, {}, cats).grades).toEqual([{ courseId: "anat", current: 80 }])
    })

    it("is empty for a range that has not started", () => {
        const r = termRecap([s("2026-10-01", 60)], [], "2027-01-05", "2027-04-30", TODAY)
        expect(r).toMatchObject({ minutes: 0, sessions: 0, best: null, longestStreak: 0, completedTotal: 0, grades: [] })
    })
})

describe("defaultRange", () => {
    it("is the last sixteen weeks through today", () => {
        expect(defaultRange(TODAY)).toEqual({ from: "2026-07-01", to: TODAY })
    })
})
