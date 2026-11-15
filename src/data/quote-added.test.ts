import "fake-indexeddb/auto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// A quote just added is the one the tile shows. The store hands quotes back in id order
// and ids are random, so the new one is not always last: the tile must find it by id.
// On the real store (core/store.ts on fake-indexeddb).
vi.mock("@/core/api", () => ({ api: {}, ApiError: class extends Error {}, retryDelayMs: () => 30000, bindAccount: () => {}, resetRequests: () => {}, signedIn: () => true, spotifyRetryAt: () => 0 }))

import * as store from "@/core/store"
import { addQuote } from "@/data/actions"
import { quoteAt } from "@/data/views"
import { ui } from "@/data/ui"

const profile = { id: "u-quote-" + Math.random().toString(36).slice(2, 8), username: "quote", revision: 1, coat: {} }
beforeAll(async () => { await store.open(profile) })
afterAll(async () => { await store.close() })

describe("a quote added", () => {
    it("is shown on the tile at once, wherever its id sorts among the others", async () => {
        await store.saveQuote({ id: "zzzzzz1", text: "First", source: "" })
        await store.saveQuote({ id: "zzzzzz2", text: "Second", source: "" })
        const rand = vi.spyOn(Math, "random").mockReturnValue(0.1)   /* an id that sorts before both */
        expect(await addQuote("Brand new", "me")).toBe(true)
        rand.mockRestore()
        expect(store.data.quotes.map((q) => q.text)).toContain("Brand new")
        expect(quoteAt(store.data.quotes, ui.quoteIx)!.quote.text).toBe("Brand new")
    })

    it("and when its id sorts last", async () => {
        const rand = vi.spyOn(Math, "random").mockReturnValue(0.999)
        expect(await addQuote("Last one", "")).toBe(true)
        rand.mockRestore()
        expect(quoteAt(store.data.quotes, ui.quoteIx)!.quote.text).toBe("Last one")
    })
})
