import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { webcrypto } from "node:crypto"
import { cacheKey, cached, forgetReads, keepReadsFor, remember } from "./ai-cache"

beforeAll(() => { if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto) })
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); keepReadsFor("") })

const DAY = 86_400_000

describe("answers remembered on this device", () => {
    it("are found by the file and the words of the read", async () => {
        const a = await cacheKey(["outline", "u1"], new Blob(["text"]))
        expect(a).toMatch(/^[0-9a-f]{64}$/)
        expect(await cacheKey(["outline", "u1"], new Blob(["text"]))).toBe(a)
        expect(await cacheKey(["outline", "u2"], new Blob(["text"]))).not.toBe(a)
        expect(await cacheKey(["timetable", "u1"], new Blob(["text"]))).not.toBe(a)
        expect(await cacheKey(["outline", "u1"], new Blob(["text!"]))).not.toBe(a)
    })

    it("are kept 30 days, the newest 12", () => {
        remember("k0", { a: 1 }, 1000)
        expect(cached("k0", 2000)).toEqual({ a: 1 })
        expect(cached("k0", 1000 + 31 * DAY)).toBeNull()
        for (let i = 1; i <= 12; i++) remember("k" + i, i, 2000 + i)
        expect(cached("k0", 3000)).toBeNull()
        expect(cached("k12", 3000)).toBe(12)
        expect(cached("k1", 3000)).toBe(1)
    })

    it("are forgotten on sign-out, and nothing breaks without storage", () => {
        remember("k", 1)
        forgetReads()
        expect(cached("k")).toBeNull()
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked") })
        expect(() => remember("k", 1)).not.toThrow()
        expect(cached("k")).toBeNull()
    })

    it("are marked with the account and dropped when another account's session starts", () => {
        keepReadsFor("u1")
        remember("k1", "mine")
        keepReadsFor("u2")
        expect(cached("k1")).toBeNull()
        remember("k2", "theirs")
        keepReadsFor("u2")
        expect(cached("k2")).toBe("theirs")
        expect((JSON.parse(localStorage.getItem("term.aiReads.v1")!) as { k: string; user: string }[]).map((e) => [e.k, e.user])).toEqual([["k2", "u2"]])
    })

    it("are kept under a versioned key, and an older store is dropped", () => {
        localStorage.setItem("term.aiReads", JSON.stringify([{ k: "k", at: Date.now(), answer: "old shape" }]))
        keepReadsFor("u1")
        expect(localStorage.getItem("term.aiReads")).toBeNull()
        expect(cached("k")).toBeNull()
        remember("k", "new")
        expect(localStorage.getItem("term.aiReads.v1")).toContain("new")
        forgetReads()
        expect(localStorage.getItem("term.aiReads.v1")).toBeNull()
    })
})
