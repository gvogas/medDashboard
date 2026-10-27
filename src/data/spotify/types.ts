// The music engine's own state, beside the Worker's answer shapes (core/spotify-types.ts),
// which this module passes on so the engine has one place to import from.

export type * from "@/core/spotify-types"

/** The Rounds tab as a device: off, loading, ready, unsupported, needs_reconnect or no_premium. */
export type WebStatus = "off" | "loading" | "ready" | "unsupported" | "needs_reconnect" | "no_premium"
export interface WebState { status: WebStatus; deviceId: string | null }

/** Which part of the music is open: `ui.spotify` in the UI state. */
export interface SpotifyPlace {
    pane: "home" | "playlist" | "album" | "artist" | "queue" | "recent" | "search"
    playlistId: string | null
    albumId: string | null
    artistId: string | null
    q: string
    filter: string
}

/** A short line under the top row. */
export interface SpotifyNote { text: string; ok: boolean }
