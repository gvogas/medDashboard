import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// The app is not booted: a store in memory, the reads, the API and the toast as fakes, the
// real planner and commit. The class schedule preview, reading a timetable, and (Task 8) the
// Import with AI card.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as { id: string }[], study_sessions: [], achievements: [], quotes: [], profile: { id: "p", termStart: null } as Record<string, unknown> },
    ui: { view: "week", bg: "med", course: "all", search: "", types: {}, aiLeft: null as number | null, aiNote: null as unknown, importNote: null as unknown },
    cal: null as unknown,
}))
const legacy = vi.hoisted(() => ({ saveRows: vi.fn(async (_rows: unknown) => {}), saveProfile: vi.fn(), toast: vi.fn(), shrink: vi.fn(async () => new Blob(["j"], { type: "image/jpeg" })) }))
const ai = vi.hoisted(() => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(async (f: File) => f as Blob), MAX_FILE: 5 * 1024 * 1024 }))
vi.mock("@/core/store", () => ({
    data: fake.data, conflicts: [],
    course: (id: string) => fake.data.courses.find((c) => c.id === id) || null, item: () => null,
    saveRows: legacy.saveRows, saveProfile: legacy.saveProfile,
    subscribe: () => () => {},
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => null }))
vi.mock("@/core/api", () => ({ api: { readSchedule: vi.fn(), readOutline: vi.fn(), readSchool: vi.fn() } }))
vi.mock("@/data/ai-read", () => ai)
vi.mock("@/data/toast", () => ({ toast: legacy.toast }))
vi.mock("@/core/image", () => ({ shrinkImage: legacy.shrink }))
vi.mock("@/data/actions", () => ({ openSettings: vi.fn() }))

import { normalizeSchool } from "@/core/school"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import { Sheet } from "./sheet"

const CAL = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="scrim"></div><div id="sheet"></div>'
    render(<Sheet />, { container: document.getElementById("sheet")! })
})
afterEach(() => {
    act(() => closeSheet())
    cleanup()
    vi.clearAllMocks()
    fake.cal = null
    fake.data.courses = []
    Object.assign(fake.ui, { aiLeft: null, aiNote: null, importNote: null })
})

const plan = (): ImportPlan => ({ kind: "schedule", notes: [], items: [], courses: [
    { id: "c1", code: "CHEM271", name: "Organic Chem", color: "#E4749B", isNew: false, term: "", meetings: [
        { id: "m1", kind: "Lab", weekday: 5, start: "13:00", end: "16:00", room: "SP-265", include: true }] },
    { id: "n1", code: "BIOL266", name: "Cell Biology", color: "#4F74D9", isNew: true, term: "Fall 2026", meetings: [
        { id: "m2", kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "Hall B", include: true },
        { id: "m3", kind: "Tutorial", weekday: 3, start: "15:00", end: "16:00", room: "", include: true }] },
] })
const CHEM = { id: "c1", code: "CHEM271", name: "Organic Chem", color: "#E4749B", instructor: "", term: "", archived: false, target: null, meetings: [] }
type Saved = { kind: string; row: { id: string; term: string; meetings: unknown[] } }[]

describe("the class schedule preview", () => {
    it("lists the courses with their badges and a tick per class, and adds the ticked ones", async () => {
        fake.data.courses = [CHEM]
        act(() => openSheet({ kind: "schedule", plan: plan(), name: "timetable.png" }))
        expect(await screen.findByRole("heading", { name: "Found 2 courses" })).toBeTruthy()
        expect(screen.getByText("timetable.png")).toBeTruthy()
        expect(within(screen.getByRole("region", { name: /CHEM271/ })).getByText("Matches your course")).toBeTruthy()
        expect(within(screen.getByRole("region", { name: /BIOL266/ })).getByText("New course")).toBeTruthy()
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()   /* no school calendar */
        fireEvent.click(screen.getByRole("checkbox", { name: "Add BIOL266 Tutorial Wed 15:00" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 classes" })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as Saved
        expect(rows.map((r) => [r.row.id, r.row.meetings.length])).toEqual([["c1", 1], ["n1", 1]])
        expect(legacy.toast).toHaveBeenCalledWith("Added 2 classes to 2 courses")
        expect(getSheet()).toBeNull()
    })

    it("sets each course's semester when there is a school calendar", async () => {
        fake.cal = CAL
        fake.data.courses = [CHEM]
        act(() => openSheet({ kind: "schedule", plan: plan(), name: "timetable.png" }))
        const bio = await screen.findByRole("group", { name: "Semester for BIOL266" })
        expect(within(bio).getByRole("button", { name: "Fall 2026" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(bio).getByRole("button", { name: "Winter 2027" }))
        const chem = screen.getByRole("group", { name: "Semester for CHEM271" })
        expect(within(chem).getByRole("button", { name: "Both semesters" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(chem).getByRole("button", { name: "Fall 2026" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 3 classes" })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as Saved
        expect(rows.map((r) => [r.row.id, r.row.term])).toEqual([["c1", "Fall 2026"], ["n1", "Winter 2027"]])
    })

    it("says when a course's classes are all there, and goes back to the card for another file", async () => {
        const p = plan()
        p.courses[0].meetings = []
        act(() => openSheet({ kind: "schedule", plan: p, name: "timetable.png" }))
        expect(await screen.findByText("Its classes are already on your board.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Another file" }))
        expect(getSheet()).toEqual({ kind: "ai" })
    })
})

describe("reading a timetable", () => {
    it("sends a picture made smaller and a PDF as text, and opens the preview with the semester named", async () => {
        const { readScheduleFile } = await import("@/data/schedule-edit")
        const png = new File(["x"], "t.png", { type: "image/png" })
        void readScheduleFile(png)
        const cfg = ai.readWithAi.mock.calls[0][1] as { what: string; title: string; note: string; maxBytes: number; prepare: (f: File) => Promise<Blob>; done: (r: unknown) => void }
        expect(cfg).toMatchObject({ what: "timetable", title: "Reading your timetable", note: "aiNote", maxBytes: 20 * 1024 * 1024 })
        await cfg.prepare(png)
        expect(legacy.shrink).toHaveBeenCalledWith(png)
        const pdf = new File(["%PDF"], "t.pdf", { type: "application/pdf" })
        await cfg.prepare(pdf)
        expect(ai.asSent).toHaveBeenCalledWith(pdf)

        fake.cal = CAL
        act(() => cfg.done({ term: "Winter 2027", courses: [{ code: "BIOL266", name: "Cell Biology", classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "" }] }] }))
        expect(getSheet()).toMatchObject({ kind: "schedule", name: "t.png" })
        expect((getSheet() as { plan: ImportPlan }).plan.courses[0]).toMatchObject({ code: "BIOL266", isNew: true, term: "Winter 2027" })
    })
})
