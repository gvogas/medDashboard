import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The app is not booted: a store in memory, the reads, the API and the toast as fakes, the
// real planner and commit. The class schedule preview, reading a timetable, and (Task 8) the
// Import with AI card.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as { id: string }[], study_sessions: [], achievements: [], quotes: [], profile: { id: "p", termStart: null } as Record<string, unknown> },
    ui: { view: "week", bg: "med", course: "all", search: "", types: {}, aiLeft: null as number | null, aiLimit: null as number | null, aiNote: null as unknown, importNote: null as unknown },
    cal: null as unknown,
}))
const legacy = vi.hoisted(() => ({ saveRows: vi.fn(async (_rows: unknown) => {}), saveProfile: vi.fn(), toast: vi.fn(), shrink: vi.fn(async () => new Blob(["j"], { type: "image/jpeg" })) }))
const ai = vi.hoisted(() => ({
    readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(async (f: File) => f as Blob), MAX_FILE: 5 * 1024 * 1024,
    isPdf: (f: File) => /\.pdf$/i.test(f.name), pdfTimetable: vi.fn(async () => "Timetable grid …"),
}))
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
vi.mock("@/core/pdftext", () => ({ pdfTimetable: ai.pdfTimetable }))
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
    Object.assign(fake.ui, { aiLeft: null, aiLimit: null, aiNote: null, importNote: null })
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

    it("saves only the semesters when no class is ticked but a semester changed", async () => {
        fake.cal = CAL
        fake.data.courses = [CHEM]
        const p = plan()
        p.courses[0].meetings = []
        act(() => openSheet({ kind: "schedule", plan: p, name: "timetable.png" }))
        for (const box of await screen.findAllByRole("checkbox")) fireEvent.click(box)
        expect((screen.getByRole("button", { name: "Add 0 classes" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(within(screen.getByRole("group", { name: "Semester for CHEM271" })).getByRole("button", { name: "Fall 2026" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save semesters" })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as Saved
        expect(rows.map((r) => [r.row.id, r.row.term])).toEqual([["c1", "Fall 2026"]])
        expect(legacy.toast).toHaveBeenCalledWith("Updated the semester of 1 course")
        expect(getSheet()).toBeNull()
    })

    it("counts a course given only a new semester beside the classes added", async () => {
        fake.cal = CAL
        fake.data.courses = [CHEM]
        const p = plan()
        p.courses[0].meetings = []
        act(() => openSheet({ kind: "schedule", plan: p, name: "timetable.png" }))
        fireEvent.click(within(await screen.findByRole("group", { name: "Semester for CHEM271" })).getByRole("button", { name: "Fall 2026" }))
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 2 classes" })))
        expect(legacy.toast).toHaveBeenCalledWith("Added 2 classes to 1 course and updated the semester of 1 other course")
    })

    it("gives the button back when the save fails", async () => {
        legacy.saveRows.mockRejectedValueOnce(new Error("offline"))
        act(() => openSheet({ kind: "schedule", plan: plan(), name: "timetable.png" }))
        await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Add 3 classes" })))
        expect(legacy.toast).toHaveBeenCalledWith("The classes were not all added: offline", { error: true, ms: 8000 })
        expect((screen.getByRole("button", { name: "Add 3 classes" }) as HTMLButtonElement).disabled).toBe(false)
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
    it("sends a picture made smaller and a PDF as its text with the grid read, and opens the preview with the semester named", async () => {
        const { readScheduleFile } = await import("@/data/schedule-edit")
        const png = new File(["x"], "t.png", { type: "image/png" })
        void readScheduleFile(png)
        const cfg = ai.readWithAi.mock.calls[0][1] as { what: string; title: string; note: string; maxBytes: number; prepare: (f: File) => Promise<Blob>; done: (r: unknown) => void }
        expect(cfg).toMatchObject({ what: "timetable", title: "Reading your timetable", note: "aiNote", maxBytes: 20 * 1024 * 1024 })
        await cfg.prepare(png)
        expect(legacy.shrink).toHaveBeenCalledWith(png)
        const pdf = new File(["%PDF"], "t.pdf", { type: "application/pdf" })
        const sent = await cfg.prepare(pdf)
        expect(ai.pdfTimetable).toHaveBeenCalledWith(pdf)
        expect(sent.type).toBe("text/plain")
        expect(await sent.text()).toBe("Timetable grid …")

        /* a picture over the Worker's 4 MB is too large as a picture, not "over 5 MB" */
        expect((cfg as unknown as { errors: Record<string, string> }).errors.too_large).toBe("That picture is too large.")
        void readScheduleFile(pdf)
        expect((ai.readWithAi.mock.calls[1][1] as { errors: Record<string, string> }).errors.too_large).toBeUndefined()

        fake.cal = CAL
        act(() => cfg.done({ term: "Winter 2027", courses: [{ code: "BIOL266", name: "Cell Biology", classes: [{ kind: "Lecture", weekday: 1, start: "09:00", end: "10:30", room: "" }] }] }))
        expect(getSheet()).toMatchObject({ kind: "schedule", name: "t.png" })
        expect((getSheet() as { plan: ImportPlan }).plan.courses[0]).toMatchObject({ code: "BIOL266", isNew: true, term: "Winter 2027" })
    })
})

describe("the Import with AI card", () => {
    const pick = (label: string, file: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } })
    const cfg = (i = 0) => ai.readWithAi.mock.calls[i][1] as { what: string; note: string; done: (r: unknown) => void }

    it("offers the three kinds and the reads left, and reads each kind of file", async () => {
        fake.ui.aiLeft = 7
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Class schedule")).toBeTruthy()
        expect(screen.getByText("Course outline")).toBeTruthy()
        expect(screen.getByText("School calendar")).toBeTruthy()
        expect(ai.refreshReads).toHaveBeenCalled()
        expect(screen.getByRole("meter", { name: "AI reads left today" }).getAttribute("aria-valuenow")).toBe("7")
        expect(screen.getByText(/7 of 10 AI reads left today/)).toBeTruthy()
        /* the outline and the school calendar both take a PDF, Word or text file */
        expect(screen.getAllByText("PDF, Word or text · read by AI")).toHaveLength(2)

        pick("Class schedule: Choose a PDF or image", new File(["x"], "t.png", { type: "image/png" }))
        pick("Course outline: Choose a file", new File(["x"], "o.pdf", { type: "application/pdf" }))
        pick("School calendar: Choose a file", new File(["x"], "c.pdf", { type: "application/pdf" }))
        expect([0, 1, 2].map((i) => [cfg(i).what, cfg(i).note])).toEqual([["timetable", "aiNote"], ["outline", "aiNote"], ["calendar", "aiNote"]])
        /* a calendar can be a Word or text file: its first step does not say PDF */
        expect((ai.readWithAi.mock.calls[2][1] as { steps: string[] }).steps[0]).toBe("Reading the document")
    })

    it("opens an outline's preview that comes back to the card", async () => {
        act(() => openSheet({ kind: "ai" }))
        await screen.findByText("Course outline")
        pick("Course outline: Choose a file", new File(["x"], "o.pdf", { type: "application/pdf" }))
        act(() => cfg().done({ code: "PHYS205", name: "Waves", classes: [], assessments: [] }))
        expect(getSheet()).toMatchObject({ kind: "import" })
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))
        expect(getSheet()).toEqual({ kind: "ai" })
    })

    it("counts against the Worker's limit once it is known, and keeps the meter within its track", async () => {
        Object.assign(fake.ui, { aiLeft: 25, aiLimit: 20 })
        act(() => openSheet({ kind: "ai" }))
        const meter = await screen.findByRole("meter", { name: "AI reads left today" })
        expect(meter.getAttribute("aria-valuemax")).toBe("20")
        expect((meter.firstElementChild as HTMLElement).style.width).toBe("100%")
        expect(screen.getByText(/25 of 20 AI reads left today/)).toBeTruthy()
    })

    it("says what went wrong, and stops offering reads when none are left", async () => {
        fake.ui.aiLeft = 0
        fake.ui.aiNote = { text: "Stopped reading.", error: false }
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Stopped reading.")).toBeTruthy()
        expect((screen.getByLabelText("Class schedule: Choose a PDF or image") as HTMLInputElement).disabled).toBe(true)
        expect(screen.getByText(/No AI reads left today/)).toBeTruthy()
    })

    it("previews pasted CSV, and says when it cannot", async () => {
        act(() => openSheet({ kind: "ai" }))
        fireEvent.change(await screen.findByLabelText("Calendar or CSV text"), { target: { value: "nonsense" } })
        fireEvent.click(screen.getByRole("button", { name: "Preview" }))
        expect(screen.getByRole("alert").textContent).toMatch(/No rows were found/)
        /* beside Preview, inside the paste box, not above it */
        expect(screen.getByRole("alert").closest("details")).toBeTruthy()
        expect(screen.getByRole("alert").parentElement!.contains(screen.getByRole("button", { name: "Preview" }))).toBe(true)
        fireEvent.change(screen.getByLabelText("Calendar or CSV text"), { target: { value: "type,course,title,date\nexam,PHYS205,Midterm,2026-10-20" } })
        fireEvent.click(screen.getByRole("button", { name: "Preview" }))
        expect(getSheet()).toMatchObject({ kind: "import" })
    })

    it("previews a calendar or CSV file, and says when it cannot", async () => {
        act(() => openSheet({ kind: "ai" }))
        const input = await screen.findByLabelText("Calendar or CSV file")
        await act(async () => fireEvent.change(input, { target: { files: [new File(["nonsense"], "x.csv", { type: "text/csv" })] } }))
        expect((await screen.findByRole("alert")).textContent).toMatch(/No rows were found/)
        await act(async () => fireEvent.change(input, { target: { files: [new File(["type,course,title,date\nexam,PHYS205,Midterm,2026-10-20"], "x.csv", { type: "text/csv" })] } }))
        await waitFor(() => expect(getSheet()).toMatchObject({ kind: "import", name: "x.csv" }))
    })
})

describe("what a read is told", () => {
    it("is the school calendar's semesters and the codes of the courses kept", async () => {
        const { readContext } = await import("@/data/ai-context")
        expect(readContext()).toEqual({})
        fake.cal = CAL
        fake.data.courses = [CHEM, { ...CHEM, id: "c2", code: "OLD1", archived: true }]
        expect(readContext()).toEqual({ terms: "Fall 2026|Winter 2027", codes: "CHEM271" })
        fake.cal = { ...CAL!, terms: [...CAL!.terms, { name: "Summer | Intensive", start: "2027-05-03", end: "2027-06-25" }] }
        expect(readContext().terms).toBe("Fall 2026|Winter 2027")
    })
})
