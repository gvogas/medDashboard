import { afterEach, describe, expect, it, vi } from "vitest"

/* run.ts is the real engine; the store keeps its run in memory, and the API is mocked. */
const fake = vi.hoisted(() => ({
    meta: new Map<string, unknown>(),
    presence: { set: vi.fn(async (_p: Record<string, unknown>) => null), clear: vi.fn(async () => null) },
    showStudying: true,
}))
vi.mock("@/core/store", () => ({
    data: { study_sessions: [], profile: { id: "me" } },
    subscribe: () => () => {},
    meta: {
        get: async (key: string) => structuredClone(fake.meta.get(key) ?? null),
        set: async (key: string, value: unknown) => { fake.meta.set(key, structuredClone(value)) },
    },
    saveStudySession: async () => {},
}))
vi.mock("@/core/api", async (orig) => ({ ...(await orig<typeof import("@/core/api")>()), api: { presence: fake.presence } }))
vi.mock("./friends", () => ({ friendsNow: () => ({ list: { settings: { findable: true, showStudying: fake.showStudying } } }) }))
vi.mock("./maintenance", () => ({ maintenanceState: () => null }))

import * as run from "./run"
import { watchPresence } from "./presence"

watchPresence((c) => (c === "bio" ? "BIO" : ""))
const FLOW = { steps: [["study", 25], ["break", 5]] as ["study" | "break", number][], rounds: 1 }

afterEach(async () => { await run.stop(); fake.presence.set.mockClear(); fake.presence.clear.mockClear(); fake.showStudying = true })

describe("presence", () => {
    it("shows a solo run to friends, again on resume, and takes it back when it stops", async () => {
        await run.begin(FLOW, "bio", null)
        expect(fake.presence.set).toHaveBeenCalledTimes(1)
        expect(fake.presence.set.mock.calls[0][0]).toMatchObject({ courseLabel: "BIO" })
        await run.togglePause()
        await run.togglePause()
        expect(fake.presence.set).toHaveBeenCalledTimes(2)
        await run.stop()
        expect(fake.presence.clear).toHaveBeenCalledTimes(1)
    })

    it("sends nothing while you hide that you are studying", async () => {
        fake.showStudying = false
        await run.begin(FLOW, "bio", null)
        await run.stop()
        expect(fake.presence.set).not.toHaveBeenCalled()
        expect(fake.presence.clear).not.toHaveBeenCalled()
    })
})
