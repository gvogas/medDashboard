import { beforeEach, describe, expect, it, vi } from "vitest"

const saved: unknown[] = []
vi.mock("@/core/store", () => ({ data: { profile: null, courses: [], items: [], spaces: [] }, subscribe: () => () => {} }))
vi.mock("./study-controller", () => ({ savePrefs: async (p: unknown) => { saved.push(p) } }))

import { finishSetup, isFresh, needsSetup, resetSetup } from "./setup"

const profile = (studyPrefs: Record<string, unknown> = {}) => ({ id: "u1", studyPrefs }) as never
const holdings = (over: Record<string, unknown> = {}) => ({ profile: profile(), courses: [], items: [], spaces: [], ...over }) as never

beforeEach(() => { resetSetup(); saved.length = 0 })

describe("the first-run setup", () => {
    it("is offered to an account with nothing in it", () => {
        expect(isFresh(holdings())).toBe(true)
        expect(needsSetup(holdings())).toBe(true)
    })

    it("is not offered with a course, an item or a class, signed out, or once done on any device", () => {
        expect(needsSetup(holdings({ courses: [{}] }))).toBe(false)
        expect(needsSetup(holdings({ items: [{}] }))).toBe(false)
        expect(needsSetup(holdings({ spaces: [{}] }))).toBe(false)
        expect(needsSetup(holdings({ profile: null }))).toBe(false)
        expect(needsSetup(holdings({ profile: profile({ setupDone: true }) }))).toBe(false)
    })

    it("stays up once offered, even after the first courses arrive, until finished", async () => {
        expect(needsSetup(holdings())).toBe(true)
        expect(needsSetup(holdings({ courses: [{}] }))).toBe(true)
        await finishSetup()
        expect(needsSetup(holdings())).toBe(false)
        expect(saved).toEqual([{ setupDone: true }])
    })
})
