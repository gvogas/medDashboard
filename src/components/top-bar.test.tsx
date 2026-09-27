import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify } from "@/bridge"
import { TopBar } from "@/components/top-bar"
import { stubMatchMedia } from "./test-media"

// The legacy app is not booted: the bar needs the ui, sync status, Spotify's state and
// the school calendar, and its buttons call the actions, which are fakes here.
const fake = vi.hoisted(() => {
    const statusListeners = new Set<(s: unknown) => void>()
    return {
        ui: { view: "week", anchor: "2026-09-23", search: "" },
        spotify: { loaded: true, connected: true, device: "Kitchen" as string | null },
        status: { state: "idle", pending: 0, message: "" },
        statusListeners,
        setStatus(s: { state: string; pending?: number; message?: string }) {
            Object.assign(this.status, { pending: 0, message: "", ...s })
            for (const fn of statusListeners) fn(this.status)
        },
    }
})
const actions = vi.hoisted(() => ({
    goToday: vi.fn(), step: vi.fn(), setSearch: vi.fn(), newItem: vi.fn(),
    toggleSettings: vi.fn(), showSidebar: vi.fn(), syncNow: vi.fn(),
}))
vi.mock("@/data/actions", () => actions)
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))
vi.mock("@/legacy/js/spotify.js", () => ({ state: fake.spotify }))
vi.mock("@/legacy/js/query.js", () => ({ schoolCal: () => null }))
vi.mock("@/legacy/js/study-controller.js", () => ({ setView: vi.fn() }))
vi.mock("@/legacy/js/sync.js", () => ({
    status: fake.status,
    onStatus: (fn: (s: unknown) => void) => fake.statusListeners.add(fn),
}))

stubMatchMedia({ reducedMotion: false })

const show = (view: string, anchor = "2026-09-23") => {
    fake.ui.view = view
    fake.ui.anchor = anchor
    act(() => notify())
}
const title = () => screen.getByRole("heading", { level: 1 }).textContent
const sub = () => screen.getByRole("heading", { level: 1 }).nextElementSibling?.textContent ?? ""

afterEach(() => {
    cleanup()
    Object.values(actions).forEach((fn) => fn.mockClear())
    fake.ui.view = "week"
    fake.ui.anchor = "2026-09-23"
    fake.ui.search = ""
    act(() => fake.setStatus({ state: "idle" }))
})

describe("the top bar", () => {
    it("titles each view", () => {
        render(<TopBar />)
        expect(title()).toBe("Week board")
        expect(sub()).toBe("Mon 21 Sep – Sun 27 Sep 2026")
        show("month")
        expect(title()).toBe("September 2026")
        expect(sub()).toBe("")
        show("table")
        expect(title()).toBe("All items")
        show("study")
        expect(title()).toBe("Study")
        show("spotify")
        expect(title()).toBe("Spotify")
        expect(sub()).toBe("Playing on Kitchen")
        fake.spotify.device = null
        act(() => notify())
        expect(sub()).toBe("No active device")
        fake.spotify.connected = false
        act(() => notify())
        expect(sub()).toBe("Not connected")
    })

    it("shows ‹ Today › only in the week and month views", () => {
        render(<TopBar />)
        const nav = () => ["Previous", "Today", "Next"].map((name) => screen.queryByRole("button", { name }) !== null)
        expect(nav()).toEqual([true, true, true])
        show("month")
        expect(nav()).toEqual([true, true, true])
        for (const view of ["table", "spotify", "study"]) {
            show(view)
            expect(nav()).toEqual([false, false, false])
        }
    })

    it("steps and goes to today", () => {
        render(<TopBar />)
        fireEvent.click(screen.getByRole("button", { name: "Previous" }))
        fireEvent.click(screen.getByRole("button", { name: "Next" }))
        fireEvent.click(screen.getByRole("button", { name: "Today" }))
        expect(actions.step.mock.calls).toEqual([[-1], [1]])
        expect(actions.goToday).toHaveBeenCalledOnce()
    })

    it("searches as you type", () => {
        render(<TopBar />)
        const box = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement
        fireEvent.change(box, { target: { value: "cardio" } })
        expect(actions.setSearch).toHaveBeenCalledWith("cardio")
        expect(box.value).toBe("cardio")
        expect(box.id).toBe("search")   // the / key focuses it by id
    })

    it("shows the sync state and syncs on click", () => {
        render(<TopBar />)
        const cases: [Parameters<typeof fake.setStatus>[0], string][] = [
            [{ state: "idle" }, "Synced"],
            [{ state: "pending" }, "Saving…"],
            [{ state: "syncing" }, "Syncing…"],
            [{ state: "offline", pending: 3 }, "Offline · 3"],
            [{ state: "error", message: "Server said no" }, "Sync problem"],
            [{ state: "signed-out" }, "Signed out"],
        ]
        for (const [status, label] of cases) {
            act(() => fake.setStatus(status))
            expect(screen.getByRole("button", { name: label })).toBeTruthy()
        }
        const pill = screen.getByRole("button", { name: "Signed out" })
        act(() => fake.setStatus({ state: "error", message: "Server said no" }))
        expect(pill.title).toBe("Server said no")
        expect(screen.getByRole("status").textContent).toBe("Sync problem. Server said no")
        fireEvent.click(pill)
        expect(actions.syncNow).toHaveBeenCalledOnce()
    })

    it("opens Settings, a new item and the sidebar", () => {
        document.body.appendChild(Object.assign(document.createElement("aside"), { id: "side" }))
        render(<TopBar />)
        fireEvent.click(screen.getByRole("button", { name: "Settings" }))
        fireEvent.click(screen.getByRole("button", { name: "New item" }))
        expect(actions.toggleSettings).toHaveBeenCalledOnce()
        expect(actions.newItem).toHaveBeenCalledOnce()

        const menu = screen.getByRole("button", { name: "Show sidebar" })
        expect(menu.getAttribute("aria-expanded")).toBe("false")
        fireEvent.click(menu)
        expect(actions.showSidebar).toHaveBeenCalledWith(true)
        document.getElementById("side")!.classList.add("on")
        act(() => notify())
        expect(menu.getAttribute("aria-expanded")).toBe("true")
        fireEvent.click(menu)
        expect(actions.showSidebar).toHaveBeenLastCalledWith(false)
        document.getElementById("side")!.remove()
    })
})
