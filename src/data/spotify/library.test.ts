// The loads and the session cache, through a fake Worker; the first two draw the legacy view
// through its shims, as the page still does until the Spotify UI is React's.
import { afterEach, describe, expect, it, vi } from "vitest"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

async function fresh(route: (path: string) => Response | Promise<Response>) {
    vi.resetModules()
    const asked: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (path: string) => { asked.push(path); return route(path) }))
    const library = await import("./library")
    const { ui } = await import("@/legacy/js/state.js")
    Object.assign(ui.spotify, { pane: "home", playlistId: null, albumId: null, artistId: null, q: "", filter: "" })
    return { library, ui, asked }
}

/* Drawing the Spotify view starts its loads; a load's redraw must not draw inside the
   draw and start the next load, or the two ping-pong until the stack overflows. */
describe("spotify view redraws", () => {
    it("keeps the retry deadline visible and cached tracks intact throughout a long cooldown", async () => {
        vi.resetModules()
        vi.useFakeTimers()
        const fetcher = vi.fn(async (path: string) => path.includes("/playlists/pl1/tracks")
            ? json({ items: [], total: 0, next: null })
            : json({ error: "rate_limited", retryAfter: 41233 }, 429, { "retry-after": "41233" }))
        vi.stubGlobal("fetch", fetcher)
        const { api, spotifyRetryAt } = await import("@/legacy/js/api.js")
        const { state: player } = await import("@/legacy/js/spotify.js")
        const view = await import("@/legacy/js/views/spotify-view.js")
        Object.assign(player, { loaded: true, connected: true })

        view.openPlaylist("pl1", "Study mix")
        await api.spotifyPlaylistTracks("pl1") // share the view's in-flight load
        const blocked = api.spotifyQueue().catch((error: unknown) => error)
        await vi.advanceTimersByTimeAsync(1500)
        expect(((await blocked) as { status: number }).status).toBe(429)
        const deadline = spotifyRetryAt()
        expect(deadline).toBeGreaterThan(Date.now())
        view.refresh("list")
        expect(view.renderSpotifyView()).toContain("Nothing in here yet.")

        view.openPlaylist("missing", "Unavailable mix")
        await vi.advanceTimersByTimeAsync(6001) // the ordinary error toast has expired
        const html = view.renderSpotifyView()
        expect(html).toContain("Try again after")
        expect(html).toContain("Waiting for the Spotify request limit to reset.")
        expect(html).not.toContain("Asking Spotify")
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(spotifyRetryAt()).toBe(deadline)
        vi.setSystemTime(deadline + 1)
        expect(spotifyRetryAt()).toBe(0)
    })

    it("draws the home pane without recursing, asking for each list once", async () => {
        const asked: string[] = []
        vi.stubGlobal("fetch", async (path: string) => {
            asked.push(path)
            const body = path.includes("/me") && !path.includes("/me/") ? { id: "u", name: "U" } : { items: [], total: 0, next: null }
            return json(body)
        })
        vi.resetModules()
        const { state: player } = await import("@/legacy/js/spotify.js")
        const view = await import("@/legacy/js/views/spotify-view.js")
        const { ui } = await import("@/legacy/js/state.js")
        ui.spotify.pane = "home"
        Object.assign(player, { loaded: true, connected: true })

        let draws = 0
        view.onChange(() => { draws++; view.renderSpotifyView() })
        expect(() => view.renderSpotifyView()).not.toThrow()
        await vi.waitFor(() => expect(asked.filter((p) => p.includes("/me")).length).toBe(1), { timeout: 8000 })
        await new Promise((r) => setTimeout(r, 200))

        const count = (part: string) => asked.filter((p) => p.startsWith(part)).length
        expect(count("/api/spotify/playlists")).toBe(1)
        expect(count("/api/spotify/recent")).toBe(1)
        expect(draws).toBeLessThan(20)
    }, 15000)
})

describe("the library", () => {
    it("asks for recently played once, and stops asking when it needs a reconnect", async () => {
        const { library, asked } = await fresh(() => json({ error: "reconnect_needed" }, 403))
        library.ensureRecent()
        await vi.waitFor(() => expect(library.busy.has("recent")).toBe(false))
        expect(library.cache.recentBlocked).toBe(true)
        expect(library.note).toBeNull()                 /* the tab says so itself, no note */
        library.ensureRecent()
        expect(asked).toEqual(["/api/spotify/recent"])
    })

    it("notes a failed load for 6 s and does not ask again before its retry time", async () => {
        vi.useFakeTimers()
        const { library, asked } = await fresh(() => json({ error: "spotify_unavailable" }, 502))
        const redraws = vi.fn()
        library.onChange(redraws)
        library.ensurePlaylists()
        expect(library.busy.has("playlists")).toBe(true)
        await vi.advanceTimersByTimeAsync(0)
        expect(library.note).toEqual({ text: "Spotify is not answering right now.", ok: false })
        expect(redraws).toHaveBeenCalled()
        library.ensurePlaylists()
        expect(asked).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(6000)
        expect(library.note).toBeNull()
        await vi.advanceTimersByTimeAsync(24_000)
        library.ensurePlaylists()
        await vi.advanceTimersByTimeAsync(1500)
        expect(asked).toHaveLength(2)
    })

    it("opens a playlist, an album with its art, and an artist, clearing the filter when the list changes", async () => {
        const { library, ui } = await fresh((path) => path.startsWith("/api/spotify/albums/")
            ? json({ items: [{ uri: "spotify:track:t1", title: "Weightless", artists: "MU", album: "", art: null, durationMs: 1 }], total: 1, next: false, nextOffset: null })
            : path.startsWith("/api/spotify/artists/")
                ? json({ items: [{ uri: "spotify:album:al1", id: "al1", name: "Weightless", artists: "MU", art: "al.jpg", count: 6 }], total: 1, next: false, nextOffset: null })
                : json({ items: [], total: 0, next: false, nextOffset: null }))
        library.setFilter("clair")
        library.openPlaylist("pl1", "Study mix")
        expect(ui.spotify).toMatchObject({ pane: "playlist", playlistId: "pl1", filter: "" })
        expect(library.cache.names.pl1).toBe("Study mix")
        await vi.waitFor(() => expect(library.cache.tracks.pl1).toBeDefined())
        library.openArtist("ar1")
        await vi.waitFor(() => expect(library.cache.artistAlbums.ar1).toBeDefined(), { timeout: 5000 })
        library.openAlbum("al1")
        await vi.waitFor(() => expect(library.cache.tracks["album:al1"]).toBeDefined(), { timeout: 5000 })
        expect(library.cache.tracks["album:al1"].items[0]).toMatchObject({ art: "al.jpg", album: "Weightless" })
        expect(library.listKey()).toBe("album:al1")
    })

    it("searches as the user types, after a pause and from two characters", async () => {
        vi.useFakeTimers()
        const empty = { tracks: [], artists: [], albums: [{ uri: "spotify:album:al1", id: "al1", name: "W", artists: "", art: null, count: 1 }], playlists: [], more: { tracks: false, artists: false, albums: false, playlists: false }, nextOffsets: { tracks: null, artists: null, albums: null, playlists: null } }
        const { library, ui, asked } = await fresh(() => json(empty))
        library.typed("w")
        await vi.advanceTimersByTimeAsync(1000)
        expect(asked).toEqual([])
        library.typed("we")
        library.typed("weightless")
        await vi.advanceTimersByTimeAsync(449)
        expect(asked).toEqual([])
        await vi.advanceTimersByTimeAsync(1)
        expect(asked).toEqual(["/api/spotify/search?q=weightless"])
        expect(ui.spotify).toMatchObject({ pane: "search", q: "weightless" })
        expect(library.cache.results?.q).toBe("weightless")
        expect(library.cache.albums.al1.name).toBe("W")
        library.search("weightless")                     /* the same search again comes from the cache */
        expect(asked).toHaveLength(1)
    })

    it("keeps what it has on a refresh while Spotify has asked us to wait", async () => {
        vi.useFakeTimers()
        const { library, asked } = await fresh((path) => path.startsWith("/api/spotify/queue")
            ? json({ error: "rate_limited" }, 429, { "retry-after": "60" })
            : json({ items: [{ id: "pl1", name: "Study mix" }], total: 1, next: false, nextOffset: null }))
        library.ensurePlaylists()
        await vi.advanceTimersByTimeAsync(0)
        library.openQueue()
        await vi.advanceTimersByTimeAsync(1500)
        expect(library.note?.text).toContain("Spotify requests are paused. Try again after ")
        library.refresh("playlists")
        expect(library.cache.playlists?.items).toHaveLength(1)
        expect(asked).toHaveLength(2)
    })

    it("reloads the open queue when the track moves on", async () => {
        const { library, asked } = await fresh(() => json({ current: null, queue: [] }))
        library.openQueue()
        await vi.waitFor(() => expect(library.cache.queue).not.toBeNull())
        library.followTrack("spotify:track:t1")          /* the first report is not a change */
        library.followTrack("spotify:track:t1")
        expect(asked).toHaveLength(1)
        library.followTrack("spotify:track:t2")
        await vi.waitFor(() => expect(asked).toHaveLength(2), { timeout: 5000 })
    })
})
