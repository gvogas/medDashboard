import { describe, expect, it, vi } from "vitest"

// The page's wiring: a session that ends on the server (a 401 from sync or Spotify) shows
// the sign-in and forgets the AI answers kept on this device, as every other sign-out does.
// Every controller is a fake.
const fake = vi.hoisted(() => ({
    sync: {} as { signedOut?: () => void },
    spotify: {} as { signedOut?: () => void },
    forgetReads: vi.fn(),
    showSignIn: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: {}, subscribe: vi.fn() }))
vi.mock("@/core/sync", () => ({ setOnPulled: vi.fn(), onUnauthenticated: (fn: () => void) => { fake.sync.signedOut = fn } }))
vi.mock("@/core/model", () => ({ useTypePrefs: vi.fn() }))
vi.mock("@/bridge", () => ({ notify: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn(), sideOpen: () => false, watchSidebar: vi.fn() }))
vi.mock("@/data/item-edit", () => ({ flush: vi.fn() }))
vi.mock("@/data/spotify/player", () => ({ onState: vi.fn(), onUnauthenticated: (fn: () => void) => { fake.spotify.signedOut = fn } }))
vi.mock("@/data/spotify/web-player", () => ({ onChange: vi.fn(), start: vi.fn(), stop: vi.fn() }))
vi.mock("@/data/theme", () => ({ followSystem: vi.fn() }))
vi.mock("@/data/sync-status", () => ({ refreshAfterSync: vi.fn(), runHeldRefresh: vi.fn(), pointerPressed: vi.fn(), pointerReleased: vi.fn(), runReviews: vi.fn() }))
vi.mock("@/data/session", () => ({ boot: vi.fn(), showSignIn: fake.showSignIn, onStoreEvent: vi.fn(), onStorage: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ commitUndo: vi.fn(), finishDelete: vi.fn() }))
vi.mock("@/data/keyboard", () => ({ onKeydown: vi.fn() }))
vi.mock("@/data/ai-cache", () => ({ forgetReads: fake.forgetReads }))
vi.mock("@/data/store", () => ({}))
vi.mock("@/data/sync", () => ({}))

import { boot } from "./boot"

describe("a session that ends on the server", () => {
    boot()

    for (const from of ["sync", "spotify"] as const) {
        it(`(${from}) shows the sign-in and forgets the AI answers kept here`, () => {
            fake.forgetReads.mockClear()
            fake.showSignIn.mockClear()
            fake[from].signedOut!()
            expect(fake.forgetReads).toHaveBeenCalledTimes(1)
            expect(fake.showSignIn).toHaveBeenCalledWith("Your session has ended. Sign in again.")
        })
    }
})
