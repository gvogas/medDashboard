import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// The app is not booted: the views read a fake store and ui, and their buttons
// call the actions, which are fakes here.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown },
    ui: {
        view: "week", anchor: "2026-09-23", search: "", types: {} as Record<string, boolean>, show: "all", source: "all", listFrom: null, course: "all",
        focus: false, bg: "med", schedule: "all", sort: { key: "date", dir: 1 }, quoteIx: 0,
    },
}))
const actions = vi.hoisted(() => ({
    openItem: vi.fn(), newItemOn: vi.fn(), toggleTask: vi.fn(), quickAddTask: vi.fn(), setSchedule: vi.fn(),
    goToDay: vi.fn(), openCourse: vi.fn(), sortTable: vi.fn(), openStudy: vi.fn(), showTileList: vi.fn(),
    /* All items' chips (their own tests are in table-filters.test.tsx) */
    itemTypes: vi.fn(() => []), isTypeOn: vi.fn(() => true), toggleType: vi.fn(), setShow: vi.fn(), setSource: vi.fn(), endTileList: vi.fn(),
}))
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))
/* the Study page has its own tests (components/study/study.test.tsx) */
vi.mock("@/components/study/study-view", () => ({ StudyView: () => <p>The Study page</p> }))
vi.mock("@/core/store", () => ({
    data: fake.data,
    course: (id: string | null) => (fake.data.courses as { id: string }[]).find((c) => c.id === id) || null,
    subscribe: () => () => {},
}))

import { notify } from "@/bridge"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { Views } from "./views"
import { Stats } from "./stats"
import { StatsHost, ViewsHost } from "@/components/shell"

const item = (row: Record<string, unknown>) => normalizeItem({ type: "assignment", date: "2026-09-23", status: "todo", ...row })

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
    fake.data.courses = [normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#C2571A", meetings: [{ id: "m1", kind: "Lecture", weekday: 3, start: "09:00", end: "10:30", room: "Hall B" }] }, 0)]
    fake.data.items = [
        item({ id: "set", title: "Renal problem set", courseId: "anat", end: "23:59" }),
        item({ id: "t1", type: "task", title: "Print flashcards" }),
        item({ id: "oh", type: "office", title: "Dr. Patel — office hours", recur: "weekly", weekday: 2, date: "2026-09-01", start: "15:00" }),
    ]
    fake.data.quotes = []
    fake.data.study_sessions = []
    fake.data.profile = null
})
afterEach(() => {
    cleanup()
    Object.values(actions).forEach((fn) => fn.mockClear())
    Object.assign(fake.ui, { view: "week", search: "", types: {}, source: "all", schedule: "all", sort: { key: "date", dir: 1 }, quoteIx: 0, focus: false })
})

const set = (patch: Partial<typeof fake.ui>) => { Object.assign(fake.ui, patch); act(() => notify()) }
const host = (id: string) => document.getElementById(id)!
/* in its host, as <App> draws it */
const show = (node: React.ReactNode, id = "views") => render(id === "views" ? <ViewsHost>{node}</ViewsHost> : <StatsHost>{node}</StatsHost>)

describe("the views host", () => {
    it("shows the chosen view, Study or Spotify, and hides itself for the focus screen", () => {
        show(<Views />)
        expect(screen.getByRole("region", { name: "Schedule" })).toBeTruthy()
        set({ view: "month" })
        expect(screen.getByRole("region", { name: "Month" })).toBeTruthy()
        set({ view: "table" })
        expect(screen.getByRole("region", { name: "All items" })).toBeTruthy()
        expect(host("views").classList.contains("own-scroll")).toBe(true)
        set({ view: "spotify" })
        expect(screen.getByText("Checking your connection…")).toBeTruthy()      /* Spotify has not answered yet */
        expect(host("views").hidden).toBe(false)
        expect(host("views").classList.contains("own-scroll")).toBe(true)
        set({ view: "study" })
        expect(screen.getByText("The Study page")).toBeTruthy()
        expect(host("views").hidden).toBe(false)
        expect(host("views").classList.contains("own-scroll")).toBe(false)
        set({ view: "study", focus: true })
        expect(host("views").hidden).toBe(true)
        set({ view: "week", focus: true })
        expect(host("views").hidden).toBe(true)
    })
})

describe("the week", () => {
    it("opens an item, adds on a day, ticks a task and quick-adds one", () => {
        show(<Views />)
        fireEvent.click(screen.getByRole("button", { name: /Renal problem set/ }))
        expect(actions.openItem).toHaveBeenCalledWith("set")

        fireEvent.click(screen.getByRole("button", { name: "Add item on 2026-09-24" }))
        expect(actions.newItemOn).toHaveBeenCalledWith("2026-09-24")

        const box = screen.getByRole("button", { name: "Done: Print flashcards" })
        fireEvent.click(box)
        expect(actions.toggleTask).toHaveBeenCalledWith("t1", box)

        const input = screen.getByRole("textbox", { name: "Add a task" })
        fireEvent.change(input, { target: { value: "Book OSCE slot" } })
        fireEvent.keyDown(input, { key: "Enter" })
        expect(actions.quickAddTask).toHaveBeenCalledWith("Book OSCE slot")
        expect((input as HTMLInputElement).value).toBe("")
    })

    it("shows every type: the type chips filter only All items", () => {
        fake.ui.types = { assignment: false, task: false }
        show(<Views />)
        expect(screen.getByRole("button", { name: /Renal problem set/ })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Done: Print flashcards" })).toBeTruthy()
        set({ view: "month" })
        expect(screen.getByText("Renal problem set")).toBeTruthy()
        set({ view: "table" })
        expect(screen.queryByRole("row", { name: /Renal problem set/ })).toBeNull()
    })

    it("lists the day's class with its items, and the tabs choose between them", () => {
        show(<Views />)
        const schedule = screen.getByRole("region", { name: "Schedule" })
        const lecture = within(schedule).getByTitle("ANAT · Lecture · Hall B")
        expect(within(lecture).getByText("Lecture")).toBeTruthy()
        expect(within(lecture).getByText("Hall B")).toBeTruthy()
        fireEvent.click(within(schedule).getByRole("button", { name: "Classes" }))
        expect(actions.setSchedule).toHaveBeenCalledWith("classes")

        set({ schedule: "classes" })
        expect(within(schedule).queryByRole("button", { name: /Renal problem set/ })).toBeNull()
        expect(within(schedule).getByRole("button", { name: "Classes" }).getAttribute("aria-pressed")).toBe("true")
        set({ schedule: "deadlines" })
        expect(within(schedule).queryByTitle("ANAT · Lecture · Hall B")).toBeNull()
    })

    it("shows office hours, and the right message when the week is empty", () => {
        show(<Views />)
        fireEvent.click(within(screen.getByRole("region", { name: "Office hours" })).getByRole("button", { name: /Dr\. Patel/ }))
        expect(actions.openItem).toHaveBeenCalledWith("oh")

        set({ search: "zzz" })
        expect(screen.getByText("No matches this week")).toBeTruthy()
        fake.data.items = []
        fake.data.courses = []
        set({ search: "" })
        expect(screen.getByText("Nothing here yet")).toBeTruthy()
    })

    it("tints a completed row and keeps the checklist bar on an open one", () => {
        fake.data.items = [
            ...fake.data.items,
            item({ id: "hist", title: "Histology slides", status: "submitted" }),
            item({ id: "case", title: "Case write-up", checklist: [{ id: "c1", text: "History", done: true }, { id: "c2", text: "Exam", done: false }] }),
        ]
        show(<Views />)
        const done = screen.getByRole("button", { name: /Histology slides/ })
        expect(done.getAttribute("data-done")).toBe("true")
        expect(done.textContent).toMatch(/Done|Attended|Submitted|Taken/)
        const open = screen.getByRole("button", { name: /Case write-up/ })
        expect(open.getAttribute("data-done")).toBeNull()
        expect(open.querySelector("[data-steps]")).toBeTruthy()
        expect(open.textContent).toContain("1/2")
        expect(screen.getByRole("button", { name: /Renal problem set/ }).title).toBe("Renal problem set · due 23:59")
    })
})

describe("the month", () => {
    it("goes to a day's week and opens a class's course", () => {
        fake.ui.view = "month"
        show(<Views />)
        fireEvent.click(screen.getByRole("button", { name: "Wed 2026-09-23, 2 due, 1 class" }))
        expect(actions.goToDay).toHaveBeenCalledWith("2026-09-23")
        const timetable = screen.getByRole("region", { name: "Weekly timetable" })
        fireEvent.click(within(timetable).getByRole("button", { name: /Anatomy/ }))
        expect(actions.openCourse).toHaveBeenCalledWith("anat")
    })

    it("draws a class in its course's colour, and tints a completed deadline", () => {
        fake.data.items = [...fake.data.items, item({ id: "hist", title: "Histology slides", status: "submitted" })]
        fake.ui.view = "month"
        show(<Views />)
        const chip = document.querySelector("[data-class-chip]") as HTMLElement
        expect(chip).toBeTruthy()
        expect(chip.style.getPropertyValue("--c")).toMatch(/^#[0-9A-F]{6}$/i)
        expect(screen.getByTitle("Assignment: Histology slides · Done").getAttribute("data-done")).toBe("true")
        expect(screen.getByTitle("Assignment: Renal problem set").getAttribute("data-done")).toBeNull()
    })
})

describe("the table", () => {
    it("sorts by a column and opens a row with Enter", () => {
        fake.ui.view = "table"
        show(<Views />)
        const date = screen.getByRole("columnheader", { name: /Date/ })
        expect(date.getAttribute("aria-sort")).toBe("ascending")
        fireEvent.click(within(screen.getByRole("columnheader", { name: /Item/ })).getByRole("button"))
        expect(actions.sortTable).toHaveBeenCalledWith("title")

        const row = screen.getByRole("row", { name: /Renal problem set/ })
        fireEvent.keyDown(row, { key: "Enter" })
        expect(actions.openItem).toHaveBeenCalledWith("set")
        expect(screen.getByText("3 shown of 3")).toBeTruthy()
    })
})

describe("the stat tiles", () => {
    it("shows four boxes and no emoji", () => {
        render(<Stats />)
        const labels = ["Next exam or quiz", "Open assignments", "Overdue", "Studied today"]
        for (const l of labels) expect(screen.getByText(l)).toBeTruthy()
        expect(document.getElementById("stats")?.textContent ?? document.body.textContent).not.toMatch(/🔥/)
    })

    it("draws the theme's animation under the next exam, and none without one", () => {
        const { container, unmount } = render(<Stats />)
        expect(container.querySelector("[data-motif]")).toBeNull()
        unmount()
        fake.data.items = [...fake.data.items, item({ id: "exam", type: "exam", title: "Cardiology midterm", date: "2026-09-26" })]
        const r = render(<Stats />)
        expect(r.container.querySelector("[data-motif]")).not.toBeNull()
    })

    it("count the work", () => {
        fake.data.items = [
            ...fake.data.items,
            item({ id: "late", date: "2026-09-20" }),
            item({ id: "exam", type: "exam", title: "Cardiology midterm", date: "2026-09-26" }),
        ]
        show(<Stats />, "stats")
        expect(screen.getByText("Cardiology midterm exam")).toBeTruthy()
        expect(screen.getByText("In 3 days")).toBeTruthy()
        expect(screen.getByText("Needs attention today")).toBeTruthy()
        expect(screen.getByText("1 due this week")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: /Next exam/ }))
        expect(actions.openItem).toHaveBeenCalledWith("exam")
        /* Overdue and Open assignments open All items on just those (table-filters.test.tsx) */
        fireEvent.click(screen.getByRole("button", { name: /^Overdue/ }))
        expect(actions.showTileList).toHaveBeenCalledWith("overdue")
        fireEvent.click(screen.getByTitle("Show open assignments"))
        expect(actions.showTileList).toHaveBeenLastCalledWith("assignments")
    })

    it("name the exam once, and show an urgent pace in red", () => {
        const steps = [1, 2, 3, 4, 5].map((n) => ({ id: "s" + n, text: "Topic " + n, done: false }))
        fake.data.items = [item({ id: "fin", type: "exam", title: "Final exam", date: "2026-09-24", checklist: steps })]
        show(<Stats />, "stats")
        expect(screen.getByText("Final exam")).toBeTruthy()
        expect(screen.queryByText("Final exam exam")).toBeNull()
        const pace = screen.getByText("0/5 topics · 5/day")
        expect(pace.className).toContain("text-destructive")
        expect(pace.parentElement?.textContent).toBe("Tomorrow · 0/5 topics · 5/day")
    })

    it("show today's study against the goal", () => {
        fake.data.profile = { id: "p", studyPrefs: { goal: 90 } }
        fake.data.study_sessions = [{ id: "s", courseId: null, itemId: null, startedAt: new Date(2026, 8, 23, 9).getTime(), studyMinutes: 70, roundsDone: 0, note: "", manual: false }]
        show(<Stats />, "stats")
        expect(screen.getByRole("meter", { name: "Daily goal" }).getAttribute("aria-valuenow")).toBe("70")
        fireEvent.click(screen.getByRole("button", { name: /Studied today/ }))
        expect(actions.openStudy).toHaveBeenCalled()
    })

    it("show the streak in words, with no emoji", () => {
        fake.data.profile = { id: "p", studyPrefs: { goal: 90 } }
        const day = (d: number, id: string) => ({ id, courseId: null, itemId: null, startedAt: new Date(2026, 8, d, 9).getTime(), studyMinutes: 30, roundsDone: 0, note: "", manual: false })
        fake.data.study_sessions = [day(21, "a"), day(22, "b"), day(23, "c")]
        show(<Stats />, "stats")
        expect(within(host("stats")).getByText("3-day streak")).toBeTruthy()
        expect(host("stats").textContent).not.toMatch(/🔥/)
    })

    it("hide on the Study and Spotify views", () => {
        show(<Stats />, "stats")
        set({ view: "spotify" })
        expect(host("stats").hidden).toBe(true)
        expect(screen.queryByText("Overdue")).toBeNull()
    })
})

describe("classes in the views, for anyone", () => {
    const WEB = "c:abcdefghij12", store = fake.data as Record<string, unknown>
    beforeEach(() => {
        store.profile = { id: "u1", hiddenSources: [] }
        store.spaces = [{ id: "abcdefghij12", scope: WEB, kind: "class", role: "member", archived: false, name: "Web Services", parent: null, revision: 1, members: [] }]
        store.shared_courses = [{ ...normalizeCourse({ id: "web", code: "WEB", name: "Web Services", color: "#17B3AE" }), scope: WEB }]
        store.shared_items = [{ ...item({ id: "a1", title: "REST API Project", courseId: "web" }), scope: WEB }]
        store.marks = []
        store.space_prefs = []
        fake.data.items = [...fake.data.items, item({ id: "f1", type: "quiz", title: "Extra quiz", classId: "abcdefghij12" })]
    })
    afterEach(() => { for (const k of ["spaces", "shared_courses", "shared_items", "marks", "space_prefs"]) store[k] = [] })

    it("mark a class's item and yours filed under it, and open the class's by its key", () => {
        show(<Views />)
        const row = screen.getByRole("button", { name: /REST API Project/ })
        expect(within(row).getByRole("img", { name: "Shared · Web Services" })).toBeTruthy()
        fireEvent.click(row)
        expect(actions.openItem).toHaveBeenCalledWith(WEB + "/a1")
        expect(within(screen.getByRole("button", { name: /Extra quiz/ })).getByRole("img", { name: "Yours, under Web Services" })).toBeTruthy()
    })

    it("leave a hidden source off the week, and keep it on All items", () => {
        store.profile = { id: "u1", isAdmin: false, hiddenSources: ["space:abcdefghij12"] }
        show(<Views />)
        expect(screen.queryByRole("button", { name: /REST API Project/ })).toBeNull()
        expect(screen.queryByRole("button", { name: /Extra quiz/ })).toBeNull()
        set({ view: "table" })
        expect(screen.getByRole("row", { name: /REST API Project/ })).toBeTruthy()
    })
})

describe("projects in the views", () => {
    const WEB = "c:abcdefghij12", FIRE = "p:fire00000001", store = fake.data as Record<string, unknown>
    const team = (row: Record<string, unknown>, assignees: string[] = []) => ({ ...item(row), scope: FIRE, updatedBy: null, assignees, completedBy: null })
    beforeEach(() => {
        store.profile = { id: "u1", hiddenSources: [] }
        store.spaces = [
            { id: "abcdefghij12", scope: WEB, kind: "class", role: "member", archived: false, name: "Web Services", parent: null, revision: 1, members: [] },
            { id: "fire00000001", scope: FIRE, kind: "project", role: "member", archived: false, name: "Fire Response API", parent: { space: "abcdefghij12", item: "a1" }, revision: 1,
                members: [{ userId: "u1", name: "George", role: "member" }, { userId: "u2", name: "Sam", role: "owner" }] },
        ]
        store.shared_courses = [{ ...normalizeCourse({ id: "web", code: "WEB", name: "Web Services", color: "#17B3AE" }), scope: WEB }]
        store.shared_items = [
            { ...item({ id: "a1", title: "REST API Project", courseId: "web" }), scope: WEB },
            team({ id: "project", type: "project", title: "Fire Response API" }),
            team({ id: "t1", type: "task", title: "Write the endpoints" }, ["u1", "u2"]),
            team({ id: "t2", type: "task", title: "Draw the diagram" }, ["u2"]),
        ]
        store.marks = []
        store.space_prefs = []
    })
    afterEach(() => { for (const k of ["spaces", "shared_courses", "shared_items", "marks", "space_prefs"]) store[k] = [] })

    it("mark a team task and the assignment a project folds into on the week", () => {
        show(<Views />)
        expect(within(screen.getAllByRole("button", { name: /Write the endpoints/ })[0]).getByRole("img", { name: "Team task · assigned to you" })).toBeTruthy()
        expect(within(screen.getByRole("button", { name: /REST API Project/ })).getByRole("img", { name: "Team · Fire Response API" })).toBeTruthy()
        expect(screen.queryByRole("button", { name: /Draw the diagram/ })).toBeNull()
        set({ search: "fire response" })
        expect(screen.getByRole("button", { name: /REST API Project/ })).toBeTruthy()
    })

    it("list every team task on All items with who has it, and pick a source", () => {
        set({ view: "table" })
        show(<Views />)
        expect(within(screen.getByRole("row", { name: /Write the endpoints/ })).getByText(/You, Sam/)).toBeTruthy()
        expect(within(screen.getByRole("row", { name: /Draw the diagram/ })).getByRole("img", { name: "Team task" })).toBeTruthy()
        const source = screen.getByRole("combobox", { name: "Source" }) as HTMLSelectElement
        expect([...source.options].map((o) => o.textContent)).toEqual(["Everything", "Personal", "Web Services", "Fire Response API"])
        fireEvent.change(source, { target: { value: "space:fire00000001" } })
        expect(actions.setSource).toHaveBeenCalledWith("space:fire00000001")
    })
})
