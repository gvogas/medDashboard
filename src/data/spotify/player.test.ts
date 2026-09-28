// The poller and the controls against a fake Worker: when it asks, what it does with a
// 401, a 409 and a 429, and how a command finds the Rounds device.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Route = (path: string, init?: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers })

const PLAYING = { connected: true, playing: true, track: { uri: "spotify:track:t1", title: "Weightless", artists: "Marconi Union", album: "", art: null, url: null, durationMs: 489000, progressMs: 1000 }, device: "Phone", deviceId: "phone1", volume: 50, supportsVolume: true, shuffle: false, repeat: "off" }
const QUIET = { ...PLAYING, playing: false }

let player: typeof import("./player") | undefined

function setVisible(visible: boolean) {
    Object.defineProperty(document, "visibilityState", { value: visible ? "visible" : "hidden", configurable: true })
}
function setOnline(online: boolean) {
    Object.defineProperty(navigator, "onLine", { value: online, configurable: true })
}

async function fresh(route: Route) {
    vi.resetModules()
    const fetcher = vi.fn(async (path: string, init?: RequestInit) => route(path, init))
    vi.stubGlobal("fetch", fetcher)
    player = await import("./player")
    const web = await import("./web-player")
    const paths = () => fetcher.mock.calls.map(([p]) => p)
    return { player, web, fetcher, paths }
}

beforeEach(() => { setVisible(true); setOnline(true) })
afterEach(() => {
    player?.stop()
    player = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe("Spotify connection on startup", () => {
    it.each([true, false])("keeps saved connection=%s accurate while playback is throttled", async (connected) => {
        const { player, paths } = await fresh((path) => path === "/api/spotify/status"
            ? json({ connected })
            : json({ error: "rate_limited", retryAfter: 3600 }, 429))
        player.start()
        await vi.waitFor(() => {
            expect(player.state.loaded).toBe(true)
            expect(player.state.connected).toBe(connected)
            if (connected) expect(player.state.stale).toBe(true)
        })
        expect(paths()).toEqual(connected ? ["/api/spotify/status", "/api/spotify/player"] : ["/api/spotify/status"])
    })
})

describe("the poller", () => {
    it("asks every 10 s while playing and every 20 s when quiet", async () => {
        vi.useFakeTimers()
        let answer: object = PLAYING
        const { player, paths } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true }) : json(answer))
        player.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(paths()).toEqual(["/api/spotify/status", "/api/spotify/player"])
        expect(player.state).toMatchObject({ loaded: true, playing: true, device: "Phone", volume: 50 })
        answer = QUIET
        await vi.advanceTimersByTimeAsync(9999)
        expect(paths()).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(paths()).toHaveLength(3)
        expect(player.state.playing).toBe(false)
        await vi.advanceTimersByTimeAsync(19999)
        expect(paths()).toHaveLength(3)
        await vi.advanceTimersByTimeAsync(1)
        expect(paths()).toHaveLength(4)
    })

    it("moves the progress line between polls, up to the track's end", async () => {
        vi.useFakeTimers()
        const { player } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true }) : json(PLAYING))
        const kinds: string[] = []
        player.onState((_, kind) => kinds.push(kind))
        player.start()
        await vi.advanceTimersByTimeAsync(3000)
        expect(player.state.track?.progressMs).toBe(4000)
        expect(kinds.filter((k) => k === "tick")).toHaveLength(3)
    })

    it("stops asking once not connected", async () => {
        vi.useFakeTimers()
        const { player, paths } = await fresh(() => json({ connected: false }))
        player.start()
        await vi.advanceTimersByTimeAsync(120_000)
        expect(paths()).toEqual(["/api/spotify/status"])
        expect(player.state).toMatchObject({ loaded: true, connected: false })
    })

    it("asks only while the tab is visible, and again as soon as it is", async () => {
        vi.useFakeTimers()
        setVisible(false)
        const { player, paths } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true }) : json(QUIET))
        player.start()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(paths()).toEqual([])
        setVisible(true)
        document.dispatchEvent(new Event("visibilitychange"))
        await vi.advanceTimersByTimeAsync(0)
        expect(paths()).toEqual(["/api/spotify/status", "/api/spotify/player"])
        /* hidden again: the timer fires but does not ask */
        setVisible(false)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(paths()).toHaveLength(2)
    })

    it("asks only while online, and again when the connection is back", async () => {
        vi.useFakeTimers()
        setOnline(false)
        const { player, paths } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true }) : json(QUIET))
        player.start()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(paths()).toEqual([])
        setOnline(true)
        window.dispatchEvent(new Event("online"))
        await vi.advanceTimersByTimeAsync(0)
        expect(paths()).toEqual(["/api/spotify/status", "/api/spotify/player"])
    })

    it("marks the state stale after a failure and waits out a 429's Retry-After", async () => {
        vi.useFakeTimers()
        let limited = true
        const { player, paths } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true })
            : limited ? json({ error: "rate_limited" }, 429, { "retry-after": "120" }) : json(QUIET))
        player.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(player.state).toMatchObject({ connected: true, stale: true })
        limited = false
        await vi.advanceTimersByTimeAsync(119_000)
        expect(paths()).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(2_000)
        expect(paths()).toHaveLength(3)
        expect(player.state.stale).toBe(false)
    })

    it("signs out on a 401 and stops", async () => {
        vi.useFakeTimers()
        const { player, paths } = await fresh((path) => path === "/api/spotify/status" ? json({ connected: true }) : json({ error: "unauthenticated" }, 401))
        const signedOut = vi.fn()
        player.onUnauthenticated(signedOut)
        player.start()
        await vi.advanceTimersByTimeAsync(0)
        expect(signedOut).toHaveBeenCalledOnce()
        expect(player.state).toMatchObject({ loaded: false, connected: false })
        await vi.advanceTimersByTimeAsync(120_000)
        expect(paths()).toHaveLength(2)
    })

    it("drops an answer that arrives after stop()", async () => {
        let answer!: (r: Response) => void
        const { player } = await fresh(() => new Promise<Response>((r) => { answer = r }))
        const seen = vi.fn()
        player.onState(seen)
        player.start()
        await vi.waitFor(() => expect(answer).toBeTypeOf("function"))
        player.stop()
        answer(json({ connected: true }))
        await new Promise((r) => setTimeout(r, 20))
        expect(seen).not.toHaveBeenCalled()
        expect(player.state.loaded).toBe(false)
    })
})

describe("the controls", () => {
    async function connectedPlayer(route: Route) {
        vi.useFakeTimers()
        const got = await fresh((path, init) => path === "/api/spotify/status" ? json({ connected: true })
            : path === "/api/spotify/player" ? json(QUIET) : route(path, init))
        got.player.start()
        await vi.advanceTimersByTimeAsync(0)
        got.fetcher.mockClear()
        return got
    }

    it("answers play at once, then sends it and polls soon after", async () => {
        const { player, paths } = await connectedPlayer(() => json(null, 204))
        const p = player.control("play")
        expect(player.state.playing).toBe(true)
        await vi.advanceTimersByTimeAsync(1500)
        await p
        expect(paths()[0]).toBe("/api/spotify/player/play")
        await vi.advanceTimersByTimeAsync(2000)
        expect(paths()).toContain("/api/spotify/player")
    })

    it("sends a command to the Rounds device when Spotify has none active", async () => {
        const { player, web, paths } = await connectedPlayer((path) => path.includes("deviceId=") ? json(null, 204) : json({ error: "no_device" }, 404))
        Object.assign(web.state, { status: "ready", deviceId: "roundsdev" })
        const p = player.control("next")
        await vi.advanceTimersByTimeAsync(5000)
        await p
        expect(paths().slice(0, 2)).toEqual(["/api/spotify/player/next", "/api/spotify/player/next?deviceId=roundsdev"])
        expect(player.state.error).toBeNull()
    })

    it("shows why for a few seconds when there is nothing to resume", async () => {
        const { player, web } = await connectedPlayer(() => json({ error: "no_device" }, 404))
        Object.assign(web.state, { status: "ready", deviceId: "roundsdev" })
        const p = player.control("play")
        await vi.advanceTimersByTimeAsync(3500)
        await p
        expect(player.state.error).toBe("nothing_to_resume")
        await vi.advanceTimersByTimeAsync(4000)
        expect(player.state.error).toBeNull()
    })

    it("says no device without the Rounds device, and offline without an answer", async () => {
        let offline = false
        const { player } = await connectedPlayer(() => offline ? Promise.reject(new TypeError("Failed to fetch")) : json({ error: "no_device" }, 404))
        const p = player.control("next")
        await vi.advanceTimersByTimeAsync(1500)
        await p
        expect(player.state.error).toBe("no_device")
        offline = true
        const q = player.control("next")
        await vi.advanceTimersByTimeAsync(1500)
        await q
        expect(player.state.error).toBe("offline")
    })

    it("forgets the connection on a 409 and signs out on a 401", async () => {
        let status = 409
        const { player } = await connectedPlayer(() => json({ error: "x" }, status))
        const signedOut = vi.fn()
        player.onUnauthenticated(signedOut)
        let p = player.control("next")
        await vi.advanceTimersByTimeAsync(1500)
        await p
        expect(player.state).toMatchObject({ loaded: true, connected: false })
        status = 401
        p = player.control("next")
        await vi.advanceTimersByTimeAsync(1500)
        await p
        expect(signedOut).toHaveBeenCalledOnce()
        expect(player.state.loaded).toBe(false)
    })

    it("restarts the track once it is a few seconds in, else goes back", async () => {
        const { player, paths } = await connectedPlayer(() => json(null, 204))
        player.state.track = { ...PLAYING.track, progressMs: 3001 }
        let p = player.previous()
        await vi.advanceTimersByTimeAsync(1500)
        await p
        player.state.track = { ...PLAYING.track, progressMs: 3000 }
        p = player.previous()
        await vi.advanceTimersByTimeAsync(1500)
        await p
        expect(paths().filter((x) => x.startsWith("/api/spotify/player/"))).toEqual(["/api/spotify/player/restart", "/api/spotify/player/previous"])
    })

    it("moves the music into this tab only once the Rounds device is ready", async () => {
        const { player, web, fetcher } = await connectedPlayer(() => json(null, 204))
        await player.playHere()
        expect(fetcher).not.toHaveBeenCalled()
        Object.assign(web.state, { status: "ready", deviceId: "roundsdev" })
        const p = player.playHere()
        await vi.advanceTimersByTimeAsync(1500)
        await p
        const [path, init] = fetcher.mock.calls[0]
        expect(path).toBe("/api/spotify/transfer")
        expect(JSON.parse(String(init?.body))).toEqual({ deviceId: "roundsdev", play: true })
    })
})
