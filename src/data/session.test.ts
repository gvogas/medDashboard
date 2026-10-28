import { afterEach, describe, expect, it, vi } from "vitest"

// The session's edges and the AI answers remembered on this device: a session started keeps
// only its own account's answers; signed out here or in another tab forgets them all. Every
// other part of the app is a fake.
const fake = vi.hoisted(() => ({
    data: { profile: null as Record<string, unknown> | null, quotes: [] as unknown[] },
    cache: { forgetReads: vi.fn(), keepReadsFor: vi.fn() },
    store: { open: vi.fn(async () => {}), close: vi.fn(async () => {}), reload: vi.fn(async () => {}), pendingCount: vi.fn(() => 0), conflicts: [] as unknown[], wipe: vi.fn(async () => {}) },
    api: { signOut: vi.fn(async () => {}), revokeAll: vi.fn(async () => {}) },
    run: { load: vi.fn(async () => {}), active: vi.fn(() => false), stop: vi.fn(async () => {}), reset: vi.fn() },
    sync: { drain: vi.fn(async () => {}), syncNow: vi.fn(async () => true) },
    classes: { openJoin: vi.fn() },
    inbox: { setUnread: vi.fn() },
    setOnUnread: vi.fn(),
}))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {}, resetRequests: vi.fn(), bindAccount: vi.fn() }))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store }))
vi.mock("@/core/sync", () => ({ startingProfile: vi.fn(async (p: unknown) => p), stop: vi.fn(), init: vi.fn(), syncNow: fake.sync.syncNow, drain: fake.sync.drain, setOnUnread: fake.setOnUnread }))
vi.mock("@/bridge", () => ({ notify: vi.fn() }))
vi.mock("./spotify/player", () => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock("./spotify/web-player", () => ({ stop: vi.fn() }))
vi.mock("./overlay", () => ({ closeSheet: vi.fn() }))
vi.mock("./ai-cache", () => fake.cache)
vi.mock("./toast", () => ({ TOAST_MS: 6000, TOAST_LONG_MS: 8000, toast: vi.fn() }))
vi.mock("./settings", () => ({ applyCoat: vi.fn() }))
vi.mock("./actions", () => ({ openSettings: vi.fn() }))
vi.mock("./signin", () => ({ showApp: vi.fn(), showSignInState: vi.fn() }))
vi.mock("./run", () => fake.run)
vi.mock("./room", () => ({ resetRoom: vi.fn() }))
vi.mock("./theme", () => ({ setTheme: vi.fn(), setBg: vi.fn() }))
vi.mock("./study-controller", () => ({ celebrateStudy: vi.fn(), celebrateAchievements: vi.fn(), commitUndo: vi.fn(async () => {}), finishDelete: vi.fn(async () => {}) }))
vi.mock("./sync-status", () => ({ refreshAfterSync: vi.fn() }))
vi.mock("./ui", () => ({ ui: { theme: "system", bg: "med" } }))
vi.mock("@/lib/lazy", () => ({ preloadIdle: vi.fn() }))
vi.mock("./classes", () => fake.classes)
vi.mock("./inbox", () => fake.inbox)

import { boot, onStorage, onStoreEvent, signOut } from "./session"
import { ui } from "./ui"

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
        expect(fake.setOnUnread).toHaveBeenCalledWith(fake.inbox.setUnread)

        vi.clearAllMocks()
        localStorage.setItem("rounds.session", JSON.stringify({ id: "u1" }))
        history.replaceState(null, "", "/#join=7KQ2M9XD")
        fake.store.open.mockImplementationOnce(async () => { fake.data.profile = { id: "u1" } })
        await boot()
        expect(location.hash).toBe("")
        expect(fake.classes.openJoin).toHaveBeenCalledWith("7KQ2M9XD")
        /* the inbox's count comes with each sync */
        expect(fake.setOnUnread).toHaveBeenCalledWith(fake.inbox.setUnread)
    })
})

describe("signing out with a study run going", () => {
    it("cancelling at the prompt keeps the run going", async () => {
        fake.run.active.mockReturnValueOnce(true)
        await signOut()
        expect(ui.signoutAsk).toEqual({ everywhere: false, unsynced: false, timer: true })
        expect(fake.run.stop).not.toHaveBeenCalled()
        expect(fake.api.signOut).not.toHaveBeenCalled()
    })
    it("asks about unsynced edits when no timer is running", async () => {
        fake.store.pendingCount.mockReturnValueOnce(2)
        await signOut()
        expect(ui.signoutAsk).toEqual({ everywhere: false, unsynced: true, timer: false })
        expect(fake.api.signOut).not.toHaveBeenCalled()
    })
    it("a run in progress is saved and its session uploaded before the sign-out is sent", async () => {
        fake.run.active.mockReturnValueOnce(true)
        await signOut({ force: true })
        const saved = fake.run.stop.mock.invocationCallOrder[0]
        const uploaded = fake.sync.syncNow.mock.invocationCallOrder[0]
        const revoked = fake.api.signOut.mock.invocationCallOrder[0]
        expect(saved).toBeLessThan(uploaded)
        expect(uploaded).toBeLessThan(revoked)
    })
    it("a failed sign-out wipes nothing, so the saved session survives", async () => {
        fake.run.active.mockReturnValueOnce(true)
        fake.api.signOut.mockRejectedValueOnce(new Error("offline"))
        await signOut({ force: true })
        expect(fake.store.wipe).not.toHaveBeenCalled()
    })
    it("a run whose upload is held back by maintenance is not wiped under a prompt that never warned of it", async () => {
        fake.run.active.mockReturnValueOnce(true)
        fake.sync.syncNow.mockResolvedValueOnce(true)
        fake.store.pendingCount.mockReturnValueOnce(0).mockReturnValueOnce(1)
        await signOut({ force: true })
        expect(ui.signoutAsk).toEqual({ everywhere: false, unsynced: true, timer: false })
        expect(fake.api.signOut).not.toHaveBeenCalled()
        expect(fake.store.wipe).not.toHaveBeenCalled()
    })
    it("a run whose upload fails is not wiped under a prompt that never warned of it", async () => {
        fake.run.active.mockReturnValueOnce(true)
        fake.sync.syncNow.mockResolvedValueOnce(false)
        fake.store.pendingCount.mockReturnValueOnce(0).mockReturnValueOnce(1)
        await signOut({ force: true })
        expect(ui.signoutAsk).toEqual({ everywhere: false, unsynced: true, timer: false })
        expect(fake.api.signOut).not.toHaveBeenCalled()
        expect(fake.store.wipe).not.toHaveBeenCalled()
    })
})
