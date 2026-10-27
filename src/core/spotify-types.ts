// What the Worker's /api/spotify/* answers look like (worker/spotify.js and
// worker/spotify/mapping.js). Types only: core/api.ts types its Spotify calls with them, and
// data/spotify/types.ts adds the engine's own state.

export interface Track {
  uri: string | null
  title: string
  artists: string
  album: string
  art: string | null
  /* only a https://open.spotify.com/ address */
  url: string | null
  durationMs: number
  progressMs: number
}

export interface Album { uri: string; id: string; name: string; artists: string; art: string | null; count: number }
export interface Artist { uri: string; id: string; name: string; art: string | null }
export interface Playlist {
  uri: string
  id: string
  name: string
  owner: string
  ownerId: string | null
  collaborative: boolean
  art: string | null
  /* null for a playlist the user does not own: Spotify does not say */
  count: number | null
}
export interface Device { id: string; name: string; type: string; active: boolean; restricted: boolean }

/** One page of a list, and where the next starts. */
export interface Page<T> { items: T[]; total: number; next: boolean; nextOffset: number | null; offset?: number }

export type SearchKind = "tracks" | "artists" | "albums" | "playlists"
export interface SearchResults {
  q: string
  tracks: Track[]
  artists: Artist[]
  albums: Album[]
  playlists: Playlist[]
  more: Record<SearchKind, boolean>
  nextOffsets: Record<SearchKind, number | null>
}

export type Repeat = "off" | "context" | "track"

/** The poller's view of the account: what plays, where, and how. */
export interface PlayerState {
  connected: boolean
  playing: boolean
  track: Track | null
  device: string | null
  deviceId: string | null
  volume: number | null
  supportsVolume: boolean
  shuffle: boolean
  repeat: Repeat
  /* the last poll failed; the line stops moving */
  stale: boolean
  /* a failed control's error code, shown for a few seconds */
  error: string | null
  loaded: boolean
}
