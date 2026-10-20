import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

// The grade panel, the course's grading setup, an item's weight row and the grading settings,
// over a fake store: the grades themselves (core/grades.ts) are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", grading: {} } as Record<string, unknown>,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    saveProfile: vi.fn(async (_patch: Record<string, unknown>) => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, saveProfile: fake.saveProfile }))

import { Grades } from "./grades"
import { GradeSetup, WeightProp } from "./grade-setup"
import { checkScale, GradingGroup, readMarks } from "./grading-settings"
import type { Course, Item } from "@/data/types"

afterEach(() => { cleanup(); fake.saveProfile.mockClear(); fake.data.profile = { id: "u-me", grading: {} } })

const CATS = [{ id: "quiz", name: "Quizzes", weight: 40, drop: 1 }, { id: "final", name: "Final", weight: 60, drop: 0 }]
const course = (over: Partial<Course> = {}) => ({ id: "bio", code: "BIO", name: "Biology", color: "#17B3AE", instructor: "", term: "", archived: false, target: null, meetings: [], ...over }) as Course
const item = (id: string, over: Partial<Item> = {}) => ({ id, type: "quiz", title: id, courseId: "bio", date: "2026-10-01", start: "", end: "", where: "", status: "todo", grade: null, weight: null, notes: "", checklist: [], links: [], ...over }) as unknown as Item

describe("the grade panel with categories", () => {
    it("shows each category, what its drops left out, and the letter on the 4.0 scale", () => {
        const items = [item("q1", { status: "graded", grade: 60, category: "quiz" }), item("q2", { status: "graded", grade: 90, category: "quiz" }), item("f", { type: "exam", category: "final" })]
        render(<Grades course={course({ gradeCategories: CATS })} items={items} whatIf={{}} setWhatIf={() => {}} onTarget={() => {}} />)
        expect(screen.getAllByText("90%")).toHaveLength(2)
        expect(screen.getByLabelText("Letter grade A-")).toBeTruthy()
        expect(screen.getByText("1 dropped")).toBeTruthy()
        /* the final is still to come: worth its category's 60% */
        expect(screen.getByText("Final · 60%", { selector: "em" })).toBeTruthy()
    })

    it("reads your scale and your pass marks", () => {
        fake.data.profile = { id: "u-me", grading: { scale: [{ letter: "P", min: 50, points: 1 }, { letter: "F", min: 0, points: 0 }], pass: [55] } }
        render(<Grades course={course()} items={[item("a", { status: "graded", grade: 70, weight: 40 }), item("b", { weight: 60 })]} whatIf={{}} setWhatIf={() => {}} onTarget={() => {}} />)
        expect(screen.getByLabelText("Letter grade P")).toBeTruthy()
        expect(screen.getByText(/to finish at 55\./)).toBeTruthy()
        expect(screen.queryByText(/finish at {2}or/)).toBeNull()
    })
})

describe("a course's grading setup", () => {
    it("adds, edits and removes a category, and sets the credits", () => {
        const onChange = vi.fn()
        const { rerender } = render(<GradeSetup course={course()} onChange={onChange} />)
        fireEvent.change(screen.getByLabelText("Credits"), { target: { value: "4" } })
        expect(onChange).toHaveBeenLastCalledWith({ credits: 4 })
        fireEvent.click(screen.getByText("+ Add a category"))
        const added = onChange.mock.lastCall![0].gradeCategories
        expect(added).toEqual([{ id: expect.any(String), name: "", weight: 0, drop: 0 }])
        rerender(<GradeSetup course={course({ gradeCategories: CATS })} onChange={onChange} />)
        fireEvent.change(screen.getByLabelText("Lowest scores dropped from Quizzes"), { target: { value: "2" } })
        expect(onChange.mock.lastCall![0].gradeCategories[0]).toMatchObject({ id: "quiz", drop: 2 })
        fireEvent.click(screen.getByLabelText("Remove Final"))
        expect(onChange.mock.lastCall![0].gradeCategories.map((c: { id: string }) => c.id)).toEqual(["quiz"])
    })

    it("warns when the categories pass 100%", () => {
        render(<GradeSetup course={course({ gradeCategories: [...CATS, { id: "x", name: "Labs", weight: 20, drop: 0 }] })} onChange={() => {}} />)
        expect(screen.getByText("Categories add up to 120%, over 100.")).toBeTruthy()
    })
})

describe("an item's weight row", () => {
    it("is its own weight without categories", () => {
        const onWeight = vi.fn()
        render(<WeightProp item={item("a", { weight: 10 })} course={course()} items={[]} onWeight={onWeight} onCategory={() => {}} />)
        expect(screen.queryByLabelText("Grade category")).toBeNull()
        fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "15" } })
        expect(onWeight).toHaveBeenCalledWith("15")
    })

    it("offers the course's categories, and says what one item of a category is worth", () => {
        const onCategory = vi.fn()
        const items = [item("a", { category: "quiz" }), item("b", { category: "quiz" }), item("c", { category: "quiz" })]
        render(<WeightProp item={items[0]} course={course({ gradeCategories: CATS })} items={items} onWeight={() => {}} onCategory={onCategory} />)
        expect(screen.getByText("about 20% each, lowest 1 dropped")).toBeTruthy()
        fireEvent.change(screen.getByLabelText("Grade category"), { target: { value: "" } })
        expect(onCategory).toHaveBeenCalledWith(null)
    })
})

describe("the grading settings", () => {
    it("read pass marks and check a scale", () => {
        expect(readMarks("65, 50 50")).toEqual([50, 65])
        expect(readMarks("")).toEqual([])
        expect(readMarks("50, 101")).toBeNull()
        expect(checkScale([{ letter: "A", min: "90", points: "4" }, { letter: "B", min: "90", points: "3" }])).toEqual({ error: "Two steps start at the same percentage." })
        expect(checkScale([{ letter: "B", min: "80", points: "3" }, { letter: "A", min: "90", points: "4" }])).toEqual({ scale: [{ letter: "A", min: 90, points: 4 }, { letter: "B", min: 80, points: 3 }] })
    })

    it("save your pass marks and your scale on your profile", () => {
        render(<GradingGroup profile={fake.data.profile as never} />)
        const pass = screen.getByDisplayValue("50, 60, 70")
        fireEvent.change(pass, { target: { value: "65" } })
        fireEvent.blur(pass)
        expect(fake.saveProfile).toHaveBeenLastCalledWith({ grading: { pass: [65] } })
        const details = screen.getByText("Letters and grade points").closest("details")!
        details.open = true
        fireEvent(details, new Event("toggle"))
        fireEvent.change(screen.getByLabelText("Grade points for A"), { target: { value: "4.3" } })
        fireEvent.click(screen.getByText("Save scale"))
        expect((fake.saveProfile.mock.lastCall![0].grading as { scale: unknown[] }).scale[0]).toEqual({ letter: "A", min: 93, points: 4.3 })
    })
})
