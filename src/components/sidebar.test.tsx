import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "./test-media"

/* The app is not booted: a store with data, a ui, and redraws that only notify.
   core/model.ts, data/query.ts and the actions are the real ones, so the filter logic is too. */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown, spaces: [] as unknown[], shared_courses: [] as unknown[] },
    invites: [] as { spaceId: string; expired: boolean }[],
    ui: { view: "week", search: "", types: {} as Record<string, boolean>, course: "all", sem: null as string | null, bg: "med", anchor: "2026-09-28", settings: false },
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
const classes = vi.hoisted(() => ({ openClass: vi.fn(), openInvites: vi.fn(), openJoin: vi.fn(), openNewClass: vi.fn() }))
vi.mock("@/data/classes", () => ({ ...classes, useInvites: () => fake.invites }))

import { openCourse, openSettings } from "@/data/actions"
import { Sidebar } from "./sidebar"

stubMatchMedia({ reducedMotion: true })

const item = (id: string, type: string, status: string, courseId: string | null = null, recur: string | null = null) =>
    ({ id, type, status, courseId, recur, title: id })

const coursesNav = () => within(screen.getByRole("region", { name: "Courses" }))

beforeEach(() => {
    fake.data.items = []
    fake.data.courses = []
    fake.data.spaces = []
    fake.data.shared_courses = []
    fake.invites = []
    fake.data.profile = { id: "p", username: "demo", displayName: "Dr Demo", coat: { name: "", role: "MS2 · Block 3", color: "" }, types: [] }
    fake.ui.types = {}
    fake.ui.course = "all"
    fake.ui.sem = null
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

describe("the semester select", () => {
    const TERMS = [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }]
    beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
    afterAll(() => { vi.useRealTimers() })
    beforeEach(() => {
        fake.data.profile = { ...(fake.data.profile as object), schoolCalendar: { name: "", terms: TERMS, days: [] } }
        fake.data.courses = [
            { id: "f", name: "Fall course", color: "#C2571A", archived: false, term: "Fall 2026", meetings: [] },
            { id: "w", name: "Winter course", color: "#1E628F", archived: false, term: "Winter 2027", meetings: [] },
            { id: "b", name: "Year course", color: "#3F7A2E", archived: false, term: "", meetings: [] },
        ]
    })

    it("lists the current semester's courses and the all-year ones, marked Both", () => {
        render(<Sidebar />)
        expect(coursesNav().getByRole("button", { name: "Semester: Fall 2026" }).getAttribute("aria-expanded")).toBe("false")
        expect(coursesNav().getByRole("button", { name: /^Fall course/ })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: /^Winter course/ })).toBeNull()
        expect(coursesNav().getByRole("button", { name: /^Year course/ }).textContent).toContain("Both")
        expect(coursesNav().getByRole("button", { name: /^Fall course/ }).textContent).not.toContain("Both")
    })

    it("switches semester; a course picked outside it goes back to All courses", () => {
        fake.ui.course = "f"
        render(<Sidebar />)
        fireEvent.click(coursesNav().getByRole("button", { name: "Semester: Fall 2026" }))
        const list = coursesNav().getByRole("listbox", { name: "Semester" })
        expect(within(list).getByRole("option", { name: /Fall 2026/ }).getAttribute("aria-selected")).toBe("true")
        expect(document.activeElement).toBe(within(list).getByRole("option", { name: /Fall 2026/ }))
        fireEvent.keyDown(list, { key: "ArrowDown" })
        fireEvent.click(document.activeElement as HTMLElement)
        expect(coursesNav().queryByRole("listbox")).toBeNull()
        expect(fake.ui.sem).toBe("Winter 2027")
        expect(fake.ui.course).toBe("all")
        expect(coursesNav().getByRole("button", { name: /^Winter course/ })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: /^Fall course/ })).toBeNull()
    })

    it("still shows the course picked when the semester shown leaves it out", () => {
        fake.ui.course = "w"
        render(<Sidebar />)
        expect(coursesNav().getByRole("button", { name: /^Winter course/ }).getAttribute("aria-pressed")).toBe("true")
    })

    it("closes on Escape without picking, focus back on the button", () => {
        render(<Sidebar />)
        const button = coursesNav().getByRole("button", { name: "Semester: Fall 2026" })
        fireEvent.click(button)
        fireEvent.keyDown(coursesNav().getByRole("listbox"), { key: "Escape" })
        expect(coursesNav().queryByRole("listbox")).toBeNull()
        expect(document.activeElement).toBe(button)
        expect(fake.ui.sem).toBeNull()
    })

    it("is not there with one semester", () => {
        fake.data.profile = { ...(fake.data.profile as object), schoolCalendar: { name: "", terms: TERMS.slice(0, 1), days: [] } }
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: /^Semester/ })).toBeNull()
        expect(coursesNav().queryByText("Both")).toBeNull()
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

describe("shared classes, for admins", () => {
    beforeEach(() => {
        fake.data.profile = { ...(fake.data.profile as object), isAdmin: true }
        fake.data.spaces = [{
            id: "sp0000000001", scope: "c:sp0000000001", kind: "class", role: "owner", name: "Web Services", archived: false, parent: null, revision: 5,
            members: [{ userId: "p", name: "Dr Demo", role: "owner" }, { userId: "q", name: "Sam", role: "member" }],
        }]
        fake.data.shared_courses = [{ scope: "c:sp0000000001", id: "web", name: "Web Services", color: "#17B3AE" }]
        fake.invites = [{ spaceId: "sp0000000002", expired: false }, { spaceId: "sp0000000003", expired: true }]
    })

    it("list each class under the courses, opening the class, and the invites waiting", () => {
        render(<Sidebar />)
        fireEvent.click(coursesNav().getByRole("button", { name: /^Web Services, shared, 2 members/ }))
        expect(classes.openClass).toHaveBeenCalledWith("sp0000000001")
        expect(coursesNav().getByRole("button", { name: /^Invites/ }).textContent).toBe("Invites1")
        fireEvent.click(coursesNav().getByRole("button", { name: /^Invites/ }))
        expect(classes.openInvites).toHaveBeenCalled()
    })

    it("turn + New course into a menu: a course, a shared class, or joining with a code", () => {
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: "+ New course" })).toBeNull()
        const menu = () => { fireEvent.click(coursesNav().getByRole("button", { name: "+ New" })); return within(coursesNav().getByRole("menu", { name: "New" })) }
        fireEvent.click(menu().getByRole("menuitem", { name: /^New shared class/ }))
        expect(classes.openNewClass).toHaveBeenCalled()
        expect(coursesNav().queryByRole("menu")).toBeNull()
        fireEvent.click(menu().getByRole("menuitem", { name: /^Join with code/ }))
        expect(classes.openJoin).toHaveBeenCalled()
        fireEvent.click(menu().getByRole("menuitem", { name: /^New course/ }))
        expect(openCourse).toHaveBeenLastCalledWith(null)
    })

    it("close the menu on Escape, focus back on + New", () => {
        render(<Sidebar />)
        const button = coursesNav().getByRole("button", { name: "+ New" })
        fireEvent.click(button)
        const menu = coursesNav().getByRole("menu", { name: "New" })
        expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[0])
        fireEvent.keyDown(menu, { key: "Escape" })
        expect(coursesNav().queryByRole("menu")).toBeNull()
        expect(document.activeElement).toBe(button)
    })
})

describe("shared classes, for everyone else", () => {
    it("are not there: no class rows, no invites, + New course as before", () => {
        fake.data.spaces = [{ id: "sp0000000001", scope: "c:sp0000000001", kind: "class", role: "owner", name: "Web Services", archived: false, parent: null, revision: 5, members: [] }]
        fake.invites = [{ spaceId: "sp0000000002", expired: false }]
        render(<Sidebar />)
        expect(coursesNav().queryByRole("button", { name: /Web Services/ })).toBeNull()
        expect(coursesNav().queryByRole("button", { name: /^Invites/ })).toBeNull()
        expect(coursesNav().getByRole("button", { name: "+ New course" })).toBeTruthy()
        expect(coursesNav().queryByRole("button", { name: "+ New" })).toBeNull()
    })
})
