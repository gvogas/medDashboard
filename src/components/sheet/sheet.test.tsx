import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// A store in memory that reloads (new arrays) and tells its listeners on every save, as
// the real one does; the delete actions and the controllers the sheet reads are fakes.
const fake = vi.hoisted(() => {
    const listeners = new Set<(e: { type: string }) => void>()
    const data = { items: [] as { id: string }[], courses: [] as { id: string }[], study_sessions: [] as unknown[], quotes: [], profile: null }
    const put = (kind: "items" | "courses", row: { id: string }) => {
        data[kind] = data[kind].some((x) => x.id === row.id) ? data[kind].map((x) => (x.id === row.id ? row : x)) : [...data[kind], row]
        for (const fn of listeners) fn({ type: "change" })
    }
    return { data, listeners, put, cal: null as unknown, ui: { bg: "med", view: "week", course: "all", search: "", types: {} } }
})
const actions = vi.hoisted(() => ({ deleteItem: vi.fn(), deleteCourse: vi.fn(), openCourse: vi.fn() }))
vi.mock("@/core/store", () => ({
    data: fake.data,
    item: (id: string) => fake.data.items.find((x) => x.id === id) || null,
    course: (id: string) => fake.data.courses.find((x) => x.id === id) || null,
    saveItem: vi.fn(async (row: { id: string }) => fake.put("items", row)),
    saveCourse: vi.fn(async (row: { id: string }) => fake.put("courses", row)),
    subscribe: (fn: (e: { type: string }) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn) },
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => "2026-09-01" }))
vi.mock("@/core/reviews", () => ({ nextReview: () => null }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))
vi.mock("@/data/actions", () => actions)
/* what Settings reads, for the sheet to load */
vi.mock("@/data/theme", () => ({ setTheme: vi.fn(), setBg: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ savePrefs: vi.fn() }))
vi.mock("@/data/sync-status", () => ({ runReviews: vi.fn() }))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/data/spotify/player", () => ({ state: { loaded: true, connected: false } }))
vi.mock("@/data/spotify/web-player", () => ({ state: { status: "off" } }))
vi.mock("@/core/api", () => ({ api: {}, spotifyRetryAt: () => 0 }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(), MAX_FILE: 5 * 1024 * 1024 }))

import * as store from "@/core/store"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { normalizeSchool } from "@/core/school"
import { launch as fireworks } from "@/lib/fireworks"
import { closeSheet, cover, getSheet, openSheet } from "@/data/overlay"
import { newSession } from "@/data/session-edit"
import { flush, TYPING_MS } from "@/data/item-edit"
import { Sheet } from "./sheet"
import { Page, Scrim, SheetHost } from "@/components/shell"
import type { Item } from "@/data/types"

const item = (row: Record<string, unknown>) => normalizeItem({ type: "assignment", date: "2026-09-23", status: "todo", ...row }) as Item
const TWO_TERMS = normalizeSchool({ terms: [
    { name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" },
    { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" },
] })

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
    fake.data.items = [item({ id: "i1", title: "Renal problem set", courseId: "anat", start: "09:00", end: "10:30",
        checklist: [{ id: "s1", text: "Read ch. 4", done: false }], links: [{ label: "Slides", url: "https://x.org" }, { label: "bad", url: "javascript:alert(1)" }] })]
    fake.data.courses = [normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#E4749B",
        meetings: [{ id: "m1", kind: "Lecture", weekday: 3, start: "09:00", end: "10:30", room: "Hall B" }] }, 0)]
    vi.mocked(store.saveItem).mockClear()
    vi.mocked(store.saveCourse).mockClear()
})
afterEach(async () => {
    fake.cal = null
    act(() => closeSheet())
    await flush()
    cleanup()
    Object.values(actions).forEach((fn) => fn.mockClear())
})

/* the page, the scrim and the sheet as <App> draws them */
const show = () => render(<><Page><button id="opener">Open</button></Page><Scrim /><SheetHost><Sheet /></SheetHost></>)
const open = (s: Parameters<typeof openSheet>[0]) => act(() => openSheet(s))
const dialog = () => screen.getByRole("dialog")

describe("the sheet", () => {
    it("opens over an inert page and closes with ✕, Escape and the scrim, focus going back", () => {
        show()
        const opener = document.getElementById("opener")!
        opener.focus()
        open({ kind: "item", id: "i1" })
        expect(dialog().getAttribute("aria-label")).toBe("Assignment")
        expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true)
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(false)
        expect(document.getElementById("scrim")!.classList.contains("on")).toBe(true)

        fireEvent.keyDown(dialog(), { key: "Escape" })
        expect(getSheet()).toBeNull()
        expect(document.getElementById("app")!.hasAttribute("inert")).toBe(false)
        expect(document.activeElement).toBe(opener)

        open({ kind: "item", id: "i1" })
        fireEvent.click(document.getElementById("scrim")!)
        expect(getSheet()).toBeNull()

        open({ kind: "item", id: "i1" })
        fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }))
        expect(getSheet()).toBeNull()
    })

    it("gives focus back to what opened it when the sheet focuses a field itself", () => {
        show()
        const opener = document.getElementById("opener")!
        for (const sheet of [
            { kind: "session", draft: newSession() },
            { kind: "new-item", draft: item({ id: "n3", title: "" }) },
        ] as const) {
            opener.focus()
            open(sheet)
            expect(dialog().contains(document.activeElement)).toBe(true)
            act(() => closeSheet())
            expect(document.activeElement).toBe(opener)
        }
    })

    it("goes inert under an overlay", () => {
        show()
        open({ kind: "item", id: "i1" })
        act(() => cover(true))
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(true)
        expect(document.getElementById("app")!.hasAttribute("inert")).toBe(true)
        act(() => cover(false))
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(false)
    })
})

describe("the item sheet", () => {
    it("says in the foot what saving needs", () => {
        show()
        open({ kind: "new-item", draft: item({ id: "n2", title: "" }) })
        expect(within(dialog()).getByRole("status").textContent).toBe("Give it a name to save")
        fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Lab report" } })
        expect(within(dialog()).getByRole("status").textContent).toBe("Ready to save")
        act(() => closeSheet())
        open({ kind: "item", id: "i1" })
        expect(within(dialog()).getByRole("status").textContent).toBe("Edits save as you type")
    })

    it("picks the type with a button, the person's own types too", async () => {
        show()
        open({ kind: "item", id: "i1" })
        const type = screen.getByRole("group", { name: "Type" })
        for (const name of ["Assignment", "Exam", "Quiz", "Lab", "Tutorial", "Office hours", "Task"]) expect(within(type).getByRole("button", { name })).toBeTruthy()
        expect(within(type).queryByRole("button", { name: "Project" })).toBeNull()   /* hidden on Med until used */
        expect(within(type).getByRole("button", { name: "Assignment" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(within(type).getByRole("button", { name: "Exam" })))
        expect(fake.data.items[0]).toMatchObject({ type: "exam" })
        expect(within(screen.getByRole("group", { name: "Type" })).getByRole("button", { name: "Exam" }).getAttribute("aria-pressed")).toBe("true")
    })

    it("picks the date in the week strip, and in the month", async () => {
        show()
        open({ kind: "item", id: "i1" })   /* due Wed 23 Sep, today */
        expect(screen.getByText("Wed 23 Sep · today")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fri 25 Sep" })))
        expect(fake.data.items[0]).toMatchObject({ date: "2026-09-25" })
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fri 2 Oct" })))
        expect(fake.data.items[0]).toMatchObject({ date: "2026-10-02" })
        expect(screen.getByRole("group", { name: "Days" })).toBeTruthy()
    })

    it("dots the days other open items fall on", () => {
        fake.data.items = [...fake.data.items, item({ id: "i2", title: "Quiz 3", date: "2026-09-24" })]
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.getByRole("button", { name: "Thu 24 Sep, something due" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Wed 23 Sep" })).toBeTruthy()   /* its own day: no dot */
    })

    it("says when the course meets, and opens the course", () => {
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.getByText(/Anatomy meets Wed 09:00 · Hall B/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Edit course" }))
        expect(actions.openCourse).toHaveBeenCalledWith("anat")
    })

    it("keeps every row: course, time, room, status, weight, grade once graded", async () => {
        show()
        open({ kind: "item", id: "i1" })
        expect((screen.getByRole("combobox", { name: "Course" }) as HTMLSelectElement).value).toBe("anat")
        expect(screen.getByRole("textbox", { name: "Start time" })).toBeTruthy()
        expect(screen.getByRole("textbox", { name: "Room" })).toBeTruthy()
        await act(async () => fireEvent.change(screen.getByRole("spinbutton", { name: "Weight" }), { target: { value: "15" } }))
        expect(fake.data.items[0]).toMatchObject({ weight: 15 })
        expect(screen.queryByRole("spinbutton", { name: "Grade" })).toBeNull()
        await act(async () => fireEvent.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Graded" })))
        expect(screen.getByRole("spinbutton", { name: "Grade" })).toBeTruthy()
    })

    it("repeats a lab every week until the end of its semester, or later", async () => {
        fake.cal = TWO_TERMS
        fake.data.items = [item({ id: "l1", type: "lab", title: "Histology lab" })]
        show()
        open({ kind: "item", id: "l1" })
        const rep = screen.getByRole("group", { name: "Repeat" })
        expect(within(rep).getByRole("button", { name: "Just once" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(within(rep).getByRole("button", { name: "Every week" })))
        expect(fake.data.items[0]).toMatchObject({ recur: "weekly", weekday: 3, recurUntil: "2026-12-18" })
        const until = screen.getByRole("combobox", { name: "Until" }) as HTMLSelectElement
        expect(Array.from(until.options).map((o) => o.text)).toEqual(["the end of Fall 2026 · 18 Dec", "the end of Winter 2027 · 23 Apr", "no end"])
        await act(async () => fireEvent.change(until, { target: { value: "2027-04-23" } }))
        expect(fake.data.items[0]).toMatchObject({ recurUntil: "2027-04-23" })
        await act(async () => fireEvent.click(within(rep).getByRole("button", { name: "Just once" })))
        expect(fake.data.items[0]).toMatchObject({ recur: null, weekday: null, recurUntil: null })
    })

    it("offers no repeat on an assignment", () => {
        show()
        open({ kind: "item", id: "i1" })
        expect(screen.queryByRole("group", { name: "Repeat" })).toBeNull()
    })

    it("office hours have a Dept that saves once typing pauses; an exam has none", async () => {
        fake.data.items = [item({ id: "o1", type: "office", title: "Dr Lee" }), item({ id: "e1", type: "exam", title: "Final" })]
        show()
        open({ kind: "item", id: "o1" })
        fireEvent.change(screen.getByRole("textbox", { name: "Dept" }), { target: { value: "Cardiology" } })
        await act(() => vi.advanceTimersByTimeAsync(TYPING_MS))
        expect(fake.data.items[0]).toMatchObject({ dept: "Cardiology" })
        act(() => closeSheet())
        await flush()
        open({ kind: "item", id: "e1" })
        expect(screen.queryByRole("textbox", { name: "Dept" })).toBeNull()
    })

    it("saves the title once typing pauses, and at once on close", async () => {
        show()
        open({ kind: "item", id: "i1" })
        fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Renal set 2" } })
        expect(store.saveItem).not.toHaveBeenCalled()
        await act(() => vi.advanceTimersByTimeAsync(TYPING_MS))
        expect(fake.data.items[0]).toMatchObject({ title: "Renal set 2" })

        fireEvent.click(screen.getByRole("button", { name: "Add notes" }))
        fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "p. 40" } })
        await act(async () => closeSheet())
        await act(() => flush())
        expect(fake.data.items[0]).toMatchObject({ notes: "p. 40" })
    })

    it("folds the checklist, notes and links until wanted, and opens what the item has", () => {
        fake.data.items = [item({ id: "e1", type: "exam", title: "Midterm" })]
        show()
        open({ kind: "item", id: "e1" })
        expect(screen.queryByRole("textbox", { name: "Notes" })).toBeNull()
        expect(screen.queryByRole("textbox", { name: "Add a step" })).toBeNull()
        expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull()

        fireEvent.click(screen.getByRole("button", { name: "Add topics" }))   /* an exam's checklist is its topics */
        expect(screen.getByRole("textbox", { name: "Add a step" })).toBe(document.activeElement)
        expect(screen.queryByRole("button", { name: "Add topics" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Add notes" }))
        expect(screen.getByRole("textbox", { name: "Notes" })).toBe(document.activeElement)
        fireEvent.click(screen.getByRole("button", { name: "Add links" }))
        expect(screen.getByRole("textbox", { name: "Link label" })).toBe(document.activeElement)
    })

    it("shows an item's steps, notes and links open, and keeps notes open when emptied", async () => {
        fake.data.items = [item({ id: "i3", title: "Essay", notes: "p. 12", checklist: [{ id: "s", text: "Outline", done: false }], links: [{ label: "Brief", url: "https://x.org" }] })]
        show()
        open({ kind: "item", id: "i3" })
        expect(screen.queryByRole("button", { name: "Add a checklist" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Add notes" })).toBeNull()
        expect(screen.queryByRole("button", { name: "Add links" })).toBeNull()
        const notes = screen.getByRole("textbox", { name: "Notes" })
        fireEvent.change(notes, { target: { value: "" } })
        await act(() => vi.advanceTimersByTimeAsync(TYPING_MS))
        expect(screen.getByRole("textbox", { name: "Notes" })).toBeTruthy()
    })

    it("fills an exam's topics from the lectures once Topics is open", () => {
        fake.data.items = [item({ id: "e2", type: "exam", title: "Final", courseId: "anat", date: "2026-10-14" })]
        show()
        open({ kind: "item", id: "e2" })
        expect(screen.queryByRole("button", { name: "Fill topics from lectures" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Add topics" }))
        expect(screen.getByRole("button", { name: "Fill topics from lectures" })).toBeTruthy()
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
    it("offers sharing the course to anyone", () => {
        ;(fake.data as { profile: unknown }).profile = { id: "u1", isAdmin: false }
        try {
            show()
            open({ kind: "course", id: "anat" })
            expect(screen.getByRole("button", { name: "Convert to shared class" })).toBeTruthy()
        } finally {
            ;(fake.data as { profile: unknown }).profile = null
        }
    })

    it("picks a semester from the school calendar, or both", async () => {
        fake.cal = TWO_TERMS
        show()
        open({ kind: "course", id: "anat" })
        const sem = screen.getByRole("group", { name: "Semester" })
        expect(within(sem).getByRole("button", { name: "Both semesters" }).getAttribute("aria-pressed")).toBe("true")
        expect(screen.getByText("Classes run in every semester.")).toBeTruthy()
        fireEvent.click(within(sem).getByRole("button", { name: "Winter 2027" }))
        expect(screen.getByText("Classes run 11 Jan – 23 Apr.")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save course" })))
        expect(fake.data.courses[0]).toMatchObject({ term: "Winter 2027" })
    })

    it("presses no semester for an old free-text term, so Both semesters can clear it", async () => {
        fake.cal = TWO_TERMS
        fake.data.courses = [{ ...fake.data.courses[0], term: "2026 Autumn" } as { id: string }]
        show()
        open({ kind: "course", id: "anat" })
        const sem = screen.getByRole("group", { name: "Semester" })
        const both = within(sem).getByRole("button", { name: "Both semesters" })
        expect(within(sem).queryAllByRole("button", { pressed: true })).toEqual([])
        fireEvent.click(both)
        expect(both.getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save course" })))
        expect(fake.data.courses[0]).toMatchObject({ term: "" })
    })

    it("keeps the free-text term without a school calendar", () => {
        show()
        open({ kind: "course", id: "anat" })
        expect(screen.getByRole("textbox", { name: "Term" })).toBeTruthy()
        expect(screen.queryByRole("group", { name: "Semester" })).toBeNull()
    })

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
