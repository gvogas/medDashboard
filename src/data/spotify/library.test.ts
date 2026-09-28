// The loads and the session cache, through a fake Worker.
import { afterEach, describe, expect, it, vi } from "vitest"

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers })

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

async function fresh(route: (path: string) => Response | Promise<Response>) {
    vi.resetModules()
    const asked: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (path: string) => { asked.push(path); return route(path) }))
    const library = await import("./library")
    const { ui } = await import("@/data/ui")
    Object.assign(ui.spotify, { pane: "home", playlistId: null, albumId: null, artistId: null, q: "", filter: "" })
    return { library, ui, asked }
}

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
        ;(await import("./signal")).subscribe(redraws)
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
