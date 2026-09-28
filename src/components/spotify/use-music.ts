// What the music's parts share besides the engine: the cooldown's end, following the
// track for the queue, and the way back out of an opened playlist, album or artist.

import { useEffect, useState } from "react"
import {
    followTrack, openAlbum, openArtist, openHome, openPlaylist, openQueue, openRecent, search,
    type SpotifyPlace, type SpotifySnapshot,
} from "@/data/spotify"
import { ui } from "@/data/ui"

/**
 * Whether Spotify has asked us to wait. The engine works it out only when something
 * changes, so this draws once more when the wait is over (and the loads can try again).
 */
export function useCooling(retryAt: number) {
    const [, redraw] = useState(0)
    const cooling = retryAt > Date.now()
    useEffect(() => {
        if (!cooling) return
        const id = setTimeout(() => redraw((n) => n + 1), retryAt - Date.now() + 50)
        return () => clearTimeout(id)
    }, [retryAt, cooling])
    return cooling
}

/** While the music is on screen: when the track moves on, the queue that shows reloads. */
export function useFollowTrack(s: SpotifySnapshot) {
    const uri = s.player.track?.uri ?? null
    const on = s.player.connected
    useEffect(() => { if (on) followTrack(uri) }, [uri, on])
}

/* ── the way back: each opening from a list remembers the place it left ── */

const trail: SpotifyPlace[] = []
const place = () => ui.spotify
const same = (a: SpotifyPlace, b: SpotifyPlace) =>
    a.pane === b.pane && a.playlistId === b.playlistId && a.albumId === b.albumId && a.artistId === b.artistId && a.q === b.q

/** Open something from the place on screen, so ‹ Back returns to it. */
export function openFrom(open: () => void) {
    const was = { ...place() }
    open()
    if (!same(was, place())) trail.push(was)
}

/** Open a place of its own (a tab, a new search): nothing to go back to. */
export function openRoot(open: () => void) {
    trail.length = 0
    open()
}

/** Back to where the open list was opened from; the library when that is not known. */
export function goBack() {
    const p = trail.pop()
    if (!p) { openHome(); return }
    if (p.pane === "playlist" && p.playlistId) openPlaylist(p.playlistId)
    else if (p.pane === "album" && p.albumId) openAlbum(p.albumId)
    else if (p.pane === "artist" && p.artistId) openArtist(p.artistId)
    else if (p.pane === "search" && p.q) search(p.q)
    else if (p.pane === "queue") openQueue()
    else if (p.pane === "recent") openRecent()
    else openHome()
}

/** For tests: forget the way back. */
export function resetTrail() { trail.length = 0 }
