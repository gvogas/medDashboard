import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    api: { buddy: { get: vi.fn(), settings: vi.fn(), claim: vi.fn(), look: vi.fn() } },
    maintenance: null as null | "blocked" | "admin",
    view: vi.fn(),
    settings: vi.fn(),
}))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {} }))
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance, maintenanceState: () => fake.maintenance }))
vi.mock("@/data/signin", () => ({ useScreen: () => "app" }))
vi.mock("@/data/store", () => ({ useProfile: () => ({ bg: "law" }) }))
vi.mock("@/data/study-controller", () => ({ setView: fake.view }))
vi.mock("@/data/actions", () => ({ openSettings: fake.settings }))

import { BuddyPage, earnedFor } from "./buddy-page"
import { BuddyBadge } from "./buddy-badge"
import { loadBuddy, resetBuddy } from "@/data/buddy"

const state = (over = {}) => ({
    enabled: true, xp: 130, tier: "hatchling", next: { tier: "r3", xp: 300 }, health: 100, mood: "happy", streak: 2, coins: 30,
    look: { buddy: "auto", bg: "none", name: "" }, tz: "UTC",
    tiers: ["egg", "hatchling", "r3", "r4", "r5", "r6", "legend"].map((id, i) => ({ id, minXp: [0, 120, 300, 700, 1400, 2500, 4000][i], reward: [5, 25, 50, 100, 200, 400, 800][i], reached: i < 2, claimed: i === 0 })),
    recent: [{ source: "session:s1", amount: 5, at: 1 }], due: 0, ...over,
})

beforeEach(() => {
    resetBuddy()
    fake.maintenance = null
    vi.stubGlobal("navigator", { onLine: true })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

const withBuddy = async (s: object) => { fake.api.buddy.get.mockResolvedValue(s); await loadBuddy() }

describe("the Buddy page", () => {
    it("shows the buddy for the profile's theme, its rank, XP, health and coins", async () => {
        await withBuddy(state())
        render(<BuddyPage />); await act(async () => {})
        expect(screen.getByRole("img", { name: "Brief, Hatchling, happy" })).toBeTruthy()
        expect(screen.getByText("130 / 300")).toBeTruthy()
        expect(screen.getByText("30 coins")).toBeTruthy()
        expect(screen.getByRole("meter", { name: "Health" }).getAttribute("aria-valuenow")).toBe("100")
        expect(screen.getByText("Study session")).toBeTruthy()
    })

    it("names the mood for each health range", async () => {
        await withBuddy(state({ health: 30, mood: "sick" }))
        render(<BuddyPage />); await act(async () => {})
        expect(screen.getByRole("img", { name: "Brief, Hatchling, sick" })).toBeTruthy()
        expect(screen.getByText(/· Sick/)).toBeTruthy()
    })

    it("claims a reached rank, and the row says Claimed", async () => {
        await withBuddy(state())
        fake.api.buddy.claim.mockResolvedValue(state({ coins: 55, tiers: state().tiers.map((t) => (t.id === "hatchling" ? { ...t, claimed: true } : t)) }))
        render(<BuddyPage />); await act(async () => {})
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Claim 25 coins" })) })
        expect(fake.api.buddy.claim).toHaveBeenCalledWith("hatchling")
        expect(screen.getByText("Claimed 25 coins")).toBeTruthy()
    })

    it("picks another theme's buddy", async () => {
        await withBuddy(state())
        fake.api.buddy.look.mockResolvedValue(state({ look: { buddy: "pilot", bg: "none", name: "" } }))
        render(<BuddyPage />); await act(async () => {})
        await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Jet" })) })
        expect(fake.api.buddy.look).toHaveBeenCalledWith({ buddy: "pilot" })
        expect(screen.getByRole("img", { name: "Jet, Hatchling, happy" })).toBeTruthy()
    })

    it("points to Settings while gameplay is off", async () => {
        await withBuddy({ enabled: false })
        render(<BuddyPage />); await act(async () => {})
        fireEvent.click(screen.getByRole("button", { name: "Open Settings" }))
        expect(fake.settings).toHaveBeenCalledWith("gameplayGrp")
    })

    it("words each kind of earning", () => {
        expect(["session:a", "item:u:t", "streak:2026-11-02", "claim:egg", "admin:1:x"].map(earnedFor))
            .toEqual(["Study session", "Finished item", "Streak day", "Rank claimed", "Admin grant"])
    })
})

describe("the header badge", () => {
    it("is hidden while gameplay is off or the buddy is switched off", async () => {
        await withBuddy({ enabled: false })
        const { container } = render(<BuddyBadge />)
        expect(container.textContent).toBe("")
        cleanup()
        await withBuddy(state())
        fake.maintenance = "blocked"
        expect(render(<BuddyBadge />).container.textContent).toBe("")
    })

    it("shows the coins, says a rank is waiting, and opens the Buddy page", async () => {
        await withBuddy(state({ tiers: state().tiers.map((t) => (t.id === "hatchling" ? { ...t, claimed: false } : t)) }))
        render(<BuddyBadge />)
        const badge = screen.getByRole("button", { name: "Brief: 30 coins, a rank to claim" })
        fireEvent.click(badge)
        expect(fake.view).toHaveBeenCalledWith("buddy")
    })
})
