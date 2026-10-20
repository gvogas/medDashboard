import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The app is not booted. A store in memory, and fakes for what Settings calls:
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
        cal: null as unknown,
        ui: { view: "week", bg: "med", theme: "dark", settingsTab: "you", importNote: null, schoolNote: null, spotifyNote: null, outlineBusy: false, schoolBusy: false, schoolAsk: false, signoutAsk: null as null | { everywhere: boolean }, feed: null as unknown, course: "all", search: "", types: {} },
        spotify: { loaded: true, connected: true, device: "Kitchen", stale: false, track: null },
        review: { on: false, through: null as string | null },
        saved: [] as unknown[],
    }
})
const actions = vi.hoisted(() => ({
    addQuote: vi.fn(async () => true), removeQuote: vi.fn(), saveCoat: vi.fn(), exportData: vi.fn(), exportItemsCsv: vi.fn(), resolveConflict: vi.fn(),
    disconnectSpotify: vi.fn(), showShortcuts: vi.fn(), signOut: vi.fn(), keepSignedIn: vi.fn(), openSettings: vi.fn(), openAiImport: vi.fn(),
    setSettingsTab: vi.fn(), deleteItem: vi.fn(), deleteCourse: vi.fn(), openCourse: vi.fn(),
}))
const api = vi.hoisted(() => ({
    calendarFeed: vi.fn(async () => ({ on: true, url: "https://x.org/cal/abc.ics" })),
    calendarRenew: vi.fn(async () => ({ on: true, url: "https://x.org/cal/new.ics" })),
    calendarStop: vi.fn(async () => undefined),
}))
const push = vi.hoisted(() => ({
    pushState: vi.fn(async () => "off" as string), turnOn: vi.fn(async () => "on" as string), turnOff: vi.fn(async () => "off" as string), testPush: vi.fn(async () => "ok" as string),
}))
const legacy = vi.hoisted(() => ({ setTheme: vi.fn(), setBg: vi.fn(), savePrefs: vi.fn(), runReviews: vi.fn(), writeSetting: vi.fn(), saveRows: vi.fn(), saveProfile: vi.fn(), render: vi.fn() }))

vi.mock("@/core/store", () => ({
    data: fake.data, conflicts: fake.conflicts,
    course: () => null, item: () => null,
    saveRows: legacy.saveRows, saveProfile: legacy.saveProfile,
    subscribe: (fn: (e: { type: string }) => void) => { fake.listeners.add(fn); return () => fake.listeners.delete(fn) },
}))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/query", () => ({ schoolCal: () => fake.cal, termStart: () => null }))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "", lastPull: null }, onStatus: () => {} }))
vi.mock("@/data/spotify/player", () => ({ state: fake.spotify }))
vi.mock("@/data/spotify/web-player", () => ({ state: { status: "ready" } }))
vi.mock("@/core/api", () => ({ api, spotifyRetryAt: () => 0 }))
vi.mock("@/core/reviews", () => ({ readSetting: () => fake.review, writeSetting: legacy.writeSetting, nextReview: () => null }))
vi.mock("@/data/sync-status", () => ({ runReviews: legacy.runReviews }))
vi.mock("@/data/study-controller", () => ({ savePrefs: legacy.savePrefs }))
vi.mock("@/data/theme", () => ({ setTheme: legacy.setTheme, setBg: legacy.setBg }))
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(), MAX_FILE: 5 * 1024 * 1024 }))
vi.mock("@/lib/fireworks", () => ({ launch: vi.fn() }))
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/push", () => push)

import { notify } from "@/bridge"
import { today } from "@/core/dates"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import type { ImportPlan } from "@/data/import-edit"
import type { SchoolDraft } from "@/data/school-edit"
import { Sheet } from "./sheet"
import { TAB_OF } from "@/data/settings"
import { normalizeSchool } from "@/core/school"

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div><div id="scrim"></div><div id="sheet"></div>'
    render(<Sheet />, { container: document.getElementById("sheet")! })
})
afterEach(() => {
    act(() => closeSheet())
    cleanup()
    vi.clearAllMocks()
    Object.assign(fake.ui, { bg: "med", importNote: null, schoolAsk: false, signoutAsk: null, feed: null })
    fake.conflicts.length = 0
    fake.cal = null
})

const settings = (tab: "you" | "study" | "connections" | "account", focus: string | null = null) => act(() => openSheet({ kind: "settings", tab, focus }))

describe("Settings", () => {
    it("switches tabs, and a deep link focuses its field", async () => {
        settings("you", "qText")
        await waitFor(() => expect(document.activeElement?.id).toBe("qText"))
        fireEvent.click(screen.getByRole("button", { name: "Study" }))
        expect(actions.setSettingsTab).toHaveBeenCalledWith("study")
    })

    it("picks a theme from six rows, a goal from its chips or typed, and the name", () => {
        settings("you")
        const rows = within(screen.getByRole("radiogroup", { name: "Theme" })).getAllByRole("radio")
        expect(rows.map((r) => r.textContent)).toEqual([
            "MedicineLab coat · pink when done", "Computer ScienceID badge · mint when done",
            "LawSuit and name plate · parchment when done", "AviationFlight jacket · sky blue when done",
            "SportsJersey · peach when done", "EngineeringHi-vis vest · yellow when done",
        ])
        expect(rows[0].getAttribute("aria-checked")).toBe("true")
        fireEvent.click(screen.getByRole("radio", { name: /Aviation/ }))
        expect(legacy.setBg).toHaveBeenCalledWith("pilot")

        fireEvent.click(screen.getByRole("radio", { name: "Surgeon" }))
        expect(actions.saveCoat).toHaveBeenCalledWith({ role: "Surgeon" })
        fireEvent.change(screen.getByRole("textbox", { name: "Your own goal" }), { target: { value: "Neurosurgeon" } })
        expect(actions.saveCoat).toHaveBeenCalledWith({ role: "Neurosurgeon" })
        fireEvent.change(screen.getByRole("textbox", { name: "Your name" }), { target: { value: "Alex" } })
        expect(actions.saveCoat).toHaveBeenCalledWith({ name: "Alex" })

        fireEvent.click(screen.getByRole("button", { name: "Pink coat" }))
        expect(actions.saveCoat).toHaveBeenCalledWith({ color: "#E4749B" })
        fireEvent.click(screen.getByRole("button", { name: "Dark" }))
        expect(legacy.setTheme).toHaveBeenCalledWith("dark")
    })

    it("moves through the theme rows and the goal chips with the arrow keys", () => {
        settings("you")
        const group = screen.getByRole("radiogroup", { name: "Theme" })
        const rows = within(group).getAllByRole("radio")
        expect(rows.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
        rows[0].focus()
        fireEvent.keyDown(rows[0], { key: "ArrowDown" })
        expect(legacy.setBg).toHaveBeenLastCalledWith("cs")
        expect(document.activeElement).toBe(rows[1])
        rows[0].focus()
        fireEvent.keyDown(rows[0], { key: "ArrowLeft" })
        expect(legacy.setBg).toHaveBeenLastCalledWith("eng")
        rows[0].focus()
        fireEvent.keyDown(rows[0], { key: "End" })
        expect(legacy.setBg).toHaveBeenLastCalledWith("eng")
        fireEvent.keyDown(document.activeElement!, { key: "Home" })
        expect(legacy.setBg).toHaveBeenLastCalledWith("med")

        const chips = within(screen.getByRole("radiogroup", { name: "Where you’re headed" })).getAllByRole("radio")
        chips[0].focus()
        fireEvent.keyDown(chips[0], { key: "ArrowRight" })
        expect(actions.saveCoat).toHaveBeenLastCalledWith({ role: chips[1].textContent })
        expect(document.activeElement).toBe(chips[1])
        // a custom goal checks no chip: the first is still the one Tab stop
        expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
    })

    it("a deep link to the theme focuses its group, and it belongs to the You tab", () => {
        expect(TAB_OF.themeGrp).toBe("you")
        settings("you", "themeGrp")
        return waitFor(() => expect(document.activeElement?.id).toBe("themeGrp"))
    })

    it("shows the coat colours only for Medicine", () => {
        fake.ui.bg = "cs"
        settings("you")
        expect(screen.queryByRole("button", { name: "Pink coat" })).toBeNull()
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

    it("switches reviews on for the account from today, or off, and runs them", async () => {
        settings("study")
        const box = () => screen.getByRole("checkbox", { name: /review tasks/ }) as HTMLInputElement
        expect(box().checked).toBe(false)
        await act(async () => fireEvent.click(box()))
        expect(legacy.savePrefs).toHaveBeenCalledWith({ reviews: today() })
        expect(legacy.runReviews).toHaveBeenCalled()

        fake.data.profile.studyPrefs = { goal: 90, dayMin: 15, rest: [0], celebrate: true, reviews: "2026-09-01" }
        act(() => notify())
        expect(box().checked).toBe(true)
        await act(async () => fireEvent.click(box()))
        expect(legacy.writeSetting).toHaveBeenCalledWith("p", { on: false, through: null })
        expect(legacy.savePrefs).toHaveBeenLastCalledWith({ reviews: null })
        fake.data.profile.studyPrefs = { goal: 90, dayMin: 15, rest: [0], celebrate: true }
    })

    it("shows reviews on from this browser until the setting first syncs", () => {
        fake.review.on = true
        settings("study")
        expect((screen.getByRole("checkbox", { name: /review tasks/ }) as HTMLInputElement).checked).toBe(true)
        fake.review.on = false
    })

    it("has no Import on the Study tab, and sends the school calendar to Import with AI", () => {
        settings("study")
        expect(screen.queryByText("Import")).toBeNull()
        expect(screen.queryByLabelText("Calendar or CSV text")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Import with AI…" }))
        expect(actions.openAiImport).toHaveBeenCalled()
    })

    it("loads the calendar feed, copies it, and asks before a new link or turning it off", async () => {
        settings("connections")
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

    it("turns the feed's alerts and this device's morning reminders on and off, and sends a test", async () => {
        settings("connections")
        const group = within(document.getElementById("remindersGrp")!)
        fireEvent.click(group.getByRole("checkbox", { name: /Alerts in the calendar feed/ }))
        expect(legacy.savePrefs).toHaveBeenCalledWith({ alarms: false })
        const morning = await waitFor(() => {
            const box = group.getByRole("checkbox", { name: "Morning reminders on this device" }) as HTMLInputElement
            expect(box.disabled).toBe(false)
            return box
        })
        await act(async () => fireEvent.click(morning))
        expect(push.turnOn).toHaveBeenCalled()
        expect(morning.checked).toBe(true)
        await act(async () => fireEvent.click(group.getByRole("button", { name: "Send a test" })))
        expect(group.getByText(/Sent\./)).toBeTruthy()
        await act(async () => fireEvent.click(morning))
        expect(push.turnOff).toHaveBeenCalled()
        expect(morning.checked).toBe(false)
    })

    it("says why morning reminders cannot be turned on", async () => {
        push.pushState.mockResolvedValueOnce("ios-install")
        settings("connections")
        const group = within(document.getElementById("remindersGrp")!)
        expect(await group.findByText(/add Term to your Home Screen/)).toBeTruthy()
        expect((group.getByRole("checkbox", { name: "Morning reminders on this device" }) as HTMLInputElement).disabled).toBe(true)
    })

    it("shows the Spotify connection", () => {
        settings("connections")
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

        fireEvent.click(screen.getByRole("button", { name: "Download my data" }))
        expect(actions.exportData).toHaveBeenCalled()
        fireEvent.click(screen.getByRole("button", { name: "Download items as CSV" }))
        expect(actions.exportItemsCsv).toHaveBeenCalled()

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
        expect(getSheet()).toBeNull()
    })

    it("goes back to Import with AI on Cancel", () => {
        act(() => openSheet({ kind: "import", plan: plan(), name: "phys.csv" }))
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
        expect(getSheet()).toEqual({ kind: "ai" })
    })

    it("asks an outline's semester when there is a school calendar, and saves it with the course", async () => {
        fake.cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }, { name: "Winter 2027", start: "2027-01-11", end: "2027-04-23" }] })
        const p = plan()
        p.kind = "outline"
        p.courses[0].keep = true
        p.courses[0].term = "Fall 2026"
        act(() => openSheet({ kind: "import", plan: p, name: "phys.pdf" }))
        const group = screen.getByRole("group", { name: "Semester for PHYS" })
        expect(within(group).getByRole("button", { name: "Fall 2026" }).getAttribute("aria-pressed")).toBe("true")
        fireEvent.click(within(group).getByRole("button", { name: "Winter 2027" }))
        expect(within(group).getByRole("button", { name: "Winter 2027" }).getAttribute("aria-pressed")).toBe("true")
        await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Import \d/ })))
        const rows = legacy.saveRows.mock.calls[0][0] as unknown as { kind: string; row: { term: string } }[]
        expect(rows[0]).toMatchObject({ kind: "courses", row: { term: "Winter 2027" } })
    })

    it("asks no semester without a school calendar, or for a calendar file", () => {
        act(() => openSheet({ kind: "import", plan: { ...plan(), kind: "outline" }, name: "phys.pdf" }))
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()
        fake.cal = normalizeSchool({ name: "Uni", days: [], terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }] })
        act(() => openSheet({ kind: "import", plan: plan(), name: "cal.ics" }))
        expect(screen.queryByRole("group", { name: /^Semester/ })).toBeNull()
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
