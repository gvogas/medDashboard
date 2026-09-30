import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "./test-media"

/* The app is not booted: a store with data, a ui, and redraws that only notify.
   core/model.ts, data/query.ts and the actions are the real ones, so the filter logic is too. */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown },
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
    openCourse: vi.fn(),
    openSettings: vi.fn(),
}))

import { openCourse, openSettings } from "@/data/actions"
import { Sidebar } from "./sidebar"

stubMatchMedia({ reducedMotion: true })

const item = (id: string, type: string, status: string, courseId: string | null = null, recur: string | null = null) =>
    ({ id, type, status, courseId, recur, title: id })

const coursesNav = () => within(screen.getByRole("region", { name: "Courses" }))

beforeEach(() => {
    fake.data.items = []
    fake.data.courses = []
    fake.data.profile = { id: "p", username: "demo", displayName: "Dr Demo", coat: { name: "", role: "MS2 · Block 3", color: "" }, types: [] }
    fake.ui.types = {}
    fake.ui.course = "all"
    fake.ui.search = ""
    fake.ui.bg = "med"
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("the type filters", () => {
    it("are not in the sidebar: they are chips on All items", () => {
        render(<Sidebar />)
        expect(screen.queryByRole("region", { name: "Open items" })).toBeNull()
        expect(screen.queryByText("Open items")).toBeNull()
        expect(screen.queryByRole("button", { name: /Edit item types|Edit types/ })).toBeNull()
        expect(screen.queryByRole("button", { name: /^Exams/ })).toBeNull()
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

describe("the frame", () => {
    it("reads Term, with the theme, the pages and the foot", () => {
        render(<Sidebar />)
        expect(screen.getByText("Term")).toBeTruthy()
        expect(screen.getByText("Medicine")).toBeTruthy()
        expect(screen.getByRole("navigation", { name: "Pages" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy()
        expect(screen.getByText(/The good physician/)).toBeTruthy()
    })
})

describe("who this is", () => {
    it("draws the theme's picture with the coat's name or the display name, and the goal", () => {
        render(<Sidebar />)
        const pic = screen.getByRole("img", { name: /Lab coat/ })
        expect(pic.textContent).toContain("Dr Demo")
        expect(screen.getByRole("button", { name: /Headed for/ }).textContent).toBe("Headed forMS2 · Block 3")
        expect(screen.queryByRole("region", { name: "Spotify" })).toBeNull()   // the player waits for Spotify's first answer
    })

    it("the picture is a button that opens Settings at the theme", () => {
        render(<Sidebar />)
        fireEvent.click(screen.getByRole("button", { name: "Change theme: Medicine" }))
        expect(openSettings).toHaveBeenCalledWith("themeGrp")
        fireEvent.click(screen.getByRole("button", { name: /Headed for/ }))
        expect(openSettings).toHaveBeenLastCalledWith("o-goal")
    })

    it("says the theme's name under the wordmark and falls back to its first goal", () => {
        fake.ui.bg = "law"
        ;(fake.data.profile as { coat: { role: string } }).coat.role = ""
        render(<Sidebar />)
        expect(screen.getByText("Law")).toBeTruthy()
        expect(screen.getByRole("img", { name: /Suit jacket/ })).toBeTruthy()
        expect(screen.getByRole("button", { name: /Headed for/ }).textContent).toBe("Headed forLitigator")
    })
})
