// The Spotify engine for React: useSpotify() reads the poller, the Rounds device, the
// library and the commands as one snapshot, rebuilt after each change the engine signals
// (a poll, a tick of the progress line, a load, a note, a click answered early). The
// actions are the engine's own functions, re-exported.

import { useSyncExternalStore } from "react"
import { spotifyRetryAt } from "@/legacy/js/api.js"
import { ui as legacyUi } from "@/legacy/js/state.js"
import { state as player } from "./player"
import { state as web, playTarget } from "./web-player"
import { busy, cache, note, type Cache } from "./library"
import { justQueued, shownVolume } from "./commands"
import { getVersion, subscribe } from "./signal"
import type { PlayerState, SpotifyNote, SpotifyPlace, WebState } from "./types"

export interface SpotifySnapshot {
    /** What plays, where, and how; `track` is a copy, so its progress is this snapshot's. */
    player: PlayerState
    /** The Rounds tab as a device. */
    web: WebState
    /** Where a click should send music: into this tab, an offer to move it here, or neither. */
    target: "here" | "offer" | null
    /** Which part of the music is open (`ui.spotify`). */
    place: SpotifyPlace
    /** What was fetched this session. The lists inside are the engine's own and grow in place. */
    cache: Readonly<Cache>
    /** What is being fetched: "playlists", "tracks", "artist", "queue", "search", "recent", "devices". */
    busy: ReadonlySet<string>
    /** The short line under the top row, for a few seconds. */
    note: SpotifyNote | null
    /** When Spotify has asked us to wait after a 429, until when (ms); else 0. */
    retryAt: number
    /** The volume the slider shows: the one being sent, else what Spotify said; null when unknown. */
    volume: number | null
    /** A track just added to the queue, shown with a tick for a moment. */
    queued: (uri: string) => boolean
    /** Whether a row's track is the one playing. */
    isNow: (uri: string | null | undefined) => boolean
}

let built = -1
let snapshot: SpotifySnapshot

function read(): SpotifySnapshot {
    const version = getVersion()
    if (version === built) return snapshot
    built = version
    const now = player.track
    snapshot = {
        player: { ...player, track: now ? { ...now } : null },
        web: { ...web },
        target: playTarget(player, web),
        place: { ...(legacyUi as unknown as { spotify: SpotifyPlace }).spotify },
        cache: { ...cache },
        busy: new Set(busy),
        note,
        retryAt: spotifyRetryAt(),
        volume: shownVolume(),
        queued: justQueued,
        isNow: (uri) => !!(now && now.uri && now.uri === uri),
    }
    return snapshot
}

/** The whole engine, redrawn on each change it signals. */
export function useSpotify(): SpotifySnapshot {
    return useSyncExternalStore(subscribe, read)
}

export { subscribe, getVersion } from "./signal"
export { nextDelayMs, start, stop, poll, control, previous, playHere, disconnected, onRoundsIfIdle, type Control } from "./player"
export { activate, playTarget } from "./web-player"
export {
    cooldownMessage, explain, say, due, ensureMe, ensurePlaylists, ensureRecent, openHome, openPlaylist, openAlbum,
    openArtist, openQueue, more, refresh, search, typed, setFilter, followTrack, listKey,
    withAlbum, appendPage, canOpen, findText, matchesFilter, playFrom,
} from "./library"
export {
    play, queueAdd, toggleShuffle, cycleRepeat, nextRepeat, toggleDevices, devicesOpen, closeDevices, pickDevice,
    setVolume, volumeHeld,
} from "./commands"
export type * from "./types"
