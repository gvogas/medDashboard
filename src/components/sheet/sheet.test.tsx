import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// A store in memory that reloads (new arrays) and tells its listeners on every save, as
// the real one does; the delete actions and the legacy modules the sheet reads are fakes.
const fake = vi.hoisted(() => {
    const listeners = new Set<(e: { type: string }) => void>()
    const data = { items: [] as { id: string }[], courses: [] as { id: string }[], study_sessions: [] as unknown[], quotes: [], profile: null }
    const put = (kind: "items" | "courses", row: { id: string }) => {
        data[kind] = data[kind].some((x) => x.id === row.id) ? data[kind].map((x) => (x.id === row.id ? row : x)) : [...data[kind], row]
        for (const fn of listeners) fn({ type: "change" })
    }
    return { data, listeners, put, ui: { bg: "med", view: "week", course: "all", search: "", types: {} } }
})
const actions = vi.hoisted(() => ({ deleteItem: vi.fn(), deleteCourse: vi.fn(), openCourse: vi.fn() }))
vi.mock("@/legacy/js/store.js", () => ({
    data: fake.data,
    item: (id: string) => fake.data.items.find((x) => x.id === id) || null,
    course: (id: string) => fake.data.courses.find((x) => x.id === id) || null,
    saveItem: vi.fn(async (row: { id: string }) => fake.put("items", row)),
    saveCourse: vi.fn(async (row: { id: string }) => fake.put("courses", row)),
    subscribe: (fn: (e: { type: string }) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn) },
}))
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))
vi.mock("@/legacy/js/query.js", () => ({ schoolCal: () => null, termStart: () => "2026-09-01" }))
vi.mock("@/legacy/js/views/study.js", () => ({ studiedFor: () => 0, duration: (m: number) => m + " min" }))
vi.mock("@/legacy/js/reviews.js", () => ({ nextReview: () => null }))
vi.mock("@/legacy/js/fireworks.js", () => ({ launch: vi.fn() }))
vi.mock("@/data/actions", () => actions)
/* what Settings reads, for the sheet to load */
vi.mock("@/legacy/js/theme.js", () => ({ setTheme: vi.fn(), setBg: vi.fn() }))
vi.mock("@/legacy/js/study-controller.js", () => ({ savePrefs: vi.fn() }))
vi.mock("@/legacy/js/sync-status.js", () => ({ runReviews: vi.fn() }))
vi.mock("@/legacy/js/sync.js", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/legacy/js/spotify.js", () => ({ state: { loaded: true, connected: false } }))
vi.mock("@/legacy/js/web-player.js", () => ({ state: { status: "off" } }))
vi.mock("@/legacy/js/api.js", () => ({ api: {}, spotifyRetryAt: () => 0 }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn() }))
vi.mock("@/legacy/js/views/render.js", () => ({ render: vi.fn(), renderView: vi.fn() }))

import * as store from "@/legacy/js/store.js"
import { normalizeCourse, normalizeItem } from "@/legacy/js/model.js"
import { launch as fireworks } from "@/legacy/js/fireworks.js"
import { closeSheet, cover, getSheet, legacyDrawer, onLegacyClose, openSheet } from "@/data/overlay"
import { flush, TYPING_MS } from "@/data/item-edit"
import { Sheet } from "./sheet"
import type { Item } from "@/data/types"

const item = (row: Record<string, unknown>) => normalizeItem({ type: "assignment", date: "2026-09-23", status: "todo", ...row }) as Item

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
    document.body.innerHTML = '<div id="app"><button id="opener">Open</button></div><div id="scrim" class="scrim"></div><aside id="drawer"></aside><div id="sheet"></div>'
    fake.data.items = [item({ id: "i1", title: "Renal problem set", courseId: "anat", start: "09:00", end: "10:30",
        checklist: [{ id: "s1", text: "Read ch. 4", done: false }], links: [{ label: "Slides", url: "https://x.org" }, { label: "bad", url: "javascript:alert(1)" }] })]
    fake.data.courses = [normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#E4749B",
        meetings: [{ id: "m1", kind: "Lecture", weekday: 3, start: "09:00", end: "10:30", room: "Hall B" }] }, 0)]
    vi.mocked(store.saveItem).mockClear()
    vi.mocked(store.saveCourse).mockClear()
})
afterEach(async () => {
    act(() => closeSheet())
    await flush()
    cleanup()
    Object.values(actions).forEach((fn) => fn.mockClear())
})

const show = () => render(<Sheet />, { container: document.getElementById("sheet")! })
const open = (s: Parameters<typeof openSheet>[0]) => act(() => openSheet(s))
const dialog = () => screen.getByRole("dialog")

describe("the sheet", () => {
    it("opens over an inert page and closes with ✕, Escape and the scrim, focus going back", () => {
        show()
        const opener = document.getElementById("opener")!
        opener.focus()
        open({ kind: "item", id: "i1" })
        expect(dialog().getAttribute("aria-label")).toBe("Assignment")
        expect(document.getElementById("app")!.inert).toBe(true)
        expect(document.getElementById("sheet")!.inert).toBe(false)
        expect(document.getElementById("scrim")!.classList.contains("on")).toBe(true)

        fireEvent.keyDown(dialog(), { key: "Escape" })
        expect(getSheet()).toBeNull()
        expect(document.getElementById("app")!.inert).toBe(false)
        expect(document.activeElement).toBe(opener)

        open({ kind: "item", id: "i1" })
        fireEvent.click(document.getElementById("scrim")!)
        expect(getSheet()).toBeNull()

        open({ kind: "item", id: "i1" })
        fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }))
        expect(getSheet()).toBeNull()
    })

    it("and the legacy drawer close each other; an overlay makes both inert", () => {
        const closeLegacy = vi.fn(() => legacyDrawer(false))
        onLegacyClose(closeLegacy)
        show()
        act(() => legacyDrawer(true))
        open({ kind: "item", id: "i1" })
        expect(closeLegacy).toHaveBeenCalledOnce()
        act(() => legacyDrawer(true))
        expect(getSheet()).toBeNull()
        act(() => legacyDrawer(false))

        open({ kind: "item", id: "i1" })
        act(() => cover(true))
        expect(document.getElementById("sheet")!.inert).toBe(true)
        act(() => cover(false))
        expect(document.getElementById("sheet")!.inert).toBe(false)
    })
})

describe("the item sheet", () => {
    it("saves the title once typing pauses, and at once on close", async () => {
        show()
        open({ kind: "item", id: "i1" })
        fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Renal set 2" } })
        expect(store.saveItem).not.toHaveBeenCalled()
        await act(() => vi.advanceTimersByTimeAsync(TYPING_MS))
        expect(fake.data.items[0]).toMatchObject({ title: "Renal set 2" })

        fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "p. 40" } })
        await act(async () => closeSheet())
        await act(() => flush())
        expect(fake.data.items[0]).toMatchObject({ notes: "p. 40" })
    })

    it("keeps what is typed when a sync reloads the item", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const title = screen.getByRole("textbox", { name: "Title" })
        fireEvent.change(title, { target: { value: "Typed" } })
        act(() => fake.put("items", { ...fake.data.items[0], where: "Lab 2" } as Item))
        expect((title as HTMLTextAreaElement).value).toBe("Typed")
        expect((screen.getByRole("textbox", { name: "Room" }) as HTMLInputElement).value).toBe("Lab 2")
    })

    it("sets the status with one press, and celebrates finishing", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const status = screen.getByRole("group", { name: "Status" })
        await act(async () => fireEvent.click(within(status).getByRole("button", { name: "Submitted" })))
        expect(fake.data.items[0]).toMatchObject({ status: "submitted" })
        expect(fireworks).toHaveBeenCalled()
        expect(within(status).getByRole("button", { name: "Submitted" }).getAttribute("aria-pressed")).toBe("true")
    })

    it("moves the end with the start", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const start = screen.getByRole("textbox", { name: "Start time" })
        fireEvent.focus(start)
        fireEvent.change(start, { target: { value: "13" } })
        await act(async () => fireEvent.blur(start))
        expect(fake.data.items[0]).toMatchObject({ start: "13:00", end: "14:30" })
    })

    it("ticks, edits, adds and removes steps, and adds and removes links", async () => {
        show()
        open({ kind: "item", id: "i1" })
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done: Read ch. 4" })))
        expect((fake.data.items[0] as Item).checklist[0].done).toBe(true)

        const add = screen.getByRole("textbox", { name: "Add a step" })
        fireEvent.change(add, { target: { value: "Flashcards" } })
        await act(async () => fireEvent.keyDown(add, { key: "Enter" }))
        expect((fake.data.items[0] as Item).checklist.map((s) => s.text)).toEqual(["Read ch. 4", "Flashcards"])

        await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Remove step" })[0]))
        expect((fake.data.items[0] as Item).checklist.map((s) => s.text)).toEqual(["Flashcards"])

        expect(screen.getByRole("link", { name: "Slides" })).toBeTruthy()
        expect(screen.queryByRole("link", { name: "bad" })).toBeNull()
        const url = screen.getByRole("textbox", { name: "Link URL" })
        fireEvent.change(url, { target: { value: "http://ex ample.com" } })
        fireEvent.keyDown(url, { key: "Enter" })
        expect(url.getAttribute("aria-invalid")).toBe("true")
        fireEvent.change(url, { target: { value: "example.com/notes" } })
        await act(async () => fireEvent.keyDown(url, { key: "Enter" }))
        expect((fake.data.items[0] as Item).links.at(-1)).toEqual({ label: "example.com/notes", url: "https://example.com/notes" })
    })

    it("keeps a new item a draft until it has a name and is saved", async () => {
        show()
        open({ kind: "new-item", draft: item({ id: "n1", title: "" }) })
        const save = screen.getByRole("button", { name: "Save item" })
        expect((save as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Pharm quiz" } })
        expect(store.saveItem).not.toHaveBeenCalled()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save item" })))
        expect(fake.data.items.map((x) => x.id)).toContain("n1")
        expect(getSheet()).toBeNull()
    })

    it("deletes through the undo delete", () => {
        show()
        open({ kind: "item", id: "i1" })
        fireEvent.click(screen.getByRole("button", { name: "Delete" }))
        expect(actions.deleteItem).toHaveBeenCalledWith("i1")
    })
})

describe("the course sheet", () => {
    it("keeps edits in the draft until Save", async () => {
        show()
        open({ kind: "course", id: "anat" })
        fireEvent.change(screen.getByRole("textbox", { name: "Course name" }), { target: { value: "Gross anatomy" } })
        fireEvent.click(screen.getByRole("button", { name: "+ Add a class" }))
        expect(store.saveCourse).not.toHaveBeenCalled()
        expect(screen.getByText("Unsaved changes")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save course" })))
        expect(fake.data.courses[0]).toMatchObject({ name: "Gross anatomy" })
        expect(fake.data.courses[0]).toHaveProperty("meetings.length", 2)
    })

    it("asks before throwing changes away; asked, Escape discards", () => {
        show()
        open({ kind: "course", id: "anat" })
        fireEvent.change(screen.getByRole("textbox", { name: "Course name" }), { target: { value: "X" } })
        fireEvent.keyDown(dialog(), { key: "Escape" })
        expect(getSheet()).not.toBeNull()
        expect(screen.getByText("Discard your changes to X?")).toBeTruthy()
        fireEvent.keyDown(dialog(), { key: "Escape" })
        expect(getSheet()).toBeNull()
        expect(store.saveCourse).not.toHaveBeenCalled()
    })

    it("holds at most twelve classes", () => {
        show()
        open({ kind: "course", id: null })
        for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", { name: "+ Add a class" }))
        expect(screen.getAllByRole("button", { name: "Remove class" })).toHaveLength(12)
        expect(screen.queryByRole("button", { name: "+ Add a class" })).toBeNull()
        expect(screen.getByText("Twelve classes is the most a course can hold.")).toBeTruthy()
    })

    it("projects what-if scores without saving them", () => {
        fake.data.items = [
            item({ id: "g1", title: "Midterm", courseId: "anat", weight: 40, status: "graded", grade: 80 }),
            item({ id: "g2", title: "Final", courseId: "anat", weight: 60 }),
        ]
        show()
        open({ kind: "course", id: "anat" })
        expect(screen.getByText("80%")).toBeTruthy()
        fireEvent.change(screen.getByRole("spinbutton", { name: "If I get this score on Final" }), { target: { value: "70" } })
        expect(screen.getByText("74%")).toBeTruthy()
        expect(screen.getByText("your final grade with these scores")).toBeTruthy()
        expect(store.saveCourse).not.toHaveBeenCalled()
    })
})

describe("the time field", () => {
    it("reads what is typed, picks from the list, nudges, and marks nonsense", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const end = screen.getByRole("textbox", { name: "End time" })
        fireEvent.focus(end)
        const list = screen.getByRole("listbox", { name: "Times" })
        await act(async () => fireEvent.click(within(list).getByRole("option", { name: "11:45" })))
        expect(fake.data.items[0]).toMatchObject({ end: "11:45" })

        fireEvent.keyDown(end, { key: "ArrowUp" })
        await act(async () => fireEvent.blur(end))
        expect(fake.data.items[0]).toMatchObject({ end: "12:00" })

        fireEvent.focus(end)
        fireEvent.change(end, { target: { value: "25:99" } })
        fireEvent.blur(end)
        expect(end.getAttribute("aria-invalid")).toBe("true")
        expect(fake.data.items[0]).toMatchObject({ end: "12:00" })

        /* Escape in the field closes its list, not the sheet */
        fireEvent.focus(end)
        fireEvent.keyDown(end, { key: "Escape" })
        expect(getSheet()).not.toBeNull()
    })
})
