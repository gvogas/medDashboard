import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// The legacy app is not booted: the views read a fake store and ui, and their buttons
// call the actions, which are fakes here.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown },
    ui: {
        view: "week", anchor: "2026-09-23", search: "", types: {} as Record<string, boolean>, course: "all",
        focus: false, bg: "med", schedule: "all", sort: { key: "date", dir: 1 }, quoteIx: 0,
    },
}))
const actions = vi.hoisted(() => ({
    openItem: vi.fn(), newItemOn: vi.fn(), toggleTask: vi.fn(), quickAddTask: vi.fn(), setSchedule: vi.fn(),
    goToDay: vi.fn(), openCourse: vi.fn(), sortTable: vi.fn(), nextQuote: vi.fn(), openStudy: vi.fn(),
}))
vi.mock("@/data/actions", () => actions)
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))
vi.mock("@/legacy/js/query.js", () => ({ schoolCal: () => null }))
/* the Study page has its own tests (components/study/study.test.tsx) */
vi.mock("@/components/study/study-view", () => ({ StudyView: () => <p>The Study page</p> }))
vi.mock("@/legacy/js/store.js", () => ({
    data: fake.data,
    course: (id: string | null) => (fake.data.courses as { id: string }[]).find((c) => c.id === id) || null,
    subscribe: () => () => {},
}))

import { notify } from "@/bridge"
import { normalizeCourse, normalizeItem } from "@/legacy/js/model.js"
import { Views } from "./views"
import { Stats } from "./stats"

const item = (row: Record<string, unknown>) => normalizeItem({ type: "assignment", date: "2026-09-23", status: "todo", ...row })

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
    document.body.innerHTML = '<div id="stats"></div><div id="views"></div>'
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
    Object.assign(fake.ui, { view: "week", search: "", schedule: "all", sort: { key: "date", dir: 1 }, quoteIx: 0, focus: false })
})

const set = (patch: Partial<typeof fake.ui>) => { Object.assign(fake.ui, patch); act(() => notify()) }
const host = (id: string) => document.getElementById(id)!
const show = (node: React.ReactNode, id = "views") => render(<>{node}</>, { container: host(id) })

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

    it("lists the day's class with its items, and the tabs choose between them", () => {
        show(<Views />)
        const schedule = screen.getByRole("region", { name: "Schedule" })
        expect(within(schedule).getByText("Anatomy")).toBeTruthy()
        fireEvent.click(within(schedule).getByRole("button", { name: "Classes" }))
        expect(actions.setSchedule).toHaveBeenCalledWith("classes")

        set({ schedule: "classes" })
        expect(within(schedule).queryByRole("button", { name: /Renal problem set/ })).toBeNull()
        expect(within(schedule).getByRole("button", { name: "Classes" }).getAttribute("aria-pressed")).toBe("true")
        set({ schedule: "deadlines" })
        expect(within(schedule).queryByText("Anatomy")).toBeNull()
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
    it("count the work and turn the quote", () => {
        fake.data.items = [
            ...fake.data.items,
            item({ id: "late", date: "2026-09-20" }),
            item({ id: "exam", type: "exam", title: "Cardiology midterm", date: "2026-09-26" }),
        ]
        fake.data.quotes = [{ id: "q1", text: "Treat the patient.", source: "Osler" }, { id: "q2", text: "Listen.", source: "" }]
        show(<Stats />, "stats")
        expect(screen.getByText("Cardiology midterm")).toBeTruthy()
        expect(screen.getByText("needs attention today")).toBeTruthy()
        expect(screen.getByText("1 due this week")).toBeTruthy()
        expect(screen.getByText("1 / 2")).toBeTruthy()

        const quote = screen.getByRole("button", { name: /Treat the patient/ })
        fireEvent.click(quote)
        expect(actions.nextQuote).toHaveBeenCalledWith(quote)
        fireEvent.click(screen.getByRole("button", { name: /Next exam/ }))
        expect(actions.openItem).toHaveBeenCalledWith("exam")
    })

    it("show today's study against the goal", () => {
        fake.data.profile = { id: "p", studyPrefs: { goal: 90 } }
        fake.data.study_sessions = [{ id: "s", courseId: null, itemId: null, startedAt: new Date(2026, 8, 23, 9).getTime(), studyMinutes: 70, roundsDone: 0, note: "", manual: false }]
        show(<Stats />, "stats")
        expect(screen.getByRole("meter", { name: "Daily goal" }).getAttribute("aria-valuenow")).toBe("70")
        fireEvent.click(screen.getByRole("button", { name: /Study today/ }))
        expect(actions.openStudy).toHaveBeenCalled()
    })

    it("hide on the Study and Spotify views", () => {
        show(<Stats />, "stats")
        set({ view: "spotify" })
        expect(host("stats").hidden).toBe(true)
        expect(screen.queryByText("Overdue")).toBeNull()
    })
})
