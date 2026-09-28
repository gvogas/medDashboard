import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "./test-media"

/* The app is not booted: a store with data, a ui, and redraws that only notify.
   core/model.ts, data/query.ts and the actions are the real ones, so the filter logic is too. */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], profile: null as unknown },
    ui: { view: "week", search: "", types: {} as Record<string, boolean>, course: "all", bg: "med", anchor: "2026-09-28", settings: false },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    saveProfile: vi.fn(async () => {}),
    course: (id: string) => (fake.data.courses as { id: string }[]).find((c) => c.id === id),
}))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn() }))
vi.mock("@/data/actions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/data/actions")>()),
    reorderTypes: vi.fn(async () => {}),
    deleteType: vi.fn(async () => {}),
    openCourse: vi.fn(),
}))

import { useTypePrefs } from "@/core/model"
import { reorderTypes, openCourse } from "@/data/actions"
import { saveProfile } from "@/core/store"
import { Sidebar } from "./sidebar"
import type { TypePref } from "@/data/types"

stubMatchMedia({ reducedMotion: true })

let prefs: TypePref[] = []
useTypePrefs(() => prefs)

const item = (id: string, type: string, status: string, courseId: string | null = null, recur: string | null = null) =>
    ({ id, type, status, courseId, recur, title: id })

const MED = ["Exams", "Quizzes", "Assignments", "Labs", "Tutorials", "Office hours", "Tasks"]
const typesNav = () => within(screen.getByRole("region", { name: "Open items" }))
const coursesNav = () => within(screen.getByRole("region", { name: "Courses" }))
const pressedTypes = () => typesNav().getAllByRole("button", { pressed: true }).map((b) => b.textContent!.replace(/\d+$/, ""))

beforeEach(() => {
    prefs = []
    fake.data.items = []
    fake.data.courses = []
    fake.data.profile = { id: "p", username: "demo", displayName: "Dr Demo", coat: { name: "", role: "MS2 · Block 3", color: "" }, types: [] }
    fake.ui.types = {}
    fake.ui.course = "all"
    fake.ui.search = ""
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("the Open items filters", () => {
    it("lists every shown type with its open items, following the course and not the search", () => {
        fake.data.items = [
            item("a", "exam", "todo", "c1"), item("b", "exam", "done", "c1"), item("c", "exam", "todo", "c2"),
            item("d", "lab", "done", "c1", "weekly"),
        ]
        fake.data.courses = [{ id: "c1", name: "Course one", color: "#C2571A", archived: false, meetings: [] }]
        fake.ui.search = "nothing matches this"
        render(<Sidebar />)
        expect(pressedTypes()).toEqual(MED)
        const exams = typesNav().getByRole("button", { name: /Exams/ })
        expect(exams.textContent).toBe("Exams2")
        expect(typesNav().getByRole("button", { name: /Labs/ }).textContent).toBe("Labs1")

        act(() => { fireEvent.click(coursesNav().getByRole("button", { name: /^Course one/ })) })
        expect(typesNav().getByRole("button", { name: /Exams/ }).textContent).toBe("Exams1")
    })

    it("with every type showing, a click shows only that one", () => {
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: /Labs/ }))
        expect(pressedTypes()).toEqual(["Labs"])
    })

    it("when that type is the only one showing, a click brings them all back", () => {
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: /Labs/ }))
        fireEvent.click(typesNav().getByRole("button", { name: /Labs/ }))
        expect(pressedTypes()).toEqual(MED)
    })

    it("otherwise a click turns one type on or off", () => {
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: /Labs/ }))
        fireEvent.click(typesNav().getByRole("button", { name: /Exams/ }))
        expect(pressedTypes()).toEqual(["Exams", "Labs"])
        fireEvent.click(typesNav().getByRole("button", { name: /Exams/ }))
        expect(pressedTypes()).toEqual(["Labs"])
    })
})

describe("editing the types", () => {
    it("opens with ✎, lists hidden types too, and closes with Done or Escape", () => {
        render(<Sidebar />)
        expect(typesNav().queryByRole("button", { name: /^Reorder/ })).toBeNull()
        fireEvent.click(typesNav().getByRole("button", { name: "Edit item types" }))
        const grips = typesNav().getAllByRole("button", { name: /^Reorder/ })
        expect(grips).toHaveLength(8)                               // Projects too, hidden on Med
        expect(typesNav().getByRole("button", { name: "Show Projects" }).getAttribute("aria-pressed")).toBe("false")

        fireEvent.click(typesNav().getByRole("button", { name: "Done" }))
        expect(typesNav().queryByRole("button", { name: /^Reorder/ })).toBeNull()

        fireEvent.click(typesNav().getByRole("button", { name: "Edit item types" }))
        fireEvent.keyDown(typesNav().getAllByRole("button", { name: /^Reorder/ })[0], { key: "Escape" })
        expect(typesNav().queryByRole("button", { name: /^Reorder/ })).toBeNull()
        expect(document.activeElement).toBe(typesNav().getByRole("button", { name: "Edit item types" }))
    })

    it("moves a type with the arrow keys on its handle, keeping the keyboard there", () => {
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: "Edit item types" }))
        const grip = typesNav().getByRole("button", { name: /^Reorder Quizzes/ })
        grip.focus()
        fireEvent.keyDown(grip, { key: "ArrowUp" })
        expect(reorderTypes).toHaveBeenCalledWith(["quiz", "exam", "assignment", "lab", "tutoring", "office", "project", "task"])
        expect(typesNav().getAllByRole("button", { name: /^Reorder/ })[0].getAttribute("aria-label")).toMatch(/^Reorder Quizzes/)
        expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toMatch(/^Reorder Quizzes/)

        fireEvent.keyDown(typesNav().getByRole("button", { name: /^Reorder Exams/ }), { key: "ArrowDown" })
        expect(reorderTypes).toHaveBeenLastCalledWith(["quiz", "assignment", "exam", "lab", "tutoring", "office", "project", "task"])
    })

    it("offers delete only for a type of your own that no item uses", () => {
        prefs = [{ id: "c-free", label: "Viva", color: "#3F7A2E", kind: "todo" }, { id: "c-used", label: "Rota", color: "#6B5B45", kind: "event" }]
        fake.data.items = [item("x", "c-used", "todo")]
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: "Edit item types" }))
        const deletes = typesNav().queryAllByRole("button", { name: /^Delete/ }).map((b) => b.getAttribute("aria-label"))
        expect(deletes).toEqual(["Delete Vivas"])
        expect(typesNav().getByTitle("1 item uses it. Hide it instead").textContent).toBe("in use")
    })

    it("adds a type: Save waits for a name, and Enter saves", async () => {
        render(<Sidebar />)
        fireEvent.click(typesNav().getByRole("button", { name: "Edit item types" }))
        fireEvent.click(typesNav().getByRole("button", { name: "+ Add a type" }))
        const name = typesNav().getByRole("textbox", { name: "New type name" })
        expect(document.activeElement).toBe(name)
        expect((typesNav().getByRole("button", { name: "Add type" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(name, { target: { value: "Viva" } })
        expect((typesNav().getByRole("button", { name: "Add type" }) as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(typesNav().getByRole("button", { name: "To-do" }))
        fireEvent.keyDown(name, { key: "Enter" })
        const saved = vi.mocked(saveProfile).mock.calls[0][0] as { types: { label?: string; kind?: string }[] }
        expect(saved.types.at(-1)).toMatchObject({ label: "Viva", kind: "todo" })
        await vi.waitFor(() => expect(typesNav().queryByRole("textbox", { name: "New type name" })).toBeNull())
    })
})

describe("the courses", () => {
    beforeEach(() => {
        fake.data.courses = [
            { id: "c1", name: "Course one", color: "#C2571A", archived: false, meetings: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] },
            { id: "c2", name: "Course two", color: "#1E628F", archived: false, meetings: [] },
            { id: "c3", name: "Old course", color: "#3F7A2E", archived: true, meetings: [] },
        ]
    })

    it("count each course's open items, not its meetings, and leave out archived ones", () => {
        fake.data.items = [item("a", "exam", "todo", "c1"), item("b", "task", "done", "c1"), item("c", "lab", "todo", "c2"), item("d", "task", "todo", "c2")]
        render(<Sidebar />)
        expect(coursesNav().getByRole("button", { name: /^Course one/ }).textContent).toBe("Course one1")
        expect(coursesNav().getByRole("button", { name: /^Course two/ }).textContent).toBe("Course two2")
        expect(coursesNav().queryByText("Old course")).toBeNull()
    })

    it("filter by course, and open the course drawer from ✎ and + New course", () => {
        render(<Sidebar />)
        expect(coursesNav().getByRole("button", { name: "All courses" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(coursesNav().getByRole("button", { name: /^Course two/ }))
        expect(fake.ui.course).toBe("c2")
        expect(coursesNav().getByRole("button", { name: /^Course two/ }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(coursesNav().getByRole("button", { name: "Edit Course one" }))
        expect(openCourse).toHaveBeenCalledWith("c1")
        fireEvent.click(coursesNav().getByRole("button", { name: "+ New course" }))
        expect(openCourse).toHaveBeenLastCalledWith(null)
    })
})

describe("the coat", () => {
    it("embroiders the display name when the coat has none, and badges the username", () => {
        render(<Sidebar />)
        expect(screen.getAllByText("Dr Demo")).toHaveLength(2)             // the pocket and the badge; CSS shows one
        expect(screen.getByText("@demo")).toBeTruthy()
        expect(screen.getByRole("button", { name: "Edit the name on the coat" })).toBeTruthy()
        expect(screen.queryByRole("region", { name: "Spotify" })).toBeNull()   // the player waits for Spotify's first answer
    })
})
