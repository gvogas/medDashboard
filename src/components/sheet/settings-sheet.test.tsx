import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The legacy app is not booted. A store in memory, and fakes for what Settings calls:
// the actions, savePrefs, the theme, the reviews, the calendar feed's API.
const fake = vi.hoisted(() => {
    const listeners = new Set<(e: { type: string }) => void>()
    return {
        listeners,
        data: {
            items: [] as unknown[], courses: [] as unknown[], study_sessions: [], achievements: [],
            quotes: [{ id: "q1", text: "Treat the patient.", source: "Osler" }] as unknown[],
            profile: { id: "p", username: "demo", displayName: "Demo", coat: { name: "Demo", role: "MS II", color: "#17B3AE" }, types: [], studyPrefs: { goal: 90, dayMin: 15, rest: [0], celebrate: true } } as Record<string, unknown>,
        },
        conflicts: [] as unknown[],
        ui: { view: "week", bg: "med", theme: "dark", settingsTab: "you", importNote: null, schoolNote: null, spotifyNote: null, outlineBusy: false, schoolBusy: false, schoolAsk: false, signoutAsk: null as null | { everywhere: boolean }, feed: null as unknown, course: "all", search: "", types: {} },
        spotify: { loaded: true, connected: true, device: "Kitchen", stale: false, track: null },
        review: { on: false, through: null as string | null },
        saved: [] as unknown[],
    }
})
const actions = vi.hoisted(() => ({
    addQuote: vi.fn(async () => true), removeQuote: vi.fn(), saveCoat: vi.fn(), exportData: vi.fn(), resolveConflict: vi.fn(),
    disconnectSpotify: vi.fn(), showShortcuts: vi.fn(), signOut: vi.fn(), keepSignedIn: vi.fn(), openSettings: vi.fn(),
    setSettingsTab: vi.fn(), deleteItem: vi.fn(), deleteCourse: vi.fn(), openCourse: vi.fn(),
}))
const api = vi.hoisted(() => ({
    calendarFeed: vi.fn(async () => ({ on: true, url: "https://x.org/cal/abc.ics" })),
    calendarRenew: vi.fn(async () => ({ on: true, url: "https://x.org/cal/new.ics" })),
    calendarStop: vi.fn(async () => undefined),
}))
const legacy = vi.hoisted(() => ({ setTheme: vi.fn(), setBg: vi.fn(), savePrefs: vi.fn(), runReviews: vi.fn(), writeSetting: vi.fn(), saveRows: vi.fn(), saveProfile: vi.fn(), render: vi.fn() }))

vi.mock("@/legacy/js/store.js", () => ({
    data: fake.data, conflicts: fake.conflicts,
    course: () => null, item: () => null,
    saveRows: legacy.saveRows, saveProfile: legacy.saveProfile,
    subscribe: (fn: (e: { type: string }) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn) },
}))
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))
vi.mock("@/legacy/js/query.js", () => ({ schoolCal: () => null, termStart: () => null }))
vi.mock("@/legacy/js/sync.js", () => ({ status: { state: "idle", pending: 0, message: "", lastPull: null }, onStatus: () => {} }))
vi.mock("@/data/spotify/player", () => ({ state: fake.spotify }))
vi.mock("@/data/spotify/web-player", () => ({ state: { status: "ready" } }))
vi.mock("@/legacy/js/api.js", () => ({ api, spotifyRetryAt: () => 0 }))
vi.mock("@/legacy/js/reviews.js", () => ({ readSetting: () => fake.review, writeSetting: legacy.writeSetting, nextReview: () => null }))
vi.mock("@/legacy/js/sync-status.js", () => ({ runReviews: legacy.runReviews }))
vi.mock("@/legacy/js/study-controller.js", () => ({ savePrefs: legacy.savePrefs }))
vi.mock("@/legacy/js/theme.js", () => ({ setTheme: legacy.setTheme, setBg: legacy.setBg }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn() }))
vi.mock("@/legacy/js/views/render.js", () => ({ render: legacy.render, renderView: vi.fn() }))
vi.mock("@/legacy/js/fireworks.js", () => ({ launch: vi.fn() }))
vi.mock("@/data/actions", () => actions)

import { notify } from "@/bridge"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import type { SchoolDraft } from "@/data/school-edit"
import { Sheet } from "./sheet"

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="scrim"></div><div id="sheet"></div>'
    render(<Sheet />, { container: document.getElementById("sheet")! })
})
afterEach(() => {
    act(() => closeSheet())
    cleanup()
    vi.clearAllMocks()
    Object.assign(fake.ui, { importNote: null, schoolAsk: false, signoutAsk: null, feed: null })
    fake.conflicts.length = 0
})

const settings = (tab: "you" | "study" | "spotify" | "account", focus: string | null = null) => act(() => openSheet({ kind: "settings", tab, focus }))

describe("Settings", () => {
    it("switches tabs, and a deep link focuses its field", async () => {
        settings("you", "qText")
        await waitFor(() => expect(document.activeElement?.id).toBe("qText"))
        fireEvent.click(screen.getByRole("button", { name: "Study" }))
        expect(actions.setSettingsTab).toHaveBeenCalledWith("study")
    })

    it("sets the theme and background, and saves the coat", () => {
        settings("you")
        fireEvent.click(screen.getByRole("button", { name: "Light" }))
        expect(legacy.setTheme).toHaveBeenCalledWith("light")
        fireEvent.click(screen.getByRole("button", { name: /CS/ }))
        expect(legacy.setBg).toHaveBeenCalledWith("cs")
        fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Dr. Demo" } })
        expect(actions.saveCoat).toHaveBeenCalledWith({ name: "Dr. Demo" })
        fireEvent.click(screen.getByRole("button", { name: "Pink coat" }))
        expect(actions.saveCoat).toHaveBeenCalledWith({ color: "#E4749B" })
    })

    it("adds a quote with Enter or Add, and removes one", async () => {
        settings("you")
        const box = screen.getByRole("textbox", { name: "Quote" })
        fireEvent.change(box, { target: { value: "Listen." } })
        await act(async () => fireEvent.keyDown(box, { key: "Enter" }))
        expect(actions.addQuote).toHaveBeenCalledWith("Listen.", "")
        fireEvent.click(screen.getByRole("button", { name: "Remove quote" }))
        expect(actions.removeQuote).toHaveBeenCalledWith("q1")
    })

    it("saves the goal, the rest days, the day minimum and the fireworks", () => {
        settings("study")
        fireEvent.click(screen.getByRole("button", { name: "15 minutes more" }))
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ goal: 105 })
        fireEvent.click(within(screen.getByRole("group", { name: "Pick a goal" })).getByRole("button", { name: "Off" }))
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ goal: 0 })
        fireEvent.click(within(screen.getByRole("group", { name: "Rest days" })).getByRole("button", { name: "Sat" }))
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ rest: [0, 6] })
        const min = screen.getByRole("spinbutton")
        fireEvent.change(min, { target: { value: "30" } })
        fireEvent.blur(min)
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ dayMin: 30 })
        fireEvent.click(screen.getByRole("checkbox", { name: /Fireworks/ }))
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ celebrate: false })
    })

    it("switches reviews on for this device and runs them", async () => {
        settings("study")
        await act(async () => fireEvent.click(screen.getByRole("checkbox", { name: /review tasks/ })))
        expect(legacy.writeSetting).toHaveBeenCalledWith("p", { on: true, through: null })
        expect(legacy.runReviews).toHaveBeenCalled()
    })

    it("loads the calendar feed, copies it, and asks before a new link or turning it off", async () => {
        settings("study")
        await screen.findByRole("textbox", { name: "Calendar feed link" })
        expect(api.calendarFeed).toHaveBeenCalledOnce()
        fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
        expect(screen.getByText(/Turn the feed off\?/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Keep" }))
        fireEvent.click(screen.getByRole("button", { name: "New link" }))
        await act(async () => fireEvent.click(within(screen.getByText(/Make a new link\?/).parentElement!).getByRole("button", { name: "New link" })))
        expect(api.calendarRenew).toHaveBeenCalled()
        expect((screen.getByRole("textbox", { name: "Calendar feed link" }) as HTMLInputElement).value).toContain("new.ics")

        api.calendarStop.mockRejectedValueOnce(new Error("offline"))
        fireEvent.click(screen.getByRole("button", { name: "Turn off" }))
        await act(async () => fireEvent.click(within(screen.getByText(/Turn the feed off\?/).parentElement!).getByRole("button", { name: "Turn off" })))
        expect(screen.getByText(/did not go through/)).toBeTruthy()
    })

    it("shows the Spotify connection", () => {
        settings("spotify")
        expect(screen.getByText("Kitchen")).toBeTruthy()
        expect(screen.getByText(/device called/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
        expect(actions.disconnectSpotify).toHaveBeenCalled()
        fake.spotify.connected = false
        act(() => notify())
        expect(screen.getByRole("link", { name: "Connect" }).getAttribute("href")).toBe("/api/spotify/connect")
        fake.spotify.connected = true
    })

    it("counts saved copies on the Account tab, restores or discards them, and asks before erasing on sign-out", () => {
        fake.conflicts.push({ id: "c1", key: "items:x", op: "put", reason: "Changed on another device.", body: { title: "Renal set" } })
        settings("account")
        expect(within(screen.getByRole("button", { name: /Account/ })).getByText("1")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Restore my edit" }))
        expect(actions.resolveConflict).toHaveBeenCalledWith("c1", true)
        fireEvent.click(screen.getByRole("button", { name: "Discard saved copy" }))
        expect(actions.resolveConflict).toHaveBeenCalledWith("c1", false)

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
        expect(actions.signOut).toHaveBeenCalled()
        fake.ui.signoutAsk = { everywhere: true }
        act(() => notify())
        expect(screen.getByRole("alert")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Sign out and erase" }))
        expect(actions.signOut).toHaveBeenLastCalledWith({ everywhere: true, force: true })
    })
})

describe("the import sheet", () => {
    const plan = (): ImportPlan => ({
        notes: [],
        courses: [{ id: "c1", code: "PHYS", name: "Physiology", color: "#4F74D9", isNew: true, keep: false,
            meetings: [{ id: "m1", kind: "Lecture", weekday: 1, start: "09:00", end: "10:00", room: "B", include: true }] }],
        items: [
            { include: true, row: { id: "i1", type: "exam", title: "Midterm", courseId: "c1", date: "2026-10-05", start: "" } as never },
            { include: true, row: { id: "i2", type: "quiz", title: "Quiz 1", courseId: "c1", date: "", start: "" } as never, week: 3 },
        ],
    })

    it("counts the ticks, sets a type, dates week numbers, and imports", async () => {
        act(() => openSheet({ kind: "import", plan: plan(), name: "phys.csv" }))
        expect(screen.getByRole("button", { name: "Import 3" })).toBeTruthy()
        fireEvent.click(screen.getByRole("checkbox", { name: "Import Midterm" }))
        expect(screen.getByRole("button", { name: "Import 2" })).toBeTruthy()
        fireEvent.change(screen.getAllByRole("combobox", { name: "Type" })[0], { target: { value: "quiz" } })
        expect((screen.getAllByRole("combobox", { name: "Type" })[0] as HTMLSelectElement).value).toBe("quiz")

        fireEvent.change(screen.getByLabelText("Week 1 starts"), { target: { value: "2026-09-07" } })
        expect(screen.getByText(/placed on the Monday/)).toBeTruthy()

        await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Import \d/ })))
        expect(legacy.saveRows).toHaveBeenCalled()
        expect(actions.openSettings).toHaveBeenCalledWith("importGrp")
        expect(fake.ui.importNote).toMatchObject({ error: false })
    })

    it("goes back to Settings on Cancel", () => {
        act(() => openSheet({ kind: "import", plan: plan(), name: "phys.csv" }))
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        expect(actions.openSettings).toHaveBeenCalledWith("importGrp")
    })
})

describe("the school sheet", () => {
    const draft = (): SchoolDraft => ({
        source: "calendar.pdf", truncated: false, name: "Uni",
        terms: [{ name: "Autumn", start: "2026-09-02", end: "2026-12-04" }],
        days: [{ from: "2026-10-12", to: "2026-10-12", kind: "off", label: "Thanksgiving" }],
    })

    it("marks bad dates and keeps Save off until they are fixed", () => {
        act(() => openSheet({ kind: "school", draft: draft() }))
        const save = screen.getByRole("button", { name: "Save calendar" }) as HTMLButtonElement
        expect(save.disabled).toBe(false)
        fireEvent.change(screen.getByLabelText("Last day of classes"), { target: { value: "2026-08-01" } })
        expect(save.disabled).toBe(true)
        expect(screen.getByText("Fix the dates marked in red")).toBeTruthy()
    })

    it("adds a day with the keyboard on it, shows Follows for a swap, and saves", async () => {
        act(() => openSheet({ kind: "school", draft: draft() }))
        fireEvent.click(screen.getByRole("button", { name: "+ Add a day" }))
        await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("From"))
        fireEvent.change(screen.getAllByRole("combobox", { name: "Kind" })[0], { target: { value: "swap" } })
        expect(screen.getByRole("combobox", { name: "Follows the timetable of" })).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save calendar" })))
        expect(legacy.saveProfile).toHaveBeenCalledWith({ schoolCalendar: expect.objectContaining({ name: "Uni" }) })
        expect(getSheet()).toBeNull()
    })
})
