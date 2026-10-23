// The engine's pure parts: when the poller asks again, where a click sends music, what a
// failure says, and how pages and rows are put together.
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/core/api"
import { nextDelayMs } from "./player"
import { playTarget } from "./web-player"
import { appendPage, canOpen, cooldownMessage, explain, findText, matchesFilter, playFrom, withAlbum } from "./library"
import { nextRepeat } from "./commands"
import type { Page, Playlist, Track } from "./types"

afterEach(() => { vi.useRealTimers() })

const track = (uri: string, over: Partial<Track> = {}): Track =>
    ({ uri, title: uri, artists: "Marconi Union", album: "", art: null, url: null, durationMs: 1000, progressMs: 0, ...over })

describe("the poller", () => {
    it("polls fast while playing, slowly when idle, and stops when not connected", () => {
        expect(nextDelayMs({ connected: true, playing: true })).toBe(10000)
        expect(nextDelayMs({ connected: true, playing: false })).toBe(20000)
        expect(nextDelayMs({ connected: false })).toBeNull()
    })

    it("polls less with the music out of sight, and just after a playing track ends", () => {
        expect(nextDelayMs({ connected: true, playing: false }, false)).toBe(60000)
        expect(nextDelayMs({ connected: true, playing: true, track: { progressMs: 0, durationMs: 240000 } }, false)).toBe(30000)
        expect(nextDelayMs({ connected: true, playing: true, track: { progressMs: 230000, durationMs: 240000 } }, false)).toBe(11500)
        expect(nextDelayMs({ connected: true, playing: true, track: { progressMs: 240000, durationMs: 240000 } }, false)).toBe(5000)
        expect(nextDelayMs({ connected: false }, false)).toBeNull()
    })
})

describe("playTarget", () => {
    const ready = { status: "ready" as const, deviceId: "roundsdev" }

    it("plays here when Term is ready and nothing else is active", () => {
        expect(playTarget({ deviceId: null }, ready)).toBe("here")
    })

    it("offers Play here when music is on another device", () => {
        expect(playTarget({ deviceId: "phone" }, ready)).toBe("offer")
    })

    it("does nothing when Term is already the device, or is not ready", () => {
        expect(playTarget({ deviceId: "roundsdev" }, ready)).toBe(null)
        for (const status of ["off", "loading", "unsupported", "needs_reconnect", "no_premium"] as const) {
            expect(playTarget({ deviceId: null }, { status, deviceId: null }), status).toBe(null)
        }
    })
})

describe("what a failure says", () => {
    const format = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })

    it("gives the cooldown's end in words", () => {
        const until = new Date(2026, 8, 28, 15, 40, 5).getTime()
        expect(cooldownMessage(until)).toBe("Spotify requests are paused. Try again after " + format(until) + ". You can keep listening in Spotify.")
    })

    it("turns a 429 into the cooldown, counting from its Retry-After", () => {
        vi.useFakeTimers({ toFake: ["Date"] })
        vi.setSystemTime(new Date(2026, 8, 28, 12))
        const now = Date.now()
        expect(explain(Object.assign(new ApiError(429, { error: "rate_limited" }), { retryAfter: 90 }))).toBe(cooldownMessage(now + 90_000))
        expect(explain(new ApiError(429, { error: "rate_limited", retryAfter: 41233 }))).toBe(cooldownMessage(now + 41_233_000))
        expect(explain(new ApiError(429, null))).toBe(cooldownMessage(now + 30_000))
    })

    it("says what Spotify refused, and blames Spotify for anything else", () => {
        expect(explain(new ApiError(404, { error: "no_device" }))).toBe("Open Spotify somewhere, or use a desktop browser, then try again.")
        expect(explain(new ApiError(403, { error: "premium_required" }))).toBe("That needs Spotify Premium.")
        expect(explain(new ApiError(403, { error: "reconnect_needed" }))).toBe("Spotify needs a fresh connection for this. Reconnect in Settings › Spotify.")
        expect(explain(new ApiError(403, { error: "playlist_forbidden" }))).toBe("Spotify only lets Term open playlists you made or collaborate on.")
        expect(explain(new ApiError(502, { error: "whatever" }))).toBe("Spotify is not answering right now.")
        expect(explain(new ApiError(500, null))).toBe("Spotify is not answering right now.")
    })

    it("calls anything that is not an answer from the Worker being offline", () => {
        expect(explain(new TypeError("Failed to fetch"))).toBe("You seem to be offline.")
    })
})

describe("pages and rows", () => {
    it("gives an album's tracks the album's art and name, keeping their own", () => {
        const page: Page<Track> = { items: [track("a"), track("b", { art: "own.jpg", album: "Own" })], total: 2, next: false, nextOffset: null }
        withAlbum(page, { art: "cover.jpg", name: "Weightless" })
        expect(page.items.map((t) => [t.art, t.album])).toEqual([["cover.jpg", "Weightless"], ["own.jpg", "Own"]])
        withAlbum(page, {})
        expect(withAlbum({ items: [track("c")], total: 1, next: false, nextOffset: null }, {}).items[0]).toMatchObject({ art: null, album: "" })
    })

    it("adds the next page to a list, taking its paging", () => {
        const list: Page<Track> = { items: [track("a")], total: 3, next: true, nextOffset: 1 }
        appendPage(list, { items: [track("b"), track("c")], total: 3, next: false, nextOffset: null })
        expect(list.items.map((t) => t.uri)).toEqual(["a", "b", "c"])
        expect(list).toMatchObject({ total: 3, next: false, nextOffset: null })
    })

    it("opens only playlists the account owns or collaborates on, and any before it is known", () => {
        const pl = (ownerId: string | null, collaborative = false): Playlist =>
            ({ uri: "spotify:playlist:p", id: "p", name: "P", owner: "", ownerId, collaborative, art: null, count: 1 })
        const me = { id: "george", name: "George" }
        expect(canOpen(pl("george"), me)).toBe(true)
        expect(canOpen(pl("sam", true), me)).toBe(true)
        expect(canOpen(pl("sam"), me)).toBe(false)
        expect(canOpen(pl("sam"), null)).toBe(true)
    })

    it("filters a list on title, artists and album, ignoring case and spaces around", () => {
        const t = track("t1", { title: "Weightless", artists: "Marconi Union", album: "Ambient" })
        expect(findText(t)).toBe("weightless marconi union ambient")
        expect(matchesFilter(t, "")).toBe(true)
        expect(matchesFilter(t, "  UNION ")).toBe(true)
        expect(matchesFilter(t, "ambient")).toBe(true)
        expect(matchesFilter(t, "clair")).toBe(false)
    })

    it("plays a list without a context from the track picked, at most 100", () => {
        const items = Array.from({ length: 150 }, (_, i) => track("t" + i))
        expect(playFrom(items, "t2")?.slice(0, 2)).toEqual(["t2", "t3"])
        expect(playFrom(items, "t2")).toHaveLength(100)
        expect(playFrom(items, null)?.[0]).toBe("t0")
        expect(playFrom(items, "missing")?.[0]).toBe("t0")
        expect(playFrom(items, "t149")).toEqual(["t149"])
        expect(playFrom([], "t1")).toBeNull()
    })

    it("cycles repeat off, the list, the track, off", () => {
        expect(nextRepeat("off")).toBe("context")
        expect(nextRepeat("context")).toBe("track")
        expect(nextRepeat("track")).toBe("off")
        expect(nextRepeat("nonsense")).toBe("off")
    })
})
