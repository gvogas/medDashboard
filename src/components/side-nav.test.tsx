import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify, setStudyBadge } from "@/bridge"
import { SideNav } from "@/components/side-nav"

// The app is not booted here: the nav only needs the view and setView.
const ui = vi.hoisted(() => ({ view: "week" }))
const setView = vi.hoisted(() => vi.fn())
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))
const side = vi.hoisted(() => ({ open: false, setSide: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ sideOpen: () => side.open, setSide: side.setSide }))
const buddyGet = vi.hoisted(() => vi.fn())
vi.mock("@/core/api", async (original) => {
    const real = await original<typeof import("@/core/api")>()
    return { ...real, api: { ...real.api, buddy: { ...real.api.buddy, get: buddyGet } } }
})
import { loadBuddy, resetBuddy } from "@/data/buddy"

const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent)

afterEach(() => {
    cleanup()
    setView.mockClear()
    side.setSide.mockClear()
    side.open = false
    setStudyBadge(null)
    ui.view = "week"
    resetBuddy()
})

describe("the pages in the sidebar", () => {
    it("lists the five pages, the current one marked", () => {
        render(<SideNav />)
        expect(screen.getByRole("navigation", { name: "Pages" })).toBeTruthy()
        expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Week", "Month", "All items", "Study", "Music"])
        expect(current()).toEqual(["Week"])
    })

    it("follows the view after a notify()", () => {
        render(<SideNav />)
        ui.view = "spotify"
        act(() => notify())
        expect(current()).toEqual(["Music"])
    })

    it("asks for a page when one is clicked", () => {
        render(<SideNav />)
        fireEvent.click(screen.getByRole("button", { name: "All items" }))
        expect(setView).toHaveBeenCalledWith("table")
        expect(side.setSide).not.toHaveBeenCalled()
    })

    it("closes the sidebar after a pick when it is open over the page", () => {
        side.open = true
        render(<SideNav />)
        fireEvent.click(screen.getByRole("button", { name: "Month" }))
        expect(setView).toHaveBeenCalledWith("month")
        expect(side.setSide).toHaveBeenCalledWith(false)
    })

    it("names each page's key, 1 to 5 in order", () => {
        render(<SideNav />)
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-keyshortcuts"))).toEqual(["1", "2", "3", "4", "5"])
    })

    it("shows the running timer beside Study", () => {
        setStudyBadge("24:13")
        render(<SideNav />)
        expect(screen.getByRole("button", { name: /Study/ }).textContent).toBe("Study24:13")
    })

    it("adds Buddy, key 6, once gameplay turns out to be on, without upsetting the hooks", async () => {
        render(<SideNav />)
        expect(screen.queryByRole("button", { name: "Buddy" })).toBeNull()
        buddyGet.mockResolvedValue({ enabled: true, xp: 0, tier: "egg", next: null, health: 100, mood: "happy", streak: 0, coins: 0,
            look: { buddy: "auto", bg: "none", name: "" }, tz: "UTC", tiers: [], recent: [], due: 0 })
        await act(async () => { await loadBuddy() })
        expect(screen.getByRole("button", { name: "Buddy" }).getAttribute("aria-keyshortcuts")).toBe("6")
    })
})
