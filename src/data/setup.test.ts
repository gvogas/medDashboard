import { beforeEach, describe, expect, it, vi } from "vitest"

const saved: unknown[] = []
vi.mock("@/core/store", () => ({ data: { profile: null, courses: [], items: [], spaces: [] }, subscribe: () => () => {} }))
vi.mock("@/core/sync", () => ({ status: { lastPull: null } }))
vi.mock("./study-controller", () => ({ savePrefs: async (p: unknown) => { saved.push(p) } }))

import { finishSetup, isFresh, needsSetup, reopenSetup, resetSetup } from "./setup"

const profile = (studyPrefs: Record<string, unknown> = {}) => ({ id: "u1", studyPrefs }) as never
const holdings = (over: Record<string, unknown> = {}) => ({ profile: profile(), courses: [], items: [], spaces: [], ...over }) as never

beforeEach(() => { resetSetup(); saved.length = 0 })

describe("the first-run setup", () => {
    it("is offered to an account with nothing in it", () => {
        expect(isFresh(holdings())).toBe(true)
        expect(needsSetup(holdings(), true)).toBe(true)
    })

    it("waits for the first pull: a new device's copy is empty until then", () => {
        expect(needsSetup(holdings())).toBe(false)
        expect(needsSetup(holdings(), false)).toBe(false)
    })

    it("is not offered with a course, an item or a class, signed out, or once done on any device", () => {
        expect(needsSetup(holdings({ courses: [{}] }), true)).toBe(false)
        expect(needsSetup(holdings({ items: [{}] }), true)).toBe(false)
        expect(needsSetup(holdings({ spaces: [{}] }), true)).toBe(false)
        expect(needsSetup(holdings({ profile: null }), true)).toBe(false)
        expect(needsSetup(holdings({ profile: profile({ setupDone: true }) }), true)).toBe(false)
    })

    it("stays up once offered, even after the first courses arrive, until finished", async () => {
        expect(needsSetup(holdings(), true)).toBe(true)
        expect(needsSetup(holdings({ courses: [{}] }), true)).toBe(true)
        await finishSetup()
        expect(needsSetup(holdings(), true)).toBe(false)
        expect(saved).toEqual([{ setupDone: true }])
    })

    it("can be opened again from Settings, and saved for every device", async () => {
        expect(needsSetup(holdings({ profile: profile({ setupDone: true }) }), true)).toBe(false)
        await reopenSetup()
        expect(needsSetup(holdings({ profile: profile({ setupDone: true }) }), true)).toBe(true)
        expect(saved).toEqual([{ setupDone: false }])
    })
})
