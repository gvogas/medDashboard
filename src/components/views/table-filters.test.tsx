import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { stubMatchMedia } from "@/components/test-media"

/* The app is not booted: a store with data, a ui, and redraws that only notify.
   core/model.ts, data/query.ts, data/views.ts and the actions are the real ones, so the
   filter logic is too. (These were the sidebar's Open items filters and editor.) */
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], profile: null as unknown },
    ui: {
        view: "table", search: "", types: {} as Record<string, boolean>, show: "all", listFrom: null as string | null, course: "all",
        bg: "med", anchor: "2026-09-23", schedule: "all", sort: { key: "title", dir: -1 } as { key: string; dir: 1 | -1 }, quoteIx: 0, focus: false,
    },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    saveProfile: vi.fn(async () => {}),
    course: (id: string) => (fake.data.courses as { id: string }[]).find((c) => c.id === id) || null,
}))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn() }))
vi.mock("@/data/actions", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/data/actions")>()),
    reorderTypes: vi.fn(async () => {}),
    deleteType: vi.fn(async () => {}),
    openItem: vi.fn(),
}))

import { notify } from "@/bridge"
import { normalizeItem, useTypePrefs } from "@/core/model"
import { reorderTypes, setCourse, setSearch } from "@/data/actions"
import { saveProfile } from "@/core/store"
import { TableView } from "./table"
import { Stats } from "./stats"
import type { TypePref } from "@/data/types"

stubMatchMedia({ reducedMotion: true })

let prefs: TypePref[] = []
useTypePrefs(() => prefs)

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

const item = (id: string, type: string, status: string, courseId: string | null = null, recur: "weekly" | null = null, date = "2026-09-25") =>
    normalizeItem({ id, type, status, courseId, recur, title: id, date, weekday: 1 })

const MED = ["Exams", "Quizzes", "Assignments", "Labs", "Tutorials", "Office hours", "Tasks"]
const typeChips = () => within(screen.getByRole("group", { name: "Types" }))
const showChips = () => within(screen.getByRole("group", { name: "Show" }))
const editor = () => within(screen.getByRole("region", { name: "Item types" }))
const pressedTypes = () => typeChips().getAllByRole("button", { pressed: true }).map((b) => b.textContent!.replace(/\d+$/, ""))
const rowIds = () => screen.queryAllByRole("row").filter((r) => r.tabIndex === 0).map((r) => r.querySelector("b")!.textContent)
const openEditor = () => fireEvent.click(screen.getByRole("button", { name: "Edit types" }))

beforeEach(() => {
    prefs = []
    fake.data.items = []
    fake.data.courses = []
    fake.data.profile = { id: "p", username: "demo", displayName: "Dr Demo", types: [] }
    Object.assign(fake.ui, { view: "table", types: {}, show: "all", listFrom: null, course: "all", search: "", bg: "med", sort: { key: "date", dir: 1 } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("the type chips", () => {
    it("show every shown type with its open items, following the course and not the search", () => {
        fake.data.items = [
            item("a", "exam", "todo", "c1"), item("b", "exam", "done", "c1"), item("c", "exam", "todo", "c2"),
            item("d", "lab", "done", "c1", "weekly"),
        ]
        fake.data.courses = [{ id: "c1", name: "Course one", color: "#C2571A", archived: false, meetings: [] }]
        fake.ui.search = "nothing matches this"
        render(<TableView />)
        expect(pressedTypes()).toEqual(MED)
        expect(typeChips().getByRole("button", { name: /Exams/ }).textContent).toBe("Exams2")
        expect(typeChips().getByRole("button", { name: /Labs/ }).textContent).toBe("Labs1")

        act(() => setCourse("c1"))
        expect(typeChips().getByRole("button", { name: /Exams/ }).textContent).toBe("Exams1")
    })

    it("with every type showing, a click shows only that one, and the table follows", () => {
        fake.data.items = [item("an exam", "exam", "todo"), item("a lab", "lab", "todo")]
        render(<TableView />)
        expect(rowIds()).toEqual(["an exam", "a lab"])
        fireEvent.click(typeChips().getByRole("button", { name: /Labs/ }))
        expect(pressedTypes()).toEqual(["Labs"])
        expect(rowIds()).toEqual(["a lab"])
        expect(screen.getByText("1 shown of 2")).toBeTruthy()
    })

    it("when that type is the only one showing, a click brings them all back", () => {
        render(<TableView />)
        fireEvent.click(typeChips().getByRole("button", { name: /Labs/ }))
        fireEvent.click(typeChips().getByRole("button", { name: /Labs/ }))
        expect(pressedTypes()).toEqual(MED)
    })

    it("otherwise a click turns one type on or off", () => {
        render(<TableView />)
        fireEvent.click(typeChips().getByRole("button", { name: /Labs/ }))
        fireEvent.click(typeChips().getByRole("button", { name: /Exams/ }))
        expect(pressedTypes()).toEqual(["Exams", "Labs"])
        fireEvent.click(typeChips().getByRole("button", { name: /Exams/ }))
        expect(pressedTypes()).toEqual(["Labs"])
    })
})

describe("the status chips", () => {
    it("show all, the open items, or the overdue with their count; the empty table says why", () => {
        fake.data.items = [item("late", "assignment", "todo", null, null, "2026-09-20"), item("soon", "assignment", "todo"), item("done", "assignment", "submitted")]
        render(<TableView />)
        expect(showChips().getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true")
        expect(showChips().getByRole("button", { name: /Overdue/ }).textContent).toBe("Overdue1")
        fireEvent.click(showChips().getByRole("button", { name: "Open" }))
        expect(rowIds()).toEqual(["late", "soon"])
        fireEvent.click(showChips().getByRole("button", { name: /Overdue/ }))
        expect(fake.ui.show).toBe("overdue")
        expect(rowIds()).toEqual(["late"])

        fireEvent.click(typeChips().getByRole("button", { name: /Labs/ }))
        expect(rowIds()).toEqual([])
        expect(screen.getByText("Nothing matches the filters")).toBeTruthy()
        expect(screen.getByText("Hidden by Overdue, 6 types off.")).toBeTruthy()
    })
})

describe("the stat tiles", () => {
    const tiles = () => {
        fake.data.items = [
            item("late", "assignment", "todo", "c1", null, "2026-09-20"), item("late lab", "lab", "todo", "c2", null, "2026-09-21"),
            item("soon", "assignment", "todo", "c2"), item("sooner", "assignment", "todo", "c1", null, "2026-09-24"), item("done", "assignment", "submitted"),
        ]
        fake.data.courses = [{ id: "c1", name: "Course one", color: "#C2571A", archived: false, meetings: [] }, { id: "c2", name: "Course two", color: "#1E628F", archived: false, meetings: [] }]
        Object.assign(fake.ui, { view: "week", course: "c1", search: "late", types: { exam: false }, show: "open", sort: { key: "title", dir: -1 } })
        render(<><Stats /><TableView /></>)
    }

    it("Overdue opens every overdue item, soonest first, whatever the course and search", () => {
        tiles()
        const tile = screen.getByTitle("Show overdue items")
        expect(tile.tagName).toBe("BUTTON")
        fireEvent.click(tile)
        expect(fake.ui).toMatchObject({ view: "table", show: "overdue", types: {}, sort: { key: "date", dir: 1 }, listFrom: "tile" })
        expect(rowIds()).toEqual(["late", "late lab"])
        expect(within(tile).getByText("2")).toBeTruthy()
        expect(screen.getByText("Every course and no search, as on the tile.")).toBeTruthy()

        fireEvent.click(screen.getByRole("button", { name: "Use the course and search" }))
        expect(fake.ui.listFrom).toBeNull()
        expect(rowIds()).toEqual(["late"])
    })

    it("Open assignments opens just those; picking a course or searching ends the tile's list", () => {
        tiles()
        const tile = screen.getByTitle("Show open assignments")
        fireEvent.click(tile)
        expect(fake.ui.view).toBe("table")
        expect(fake.ui.show).toBe("open")
        expect(Object.entries(fake.ui.types).filter(([, on]) => on).map(([id]) => id)).toEqual(["assignment"])
        expect(pressedTypes()).toEqual(["Assignments"])
        expect(rowIds()).toEqual(["late", "sooner", "soon"])
        expect(within(tile).getByText("3")).toBeTruthy()

        act(() => setCourse("c2"))
        expect(fake.ui.listFrom).toBeNull()
        expect(rowIds()).toEqual([])                 /* course two, and still searching "late" */
        act(() => { setSearch(""); notify() })
        expect(rowIds()).toEqual(["soon"])
    })
})

describe("editing the types", () => {
    it("opens with Edit types, lists hidden types too, and closes with Done or Escape", () => {
        render(<TableView />)
        expect(screen.queryByRole("button", { name: /^Reorder/ })).toBeNull()
        openEditor()
        expect(screen.getByRole("button", { name: "Edit types" }).getAttribute("aria-expanded")).toBe("true")
        const grips = editor().getAllByRole("button", { name: /^Reorder/ })
        expect(grips).toHaveLength(8)                               // Projects too, hidden on Med
        expect(editor().getByRole("button", { name: "Show Projects" }).getAttribute("aria-pressed")).toBe("false")

        fireEvent.click(editor().getByRole("button", { name: "Done" }))
        expect(screen.queryByRole("button", { name: /^Reorder/ })).toBeNull()
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit types" }))

        openEditor()
        fireEvent.keyDown(editor().getAllByRole("button", { name: /^Reorder/ })[0], { key: "Escape" })
        expect(screen.queryByRole("button", { name: /^Reorder/ })).toBeNull()
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit types" }))
    })

    it("moves a type with the arrow keys on its handle, keeping the keyboard there", () => {
        render(<TableView />)
        openEditor()
        const grip = editor().getByRole("button", { name: /^Reorder Quizzes/ })
        grip.focus()
        fireEvent.keyDown(grip, { key: "ArrowUp" })
        expect(reorderTypes).toHaveBeenCalledWith(["quiz", "exam", "assignment", "lab", "tutoring", "office", "project", "task"])
        expect(editor().getAllByRole("button", { name: /^Reorder/ })[0].getAttribute("aria-label")).toMatch(/^Reorder Quizzes/)
        expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toMatch(/^Reorder Quizzes/)

        fireEvent.keyDown(editor().getByRole("button", { name: /^Reorder Exams/ }), { key: "ArrowDown" })
        expect(reorderTypes).toHaveBeenLastCalledWith(["quiz", "assignment", "exam", "lab", "tutoring", "office", "project", "task"])
    })

    it("offers delete only for a type of your own that no item uses", () => {
        prefs = [{ id: "c-free", label: "Viva", color: "#3F7A2E", kind: "todo" }, { id: "c-used", label: "Rota", color: "#6B5B45", kind: "event" }]
        fake.data.items = [item("x", "c-used", "todo")]
        render(<TableView />)
        openEditor()
        const deletes = editor().queryAllByRole("button", { name: /^Delete/ }).map((b) => b.getAttribute("aria-label"))
        expect(deletes).toEqual(["Delete Vivas"])
        expect(editor().getByTitle("1 item uses it. Hide it instead").textContent).toBe("in use")
    })

    it("adds a type: Save waits for a name, and Enter saves", async () => {
        render(<TableView />)
        openEditor()
        fireEvent.click(editor().getByRole("button", { name: "+ Add a type" }))
        const name = editor().getByRole("textbox", { name: "New type name" })
        expect(document.activeElement).toBe(name)
        expect((editor().getByRole("button", { name: "Add type" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(name, { target: { value: "Viva" } })
        expect((editor().getByRole("button", { name: "Add type" }) as HTMLButtonElement).disabled).toBe(false)
        fireEvent.click(editor().getByRole("button", { name: "To-do" }))
        fireEvent.keyDown(name, { key: "Enter" })
        const saved = vi.mocked(saveProfile).mock.calls[0][0] as { types: { label?: string; kind?: string }[] }
        expect(saved.types.at(-1)).toMatchObject({ label: "Viva", kind: "todo" })
        await vi.waitFor(() => expect(editor().queryByRole("textbox", { name: "New type name" })).toBeNull())
    })
})
