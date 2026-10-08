import { describe, expect, it } from "vitest"
import { plan } from "./reminders"
import type { EffectiveItem, EffectiveCourse } from "./effective"

const item = (over: Partial<EffectiveItem>): EffectiveItem => ({
    id: "i1", type: "assignment", title: "Essay", courseId: "c1", date: "2026-10-20", start: "", end: "", where: "", status: "todo",
    grade: null, weight: null, notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "", completedAt: null,
    ...over,
} as EffectiveItem)
const course = { id: "c1", code: "BIO101" } as EffectiveCourse
const courseOf = () => course
const now = new Date(2026, 9, 10, 12, 0)

describe("reminders", () => {
    it("an assignment: the evening before and on the day, three hours before its time", () => {
        const list = plan([item({ start: "17:00" })], courseOf, now)
        expect(list.map((r) => [r.at.toString(), r.title, r.body])).toEqual([
            [new Date(2026, 9, 19, 18, 0).toString(), "Due tomorrow", "BIO101 · Essay at 17:00"],
            [new Date(2026, 9, 20, 14, 0).toString(), "Due today", "BIO101 · Essay at 17:00"],
        ])
        expect(new Set(list.map((r) => r.id)).size).toBe(2)
        expect(list.every((r) => Number.isInteger(r.id) && r.id > 0 && r.id < 2 ** 31)).toBe(true)
    })

    it("an exam: two evenings before and that morning; 9:00 for something due without a time", () => {
        const [a, b] = plan([item({ type: "exam", title: "Midterm" })], courseOf, now)
        expect([a.at.getDate(), a.at.getHours(), a.title]).toEqual([18, 18, "Exam in two days"])
        expect([b.at.getDate(), b.at.getHours(), b.at.getMinutes()]).toEqual([20, 7, 30])
        expect(plan([item({})], courseOf, now)[1].at.getHours()).toBe(9)
    })

    it("leaves out what is done, repeating, office hours, past, or over 30 days away", () => {
        expect(plan([
            item({ status: "done" }), item({ recur: "weekly" }), item({ type: "office" }),
            item({ date: "2026-10-01" }), item({ date: "2026-12-01" }),
        ], courseOf, now)).toEqual([])
        /* the evening before has passed, the day itself is still ahead */
        expect(plan([item({ date: "2026-10-11" })], courseOf, new Date(2026, 9, 10, 19, 0)).map((r) => r.title)).toEqual(["Due today"])
    })

    it("keeps at most 60, soonest first", () => {
        const many = Array.from({ length: 50 }, (_, i) => item({ id: "i" + i, date: `2026-10-${String(12 + (i % 15)).padStart(2, "0")}` }))
        const list = plan(many, courseOf, now)
        expect(list).toHaveLength(60)
        expect(list.every((r, i) => i === 0 || r.at >= list[i - 1].at)).toBe(true)
    })
})
