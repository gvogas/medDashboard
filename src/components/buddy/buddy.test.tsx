import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    api: { buddy: { get: vi.fn(), settings: vi.fn(), claim: vi.fn(), look: vi.fn(), shop: vi.fn(), buy: vi.fn(), saveCustom: vi.fn(), deleteCustom: vi.fn() } },
    maintenance: null as null | "blocked" | "admin",
    view: vi.fn(),
    settings: vi.fn(),
}))
vi.mock("@/core/api", () => ({
    api: fake.api,
    ApiError: class extends Error { status: number; body: { error?: string } | null; constructor(status: number, body: { error?: string } | null) { super(body?.error); this.status = status; this.body = body } },
}))
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance, maintenanceState: () => fake.maintenance }))
vi.mock("@/data/signin", () => ({ useScreen: () => "app" }))
vi.mock("@/data/store", () => ({ useProfile: () => ({ bg: "law" }) }))
vi.mock("@/data/study-controller", () => ({ setView: fake.view }))
vi.mock("@/data/actions", () => ({ openSettings: fake.settings }))

import { BuddyPage, earnedFor } from "./buddy-page"
import { BuddyBadge } from "./buddy-badge"
import { loadBuddy, resetBuddy } from "@/data/buddy"
import { ApiError } from "@/core/api"
import { cannotBuy } from "./buddy-shop"

const state = (over = {}) => ({
    enabled: true, xp: 130, tier: "hatchling", next: { tier: "r3", xp: 300 }, health: 100, mood: "happy", streak: 2, coins: 30,
    look: { buddy: "auto", bg: "none", frame: "none", name: "" }, tz: "UTC", custom: null, owned: [],
    tiers: ["egg", "hatchling", "r3", "r4", "r5", "r6", "legend"].map((id, i) => ({ id, minXp: [0, 120, 300, 700, 1400, 2500, 4000][i], reward: [5, 25, 50, 100, 200, 400, 800][i], reached: i < 2, claimed: i === 0 })),
    recent: [{ source: "session:s1", amount: 5, at: 1 }], due: 0, ...over,
})

const item = (sku: string, kind: "upgrade" | "bg" | "frame", name: string, level: number, max: number, cost: number | null) => ({ sku, kind, name, effect: kind === "upgrade" ? "+20% study coins" : "Cosmetic", level, max, cost })
const SHOP = { coins: 30, items: [item("focus", "upgrade", "Focus Engine", 0, 5, 75), item("bg-meadow", "bg", "Meadow", 0, 1, 25), item("bg-night", "bg", "Starry night", 1, 1, null)] }

beforeEach(() => {
    resetBuddy()
    fake.maintenance = null
    vi.stubGlobal("navigator", { onLine: true })
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    fake.api.buddy.shop.mockResolvedValue(SHOP)
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
        fake.api.buddy.look.mockResolvedValue(state({ look: { buddy: "pilot", bg: "none", frame: "none", name: "" } }))
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
        expect(["session:a", "item:u:t", "streak:2026-11-02", "claim:egg", "admin:1:x", "grade90:c:s:x", "buy:focus:1"].map(earnedFor))
            .toEqual(["Study session", "Finished item", "Streak day", "Rank claimed", "Admin grant", "Grade bonus", "Shop"])
    })
})

describe("the shop", () => {
    it("says how many more coins an upgrade needs, and buys what you can afford", async () => {
        await withBuddy(state())
        fake.api.buddy.buy.mockResolvedValue({ coins: 0, item: { ...SHOP.items[1], level: 1, cost: null } })
        render(<BuddyPage />); await act(async () => {})
        const focus = screen.getByRole("button", { name: "Buy Focus Engine level 1 for 75 coins" }) as HTMLButtonElement
        expect(focus.disabled).toBe(true)
        expect(screen.getByText("45 more coins")).toBeTruthy()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Buy Meadow for 25 coins" })) })
        expect(fake.api.buddy.buy).toHaveBeenCalledWith("bg-meadow", 1)
    })

    it("puts on a background you own", async () => {
        await withBuddy(state({ owned: ["bg-night"] }))
        fake.api.buddy.look.mockResolvedValue(state({ owned: ["bg-night"], look: { buddy: "auto", bg: "bg-night", frame: "none", name: "" } }))
        render(<BuddyPage />); await act(async () => {})
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use" })) })
        expect(fake.api.buddy.look).toHaveBeenCalledWith({ bg: "bg-night" })
        expect(screen.getByRole("button", { name: "Take off" })).toBeTruthy()
    })

    it("shows the Worker's reason when a buy fails", async () => {
        await withBuddy(state({ coins: 100 }))
        fake.api.buddy.buy.mockRejectedValue(new ApiError(409, { error: "not_enough_coins" }))
        render(<BuddyPage />); await act(async () => {})
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Buy Focus Engine level 1 for 75 coins" })) })
        expect(screen.getByText("Not enough coins for that yet.")).toBeTruthy()
    })

    it("words why a buy is off", () => {
        expect(cannotBuy(item("focus", "upgrade", "F", 5, 5, null), 999)).toBe("Top level")
        expect(cannotBuy(item("focus", "upgrade", "F", 1, 5, 110), 100)).toBe("10 more coins")
        expect(cannotBuy(item("focus", "upgrade", "F", 1, 5, 110), 110)).toBe("")
    })
})

describe("naming and the custom buddy", () => {
    it("renames the buddy, and the name shows on the page and the badge", async () => {
        await withBuddy(state())
        fake.api.buddy.look.mockResolvedValue(state({ look: { buddy: "auto", bg: "none", frame: "none", name: "Professor" } }))
        render(<><BuddyPage /><BuddyBadge /></>); await act(async () => {})
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Professor " } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })) })
        expect(fake.api.buddy.look).toHaveBeenCalledWith({ name: "Professor" })
        expect(screen.getByRole("img", { name: "Professor, Hatchling, happy" })).toBeTruthy()
        expect(screen.getByRole("button", { name: /^Professor: 30 coins/ })).toBeTruthy()
    })

    it("shows a saved custom buddy, can pick it, and can delete it", async () => {
        const custom = { palette: ["#e8913f"], rows: [".00.", "0000", "0000", ".00."] }
        await withBuddy(state({ custom }))
        fake.api.buddy.look.mockResolvedValue(state({ custom, look: { buddy: "custom", bg: "none", frame: "none", name: "" } }))
        fake.api.buddy.deleteCustom.mockResolvedValue(state())
        render(<BuddyPage />); await act(async () => {})
        await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "Your own" })) })
        expect(screen.getByRole("img", { name: "Mochi, Hatchling, happy" })).toBeTruthy()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete my custom buddy" })) })
        expect(fake.api.buddy.deleteCustom).toHaveBeenCalled()
        expect(screen.queryByRole("radio", { name: "Your own" })).toBeNull()
    })

    it("refuses a file that is not a picture, or is over 10 MB, and never uploads it", async () => {
        await withBuddy(state())
        render(<BuddyPage />); await act(async () => {})
        const input = document.getElementById("buddy-file") as HTMLInputElement
        fireEvent.change(input, { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } })
        expect(screen.getByText(/isn't a picture this can read/)).toBeTruthy()
        const big = new File(["x"], "big.png", { type: "image/png" })
        Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 })
        fireEvent.change(input, { target: { files: [big] } })
        expect(screen.getByText(/over 10 MB/)).toBeTruthy()
        expect(fake.api.buddy.saveCustom).not.toHaveBeenCalled()
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

    it("looks tired while cards are due and none were reviewed today, and says so", async () => {
        const { data } = await import("@/core/store")
        const { notify } = await import("@/bridge")
        data.decks = [{ id: "d1", title: "D", courseId: null, classId: null, authorId: "u" }]
        data.cards = [{ id: "k1", deckId: "d1", front: "Q", back: "A", source: "hand", authorId: "u" }]
        try {
            notify()
            await withBuddy(state({ tiers: state().tiers.map((t) => ({ ...t, claimed: t.reached })) }))
            render(<BuddyBadge />)
            expect(screen.getByRole("button", { name: "Brief: 30 coins, cards due" })).toBeTruthy()
        } finally { data.decks = []; data.cards = []; notify() }
    })

    it("shows the coins, says a rank is waiting, and opens the Buddy page", async () => {
        await withBuddy(state({ tiers: state().tiers.map((t) => (t.id === "hatchling" ? { ...t, claimed: false } : t)) }))
        render(<BuddyBadge />)
        const badge = screen.getByRole("button", { name: "Brief: 30 coins, a rank to claim" })
        fireEvent.click(badge)
        expect(fake.view).toHaveBeenCalledWith("buddy")
    })
})
