import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    api: { buddy: { get: vi.fn(), settings: vi.fn() } },
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
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance, maintenanceState: () => fake.maintenance }))

import { Gameplay } from "./settings-study"
import { resetBuddy } from "@/data/buddy"
import type { Profile } from "@/data/types"

const on = { enabled: true, xp: 0, tier: "egg", next: { tier: "hatchling", xp: 120 }, health: 100, mood: "happy", streak: 0, coins: 0,
    look: { buddy: "auto", bg: "none", name: "" }, tz: "UTC", tiers: [], recent: [], due: 0 }
const profile = { id: "u-gp" } as Profile

beforeEach(() => {
    resetBuddy()
    fake.maintenance = null
    localStorage.clear()
    vi.stubGlobal("navigator", { onLine: true })
    fake.api.buddy.get.mockResolvedValue({ enabled: false })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("Settings › Gameplay", () => {
    it("turns gameplay on, explains earning once, and off again", async () => {
        render(<Gameplay profile={profile} />); await act(async () => {})
        const box = screen.getByRole("checkbox", { name: "Raise a study buddy" }) as HTMLInputElement
        expect(box.checked).toBe(false)
        fake.api.buddy.settings.mockResolvedValueOnce(on)
        await act(async () => { fireEvent.click(box) })
        expect(fake.api.buddy.settings).toHaveBeenCalledWith(true, expect.any(String))
        expect(box.checked).toBe(true)
        expect(screen.getByRole("status").textContent).toMatch(/Typed-in study doesn’t count/)
        fake.api.buddy.settings.mockResolvedValueOnce({ enabled: false })
        await act(async () => { fireEvent.click(box) })
        expect(box.checked).toBe(false)
        fake.api.buddy.settings.mockResolvedValueOnce(on)
        await act(async () => { fireEvent.click(box) })
        expect(screen.queryByRole("status")).toBeNull()       /* shown once per browser */
    })

    it("keeps the switch where it was when the save fails, and says so", async () => {
        render(<Gameplay profile={profile} />); await act(async () => {})
        fake.api.buddy.settings.mockRejectedValueOnce(new TypeError("offline"))
        await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "Raise a study buddy" })) })
        expect((screen.getByRole("checkbox", { name: "Raise a study buddy" }) as HTMLInputElement).checked).toBe(false)
        expect(screen.getByText(/needs a connection/)).toBeTruthy()
    })

    it("is hidden while the buddy is switched off for maintenance", async () => {
        fake.maintenance = "blocked"
        const { container } = render(<Gameplay profile={profile} />)
        expect(container.textContent).toBe("")
    })
})
