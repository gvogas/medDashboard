import { afterEach, describe, expect, it, vi } from "vitest"

// The session's edges and the AI answers remembered on this device: a session started keeps
// only its own account's answers; signed out here or in another tab forgets them all. Every
// other part of the app is a fake.
const fake = vi.hoisted(() => ({
    data: { profile: null as Record<string, unknown> | null, quotes: [] as unknown[] },
    cache: { forgetReads: vi.fn(), keepReadsFor: vi.fn() },
    store: { open: vi.fn(async () => {}), close: vi.fn(async () => {}) },
    classes: { openJoin: vi.fn() },
    inbox: { setUnread: vi.fn() },
    onUnread: vi.fn(),
}))
vi.mock("@/core/api", () => ({ api: {}, ApiError: class extends Error {}, resetRequests: vi.fn(), bindAccount: vi.fn() }))
vi.mock("@/core/store", () => ({ data: fake.data, open: fake.store.open, close: fake.store.close }))
vi.mock("@/core/sync", () => ({ startingProfile: vi.fn(async (p: unknown) => p), stop: vi.fn(), init: vi.fn(), syncNow: vi.fn(), onUnread: fake.onUnread }))
vi.mock("@/bridge", () => ({ notify: vi.fn() }))
vi.mock("./spotify/player", () => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock("./spotify/web-player", () => ({ stop: vi.fn() }))
vi.mock("./overlay", () => ({ closeSheet: vi.fn() }))
vi.mock("./ai-cache", () => fake.cache)
vi.mock("./toast", () => ({ toast: vi.fn() }))
vi.mock("./settings", () => ({ applyCoat: vi.fn() }))
vi.mock("./actions", () => ({ openSettings: vi.fn() }))
vi.mock("./signin", () => ({ showApp: vi.fn(), showSignInState: vi.fn() }))
vi.mock("./run", () => ({ load: vi.fn(async () => {}), active: () => false }))
vi.mock("./room", () => ({ resetRoom: vi.fn() }))
vi.mock("./theme", () => ({ setTheme: vi.fn(), setBg: vi.fn() }))
vi.mock("./study-controller", () => ({ celebrateStudy: vi.fn(), celebrateAchievements: vi.fn() }))
vi.mock("./sync-status", () => ({ refreshAfterSync: vi.fn() }))
vi.mock("./ui", () => ({ ui: { theme: "system", bg: "med" } }))
vi.mock("@/lib/lazy", () => ({ preloadIdle: vi.fn() }))
vi.mock("./classes", () => fake.classes)
vi.mock("./inbox", () => fake.inbox)

import { boot, onStorage, onStoreEvent } from "./session"

afterEach(() => {
    vi.clearAllMocks()
    fake.data.profile = null
    localStorage.clear()
})

describe("the AI answers kept on this device", () => {
    it("are kept for the account whose session starts", async () => {
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1" } })
        await boot()
        expect(fake.cache.keepReadsFor).toHaveBeenCalledWith("u1")
        expect(fake.cache.forgetReads).not.toHaveBeenCalled()
    })

    it("are forgotten when the session is signed out", () => {
        onStoreEvent({ type: "signed-out" } as never)
        expect(fake.cache.forgetReads).toHaveBeenCalled()
    })

    it("are forgotten when another tab signs in as someone else, and kept when it is the same account", async () => {
        fake.data.profile = { id: "u1" }
        onStorage(new StorageEvent("storage", { key: "rounds.session", newValue: JSON.stringify({ id: "u1" }) }))
        expect(fake.cache.forgetReads).not.toHaveBeenCalled()
        onStorage(new StorageEvent("storage", { key: "rounds.session", newValue: JSON.stringify({ id: "u2" }) }))
        expect(fake.cache.forgetReads).toHaveBeenCalled()
        await vi.waitFor(() => expect(fake.store.close).toHaveBeenCalled())
    })
})

describe("a join link", () => {
    it("is read once and cleared; anyone signed in gets the join sheet with its code, admin or not", async () => {
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        history.replaceState(null, "", "/#join=7KQ2M9XD")
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1", isAdmin: true } })
        await boot()
        expect(location.hash).toBe("")
        expect(fake.classes.openJoin).toHaveBeenCalledWith("7KQ2M9XD")
        /* the inbox's count comes with each sync */
        expect(fake.onUnread).toHaveBeenCalledWith(fake.inbox.setUnread)

        vi.clearAllMocks()
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        history.replaceState(null, "", "/#join=7KQ2M9XD")
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1" } })
        await boot()
        expect(location.hash).toBe("")
        expect(fake.classes.openJoin).toHaveBeenCalledWith("7KQ2M9XD")
        /* the inbox's count comes with each sync */
        expect(fake.onUnread).toHaveBeenCalledWith(fake.inbox.setUnread)
    })
})
