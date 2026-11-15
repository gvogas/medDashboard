import { afterEach, describe, expect, it, vi } from "vitest"

// The Study plan card's actions over the data: a tick is the exam's own checklist step (your
// mark's, on a class exam), Study this sets the timer's course and item, and the day's target
// is read back only on the day it was kept.
const fake = vi.hoisted(() => ({
    items: {} as Record<string, any>,
    editNow: vi.fn(async () => {}), editMark: vi.fn(async () => {}), pickCourse: vi.fn(), pickItem: vi.fn(),
}))
vi.mock("./effective", () => ({ effectiveItems: () => Object.values(fake.items), itemByKey: (k: string) => fake.items[k] ?? null, courseKeyOf: (it: any) => (it.courseKey !== undefined ? it.courseKey : it.courseId) }))
vi.mock("./item-edit", () => ({ editNow: fake.editNow }))
vi.mock("./marks", () => ({ editMark: fake.editMark }))
vi.mock("./study-timer", () => ({ pickCourse: fake.pickCourse, pickItem: fake.pickItem }))
vi.mock("./store", () => ({ useItems: () => [], useMarks: () => [], useProfile: () => null, useSharedCourses: () => [], useSharedItems: () => [] }))

import { readTarget, studyExam, tickTopic } from "./study-plan"

const step = (id: string, text: string, done = false) => ({ id, text, done })
const CLASS_KEY = "c:abcdefghij12/m1"

afterEach(() => { vi.clearAllMocks(); fake.items = {}; try { localStorage.clear() } catch {} })

describe("ticking a topic from the plan", () => {
    it("ticks the first open step with that text on your own exam, and saves the whole list", async () => {
        fake.items = { ex1: { id: "ex1", checklist: [step("a", "Thorax", true), step("b", " Thorax "), step("c", "Abdomen")] } }
        await tickTopic("ex1", "Thorax", true)
        expect(fake.editNow).toHaveBeenCalledWith("ex1", { checklist: [step("a", "Thorax", true), step("b", " Thorax ", true), step("c", "Abdomen")] })
        expect(fake.editMark).not.toHaveBeenCalled()
    })

    it("unticks the first done step with that text", async () => {
        fake.items = { ex1: { id: "ex1", checklist: [step("a", "Thorax", true), step("b", "Abdomen", true)] } }
        await tickTopic("ex1", "Abdomen", false)
        expect(fake.editNow).toHaveBeenCalledWith("ex1", { checklist: [step("a", "Thorax", true), step("b", "Abdomen", false)] })
    })

    it("on a class exam the checklist is yours: it goes into your mark", async () => {
        fake.items = { [CLASS_KEY]: { id: "m1", key: CLASS_KEY, checklist: [step("a", "Thorax")] } }
        await tickTopic(CLASS_KEY, "Thorax", true)
        expect(fake.editMark).toHaveBeenCalledWith(CLASS_KEY, { checklist: [step("a", "Thorax", true)] })
        expect(fake.editNow).not.toHaveBeenCalled()
    })

    it("does nothing for an exam that is gone or a topic that is not there", async () => {
        fake.items = { ex1: { id: "ex1", checklist: [step("a", "Thorax", true)] } }
        await tickTopic("nope", "Thorax", true)
        await tickTopic("ex1", "Pelvis", true)
        await tickTopic("ex1", "Thorax", true)   /* already done */
        expect(fake.editNow).not.toHaveBeenCalled()
    })
})

describe("Study this", () => {
    it("sets the timer to the exam's course and the exam, by key", () => {
        fake.items = { ex1: { id: "ex1", courseId: "anat" }, [CLASS_KEY]: { id: "m1", key: CLASS_KEY, courseId: "web", courseKey: "c:abcdefghij12/web" } }
        expect(studyExam("ex1")).toBe(true)
        expect(fake.pickCourse).toHaveBeenLastCalledWith("anat")
        expect(fake.pickItem).toHaveBeenLastCalledWith("ex1")
        expect(studyExam(CLASS_KEY)).toBe(true)
        expect(fake.pickCourse).toHaveBeenLastCalledWith("c:abcdefghij12/web")
        expect(fake.pickItem).toHaveBeenLastCalledWith(CLASS_KEY)
    })

    it("leaves the timer alone for an exam with no course", () => {
        fake.items = { ex1: { id: "ex1", courseId: null } }
        expect(studyExam("ex1")).toBe(false)
        expect(fake.pickCourse).not.toHaveBeenCalled()
    })
})

describe("the day's target", () => {
    it("is read back only for the day it was kept, and only as lists of text", () => {
        localStorage.setItem("rounds.plan.today", JSON.stringify({ date: "2026-10-20", target: { ex1: ["Thorax", 7, null], ex2: "no" } }))
        expect(readTarget("2026-10-20")).toEqual({ ex1: ["Thorax"] })
        expect(readTarget("2026-10-21")).toBeNull()
        localStorage.setItem("rounds.plan.today", "not json")
        expect(readTarget("2026-10-20")).toBeNull()
    })
})
