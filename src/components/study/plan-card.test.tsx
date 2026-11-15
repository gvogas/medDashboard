import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// The Timer tab's Study plan card: today's target with boxes to tick, Study this, the days
// after, and what it says with nothing to plan. The plan itself is core/study-today.ts
// (test/study-today.test.js); here the hook is a fake that hands the card a view.
const fake = vi.hoisted(() => ({
    view: null as any,
    tick: vi.fn(), study: vi.fn(() => true), open: vi.fn(), toast: vi.fn(),
    items: {} as Record<string, any>,
}))
vi.mock("@/data/study-plan", () => ({ usePlanView: () => fake.view, tickTopic: fake.tick, studyExam: fake.study }))
vi.mock("@/data/effective", () => ({ itemByKey: (k: string) => fake.items[k] ?? null, courseKeyOf: (it: any) => it.courseId }))
vi.mock("@/data/actions", () => ({ openItem: fake.open }))
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/core/dates", async (orig) => ({ ...(await orig<object>()), today: () => "2026-10-20" }))

import { PlanCard } from "./plan-card"

const none = { today: [], upcoming: [], target: {}, left: 0, total: 0, exams: 0, bare: 0, bareKey: null }
const anatomy = { examKey: "ex1", exam: "Anatomy midterm", date: "2026-10-24", daysLeft: 4, topics: [{ text: "Thorax", done: false }, { text: "Abdomen", done: true }] }
const later = (date: string, topics: string[]) => ({ date, examKey: "ex1", exam: "Anatomy midterm", topics })

afterEach(() => { cleanup(); vi.clearAllMocks(); fake.items = {} })

describe("the Study plan card", () => {
    it("lists today's topics per exam as boxes, says how many are left, and ticks one through the exam's checklist", () => {
        fake.items = { ex1: { id: "ex1", courseId: "anat" } }
        fake.view = { ...none, today: [anatomy], left: 1, total: 2, exams: 1 }
        render(<PlanCard />)
        const card = screen.getByRole("region", { name: "Study plan" })
        expect(within(card).getByText("1 of 2 left today")).toBeTruthy()
        const exam = within(card).getByRole("group", { name: "Anatomy midterm" })
        expect(within(exam).getByText("in 4 days")).toBeTruthy()
        expect((within(exam).getByRole("checkbox", { name: "Thorax" }) as HTMLInputElement).checked).toBe(false)
        expect((within(exam).getByRole("checkbox", { name: "Abdomen" }) as HTMLInputElement).checked).toBe(true)
        fireEvent.click(within(exam).getByRole("checkbox", { name: "Thorax" }))
        expect(fake.tick).toHaveBeenCalledWith("ex1", "Thorax", true)
        fireEvent.click(within(exam).getByRole("checkbox", { name: "Abdomen" }))
        expect(fake.tick).toHaveBeenCalledWith("ex1", "Abdomen", false)
    })

    it("points the timer at an exam, and opens the exam from its name", () => {
        fake.items = { ex1: { id: "ex1", courseId: "anat" } }
        fake.view = { ...none, today: [anatomy], left: 1, total: 2, exams: 1 }
        render(<PlanCard />)
        fireEvent.click(screen.getByRole("button", { name: "Study Anatomy midterm with the timer" }))
        expect(fake.study).toHaveBeenCalledWith("ex1")
        expect(fake.toast).toHaveBeenCalledWith("The timer is set to Anatomy midterm.")
        fireEvent.click(screen.getByRole("button", { name: "Anatomy midterm" }))
        expect(fake.open).toHaveBeenCalledWith("ex1")
    })

    it("offers no Study this for an exam with no course: study time is logged against one", () => {
        fake.items = { ex1: { id: "ex1", courseId: null } }
        fake.view = { ...none, today: [anatomy], left: 1, total: 2, exams: 1 }
        render(<PlanCard />)
        expect(screen.queryByRole("button", { name: /with the timer/ })).toBeNull()
    })

    it("says so when today's topics are all done", () => {
        fake.view = { ...none, today: [{ ...anatomy, topics: [{ text: "Thorax", done: true }] }], left: 0, total: 1, exams: 1 }
        render(<PlanCard />)
        expect(screen.getByText("Done for today")).toBeTruthy()
        expect(screen.getByRole("status").textContent).toContain("Today's topics are done")
    })

    it("shows the next four study days, the rest behind Show all, tomorrow by name", () => {
        const days = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"]
        fake.view = { ...none, upcoming: days.map((d, i) => later(d, ["T" + i])), exams: 1 }
        render(<PlanCard />)
        expect(screen.getByText("Nothing planned for today.")).toBeTruthy()
        const list = screen.getByRole("list", { name: "Study days" })
        expect(within(list).getAllByText(/^Anatomy midterm$/)).toHaveLength(4)
        expect(within(list).getByText("Tomorrow")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Show all 6 study days" }))
        expect(within(list).getAllByText(/^Anatomy midterm$/)).toHaveLength(6)
        expect(screen.getByRole("button", { name: "Show fewer days" }).getAttribute("aria-expanded")).toBe("true")
    })

    it("with nothing to plan, says how a plan is made and offers the next exam that has no topics", () => {
        fake.items = { ex9: { id: "ex9", title: "Physiology final" } }
        fake.view = { ...none, bare: 1, bareKey: "ex9" }
        render(<PlanCard />)
        expect(screen.getByText(/Your next exam has no topics yet/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Add topics to Physiology final" }))
        expect(fake.open).toHaveBeenCalledWith("ex9")
        cleanup()
        fake.view = none
        render(<PlanCard />)
        expect(screen.getByText(/No study days in the next 14 days/)).toBeTruthy()
    })
})
