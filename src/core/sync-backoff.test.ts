import { describe, expect, it } from "vitest"
import { backoffMs } from "./sync"

describe("how long a failed sync waits", () => {
    it("starts at 30 s and doubles to 10 min", () => {
        const none = () => 0
        expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoffMs(n, 30_000, none))).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000, 600_000])
    })
    it("adds up to 20% at random, so devices back from an outage spread out", () => {
        expect(backoffMs(1, 30_000, () => 1)).toBe(36_000)
        expect(backoffMs(6, 30_000, () => 0.5)).toBe(660_000)
    })
    it("never waits less than a rate limit asked", () => {
        expect(backoffMs(1, 300_000, () => 0)).toBe(300_000)
    })
})
