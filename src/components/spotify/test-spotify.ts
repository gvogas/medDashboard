// For the music's component tests: a fake Worker for the engine (each test file mocks
// "@/core/api" with `fakeApi()`), what it answers, and a fresh engine per test.
// The engine itself is the real one: its loads, its cache and its commands.

import { act } from "@testing-library/react"
import { vi } from "vitest"
import { busy, cache, forgetRetries } from "@/data/spotify/library"
import { state as player } from "@/data/spotify/player"
import { state as web } from "@/data/spotify/web-player"
import { changed } from "@/data/spotify/signal"
import { ui } from "@/data/ui"
import type { Album, Artist, Device, Page, PlayerState, Playlist, SearchResults, Track } from "@/data/spotify"
import { resetTrail } from "./use-music"

/** Every Spotify call the engine makes, answering at once; tests set what each returns. */
export function fakeApi() {
    const empty = { items: [], total: 0, next: false, nextOffset: null }
    return {
        spotifyStatus: vi.fn(async () => ({ connected: true })),
        spotifyPlayer: vi.fn(async () => ({ connected: true })),
        spotifyControl: vi.fn(async () => null),
        spotifyToken: vi.fn(async () => ({ token: "t" })),
        spotifyTransfer: vi.fn(async () => null),
        spotifyDevices: vi.fn(async () => ({ devices: [] as Device[] })),
        spotifyShuffle: vi.fn(async () => null),
        spotifyRepeat: vi.fn(async () => null),
        spotifyMe: vi.fn(async () => ({ id: "george", name: "George" })),
        spotifyRecent: vi.fn(async (): Promise<unknown> => ({ items: [] })),
        spotifyAlbumTracks: vi.fn(async (): Promise<unknown> => empty),
        spotifyArtistAlbums: vi.fn(async (): Promise<unknown> => empty),
        spotifyDisconnect: vi.fn(async () => null),
        spotifySearch: vi.fn(async (_q?: unknown, _type?: unknown, _offset?: unknown): Promise<unknown> => ({})),
        spotifyPlaylists: vi.fn(async (): Promise<unknown> => empty),
        spotifyPlaylistTracks: vi.fn(async (): Promise<unknown> => empty),
        spotifyQueue: vi.fn(async (): Promise<unknown> => ({ current: null, queue: [] })),
        spotifyQueueAdd: vi.fn(async () => null),
        spotifyPlay: vi.fn(async () => null),
        spotifyVolume: vi.fn(async () => null),
    }
}

export const track = (uri: string, over: Partial<Track> = {}): Track => ({
    uri: "spotify:track:" + uri, title: uri, artists: "Marconi Union", album: "Weightless", art: null, url: null, durationMs: 489000, progressMs: 0, ...over,
})
export const playlist = (id: string, name: string, over: Partial<Playlist> = {}): Playlist => ({
    uri: "spotify:playlist:" + id, id, name, owner: "George", ownerId: "george", collaborative: false, art: null, count: 12, ...over,
})
export const album = (id: string, name: string): Album => ({ uri: "spotify:album:" + id, id, name, artists: "Sigur Rós", art: null, count: 9 })
export const artist = (id: string, name: string): Artist => ({ uri: "spotify:artist:" + id, id, name, art: null })
export const page = <T>(items: T[], over: Partial<Page<T>> = {}): Page<T> => ({ items, total: items.length, next: false, nextOffset: null, ...over })
export const results = (q: string, over: Partial<SearchResults> = {}): Omit<SearchResults, "q"> & { q?: string } => ({
    tracks: [], artists: [], albums: [], playlists: [],
    more: { tracks: false, artists: false, albums: false, playlists: false },
    nextOffsets: { tracks: null, artists: null, albums: null, playlists: null },
    ...over,
})

const IDLE: PlayerState = {
    connected: true, playing: false, track: null, device: null, deviceId: null, volume: null, supportsVolume: false,
    shuffle: false, repeat: "off", stale: false, error: null, loaded: true,
}

/** A fresh engine: nothing cached, the library open, connected and quiet. */
export function resetEngine(state: Partial<PlayerState> = {}) {
    Object.assign(cache, {
        me: null, playlists: null, tracks: {}, albums: {}, artists: {}, artistAlbums: {}, queue: null, results: null,
        recent: null, recentBlocked: false, devices: null, names: { liked: "Liked Songs" },
    })
    busy.clear()
    forgetRetries()
    Object.assign(ui.spotify, { pane: "home", playlistId: null, albumId: null, artistId: null, q: "", filter: "" })
    Object.assign(player, IDLE, state)
    Object.assign(web, { status: "off", deviceId: null })
    resetTrail()
    changed()                                   /* the snapshot is kept until the engine says so */
}

/** Change what the poller knows, as a poll would. */
export function setPlayer(state: Partial<PlayerState>) {
    act(() => { Object.assign(player, state); changed() })
}
