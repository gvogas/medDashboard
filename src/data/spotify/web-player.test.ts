// The Rounds device: the SDK is loaded once, the device follows the SDK's events, and a
// phone browser (which Spotify does not support) never loads it.
import { afterEach, describe, expect, it, vi } from "vitest"

const SDK = "https://sdk.scdn.co/spotify-player.js"

type Handler = (e: { device_id: string }) => void
class FakePlayer {
    static made: FakePlayer[] = []
    handlers: Record<string, Handler> = {}
    connect = vi.fn()
    disconnect = vi.fn()
    activateElement = vi.fn()
    constructor(public options: { name: string; volume: number; getOAuthToken: (give: (t: string) => void) => void }) { FakePlayer.made.push(this) }
    addListener(event: string, fn: Handler) { this.handlers[event] = fn }
}

const win = window as unknown as { Spotify?: unknown; onSpotifyWebPlaybackSDKReady?: () => void }

async function fresh() {
    vi.resetModules()
    FakePlayer.made = []
    document.head.querySelectorAll("script").forEach((s) => s.remove())
    delete win.Spotify
    delete win.onSpotifyWebPlaybackSDKReady
    return import("./web-player")
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe("the Rounds device", () => {
    it("loads the SDK once and becomes a device when it is ready", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "short" }))))
        const web = await fresh()
        const seen = vi.fn()
        web.onChange(seen)
        web.start()
        web.start()
        expect(web.state.status).toBe("loading")
        expect(document.head.querySelectorAll(`script[src="${SDK}"]`)).toHaveLength(1)
        win.Spotify = { Player: FakePlayer }
        win.onSpotifyWebPlaybackSDKReady?.()
        expect(FakePlayer.made).toHaveLength(1)
        const p = FakePlayer.made[0]
        expect(p.options).toMatchObject({ name: "Rounds", volume: 0.8 })
        expect(p.connect).toHaveBeenCalledOnce()
        const token = await new Promise((give) => p.options.getOAuthToken(give))
        expect(token).toBe("short")
        p.handlers.ready({ device_id: "roundsdev" })
        expect(web.state).toEqual({ status: "ready", deviceId: "roundsdev" })
        expect(seen).toHaveBeenLastCalledWith(web.state)
        web.activate()
        expect(p.activateElement).toHaveBeenCalledOnce()
        p.handlers.not_ready({ device_id: "roundsdev" })
        expect(web.state).toEqual({ status: "loading", deviceId: null })
        web.stop()
        expect(p.disconnect).toHaveBeenCalledOnce()
        expect(web.state.status).toBe("off")
    })

    it.each([
        ["initialization_error", "unsupported"],
        ["authentication_error", "needs_reconnect"],
        ["account_error", "no_premium"],
    ])("reports %s as %s", async (event, status) => {
        const web = await fresh()
        win.Spotify = { Player: FakePlayer }
        web.start()
        FakePlayer.made[0].handlers[event]({ device_id: "" })
        expect(web.state.status).toBe(status)
    })

    it("gives up when the SDK will not load", async () => {
        const web = await fresh()
        web.start()
        const script = document.head.querySelector<HTMLScriptElement>(`script[src="${SDK}"]`)!
        script.onerror?.(new Event("error"))
        expect(web.state.status).toBe("unsupported")
        expect(document.head.querySelector(`script[src="${SDK}"]`)).toBeNull()
    })

    it("never loads in a phone browser", async () => {
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")
        const web = await fresh()
        web.start()
        expect(web.state.status).toBe("unsupported")
        expect(document.head.querySelector(`script[src="${SDK}"]`)).toBeNull()
    })
})
