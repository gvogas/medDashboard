import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

// A store in memory that reloads (new arrays) and tells its listeners on every save; the
// actions are the real ones, over a fake Study controller, sticker maker and redraw.
const fake = vi.hoisted(() => {
    const listeners = new Set<(e: { type: string }) => void>()
    const data = {
        items: [] as { id: string }[], courses: [] as unknown[], study_sessions: [] as { id: string }[], achievements: [] as { id: string }[],
        quotes: [], profile: { id: "p", studyPrefs: { goal: 60, dayMin: 15 } } as unknown,
    }
    const put = (kind: "study_sessions" | "achievements", row: { id: string }) => {
        data[kind] = data[kind].some((x) => x.id === row.id) ? data[kind].map((x) => (x.id === row.id ? row : x)) : [...data[kind], row]
        for (const fn of listeners) fn({ type: "change" })
    }
    return { data, listeners, put, ui: { bg: "med", view: "study", course: "all", search: "", types: {}, study: { courseId: null, itemId: null } } }
})
vi.mock("@/core/store", () => ({
    data: fake.data,
    item: (id: string) => fake.data.items.find((x) => x.id === id) || null,
    course: () => null,
    saveStudySession: vi.fn(async (row: { id: string }) => fake.put("study_sessions", row)),
    saveAchievement: vi.fn(async (row: { id: string }) => fake.put("achievements", row)),
    deleteAchievement: vi.fn(),
    subscribe: (fn: (e: { type: string }) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn) },
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ deleteWithUndo: vi.fn(), deleteLater: vi.fn(), setView: vi.fn() }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))
vi.mock("@/core/api", () => ({ api: {}, spotifyRetryAt: () => 0 }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(), MAX_FILE: 5 * 1024 * 1024 }))
vi.mock("@/core/sticker", () => ({
    readPicture: vi.fn(async (file: File) => (file.name.endsWith(".heic") ? null : { width: 400, height: 300 })),
    drawSticker: vi.fn(),
    dragCrop: vi.fn((crop: { x: number }, _pic: unknown, dx: number) => ({ ...crop, x: crop.x + dx / 100 })),
    stickerData: vi.fn(() => "data:image/webp;base64,AAAA"),
}))
vi.mock("@/data/toast", () => ({ toast: vi.fn() }))
/* what Settings reads, for the sheet to load */
vi.mock("@/data/theme", () => ({ setTheme: vi.fn(), setBg: vi.fn() }))
vi.mock("@/data/spotify/player", () => ({ state: { loaded: true, connected: false } }))
vi.mock("@/data/spotify/web-player", () => ({ state: { status: "off" } }))
vi.mock("@/data/sync-status", () => ({ runReviews: vi.fn() }))

import * as store from "@/core/store"
import * as sticker from "@/core/sticker"
import { deleteLater, deleteWithUndo } from "@/data/study-controller"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { toast } from "@/data/toast"
import { closeSheet, getSheet } from "@/data/overlay"
import { openAchievement, openSession } from "@/data/actions"
import { Sheet } from "./sheet"

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="scrim" class="scrim"></div><div id="sheet"></div>'
    fake.data.courses = [
        normalizeCourse({ id: "anat", code: "ANAT", name: "Anatomy", color: "#E4749B" }, 0),
        normalizeCourse({ id: "path", code: "PATH", name: "Pathology", color: "#5B8DEF" }, 1),
    ]
    fake.data.items = [
        normalizeItem({ id: "e1", type: "exam", title: "Midterm", courseId: "anat", date: "2026-10-02", status: "todo" }),
        normalizeItem({ id: "a1", type: "assignment", title: "Renal set", courseId: "anat", date: "2026-09-25", status: "todo" }),
        normalizeItem({ id: "a2", type: "assignment", title: "Path cases", courseId: "path", date: "2026-09-26", status: "todo" }),
    ]
    fake.data.study_sessions = []
    fake.data.achievements = []
    vi.clearAllMocks()
})
afterEach(() => { act(() => closeSheet()); cleanup() })

const show = () => render(<Sheet />, { container: document.getElementById("sheet")! })
const dialog = () => screen.getByRole("dialog")
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name })
const foot = () => dialog().lastElementChild as HTMLElement

describe("the session sheet", () => {
    it("opens a new one with How long focused, and the quick lengths set and press", () => {
        show()
        act(() => openSession(null))
        expect(dialog().getAttribute("aria-label")).toBe("Log study")
        const mins = screen.getByLabelText("How long") as HTMLInputElement
        expect(document.activeElement).toBe(mins)
        expect(mins.value).toBe("30")
        expect(button("30m").getAttribute("aria-pressed")).toBe("true")

        fireEvent.click(button("1h 30m"))
        expect(mins.value).toBe("90")
        expect(button("1h 30m").getAttribute("aria-pressed")).toBe("true")
        expect(button("30m").getAttribute("aria-pressed")).toBe("false")
        expect(button("Log 1h 30m")).toBeTruthy()
    })

    it("changing the course clears what it was for, and the line follows what is typed", () => {
        show()
        act(() => openSession(null, "anat"))
        const item = screen.getByLabelText("For") as HTMLSelectElement
        expect([...item.options].map((o) => o.text)).toEqual(["Nothing in particular", "Renal set", "Midterm"])
        fireEvent.change(item, { target: { value: "a1" } })
        expect(item.value).toBe("a1")
        fireEvent.change(screen.getByLabelText("Course"), { target: { value: "path" } })
        expect((screen.getByLabelText("For") as HTMLSelectElement).value).toBe("")
        expect([...(screen.getByLabelText("For") as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Nothing in particular", "Path cases"])

        const line = within(dialog()).getAllByRole("status").find((s) => s.tagName === "P")!
        expect(line.textContent).toBe("Today goes to 30m of 1h 00m. Your streak goes to 1 day.")
        fireEvent.change(screen.getByLabelText("How long"), { target: { value: "0" } })
        expect(line.textContent).toBe("Enter a day, a start time and 1 to 720 minutes.")
        expect((button("Log 0m") as HTMLButtonElement).disabled).toBe(true)
        expect(foot().textContent).toContain("Not ready yet")
        fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-09-30" } })
        fireEvent.change(screen.getByLabelText("How long"), { target: { value: "40" } })
        expect(line.textContent).toBe("Pick a day up to today.")
    })

    it("saves an edit keeping the session's other fields, and closes", async () => {
        const s = { id: "s1", courseId: "anat", itemId: null, startedAt: new Date(2026, 8, 22, 14, 0).getTime(), studyMinutes: 50, roundsDone: 2, note: "", manual: false }
        fake.data.study_sessions = [s]
        show()
        act(() => openSession("s1"))
        expect(dialog().getAttribute("aria-label")).toBe("Edit session")
        expect(dialog().textContent).toContain("recorded by the timer")
        expect(foot().textContent).toContain("Unsaved changes")
        fireEvent.change(screen.getByLabelText("How long"), { target: { value: "65" } })
        fireEvent.change(screen.getByLabelText("What you covered"), { target: { value: "  Anki, 120 cards " } })
        await act(async () => { fireEvent.click(button("Save")) })
        expect(store.saveStudySession).toHaveBeenCalledWith({ ...s, spaceId: null, studyMinutes: 65, note: "Anki, 120 cards" })
        expect(getSheet()).toBeNull()
    })

    it("logs a new one by hand", async () => {
        show()
        act(() => openSession(null, "path"))
        await act(async () => { fireEvent.click(button("Log 30m")) })
        expect(store.saveStudySession).toHaveBeenCalledWith(expect.objectContaining({
            courseId: "path", studyMinutes: 30, manual: true, roundsDone: 0, startedAt: new Date(2026, 8, 23, 11, 30).getTime(),
        }))
    })

    it("Delete closes the sheet and hands the session to the Study view's Undo", () => {
        fake.data.study_sessions = [{ id: "s1", courseId: "anat", itemId: null, startedAt: Date.now(), studyMinutes: 20, roundsDone: 0, note: "", manual: true } as never]
        show()
        act(() => openSession("s1"))
        expect(dialog().textContent).toContain("logged by hand")
        act(() => { fireEvent.click(button("Delete")) })
        expect(deleteWithUndo).toHaveBeenCalledWith("s1")
        expect(getSheet()).toBeNull()
    })
})

describe("the achievement sheet", () => {
    const pickFile = async (name = "cat.jpg") => {
        const input = dialog().querySelector('input[type="file"]') as HTMLInputElement
        await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/jpeg" })] } }) })
    }

    it("switching what earns it sets the target and the fields", () => {
        show()
        act(() => openAchievement(null))
        expect(dialog().getAttribute("aria-label")).toBe("New achievement")
        expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("10")
        fireEvent.click(button(/A grade/))
        expect((screen.getByLabelText("Grade") as HTMLInputElement).value).toBe("90")
        expect([...(screen.getByLabelText("Exam or quiz") as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Pick one", "ANAT · Midterm"])
        expect(within(dialog()).getByText("Pick an exam or quiz.")).toBeTruthy()
        fireEvent.click(button(/Study hours/))
        expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("10")
        expect((screen.getByLabelText("Course") as HTMLSelectElement).value).toBe("anat")
    })

    it("crops a picture into the sticker: zoom, arrow keys, Use this", async () => {
        show()
        act(() => openAchievement(null))
        expect(document.activeElement).toBe(button("Upload a picture"))
        expect(foot().textContent).toContain("Upload a sticker")
        await pickFile()

        const stage = screen.getByRole("img", { name: /The picture in the circle/ })
        expect(document.activeElement).toBe(stage)
        expect(foot().textContent).toContain("Finish the crop first")
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cat" } })
        expect((button("Add") as HTMLButtonElement).disabled).toBe(true)

        fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } })
        expect(vi.mocked(sticker.drawSticker).mock.lastCall![2]).toEqual({ x: 0, y: 0, zoom: 2 })
        fireEvent.keyDown(stage, { key: "ArrowRight" })
        expect(sticker.dragCrop).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 2 }, { width: 400, height: 300 }, 12, 0, 208)

        fireEvent.click(button("Use this"))
        expect(sticker.stickerData).toHaveBeenCalledWith({ width: 400, height: 300 }, { x: 0.12, y: 0, zoom: 2 })
        expect((within(dialog()).getByAltText("Your sticker") as HTMLImageElement).src).toBe("data:image/webp;base64,AAAA")
        expect(document.activeElement).toBe(screen.getByLabelText("Name"))
        expect((button("Add") as HTMLButtonElement).disabled).toBe(false)
        expect(foot().textContent).toContain("Ready to add")
    })

    it("Cancel drops the picture; one that cannot be read says so", async () => {
        show()
        act(() => openAchievement(null))
        await pickFile()
        /* the crop's own Cancel, before the foot's */
        fireEvent.click(within(dialog()).getAllByRole("button", { name: "Cancel" })[0])
        expect(screen.queryByRole("img", { name: /The picture in the circle/ })).toBeNull()
        expect(document.activeElement).toBe(button("Upload a picture"))
        await pickFile("photo.heic")
        expect(toast).toHaveBeenCalledWith("That picture could not be read. Try a JPG or PNG.", { error: true })
        expect(screen.queryByRole("img", { name: /The picture in the circle/ })).toBeNull()
    })

    it("needs a name and a sticker to save, and saves", async () => {
        show()
        act(() => openAchievement(null))
        await pickFile()
        fireEvent.click(button("Use this"))
        expect(foot().textContent).toContain("Give it a name")
        expect((button("Add") as HTMLButtonElement).disabled).toBe(true)
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: " 20 hours on Anatomy " } })
        fireEvent.change(screen.getByLabelText("Hours"), { target: { value: "20" } })
        await act(async () => { fireEvent.click(button("Add")) })
        expect(store.saveAchievement).toHaveBeenCalledWith(expect.objectContaining({
            name: "20 hours on Anatomy", sticker: "data:image/webp;base64,AAAA", rule: "hours", courseId: "anat", itemId: null, target: 20,
        }))
        expect(getSheet()).toBeNull()
    })

    it("at 30 achievements a new one is refused with a toast", () => {
        fake.data.achievements = Array.from({ length: 30 }, (_, i) => ({ id: "a" + i }))
        act(() => openAchievement(null))
        expect(toast).toHaveBeenCalledWith("You have 30 achievements, the most there can be.")
        expect(getSheet()).toBeNull()
    })

    it("Delete closes the sheet and deletes with the toast's Undo", async () => {
        fake.data.achievements = [{ id: "own1", name: "Cat", sticker: "data:image/png;base64,x", rule: "grade", courseId: null, itemId: "e1", target: 90 } as never]
        show()
        act(() => openAchievement("own1"))
        expect(dialog().getAttribute("aria-label")).toBe("Edit achievement")
        expect(document.activeElement).toBe(screen.getByLabelText("Name"))
        expect(within(dialog()).getByText("Not graded yet so far.")).toBeTruthy()
        await act(async () => { fireEvent.click(button("Delete")) })
        expect(deleteLater).toHaveBeenCalledWith("achievements", "own1", "“Cat”", expect.any(Function))
        expect(getSheet()).toBeNull()
    })
})
