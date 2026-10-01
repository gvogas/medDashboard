// The Spotify page and the sidebar player, over the real engine and a fake Worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const api = vi.hoisted(() => ({}) as ReturnType<typeof import("./test-spotify").fakeApi>)
const gate = vi.hoisted(() => ({ until: 0 }))
vi.mock("@/core/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/api")>()),
    api,
    spotifyRetryAt: () => (gate.until > Date.now() ? gate.until : 0),
}))

import { ApiError } from "@/core/api"
import { cooldownMessage } from "@/data/spotify"
import { state as web } from "@/data/spotify/web-player"
import { SpotifyPage } from "./spotify-page"
import { SidebarPlayer } from "./sidebar-player"
import { album, artist, fakeApi, page, playlist, resetEngine, results, setPlayer, track } from "./test-spotify"
import { showApp } from "@/data/signin"

const WEIGHTLESS = track("t1", { title: "Weightless", progressMs: 191000, url: "https://open.spotify.com/track/t1" })

beforeEach(() => {
    Object.assign(api, fakeApi())
    api.spotifyPlaylists.mockResolvedValue(page([playlist("pl1", "Study mix"), playlist("pl2", "Deep Focus", { owner: "Spotify", ownerId: "spotify", count: null })], { total: 2 }))
    gate.until = 0
    resetEngine({ track: WEIGHTLESS, playing: true, device: "MacBook", deviceId: "mac", volume: 60, supportsVolume: true })
    document.body.innerHTML = '<div id="app"></div>'
    showApp()   /* the page's keys work only while the app shows */
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const show = () => render(<SpotifyPage />, { container: document.getElementById("app")! })
const card = (name: string) => within(screen.getByRole("region", { name }))

describe("the Spotify page", () => {
    it("checks the connection, then offers to connect", () => {
        resetEngine({ loaded: false, connected: false })
        show()
        expect(screen.getByText("Checking your connection…")).toBeTruthy()
        setPlayer({ loaded: true })
        expect(screen.getByText("Spotify is not connected")).toBeTruthy()
        expect(screen.getByRole("link", { name: "Connect Spotify" }).getAttribute("href")).toBe("/api/spotify/connect")
        expect(api.spotifyPlaylists).not.toHaveBeenCalled()
    })

    it("shows what plays and the library once connected", async () => {
        show()
        const player = card("Player")
        expect(player.getByRole("link", { name: "Weightless" }).getAttribute("href")).toBe("https://open.spotify.com/track/t1")
        expect(player.getByText("Marconi Union · Weightless")).toBeTruthy()
        expect(player.getByText("3:11")).toBeTruthy()
        expect(player.getByText("8:09")).toBeTruthy()
        expect(player.getByRole("button", { name: "Pause" })).toBeTruthy()
        expect(await card("Browse music").findByRole("button", { name: "Open Study mix" })).toBeTruthy()
        /* a playlist someone else made cannot be opened: its cover plays it */
        expect(card("Browse music").getByRole("button", { name: "Play Deep Focus" })).toBeTruthy()
        expect(card("Browse music").queryByRole("button", { name: "Open Deep Focus" })).toBeNull()
        expect(card("Browse music").getByText("2 playlists")).toBeTruthy()
        expect(api.spotifyPlaylists).toHaveBeenCalledTimes(1)
        expect(api.spotifyMe).toHaveBeenCalledTimes(1)
    })

    it("says when Spotify has asked us to wait, and draws again when the wait is over", async () => {
        gate.until = Date.now() + 400
        api.spotifyPlaylists.mockImplementation(() => new Promise(() => {}))   /* still out */
        show()
        expect(screen.getByRole("status").textContent).toBe(cooldownMessage(gate.until))
        expect(screen.getByText("Waiting for the Spotify request limit to reset.")).toBeTruthy()
        await waitFor(() => expect(screen.queryByText(/Spotify requests are paused/)).toBeNull(), { timeout: 2000 })
        expect(screen.getByText("Asking Spotify…")).toBeTruthy()
    })

    it("shows a failed load's note", async () => {
        api.spotifyPlaylists.mockRejectedValue(new ApiError(502, { error: "spotify_unavailable" }))
        show()
        expect(await screen.findByText("Spotify is not answering right now.")).toBeTruthy()
    })

    it("switches the left card between Up next and Recent", async () => {
        api.spotifyQueue.mockResolvedValue({ current: WEIGHTLESS, queue: [track("t2", { title: "Night Owl" }), track("t3", { title: "Experience" })] })
        api.spotifyRecent.mockResolvedValue({ items: [track("r1", { title: "Holocene" })] })
        show()
        const player = card("Player")
        expect(await player.findByText("Night Owl")).toBeTruthy()
        expect(player.getByText("2 next")).toBeTruthy()
        expect(player.getByText(/Spotify lets apps add to the queue and skip, but not remove or reorder/)).toBeTruthy()
        expect(player.getByRole("button", { name: "Up next" }).getAttribute("aria-pressed")).toBe("true")

        fireEvent.click(player.getByRole("button", { name: "Recent" }))
        expect(await player.findByText("Holocene")).toBeTruthy()
        expect(player.queryByText("Night Owl")).toBeNull()
        fireEvent.click(player.getByRole("button", { name: "Play Holocene" }))
        /* recently played has no context: it plays from the track picked on */
        await waitFor(() => expect(api.spotifyPlay).toHaveBeenCalledWith({ uri: "spotify:track:r1", contextUri: null, uris: ["spotify:track:r1"] }))
    })

    it("asks to reconnect when recently played needs a permission, and says when the queue is empty", async () => {
        api.spotifyRecent.mockRejectedValue(new ApiError(403, { error: "reconnect_needed" }))
        show()
        const player = card("Player")
        expect(await player.findByText("The queue is empty. Add to it with + on any track.")).toBeTruthy()
        fireEvent.click(player.getByRole("button", { name: "Recent" }))
        expect(await player.findByText("Reconnect to see what you played lately")).toBeTruthy()
        expect(player.getByRole("link", { name: "Reconnect Spotify" }).getAttribute("href")).toBe("/api/spotify/connect")
    })

    it("opens a playlist, filters it, plays it and goes back", async () => {
        const tracks = Array.from({ length: 9 }, (_, i) => track("s" + i, { title: "Song " + i }))
        tracks[3] = WEIGHTLESS
        api.spotifyPlaylistTracks.mockResolvedValue(page(tracks, { total: 30, next: true, nextOffset: 9 }))
        show()
        const music = card("Browse music")
        fireEvent.click(await music.findByRole("button", { name: "Open Study mix" }))
        expect(await music.findByText("Song 0")).toBeTruthy()
        expect(api.spotifyPlaylistTracks).toHaveBeenCalledWith("pl1", 0)
        expect(music.getByRole("heading", { name: "Study mix" })).toBeTruthy()
        expect(music.getByText("30 tracks")).toBeTruthy()
        /* the track playing shows the equaliser in place of its length */
        expect(music.getAllByRole("img", { name: "Playing" })).toHaveLength(1)

        fireEvent.change(music.getByRole("searchbox", { name: "Filter tracks" }), { target: { value: "song 1" } })
        expect(music.getByText("1 of 9 loaded")).toBeTruthy()
        expect(music.getByText("Song 2").closest("[hidden]")).toBeTruthy()

        fireEvent.click(music.getByRole("button", { name: "▶ Play all" }))
        await waitFor(() => expect(api.spotifyPlay).toHaveBeenCalledWith({ uri: null, contextUri: "spotify:playlist:pl1" }))
        fireEvent.click(music.getByRole("button", { name: "Show more · 21 left" }))
        await waitFor(() => expect(api.spotifyPlaylistTracks).toHaveBeenLastCalledWith("pl1", 9))

        fireEvent.click(music.getByRole("button", { name: "‹ Back" }))
        expect(music.getByRole("button", { name: "Open Study mix" })).toBeTruthy()
        expect(music.queryByText("Song 0")).toBeNull()
    })

    it("plays Liked Songs from the track picked, as it has no context", async () => {
        api.spotifyPlaylistTracks.mockResolvedValue(page([track("l1"), track("l2"), track("l3")]))
        show()
        const music = card("Browse music")
        fireEvent.click(await music.findByRole("button", { name: "Open Liked Songs" }))
        fireEvent.click(await music.findByRole("button", { name: "Play l2" }))
        await waitFor(() => expect(api.spotifyPlay).toHaveBeenCalledWith({ uri: "spotify:track:l2", contextUri: null, uris: ["spotify:track:l2", "spotify:track:l3"] }))
    })

    it("searches, shows more of a kind, and opens an artist then an album, back and back", async () => {
        api.spotifySearch.mockImplementation(async (_q: unknown, type: unknown) => type === "track"
            ? results("", { tracks: [track("m2", { title: "More one" })] })
            : results("", {
                tracks: [track("f1", { title: "Found one" })], artists: [artist("a1", "Sigur Rós")], albums: [album("al1", "Ágætis byrjun")], playlists: [playlist("pl9", "Post-rock")],
                more: { tracks: true, artists: false, albums: false, playlists: false }, nextOffsets: { tracks: 1, artists: null, albums: null, playlists: null },
            }))
        api.spotifyArtistAlbums.mockResolvedValue(page([album("al1", "Ágætis byrjun")]))
        api.spotifyAlbumTracks.mockResolvedValue(page([track("x1", { title: "Svefn-g-englar", album: "" })]))
        show()
        const music = card("Browse music")
        const box = music.getByRole("searchbox", { name: "Search Spotify" })
        fireEvent.change(box, { target: { value: "sigur" } })
        fireEvent.submit(box.closest("form")!)
        expect(await music.findByText("Found one")).toBeTruthy()
        expect(api.spotifySearch).toHaveBeenCalledWith("sigur", null, 0)
        expect(music.getByText("for “sigur”")).toBeTruthy()
        for (const kind of ["Tracks", "Artists", "Albums", "Playlists"]) expect(music.getByRole("region", { name: kind })).toBeTruthy()

        fireEvent.click(within(music.getByRole("region", { name: "Tracks" })).getByRole("button", { name: "Show more" }))
        expect(await music.findByText("More one")).toBeTruthy()
        expect(api.spotifySearch).toHaveBeenLastCalledWith("sigur", "track", 1)

        fireEvent.click(music.getByRole("button", { name: "Open Sigur Rós" }))
        expect(await music.findByText("Albums and singles")).toBeTruthy()
        fireEvent.click(music.getByRole("button", { name: "Open Ágætis byrjun" }))
        expect(await music.findByText("Svefn-g-englar")).toBeTruthy()
        /* an album's tracks take the album's name */
        expect(music.getByText("Marconi Union · Ágætis byrjun")).toBeTruthy()

        fireEvent.click(music.getByRole("button", { name: "‹ Back" }))
        expect(await music.findByText("Albums and singles")).toBeTruthy()
        fireEvent.click(music.getByRole("button", { name: "‹ Back" }))
        expect(await music.findByText("Found one")).toBeTruthy()
        fireEvent.click(music.getByRole("button", { name: "‹ Library" }))
        expect(await music.findByRole("button", { name: "Open Study mix" })).toBeTruthy()
    })

    it("says when a search finds nothing", async () => {
        api.spotifySearch.mockResolvedValue(results(""))
        show()
        const box = card("Browse music").getByRole("searchbox", { name: "Search Spotify" })
        fireEvent.change(box, { target: { value: "zzqx" } })
        fireEvent.submit(box.closest("form")!)
        expect(await screen.findByText("Nothing found")).toBeTruthy()
    })

    it("adds a track to the queue, ticking it for a moment, and reloads Up next", async () => {
        api.spotifySearch.mockResolvedValue(results("", { tracks: [track("q1", { title: "Night Owl" })] }))
        show()
        const music = card("Browse music")
        await waitFor(() => expect(api.spotifyQueue).toHaveBeenCalledTimes(1))
        const box = music.getByRole("searchbox", { name: "Search Spotify" })
        fireEvent.change(box, { target: { value: "night" } })
        fireEvent.submit(box.closest("form")!)
        fireEvent.click(await music.findByRole("button", { name: "Queue Night Owl" }))
        await waitFor(() => expect(music.getByRole("button", { name: "Queue Night Owl" }).textContent).toBe("✓"))
        expect(api.spotifyQueueAdd).toHaveBeenCalledWith("spotify:track:q1")
        expect((music.getByRole("button", { name: "Queue Night Owl" }) as HTMLButtonElement).disabled).toBe(true)
        /* the queue shows in the left card, so it is asked for again */
        await waitFor(() => expect(api.spotifyQueue).toHaveBeenCalledTimes(2))
        await waitFor(() => expect(music.getByRole("button", { name: "Queue Night Owl" }).textContent).toBe("+"), { timeout: 3000 })
    })

    it("plays, pauses, skips, shuffles and repeats", async () => {
        show()
        const player = card("Player")
        fireEvent.click(player.getByRole("button", { name: "Pause" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("pause", null)
        expect(player.getByRole("button", { name: "Play" })).toBeTruthy()
        fireEvent.click(player.getByRole("button", { name: "Next" }))
        expect(api.spotifyControl).toHaveBeenLastCalledWith("next", null)
        /* past the first seconds, previous starts the track again */
        fireEvent.click(player.getByRole("button", { name: "Previous" }))
        expect(api.spotifyControl).toHaveBeenLastCalledWith("restart", null)

        const shuffle = player.getByRole("button", { name: "Shuffle" })
        fireEvent.click(shuffle)
        expect(shuffle.getAttribute("aria-pressed")).toBe("true")
        expect(api.spotifyShuffle).toHaveBeenCalledWith(true)
        fireEvent.click(player.getByRole("button", { name: "Repeat is off" }))
        expect(api.spotifyRepeat).toHaveBeenLastCalledWith("context")
        fireEvent.click(player.getByRole("button", { name: "Repeating the playlist or album" }))
        expect(player.getByRole("button", { name: "Repeating this track" }).textContent).toBe("↻¹")
        expect(api.spotifyRepeat).toHaveBeenLastCalledWith("track")
    })

    it("turns shuffle and repeat off with nothing to send them to, and lets the Term tab play", () => {
        resetEngine()
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        show()
        const player = card("Player")
        expect(player.getByText("Nothing playing")).toBeTruthy()
        expect((player.getByRole("button", { name: "Shuffle" }) as HTMLButtonElement).disabled).toBe(true)
        expect((player.getByRole("button", { name: "Repeat is off" }) as HTMLButtonElement).disabled).toBe(true)
        expect((player.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(player.getByRole("button", { name: "Play in Term" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("play", null)
    })

    it("lists the devices, this tab by name, those that take no commands disabled", async () => {
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        api.spotifyDevices.mockResolvedValue({ devices: [
            { id: "mac", name: "MacBook", type: "Computer", active: true, restricted: false },
            { id: "rounds", name: "Term", type: "Computer", active: false, restricted: false },
            { id: "tv", name: "Living room", type: "TV", active: false, restricted: true },
        ] })
        show()
        const player = card("Player")
        const button = player.getByRole("button", { name: /MacBook/ })
        fireEvent.click(button)
        await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"))
        const list = within(await player.findByRole("dialog", { name: "Choose a device" }))
        expect(await list.findByText("This tab")).toBeTruthy()
        expect(list.getByText("Term, in this browser")).toBeTruthy()
        expect(list.getByText("Playing here")).toBeTruthy()
        const tv = list.getByRole("button", { name: /Living room/ }) as HTMLButtonElement
        expect(tv.disabled).toBe(true)
        expect(tv.title).toBe("This device does not take commands")

        fireEvent.click(list.getByRole("button", { name: /This tab/ }))
        await waitFor(() => expect(api.spotifyTransfer).toHaveBeenCalledWith("rounds", true))
        expect(player.queryByRole("dialog")).toBeNull()
        expect(await screen.findByText("Moved to this tab.")).toBeTruthy()
    })

    it("says so when no device is open, and closes the list on Escape or a click elsewhere", async () => {
        show()
        const player = card("Player")
        fireEvent.click(player.getByRole("button", { name: /MacBook/ }))
        expect(await player.findByText("No devices. Open Spotify on your phone, computer or speaker.")).toBeTruthy()
        const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
        act(() => { document.body.dispatchEvent(esc) })
        expect(esc.defaultPrevented).toBe(true)
        expect(player.queryByRole("dialog")).toBeNull()

        fireEvent.click(player.getByRole("button", { name: /MacBook/ }))
        await player.findByRole("dialog")
        fireEvent.pointerDown(card("Browse music").getByRole("searchbox", { name: "Search Spotify" }))
        expect(player.queryByRole("dialog")).toBeNull()
    })

    it("sets the volume where the device takes it, and not elsewhere", async () => {
        show()
        const volume = card("Player").getByRole("slider", { name: "Volume" }) as HTMLInputElement
        expect(volume.disabled).toBe(false)
        expect(volume.value).toBe("60")
        fireEvent.change(volume, { target: { value: "35" } })
        expect(card("Player").getByText("35")).toBeTruthy()
        await waitFor(() => expect(api.spotifyVolume).toHaveBeenCalledWith(35))
        expect(api.spotifyVolume).toHaveBeenCalledTimes(1)

        setPlayer({ supportsVolume: false })
        expect((card("Player").getByRole("slider", { name: "Volume" }) as HTMLInputElement).disabled).toBe(true)
        expect(card("Player").getByTitle("This device does not take volume from here")).toBeTruthy()
    })

    it("offers to move the music here when it plays elsewhere and this tab can play", () => {
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        show()
        fireEvent.click(card("Player").getByRole("button", { name: "Play here" }))
        expect(api.spotifyTransfer).toHaveBeenCalledWith("rounds")
    })

    it("follows the track: when it moves on, Up next is asked for again", async () => {
        show()
        await waitFor(() => expect(api.spotifyQueue).toHaveBeenCalledTimes(1))
        setPlayer({ track: track("t9", { title: "Holocene" }) })
        await waitFor(() => expect(api.spotifyQueue).toHaveBeenCalledTimes(2))
    })
})

describe("the page's keys", () => {
    const key = (k: string, target: Element = document.body) => {
        const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })
        act(() => { target.dispatchEvent(e) })
        return e.defaultPrevented
    }

    it("/ goes to the search box, Space plays or pauses", () => {
        show()
        expect(key("/")).toBe(true)
        expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search Spotify" }))
        /* typed into the box, / is just a character, and Space a space */
        expect(key("/", document.activeElement!)).toBe(false)
        expect(key(" ", document.activeElement!)).toBe(false)
        expect(api.spotifyControl).not.toHaveBeenCalled()

        expect(key(" ")).toBe(true)
        expect(api.spotifyControl).toHaveBeenCalledWith("pause", null)
        expect(key(" ")).toBe(true)
        expect(api.spotifyControl).toHaveBeenLastCalledWith("play", null)
    })

    it("leaves Space to a focused button, and does nothing when not connected", () => {
        show()
        expect(key(" ", card("Player").getByRole("button", { name: "Next" }))).toBe(false)
        cleanup()
        resetEngine({ connected: false })
        show()
        expect(key(" ")).toBe(false)
        expect(api.spotifyControl).not.toHaveBeenCalled()
    })
})

describe("the sidebar player", () => {
    const badge = () => screen.getByRole("region", { name: "Spotify" })

    it("waits for Spotify, then offers to connect", () => {
        resetEngine({ loaded: false, connected: false })
        render(<SidebarPlayer />)
        expect(screen.queryByRole("region", { name: "Spotify" })).toBeNull()
        setPlayer({ loaded: true })
        expect(badge().dataset.state).toBe("off")
        expect(within(badge()).getByRole("link", { name: "Connect Spotify" }).getAttribute("href")).toBe("/api/spotify/connect")
    })

    it("says nothing is playing, with play when this tab can", () => {
        resetEngine()
        render(<SidebarPlayer />)
        expect(badge().dataset.state).toBe("idle")
        expect(within(badge()).getByText("Nothing playing")).toBeTruthy()
        expect(within(badge()).queryByRole("button")).toBeNull()
        act(() => { Object.assign(web, { status: "ready", deviceId: "rounds" }) })
        setPlayer({})
        fireEvent.click(within(badge()).getByRole("button", { name: "Play in Term" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("play", null)
    })

    it("shows the track, its progress, the controls and the device", () => {
        render(<SidebarPlayer />)
        const b = within(badge())
        expect(badge().dataset.state).toBe("playing")
        expect(b.getByRole("link", { name: "Weightless" })).toBeTruthy()
        expect(b.getByText("Marconi Union")).toBeTruthy()
        expect(b.getByText("MacBook")).toBeTruthy()
        expect(badge().querySelector<HTMLElement>("i[style]")?.style.width).toBe((191000 / 489000) * 100 + "%")
        fireEvent.click(b.getByRole("button", { name: "Pause" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("pause", null)
        expect(badge().dataset.state).toBe("paused")
        fireEvent.click(b.getByRole("button", { name: "Next" }))
        expect(api.spotifyControl).toHaveBeenLastCalledWith("next", null)
    })

    it("says why a control failed, dims when stale, and offers Play here", () => {
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        render(<SidebarPlayer />)
        setPlayer({ error: "premium_required", stale: true })
        expect(within(badge()).getByRole("status").textContent).toBe("Controls need Spotify Premium")
        expect(badge().dataset.stale).toBe("true")
        fireEvent.click(within(badge()).getByRole("button", { name: "Play here" }))
        expect(api.spotifyTransfer).toHaveBeenCalledWith("rounds")
    })

    it("sends a person with nothing to resume to the Music page", () => {
        render(<SidebarPlayer />)
        setPlayer({ error: "nothing_to_resume" })
        expect(within(badge()).getByRole("status").textContent).toBe("Pick something on the Music page")
    })
})
