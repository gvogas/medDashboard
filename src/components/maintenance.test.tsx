import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

// Maintenance mode in the app: a page switched off shows the maintenance page in its place
// to everyone but admins, who keep the page with a slim bar over it; Import with AI shows
// the message in its sheet. The store and ui are fakes; the pages are stand-ins.
const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [], study_sessions: [], achievements: [], profile: null as null | Record<string, unknown> },
    ui: { view: "week", anchor: "2026-09-23", focus: false, aiLeft: null as number | null, aiLimit: null, aiNote: null as unknown },
}))
const actions = vi.hoisted(() => ({ setView: vi.fn(), openSettings: vi.fn() }))
vi.mock("@/core/store", () => ({ data: fake.data, conflicts: [], course: () => null, item: () => null, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ai-read", () => ({ readWithAi: vi.fn(), refreshReads: vi.fn(async () => {}), asSent: vi.fn(), MAX_FILE: 5 * 1024 * 1024 }))
vi.mock("@/components/views/week", () => ({ WeekView: () => <p>The week</p> }))
vi.mock("@/components/views/month", () => ({ MonthView: () => <p>The month</p> }))
vi.mock("@/components/views/table", () => ({ TableView: () => <p>All the items</p> }))
vi.mock("@/components/study/study-view", () => ({ StudyView: () => <p>The Study page</p> }))
vi.mock("@/components/spotify/spotify-page", () => ({ SpotifyPage: () => <p>The Music page</p> }))
vi.mock("@/components/views/stats", () => ({ Stats: () => <p>The tiles</p> }))

import { notify } from "@/bridge"
import { Views } from "@/components/views/views"
import { Stats } from "@/components/views/stats"
import { StatsHost, ViewsHost } from "@/components/shell"
import { inMaintenance } from "@/data/maintenance"
import { closeSheet, openSheet } from "@/data/overlay"
import { Sheet } from "@/components/sheet/sheet"

const sam = (features: string[], message = "") => ({ id: "u-sam", isAdmin: false, maintenance: { features, message, updatedAt: 1 } })
const george = (features: string[]) => ({ ...sam(features), id: "u-george", isAdmin: true })
const show = (view: string) => { fake.ui.view = view; act(() => notify()) }
const BAR = "In maintenance — only admins see this"

afterEach(() => {
    cleanup()
    fake.data.profile = null
    fake.ui.view = "week"
    vi.clearAllMocks()
})

describe("a page in maintenance", () => {
    const draw = () => render(<><StatsHost><Stats /></StatsHost><ViewsHost><Views /></ViewsHost></>)

    it("shows the maintenance page in its place, with a way to a page that works", async () => {
        fake.data.profile = sam(["week"])
        draw()
        expect(await screen.findByRole("heading", { name: "Week is being worked on" })).toBeTruthy()
        expect(screen.getByText("We’re fixing something here. Your data is safe and keeps syncing. Check back soon.")).toBeTruthy()
        expect(screen.queryByText("The week")).toBeNull()
        expect(document.getElementById("stats")!.hidden).toBe(true)
        fireEvent.click(screen.getByRole("button", { name: "Go to Month" }))
        expect(actions.setView).toHaveBeenCalledWith("month")
    })

    it("lands on it however the page was reached: a key, or the page saved from last time", async () => {
        fake.data.profile = sam(["spotify", "study"])
        draw()
        expect(await screen.findByText("The week")).toBeTruthy()
        show("spotify")
        expect(await screen.findByRole("heading", { name: "Music is being worked on" })).toBeTruthy()
        show("study")
        expect(await screen.findByRole("heading", { name: "Study is being worked on" })).toBeTruthy()
        show("table")
        expect(await screen.findByText("All the items")).toBeTruthy()
        expect(screen.queryByText(BAR)).toBeNull()
    })

    it("leaves every page as it was when nothing is in maintenance", async () => {
        fake.data.profile = { id: "u-sam", isAdmin: false, maintenance: null }
        draw()
        for (const [view, text] of [["week", "The week"], ["month", "The month"], ["table", "All the items"], ["study", "The Study page"], ["spotify", "The Music page"]]) {
            show(view)
            expect(await screen.findByText(text)).toBeTruthy()
        }
        expect(screen.queryByRole("heading", { name: /being worked on/ })).toBeNull()
        expect(screen.queryByText(BAR)).toBeNull()
    })

    it("covers every page with the whole app switch, in the admins' words", async () => {
        fake.data.profile = sam(["app"], "Back at 9 pm.")
        draw()
        for (const view of ["week", "month", "table", "study", "spotify"]) {
            show(view)
            expect(await screen.findByRole("heading", { name: "Term is being worked on" })).toBeTruthy()
        }
        expect(screen.getByText("Back at 9 pm.")).toBeTruthy()
        expect(screen.getByText("Your data is safe and keeps syncing.")).toBeTruthy()
        /* nowhere else to go */
        expect(screen.queryByRole("button", { name: /^Go to/ })).toBeNull()
    })

    it("lets an admin keep using it, under a slim bar", async () => {
        fake.data.profile = george(["week"])
        draw()
        expect(await screen.findByText("The week")).toBeTruthy()
        expect(screen.getByRole("status").textContent).toBe(BAR)
        expect(document.getElementById("stats")!.hidden).toBe(false)
        show("month")
        expect(await screen.findByText("The month")).toBeTruthy()
        expect(screen.queryByText(BAR)).toBeNull()
    })
})

describe("inMaintenance", () => {
    it("is on for a feature switched off, or for all of them with the whole app", () => {
        fake.data.profile = sam(["classes"])
        expect(inMaintenance("classes")).toBe(true)
        expect(inMaintenance("import")).toBe(false)
        fake.data.profile = sam(["app"])
        expect(inMaintenance("import")).toBe(true)
        fake.data.profile = null
        expect(inMaintenance("classes")).toBe(false)
    })
})

describe("Import with AI in maintenance", () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="app"></div><div id="scrim"></div><div id="sheet"></div>'
        render(<Sheet />, { container: document.getElementById("sheet")! })
    })
    afterEach(() => { act(() => closeSheet()) })

    it("shows the message in the sheet instead of the importer", async () => {
        fake.data.profile = sam(["import"], "The reader is being upgraded.")
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByRole("heading", { name: "Import with AI is being worked on" })).toBeTruthy()
        expect(screen.getByText("The reader is being upgraded.")).toBeTruthy()
        expect(screen.queryByText("Class schedule")).toBeNull()
        expect(screen.queryByLabelText(/Choose a file/)).toBeNull()
    })

    it("is the importer, under the bar, for an admin", async () => {
        fake.data.profile = george(["app"])
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Class schedule")).toBeTruthy()
        expect(screen.getByText(BAR)).toBeTruthy()
    })

    it("is the importer as before when Import with AI is not in maintenance", async () => {
        fake.data.profile = sam(["week"])
        act(() => openSheet({ kind: "ai" }))
        expect(await screen.findByText("Class schedule")).toBeTruthy()
        expect(screen.queryByText(BAR)).toBeNull()
    })
})
