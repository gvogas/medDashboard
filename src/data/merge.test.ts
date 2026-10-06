import { describe, expect, it, vi } from "vitest"

vi.mock("@/core/store", () => ({ data: { courses: [], shared_courses: [], spaces: [] } }))
vi.mock("@/core/api", () => ({ api: { spaces: { absorb: vi.fn() } } }))
vi.mock("@/core/sync", () => ({ syncNow: vi.fn() }))
vi.mock("./overlay", () => ({ openSheet: vi.fn() }))
vi.mock("./classes", () => ({ openClass: vi.fn() }))
vi.mock("./toast", () => ({ toast: vi.fn() }))

import { matchFor, pairItems } from "./merge"
import type { Course, SharedCourse } from "./types"

const row = (id: string, type: string, title: string, date: string) => ({ id, type, title, date })

describe("pairing your items with a class's", () => {
    it("pairs identical ids first, then the same type and title on the nearest date", () => {
        const mine = [row("q1", "quiz", "Quiz 1", "2026-10-01"), row("x2", "exam", "Midterm", "2026-10-14"), row("x3", "assignment", "Lab report #2", "2026-10-20")]
        const theirs = [row("q1", "quiz", "Quiz 1", "2026-10-01"), row("e1", "exam", "midterm", "2026-10-16"), row("e2", "exam", "Midterm", "2026-12-10"), row("a9", "assignment", "Lab Report 2", "2026-10-21")]
        expect(pairItems(mine, theirs)).toEqual({ pairs: [["q1", "q1"], ["x2", "e1"], ["x3", "a9"]], apart: [] })
    })

    it("leaves apart what it is unsure of, a lecture review, and an item of your own type", () => {
        const mine = [row("x1", "quiz", "Quiz", "2026-10-10"), row("rvab12cd31", "task", "Review 1/4 · WEB Lecture Mon 5 Oct", "2026-10-06"), row("c1", "c-viva", "Viva", "2026-10-20"), row("x4", "quiz", "Quiz", "2026-10-10")]
        const theirs = [row("s1", "quiz", "Quiz", "2026-10-08"), row("s2", "quiz", "Quiz", "2026-10-12"), row("rvab12cd31", "task", "Review", "2026-10-06"), row("c1", "exam", "Viva", "2026-10-20")]
        expect(pairItems(mine, theirs)).toEqual({ pairs: [], apart: ["x1", "rvab12cd31", "c1", "x4"] })
    })
})

describe("a course of yours matching a class", () => {
    it("is the one with the class course's id, else its code, else its name", () => {
        const shared = [{ scope: "c:abcdefghij12", id: "web", code: "CS 446", name: "Web Services" }] as unknown as SharedCourse[]
        const courses = (list: object[]) => list as Course[]
        expect(matchFor("abcdefghij12", courses([{ id: "web", code: "X", name: "Y" }]), shared)?.id).toBe("web")
        expect(matchFor("abcdefghij12", courses([{ id: "a", code: "cs446", name: "Other" }]), shared)?.id).toBe("a")
        expect(matchFor("abcdefghij12", courses([{ id: "b", code: "WS", name: "web services" }]), shared)?.id).toBe("b")
        expect(matchFor("abcdefghij12", courses([{ id: "c", code: "BIO", name: "Biology" }]), shared)).toBeNull()
        expect(matchFor("zzzzzzzzzzzz", courses([{ id: "web", code: "X", name: "Y" }]), shared)).toBeNull()
    })
})
