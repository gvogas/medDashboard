import { describe, expect, it } from "vitest"
import { carryEdits, type ImportPlan } from "./import-edit"

// Two plans of the same outline: the one the person edited, and the one a new target makes.
const plan = (courses: unknown[], items: unknown[]) => ({ notes: [], courses, items }) as unknown as ImportPlan

describe("carrying the edits over when the plan is rebuilt", () => {
    it("keeps a tick the person set by hand, even on a matched row the new plan defaults to unticked", () => {
        const from = plan([], [{ include: true, edited: true, match: "m1", row: { title: "Quiz 1", type: "quiz" } }])
        const to = plan([], [{ include: false, match: "m1", row: { title: "Quiz 1", type: "quiz" } }])
        carryEdits(from, to)
        expect(to.items).toEqual([{ include: true, edited: true, match: "m1", row: { title: "Quiz 1", type: "quiz" } }])
    })
    it("keeps an untouched row's default from the new plan, not the old one's", () => {
        const from = plan([], [{ include: false, match: "m2", row: { title: "Midterm", type: "quiz" } }])
        const to = plan([], [{ include: false, match: "m2", row: { title: "Midterm", type: "exam" } }])
        carryEdits(from, to)
        expect(to.items).toEqual([{ include: false, match: "m2", row: { title: "Midterm", type: "quiz" } }])
    })
    it("ticks an undated row the planner left unticked once the new plan dates it", () => {
        const from = plan([], [{ include: false, row: { title: "Essay", type: "essay", date: "" } }])
        const to = plan([], [{ include: true, row: { title: "Essay", type: "essay", date: "2026-09-30" } }])
        carryEdits(from, to)
        expect(to.items).toEqual([{ include: true, row: { title: "Essay", type: "essay", date: "2026-09-30" } }])
    })
    it("carries a class meeting the person unticked, and keeps the new plan's default for one they did not touch", () => {
        const from = plan(
            [{ code: "WEB", meetings: [{ weekday: 1, start: "09:00", end: "10:30", include: false, edited: true }, { weekday: 3, start: "13:00", end: "15:00", include: false }] }],
            [],
        )
        const to = plan(
            [{ code: "WEB", meetings: [{ weekday: 1, start: "09:00", end: "10:30", include: true }, { weekday: 3, start: "13:00", end: "15:00", include: true }] }],
            [],
        )
        carryEdits(from, to)
        expect(to.courses[0].meetings).toEqual([
            { weekday: 1, start: "09:00", end: "10:30", include: false, edited: true },
            { weekday: 3, start: "13:00", end: "15:00", include: true },
        ])
    })
})
