// The commands against a fake Worker: what they send, what they answer before Spotify
// does, and what they say when Spotify refuses.
import { afterEach, describe, expect, it, vi } from "vitest"

type Call = { path: string; body: unknown }
const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

async function fresh(route: (path: string) => Response = () => json(null, 204)) {
    vi.useFakeTimers()
    vi.resetModules()
    const calls: Call[] = []
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
        return route(path)
    }))
    const commands = await import("./commands")
    const library = await import("./library")
    const { state: player } = await import("./player")
    const { state: web } = await import("./web-player")
    const { ui } = await import("@/data/ui")
    Object.assign(ui.spotify, { pane: "home", playlistId: null, albumId: null, artistId: null, q: "", filter: "" })
    Object.assign(player, { loaded: true, connected: true, device: "Phone", deviceId: "phone1", shuffle: false, repeat: "off", volume: 50, supportsVolume: true })
    /* let the gate's 1.5 s gap pass between calls */
    const settle = () => vi.advanceTimersByTimeAsync(1600)
    return { commands, library, player, web, ui, calls, settle }
}

describe("shuffle and repeat", () => {
    it("answer the click at once, then send it", async () => {
        const { commands, player, calls, settle } = await fresh()
        const sync = vi.fn()
        ;(await import("./signal")).subscribe(sync)
        const p = commands.toggleShuffle()
        expect(player.shuffle).toBe(true)
        expect(sync).toHaveBeenCalledOnce()
        await settle()
        await p
        expect(calls[0]).toEqual({ path: "/api/spotify/shuffle", body: { state: true } })
        const q = commands.cycleRepeat()
        expect(player.repeat).toBe("context")
        await settle()
        await q
        expect(calls[1]).toEqual({ path: "/api/spotify/repeat", body: { state: "context" } })
    })

    it("go back and say why when Spotify refuses", async () => {
        const { commands, library, player, settle } = await fresh(() => json({ error: "premium_required" }, 403))
        const sync = vi.fn()
        ;(await import("./signal")).subscribe(sync)
        const p = commands.cycleRepeat()
        await settle()
        await p
        expect(player.repeat).toBe("off")
        expect(sync).toHaveBeenCalledTimes(3)   /* the click, going back, and the note */
        expect(library.note).toEqual({ text: "That needs Spotify Premium.", ok: false })
        await vi.advanceTimersByTimeAsync(4000)
        expect(library.note).toBeNull()
    })
})

describe("play", () => {
    it("plays a track in a list Spotify has no context for from the loaded tracks onward", async () => {
        const { commands, library, calls } = await fresh()
        library.cache.tracks.liked = { items: ["a", "b", "c"].map((id) => ({ uri: "spotify:track:" + id })) as never, total: 3, next: false, nextOffset: null }
        const p = commands.play("spotify:track:b", null, "liked")
        await vi.advanceTimersByTimeAsync(0)   /* the first call does not wait */
        await p
        expect(calls[0]).toEqual({ path: "/api/spotify/play", body: { uri: "spotify:track:b", contextUri: null, uris: ["spotify:track:b", "spotify:track:c"] } })
        expect(library.note).toEqual({ text: "Playing.", ok: true })
        await vi.advanceTimersByTimeAsync(1500)
        expect(library.note).toBeNull()
    })

    it("plays a context as it is, and tries the Term device when nothing is active", async () => {
        const { commands, web, calls, settle } = await fresh((path) => calls.length === 1 ? json({ error: "no_device" }, 404) : json(null, 204))
        Object.assign(web, { status: "ready", deviceId: "roundsdev" })
        const p = commands.play(null, "spotify:album:al1")
        await settle()
        await settle()
        await p
        expect(calls.slice(0, 2).map((c) => c.body)).toEqual([
            { uri: null, contextUri: "spotify:album:al1" },
            { uri: null, contextUri: "spotify:album:al1", deviceId: "roundsdev" },
        ])
    })

    it("says what went wrong", async () => {
        const { commands, library, settle } = await fresh(() => json({ error: "no_device" }, 404))
        const p = commands.play("spotify:track:t1")
        await settle()
        await p
        expect(library.note?.text).toBe("Open Spotify somewhere, or use a desktop browser, then try again.")
    })
})

describe("the queue", () => {
    it("adds a track, ticks it for a moment, and forgets the stale queue", async () => {
        const { commands, library, calls } = await fresh()
        library.cache.queue = { current: null, queue: [] }
        const p = commands.queueAdd("spotify:track:t2")
        await vi.advanceTimersByTimeAsync(0)
        expect(await p).toBe(true)
        expect(calls[0]).toEqual({ path: "/api/spotify/queue", body: { uri: "spotify:track:t2" } })
        expect(commands.justQueued("spotify:track:t2")).toBe(true)
        expect(library.cache.queue).toBeNull()
        await vi.advanceTimersByTimeAsync(1500)
        expect(commands.justQueued("spotify:track:t2")).toBe(false)
    })

    it("reloads the queue when it is open", async () => {
        const { commands, ui, calls, settle } = await fresh((path) => path === "/api/spotify/queue" && calls.length > 1 ? json({ current: null, queue: [] }) : json(null, 204))
        ui.spotify.pane = "queue"
        const p = commands.queueAdd("spotify:track:t2")
        await vi.advanceTimersByTimeAsync(0)
        await p
        await settle()
        expect(calls.map((c) => c.path)).toEqual(["/api/spotify/queue", "/api/spotify/queue"])
    })

    it("says why it could not, and returns false", async () => {
        const { commands, library } = await fresh(() => json({ error: "not_allowed" }, 403))
        const p = commands.queueAdd("spotify:track:t2")
        await vi.advanceTimersByTimeAsync(0)
        expect(await p).toBe(false)
        expect(library.note?.text).toBe("Spotify would not do that right now.")
    })
})

describe("devices and volume", () => {
    it("opens the device list, and moves playback keeping it paused", async () => {
        const devices = [{ id: "roundsdev", name: "Term", type: "Computer", active: false, restricted: false }, { id: "phone1", name: "Phone", type: "Smartphone", active: true, restricted: false }]
        const { commands, library, web, player, calls, settle } = await fresh((path) => path === "/api/spotify/devices" ? json({ devices }) : json(null, 204))
        Object.assign(web, { status: "ready", deviceId: "roundsdev" })
        player.playing = false
        commands.toggleDevices()
        expect(commands.devicesOpen()).toBe(true)
        await settle()
        expect(library.cache.devices).toEqual(devices)
        await commands.pickDevice("phone1")                  /* already playing there: nothing to do */
        expect(commands.devicesOpen()).toBe(false)
        commands.toggleDevices()
        await settle()
        const p = commands.pickDevice("roundsdev")
        await settle()
        await p
        expect(calls.at(-1)).toEqual({ path: "/api/spotify/transfer", body: { deviceId: "roundsdev", play: false } })
        expect(library.note).toEqual({ text: "Moved to this tab.", ok: true })
        commands.toggleDevices()
        commands.toggleDevices()
        expect(commands.devicesOpen()).toBe(false)
    })

    it("sends only the last volume of a drag, and holds it against polls meanwhile", async () => {
        const { commands, player, calls, settle } = await fresh()
        commands.setVolume(40)
        commands.setVolume(30)
        expect(commands.volumeHeld()).toBe(true)
        expect(player.volume).toBe(30)
        player.volume = 50                                   /* a poll lands during the drag */
        expect(commands.shownVolume()).toBe(30)
        await vi.advanceTimersByTimeAsync(249)
        expect(calls).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(commands.volumeHeld()).toBe(false)
        await settle()
        expect(calls).toEqual([{ path: "/api/spotify/volume", body: { percent: 30 } }])
    })
})
