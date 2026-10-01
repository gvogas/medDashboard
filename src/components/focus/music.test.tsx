// The focus screen's music: the pill and the panel, standalone, over the real engine and a
// fake Worker (the focus screen that places them comes later).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const api = vi.hoisted(() => ({}) as ReturnType<typeof import("@/components/spotify/test-spotify").fakeApi>)
const gate = vi.hoisted(() => ({ until: 0 }))
vi.mock("@/core/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/api")>()),
    api,
    spotifyRetryAt: () => (gate.until > Date.now() ? gate.until : 0),
}))

import { cooldownMessage } from "@/data/spotify"
import { state as web } from "@/data/spotify/web-player"
import { fakeApi, page, playlist, resetEngine, results, setPlayer, track } from "@/components/spotify/test-spotify"
import { SidebarPlayer } from "@/components/spotify/sidebar-player"
import { MusicPill } from "./music-pill"
import { MusicPanel } from "./music-panel"

const WEIGHTLESS = track("t1", { title: "Weightless", art: "https://i.scdn.co/image/w", progressMs: 244500 })

beforeEach(() => {
    Object.assign(api, fakeApi())
    api.spotifyPlaylists.mockResolvedValue(page([playlist("pl1", "Study mix"), playlist("pl2", "Revision mix")]))
    gate.until = 0
    resetEngine({ track: WEIGHTLESS, playing: true, device: "MacBook", deviceId: "mac", volume: 60, supportsVolume: true })
})
afterEach(() => { cleanup() })

const pill = () => within(screen.getByRole("region", { name: "Music" }))

describe("the pill", () => {
    it("waits for Spotify, then offers to connect", () => {
        resetEngine({ loaded: false, connected: false })
        render(<MusicPill onOpen={() => {}} />)
        expect(pill().getByText("Checking your connection…")).toBeTruthy()
        setPlayer({ loaded: true })
        expect(pill().getByText("Spotify is not connected")).toBeTruthy()
        expect(pill().getByRole("link", { name: "Connect Spotify" }).getAttribute("href")).toBe("/api/spotify/connect")
    })

    it("with nothing playing, asks for something and opens the player", () => {
        resetEngine()
        const onOpen = vi.fn()
        render(<MusicPill onOpen={onOpen} />)
        fireEvent.click(pill().getByRole("button", { name: "Pick something to play ▴" }))
        expect(onOpen).toHaveBeenCalledOnce()
        expect(pill().queryByRole("button", { name: "Play in Term" })).toBeNull()
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        setPlayer({})
        fireEvent.click(pill().getByRole("button", { name: "Play in Term" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("play", null)
    })

    it("shows the track, its progress and the device, and its controls work", () => {
        const onOpen = vi.fn()
        const { rerender } = render(<MusicPill onOpen={onOpen} />)
        expect(pill().getByText("Weightless")).toBeTruthy()
        expect(pill().getByText("· Marconi Union")).toBeTruthy()
        expect(pill().getByText("MacBook")).toBeTruthy()
        expect((pill().getByText("MacBook").previousElementSibling as HTMLElement).className).toContain("bg-[var(--spotify)]")
        expect(screen.getByRole("region", { name: "Music" }).textContent).not.toMatch(/🔈/u)
        expect(screen.getByRole("region", { name: "Music" }).className).toContain("bg-white/10")
        expect(screen.getByRole("region", { name: "Music" }).querySelector<HTMLElement>("i[style]")?.style.width).toBe("50%")
        fireEvent.click(pill().getByRole("button", { name: "Pause" }))
        expect(api.spotifyControl).toHaveBeenCalledWith("pause", null)
        expect(pill().getByRole("button", { name: "Play" })).toBeTruthy()
        fireEvent.click(pill().getByRole("button", { name: "Next" }))
        expect(api.spotifyControl).toHaveBeenLastCalledWith("next", null)
        fireEvent.click(pill().getByRole("button", { name: "Previous" }))
        expect(api.spotifyControl).toHaveBeenLastCalledWith("restart", null)

        const music = pill().getByRole("button", { name: "▴ Music" })
        expect(music.getAttribute("aria-expanded")).toBe("false")
        fireEvent.click(music)
        expect(onOpen).toHaveBeenCalledOnce()
        rerender(<MusicPill onOpen={onOpen} open />)
        expect(pill().getByRole("button", { name: "▾ Music" }).getAttribute("aria-expanded")).toBe("true")
    })

    it("gives the cooldown, or a failed command, in place of the artist", async () => {
        render(<MusicPill onOpen={() => {}} />)
        setPlayer({ error: "premium_required" })
        expect(pill().getByRole("status").textContent).toBe(" · Controls need Spotify Premium")
        gate.until = Date.now() + 300
        setPlayer({})
        expect(pill().getByRole("status").textContent).toBe(" · " + cooldownMessage(gate.until))
        setPlayer({ error: null })
        await waitFor(() => expect(pill().queryByRole("status")).toBeNull(), { timeout: 2000 })
        expect(pill().getByText("· Marconi Union")).toBeTruthy()
    })

    it("on the Spotify page, leaves the note to the page", () => {
        render(<MusicPill onOpen={() => {}} tone="page" />)
        setPlayer({ error: "premium_required" })
        expect(pill().queryByRole("status")).toBeNull()
    })
})

describe("the panel", () => {
    const panel = () => within(screen.getByRole("complementary", { name: "Music" }))
    const tab = (name: string) => panel().getByRole("button", { name })

    it("has a title and closes with ✕", () => {
        const onClose = vi.fn()
        render(<MusicPanel onClose={onClose} />)
        expect(panel().getByRole("heading", { name: "Music" })).toBeTruthy()
        fireEvent.click(panel().getByRole("button", { name: "Close music" }))
        expect(onClose).toHaveBeenCalledOnce()
    })

    it("is drawn as the prototype: ✕ as an icon, the white play button, the tabs as pills", () => {
        render(<MusicPanel onClose={() => {}} />)
        const close = panel().getByRole("button", { name: "Close music" })
        expect(close.querySelector("svg")).toBeTruthy()
        expect(close.textContent).toBe("")
        expect(panel().getByRole("button", { name: "Pause" }).className).toContain("bg-foreground")
        expect(tab("Library").className).toContain("rounded-full")
        expect(panel().getByRole("group", { name: "Music" }).className).not.toContain("bg-[var(--chip-bg)]")
    })

    it("offers to connect when Spotify is not", () => {
        resetEngine({ connected: false })
        render(<MusicPanel onClose={() => {}} />)
        expect(panel().getByText("Spotify is not connected")).toBeTruthy()
        expect(panel().getByRole("link", { name: "Connect Spotify" })).toBeTruthy()
        expect(panel().getByRole("link", { name: "Connect Spotify" }).className).toContain("bg-foreground")
        expect(panel().queryByRole("button", { name: "Up next" })).toBeNull()
    })

    it("shows what plays, and the library three across", async () => {
        render(<MusicPanel onClose={() => {}} />)
        expect(panel().getByRole("region", { name: "Now playing" })).toBeTruthy()
        expect(panel().getByText("Weightless")).toBeTruthy()
        expect(tab("Library").getAttribute("aria-pressed")).toBe("true")
        const open = await panel().findByRole("button", { name: "Open Study mix" })
        expect(open.closest(".grid-cols-3")).toBeTruthy()
        /* the theme's pick is the page's */
        expect(panel().queryByRole("region", { name: /^For / })).toBeNull()
        expect(panel().getByRole("heading", { name: "Library" })).toBeTruthy()
    })

    it("switches between Up next, Recent and Library", async () => {
        api.spotifyQueue.mockResolvedValue({ current: WEIGHTLESS, queue: [track("t2", { title: "Night Owl" })] })
        api.spotifyRecent.mockResolvedValue({ items: [track("r1", { title: "Holocene" })] })
        render(<MusicPanel onClose={() => {}} />)

        fireEvent.click(tab("Up next"))
        expect(await panel().findByText("Night Owl")).toBeTruthy()
        expect(tab("Up next").getAttribute("aria-pressed")).toBe("true")
        expect(panel().getByText(/Spotify lets apps add to the queue and skip/)).toBeTruthy()
        expect(panel().getByRole("button", { name: "Refresh queue" })).toBeTruthy()

        fireEvent.click(tab("Recent"))
        expect(await panel().findByText("Holocene")).toBeTruthy()
        expect(panel().queryByText("Night Owl")).toBeNull()
        expect(panel().getByRole("heading", { name: "Recently played" })).toBeTruthy()

        fireEvent.click(tab("Library"))
        expect(await panel().findByRole("button", { name: "Open Study mix" })).toBeTruthy()
    })

    it("opens a playlist and goes back, queues a track, and searches", async () => {
        api.spotifyPlaylistTracks.mockResolvedValue(page([track("s1", { title: "Song one" })]))
        api.spotifySearch.mockResolvedValue(results("", { tracks: [track("f1", { title: "Found one" })] }))
        render(<MusicPanel onClose={() => {}} />)
        fireEvent.click(await panel().findByRole("button", { name: "Open Study mix" }))
        expect(await panel().findByText("Song one")).toBeTruthy()
        /* the panel's opened list: the kind, no columns' header, unnumbered rows */
        expect(panel().getByText("Playlist")).toBeTruthy()
        expect(panel().queryByText("Title")).toBeNull()
        fireEvent.click(panel().getByRole("button", { name: "Queue Song one" }))
        await waitFor(() => expect(panel().getByRole("button", { name: "Queue Song one" }).textContent).toBe("✓"))
        fireEvent.click(panel().getByRole("button", { name: "‹ Back" }))
        expect(await panel().findByRole("button", { name: "Open Study mix" })).toBeTruthy()

        const box = panel().getByRole("searchbox", { name: "Search Spotify" })
        fireEvent.change(box, { target: { value: "found" } })
        fireEvent.submit(box.closest("form")!)
        expect(await panel().findByText("Found one")).toBeTruthy()
        /* results are no tab's */
        for (const name of ["Up next", "Recent", "Library"]) expect(tab(name).getAttribute("aria-pressed")).toBe("false")
    })

    it("lists the devices", async () => {
        Object.assign(web, { status: "ready", deviceId: "rounds" })
        api.spotifyDevices.mockResolvedValue({ devices: [{ id: "rounds", name: "Term", type: "Computer", active: false, restricted: false }] })
        render(<MusicPanel onClose={() => {}} />)
        fireEvent.click(panel().getByRole("button", { name: /MacBook/ }))
        const list = within(await panel().findByRole("dialog", { name: "Choose a device" }))
        expect(await list.findByText("This tab")).toBeTruthy()
    })

    it("shows the cooldown", () => {
        gate.until = Date.now() + 60_000
        render(<MusicPanel onClose={() => {}} />)
        expect(panel().getByText(cooldownMessage(gate.until))).toBeTruthy()
    })
})

describe("reduced motion", () => {
    it("stills every equaliser: each moving bar also says motion-reduce:animate-none", async () => {
        api.spotifyQueue.mockResolvedValue({ current: WEIGHTLESS, queue: [] })
        render(<><MusicPanel onClose={() => {}} /><SidebarPlayer /></>)
        fireEvent.click(screen.getByRole("button", { name: "Up next" }))
        await screen.findAllByRole("img", { name: "Playing" })
        const moving = [...document.querySelectorAll("[class*='animate-[spot-eq']")]
        expect(moving.length).toBeGreaterThanOrEqual(7)      /* three in the row, four in the badge */
        for (const el of moving) expect(el.className).toContain("motion-reduce:animate-none")
        /* the covers lift on hover, and not with reduced motion */
        for (const el of document.querySelectorAll("[class*='group-hover/tile:-translate-y']")) expect(el.className).toContain("motion-reduce:group-hover/tile:translate-y-0")
    })
})
