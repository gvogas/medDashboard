import { describe, expect, it } from "vitest"
import { courseGrades, gpaSummary } from "./gpa"
import type { EffectiveCourse, EffectiveItem } from "./effective"

const course = (id: string, over: Partial<EffectiveCourse> = {}) => ({ id, code: id, name: id, color: "#17B3AE", instructor: "", term: "", archived: false, target: null, meetings: [], ...over }) as EffectiveCourse
const item = (id: string, courseId: string, grade: number | null, over: Partial<EffectiveItem> = {}) =>
    ({ id, courseId, type: "exam", title: id, date: "2026-10-01", status: grade === null ? "todo" : "graded", grade, weight: 50, ...over }) as EffectiveItem
const CAL = { name: "", terms: [{ name: "Fall", start: "2026-09-01", end: "2026-12-20" }, { name: "Winter", start: "2027-01-05", end: "2027-04-30" }], days: [] }

describe("the GPA", () => {
    it("grades each course by its key, with its categories", () => {
        const courses = [course("bio", { gradeCategories: [{ id: "q", name: "Quizzes", weight: 100, drop: 1 }] }), course("web", { key: "c:sp1/web" })]
        const items = [
            item("q1", "bio", 50, { category: "q" }), item("q2", "bio", 90, { category: "q" }),
            item("w1", "web", 80, { courseKey: "c:sp1/web" }), item("w2", "web", 70),
        ]
        const g = courseGrades(courses, items)
        expect(g.get("bio")).toBe(90)
        expect(g.get("c:sp1/web")).toBe(80)
    })

    it("weights by credits: the semester picked, and overall", () => {
        const courses = [course("bio", { term: "Fall", credits: 4 }), course("chem", { term: "Winter" }), course("old", { term: "Fall", archived: true, credits: 1 })]
        const items = [item("b", "bio", 95), item("c", "chem", 75), item("o", "old", 50)]
        const s = gpaSummary(courses, items, {}, CAL, CAL.terms[0])
        expect(s.term).toEqual({ gpa: 3.2, credits: 5, courses: 2 })
        expect(s.overall).toEqual({ gpa: 2.75, credits: 8, courses: 3 })
    })

    it("without a calendar, this term is the courses not archived; your scale reads the letters", () => {
        const courses = [course("bio"), course("old", { archived: true })]
        const items = [item("b", "bio", 70), item("o", "old", 90)]
        const scale = { scale: [{ letter: "P", min: 60, points: 1 }, { letter: "F", min: 0, points: 0 }] }
        expect(gpaSummary(courses, items, scale, null, null)).toEqual({ term: { gpa: 1, credits: 3, courses: 1 }, overall: { gpa: 1, credits: 6, courses: 2 } })
        expect(gpaSummary([course("x")], [], {}, null, null)).toEqual({ term: null, overall: null })
    })
})
