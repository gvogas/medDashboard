// The music's data: what it fetched through the Worker, cached for the session, and the
// loads, pane changes and search that fill that cache. The open place is `ui.spotify` in
// the UI state, shared by the focus panel and the Spotify page.

import { api, ApiError, retryDelayMs, spotifyRetryAt } from "@/core/api"
import { ui } from "@/data/ui"
import { changed } from "./signal"
import type { Album, Artist, Device, Page, Playlist, SearchKind, SearchResults, SpotifyNote, SpotifyPlace, Track } from "./types"

const place = (): SpotifyPlace => ui.spotify
/* A search, or the next page of one kind: the kind, and the offset it starts from */
const searchPage = (q: string, type: string | null = null, offset: number | null = 0): Promise<Omit<SearchResults, "q">> => api.spotifySearch(q, type, offset)

export interface Cache {
    /* the Spotify account, to tell its playlists from others' */
    me: { id: string; name: string } | null
    playlists: Page<Playlist> | null
    /* list key → a page: a playlist id, 'liked' or 'album:<id>' */
    tracks: Record<string, Page<Track>>
    /* from search and artist pages */
    albums: Record<string, Album>
    artists: Record<string, Artist>
    artistAlbums: Record<string, Page<Album>>
    queue: { current: Track | null; queue: Track[] } | null
    results: SearchResults | null
    recent: { items: Track[] } | null
    /* the connection predates the recently-played scope */
    recentBlocked: boolean
    /* while the device picker is open */
    devices: Device[] | null
    names: Record<string, string>
}

export const cache: Cache = {
    me: null,
    playlists: null,
    tracks: {},
    albums: {},
    artists: {},
    artistAlbums: {},
    queue: null,
    results: null,
    recent: null,
    recentBlocked: false,
    devices: null,
    names: { liked: "Liked Songs" },
}
const retryAt: Record<string, number> = {}        /* a load that failed is not retried by a redraw before this */
export const busy = new Set<string>()             /* what is being fetched: guards each load, and the empty states */
export let note: SpotifyNote | null = null        /* a short line under the top row */
let noteTimer: ReturnType<typeof setTimeout> | undefined
let typeTimer: ReturnType<typeof setTimeout> | undefined
/** Something here changed: React redraws. */
export function rerender() {
    changed()
}

/* A load starts while the view is being drawn; redrawing right there would draw inside
   the draw and start the next load, over and over. Redraw once the draw is done. */
let redrawQueued = false
function redraw() {
    if (redrawQueued) return
    redrawQueued = true
    queueMicrotask(() => { redrawQueued = false; rerender() })
}

const MESSAGES: Record<string, string> = {
    no_device: "Open Spotify somewhere, or use a desktop browser, then try again.",
    premium_required: "That needs Spotify Premium.",
    not_allowed: "Spotify would not do that right now.",
    spotify_unavailable: "Spotify is not answering right now.",
    rate_limited: "Spotify asked us to slow down. Try again in a moment.",
    not_connected: "Spotify is not connected. Connect it in Settings.",
    not_found: "That is not on Spotify any more.",
    reconnect_needed: "Spotify needs a fresh connection for this. Reconnect in Settings › Spotify.",
    playlist_forbidden: "Spotify only lets Term open playlists you made or collaborate on.",
    offline: "You seem to be offline.",
}

export function explain(e: unknown): string {
    if (!(e instanceof ApiError)) return MESSAGES.offline
    if (e.status === 429) return cooldownMessage(spotifyRetryAt() || Date.now() + retryDelayMs(e))
    return MESSAGES[e.body?.error as string] || MESSAGES.spotify_unavailable
}

export function cooldownMessage(until: number) {
    const time = new Date(until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })
    return "Spotify requests are paused. Try again after " + time + ". You can keep listening in Spotify."
}

export function say(text: string, ms = 4000, ok = false) {
    note = { text, ok }
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => { note = null; rerender() }, ms)
    rerender()
}

export const due = (what: string) => Date.now() >= (retryAt[what] || 0)

/** Forget when failed loads may be tried again (for tests: a fresh engine). */
export function forgetRetries() { for (const k of Object.keys(retryAt)) delete retryAt[k] }

/** `quiet(e)` may take a failure itself and return true, so no note is shown. */
export async function load(what: string, fn: () => Promise<void>, quiet: (e: unknown) => boolean = () => false) {
    busy.add(what)
    redraw()
    try {
        await fn()
        delete retryAt[what]
    } catch (e) {
        /* The redraw below would ask again at once; a refusal would then loop and keep
           the app over Spotify's rate limit. Wait before a redraw may ask again. */
        retryAt[what] = Date.now() + retryDelayMs(e)
        if (!quiet(e)) say(explain(e), 6000)
    } finally {
        busy.delete(what)
        rerender()
    }
}

function go(pane: SpotifyPlace["pane"], fields: Partial<SpotifyPlace> = {}) {
    const s = place()
    if (pane !== s.pane || (Object.keys(fields) as (keyof SpotifyPlace)[]).some((k) => s[k] !== fields[k])) s.filter = ""
    Object.assign(s, { pane }, fields)
}

/* ── the pure parts: pages and rows ── */

/** An album's tracks come without the album: give each its art and name. */
export function withAlbum(page: Page<Track>, meta: Partial<Album>): Page<Track> {
    page.items.forEach((t) => { t.art = t.art || meta.art || null; t.album = t.album || meta.name || "" })
    return page
}

/** Add the next page to a list already loaded. */
export function appendPage<T>(list: Page<T>, page: Page<T>) {
    list.items.push(...page.items)
    list.next = page.next
    list.nextOffset = page.nextOffset
    list.total = page.total
}

/** Spotify only lets Rounds open playlists the user owns or collaborates on. Unknown until /me answers. */
export const canOpen = (p: Playlist, me: Cache["me"]) => !me || p.ownerId === me.id || p.collaborative

/** What the filter inside a list looks through: title, artists and album, lower case. */
export const findText = (t: Pick<Track, "title" | "artists" | "album">) => (t.title + " " + t.artists + " " + (t.album || "")).toLowerCase()

/** Whether a track shows under the filter typed. */
export function matchesFilter(t: Pick<Track, "title" | "artists" | "album">, filter: string) {
    const f = (filter || "").trim().toLowerCase()
    return !f || findText(t).includes(f)
}

/** The uris to play from `uri` onward in a list Spotify has no context for, at most 100; null when none. */
export function playFrom(items: Pick<Track, "uri">[], uri: string | null): string[] | null {
    const from = uri ? Math.max(0, items.findIndex((t) => t.uri === uri)) : 0
    const uris = items.slice(from, from + 100).map((t) => t.uri as string)
    return uris.length ? uris : null
}

/* ── loaders ── */

let meAsked = false       /* a redraw while /me is out must not ask again */
export function ensureMe() {
    if (cache.me || meAsked || busy.size || !due("me")) return
    meAsked = true
    /* Only for hiding "open" on others' playlists: a failure just leaves it showing. */
    api.spotifyMe().then((m: Cache["me"]) => { cache.me = m; rerender() }, (e: unknown) => { retryAt.me = Date.now() + Math.max(retryDelayMs(e), 60000) })
        .finally(() => { meAsked = false })
}

export function ensurePlaylists() {
    if (cache.playlists || busy.has("playlists") || !due("playlists")) return
    load("playlists", async () => {
        const pl: Page<Playlist> = await api.spotifyPlaylists(0)
        cache.playlists = pl
        pl.items.forEach((p) => { cache.names[p.id] = p.name })
    })
}

export function ensureRecent() {
    if (cache.recent || cache.recentBlocked || busy.has("recent") || !due("recent")) return
    load("recent", async () => { cache.recent = await api.spotifyRecent() },
        (e) => { if (e instanceof ApiError && e.body?.error === "reconnect_needed") { cache.recentBlocked = true; return true } return false })
}

function morePlaylists() {
    const pl = cache.playlists
    if (!pl || !pl.next || busy.has("playlists") || !due("playlists")) return
    load("playlists", async () => {
        const page: Page<Playlist> = await api.spotifyPlaylists(pl.nextOffset as number)
        appendPage(pl, page)
        page.items.forEach((p) => { cache.names[p.id] = p.name })
    })
}

function fetchList(key: string, offset: number | null): Promise<Page<Track>> {
    if (key.startsWith("album:")) {
        const id = key.slice(6), meta = cache.albums[id] || {}
        return api.spotifyAlbumTracks(id, offset as number).then((page: Page<Track>) => withAlbum(page, meta))
    }
    return api.spotifyPlaylistTracks(key, offset as number)
}

function loadList(key: string) {
    load("tracks", async () => {
        const page = await fetchList(key, 0)
        cache.tracks[key] = page
    })
}

export function openHome() {
    go("home")
    rerender()
}

export function openPlaylist(id: string, name?: string) {
    if (name) cache.names[id] = name
    go("playlist", { playlistId: id })
    if (cache.tracks[id]) { rerender(); return }
    loadList(id)
}

export function openAlbum(id: string) {
    go("album", { albumId: id })
    if (cache.tracks["album:" + id]) { rerender(); return }
    loadList("album:" + id)
}

export function openArtist(id: string) {
    go("artist", { artistId: id })
    if (cache.artistAlbums[id]) { rerender(); return }
    load("artist", async () => {
        const page: Page<Album> = await api.spotifyArtistAlbums(id, 0)
        page.items.forEach((a) => { cache.albums[a.id] = a })
        cache.artistAlbums[id] = page
    })
}

/** The key of the track list open now in `cache.tracks`, if one is. */
export function listKey() {
    const s = place()
    return s.pane === "playlist" ? s.playlistId : s.pane === "album" ? "album:" + s.albumId : null
}

/** The next page of: 'playlists', 'artist', 'search:<kind>', or else the open track list. */
export function more(what: string) {
    if (what === "playlists") return morePlaylists()
    if (what.startsWith("search:")) return searchMore(what.slice(7))
    if (what === "artist") {
        const id = place().artistId, a = id ? cache.artistAlbums[id] : undefined
        if (!id || !a || !a.next || busy.has("artist") || !due("artist")) return
        return load("artist", async () => {
            const page: Page<Album> = await api.spotifyArtistAlbums(id, a.nextOffset as number)
            page.items.forEach((x) => { cache.albums[x.id] = x })
            appendPage(a, page)
        })
    }
    const key = listKey(), t = key && cache.tracks[key]
    if (!key || !t || !t.next || busy.has("tracks") || !due("tracks")) return
    load("tracks", async () => {
        const page = await fetchList(key, t.nextOffset)
        appendPage(t, page)
    })
}

export function openQueue(refresh = false) {
    go("queue")
    if (cache.queue && !refresh) { rerender(); return }
    load("queue", async () => { cache.queue = await api.spotifyQueue() })
}

/** Recently played, as its own place (the focus panel's Recent tab). */
export function openRecent() {
    go("recent")
    rerender()
}

/* How many parts of the page show the queue outside the queue pane (the Spotify page's
   Up next): while any do, a change to what is queued reloads it rather than dropping it. */
let queueWatchers = 0
export function watchQueue() {
    queueWatchers++
    return () => { queueWatchers-- }
}
const queueShown = () => place().pane === "queue" || queueWatchers > 0

/** Load the queue without moving the open place; `fresh` reloads one already loaded. */
export function ensureQueue(fresh = false) {
    if ((cache.queue && !fresh) || busy.has("queue") || (!fresh && !due("queue"))) return
    load("queue", async () => { cache.queue = await api.spotifyQueue() })
}

/** What is queued has changed (a track added): reload it where it shows, else forget it. */
export function queueChanged() {
    if (!queueShown()) { cache.queue = null; return }
    if (place().pane === "queue") openQueue(true)
    else ensureQueue(true)
}

let lastUri: string | null | undefined        /* the track the poller last reported, to notice a change */

/**
 * Called with what is playing whenever the poller answers, while the music is on screen.
 * When the track moves on, the next one has moved up: what is queued has changed too.
 */
export function followTrack(uri: string | null) {
    if (uri === lastUri) return
    const moved = lastUri !== undefined
    lastUri = uri
    if (moved && queueShown() && !busy.has("queue") && due("queue")) load("queue", async () => { cache.queue = await api.spotifyQueue() })
}

/** A refresh button: the playlist list, the open list, the queue, or recently played. */
export function refresh(what: string) {
    // Keep the visible cache while the shared request gate is waiting out a 429.
    if (spotifyRetryAt()) { rerender(); return }
    if (what === "playlists") { cache.playlists = null; delete retryAt.playlists; ensurePlaylists(); return }
    if (what === "queue") { if (place().pane === "queue") openQueue(true); else ensureQueue(true); return }
    if (what === "recent") { cache.recent = null; delete retryAt.recent; ensureRecent(); return }
    const key = listKey()
    if (key) { delete cache.tracks[key]; loadList(key) }
}

function remember(r: Pick<SearchResults, "albums" | "artists" | "playlists">) {
    r.albums.forEach((a) => { cache.albums[a.id] = a })
    r.artists.forEach((a) => { cache.artists[a.id] = a })
    r.playlists.forEach((p) => { cache.names[p.id] = p.name })
}

export function search(q: string, typed = false) {
    q = (q || "").trim()
    place().q = q
    if (!q) return
    if (typed && (!due("search") || busy.has("search"))) { catchUp(); return }
    go("search", { q })
    if (cache.results && cache.results.q === q) { rerender(); return }
    lastAsked = q
    load("search", async () => {
        const r = await searchPage(q)
        remember(r)
        cache.results = { q, ...r }
    }).then(catchUp)
}

/* Text typed while a search is out, or while Spotify has asked us to wait, is searched
   once the way is clear, so the list never stays on "Searching…" for it. */
let lastAsked: string | null = null, catchUpTimer: ReturnType<typeof setTimeout> | undefined
function catchUp() {
    clearTimeout(catchUpTimer)
    if (busy.has("search")) return   /* the search that is out calls this when it ends */
    const q = place().q
    if (!q || q === lastAsked || (cache.results && cache.results.q === q)) return
    catchUpTimer = setTimeout(() => {
        /* someone who has moved on to an album or playlist is not pulled back to results */
        if (place().pane === "search" && place().q === q) search(q)
    }, Math.max(0, (retryAt.search || 0) - Date.now()))
}

/** Search as the user types: after a pause, and only for two characters or more. */
export function typed(value: string) {
    clearTimeout(typeTimer)
    const q = (value || "").trim()
    if (q.length < 2) return
    typeTimer = setTimeout(() => { if (place().pane !== "search" || place().q !== q) search(q, true) }, 450)
}

const SEARCH_TYPE: Record<SearchKind, string> = { tracks: "track", artists: "artist", albums: "album", playlists: "playlist" }

function searchMore(kind: string) {
    const r = cache.results
    if (!r || !Object.hasOwn(SEARCH_TYPE, kind)) return
    const k = kind as SearchKind
    if (!r.more[k] || busy.has("search") || !due("search")) return
    load("search", async () => {
        const page = await searchPage(r.q, SEARCH_TYPE[k], r.nextOffsets[k])
        remember(page)
        ;(r[k] as unknown[]).push(...page[k])
        r.more[k] = page.more[k]
        r.nextOffsets[k] = page.nextOffsets[k]
    })
}

/** The filter inside the open list. */
export function setFilter(value: string) {
    place().filter = value
    changed()
}
