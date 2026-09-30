import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify } from "@/bridge"
import { TopBar } from "@/components/top-bar"
import { setSide } from "@/data/sidebar"
import { stubMatchMedia } from "./test-media"

// The app is not booted: the bar needs the ui, Spotify's state and
// the school calendar, and its buttons call the actions, which are fakes here.
const fake = vi.hoisted(() => ({
    ui: { view: "week", anchor: "2026-09-23", search: "" },
    spotify: { loaded: true, connected: true, device: "Kitchen" as string | null },
}))
const actions = vi.hoisted(() => ({
    goToday: vi.fn(), step: vi.fn(), setSearch: vi.fn(), newItem: vi.fn(), showSidebar: vi.fn(),
}))
vi.mock("@/data/actions", () => actions)
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/spotify/player", () => ({ state: fake.spotify }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

stubMatchMedia({ reducedMotion: false })

const show = (view: string, anchor = "2026-09-23") => {
    fake.ui.view = view
    fake.ui.anchor = anchor
    act(() => notify())
}
const title = () => screen.getByRole("heading", { level: 1 }).textContent
const sub = () => (screen.getByRole("heading", { level: 1 }).previousElementSibling?.textContent ?? "").trim()

afterEach(() => {
    cleanup()
    Object.values(actions).forEach((fn) => fn.mockClear())
    fake.ui.view = "week"
    fake.ui.anchor = "2026-09-23"
    fake.ui.search = ""
})

describe("the top bar", () => {
    it("shows the date line over the title, the title in the serif", () => {
        render(<TopBar />)
        const h1 = screen.getByRole("heading", { level: 1 })
        expect(h1.className).toContain("font-serif")
        expect(h1.previousElementSibling?.textContent).toBeTruthy()
    })

    it("titles each view", () => {
        render(<TopBar />)
        expect(title()).toBe("21 Sep – 27 Sep")
        expect(sub()).toBe("Wednesday 23 September")
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

    it("opens a new item and the sidebar", () => {
        render(<TopBar />)
        fireEvent.click(screen.getByRole("button", { name: "New item" }))
        expect(actions.newItem).toHaveBeenCalledOnce()

        const menu = screen.getByRole("button", { name: "Show sidebar" })
        expect(menu.getAttribute("aria-expanded")).toBe("false")
        fireEvent.click(menu)
        expect(actions.showSidebar).toHaveBeenCalledWith(true)
        act(() => setSide(true))   /* what showSidebar does */
        expect(menu.getAttribute("aria-expanded")).toBe("true")
        fireEvent.click(menu)
        expect(actions.showSidebar).toHaveBeenLastCalledWith(false)
        act(() => setSide(false))
    })
})
