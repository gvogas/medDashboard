import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    api: { buddy: { get: vi.fn(), settings: vi.fn(), claim: vi.fn(), look: vi.fn() } },
    maintenance: null as null | "blocked" | "admin",
}))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("./maintenance", () => ({ maintenanceState: () => fake.maintenance }))

import { ApiError } from "@/core/api"
import { activeBuddy, buddyNow, claimTier, gainSince, loadBuddy, resetBuddy, setGameplay } from "./buddy"

export const state = (over = {}) => ({
    enabled: true, xp: 130, tier: "hatchling", next: { tier: "r3", xp: 300 }, health: 100, mood: "happy", streak: 2, coins: 30,
    look: { buddy: "auto", bg: "none", name: "" }, tz: "UTC",
    tiers: ["egg", "hatchling", "r3", "r4", "r5", "r6", "legend"].map((id, i) => ({ id, minXp: [0, 120, 300, 700, 1400, 2500, 4000][i], reward: 5, reached: i < 2, claimed: i === 0 })),
    recent: [{ source: "session:s1", amount: 5, at: 1 }], due: 0, ...over,
})

beforeEach(() => { resetBuddy(); vi.clearAllMocks(); fake.maintenance = null; vi.stubGlobal("navigator", { onLine: true }) })

describe("the buddy store", () => {
    it("shows nothing while gameplay is off, and the Buddy while it is on", async () => {
        fake.api.buddy.get.mockResolvedValueOnce({ enabled: false })
        await loadBuddy()
        expect(activeBuddy()).toBeNull()
        fake.api.buddy.get.mockResolvedValueOnce(state())
        await loadBuddy()
        expect(activeBuddy()?.coins).toBe(30)
    })

    it("keeps the last good state when an answer fails, and asks once for two calls at once", async () => {
        fake.api.buddy.get.mockResolvedValueOnce(state())
        await loadBuddy()
        fake.api.buddy.get.mockRejectedValueOnce(new Error("invalid response"))
        await Promise.all([loadBuddy(), loadBuddy()])
        expect(fake.api.buddy.get).toHaveBeenCalledTimes(2)
        expect(activeBuddy()?.coins).toBe(30)
        expect(buddyNow().error).toMatch(/Could not load/)
    })

    it("asks nothing while the buddy is switched off for maintenance", async () => {
        fake.maintenance = "blocked"
        await loadBuddy()
        expect(fake.api.buddy.get).not.toHaveBeenCalled()
    })

    it("sends the browser's zone when gameplay is turned on, and says what went wrong", async () => {
        fake.api.buddy.settings.mockResolvedValueOnce(state())
        expect(await setGameplay(true)).toBe("")
        expect(fake.api.buddy.settings).toHaveBeenCalledWith(true, expect.any(String))
        fake.api.buddy.claim.mockRejectedValueOnce(new ApiError(409, { error: "tier_not_reached" }))
        expect(await claimTier("r3")).toBe("Your buddy hasn't reached that rank yet.")
    })

    it("works out XP gained since a value read before the change", async () => {
        fake.api.buddy.get.mockResolvedValueOnce(state({ xp: 160 }))
        expect(await gainSince(130)).toBe(30)
        expect(await gainSince(undefined)).toBe(0)
    })
})
