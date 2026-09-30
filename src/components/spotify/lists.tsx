// The music's lists, drawn from the engine's session cache: Up next, Recently played, the
// library's cover grid, an opened playlist, album or artist, and search results. The loads
// start from effects (they mark what is busy at once), never while drawing.

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
    activate, canOpen, due, ensurePlaylists, ensureQueue, ensureRecent, matchesFilter, more, openAlbum, openArtist,
    openPlaylist, play, refresh, setFilter, toggleShuffle, watchQueue, type Page, type SpotifySnapshot, type Track,
} from "@/data/spotify"
import { chipButton, Count, Empty, ghost, Loading, More, Refresh, Sub } from "./bits"
import { AlbumRow, ArtistRow, LikedTile, PlaylistRow, PlaylistTile, TrackRow } from "./rows"
import { goBack } from "./use-music"

interface ListProps { s: SpotifySnapshot; cooling: boolean }

/** Rows of tracks; `filter` hides those it does not match (they stay loaded). */
function Tracks({ s, items, contextUri = null, list = null, filter = "" }: { s: SpotifySnapshot; items: Track[]; contextUri?: string | null; list?: string | null; filter?: string }) {
    const nowUri = s.player.track?.uri ?? null, playing = s.player.playing
    return <>{items.map((t, i) => (
        <TrackRow
            key={(t.uri || "") + ":" + i}
            t={t}
            now={!!nowUri && t.uri === nowUri}
            playing={playing}
            queued={!!t.uri && s.queued(t.uri)}
            contextUri={contextUri}
            list={list}
            hidden={!matchesFilter(t, filter)}
        />
    ))}</>
}

/* ── Up next ── */

/** The queue: what plays now, what is next, and what Spotify does not let apps do. */
export function QueueList({ s, cooling }: ListProps) {
    /* on screen: a track added or the track moving on reloads it */
    useEffect(() => watchQueue(), [])
    useEffect(() => { if (!document.hidden) ensureQueue() }, [s, cooling])
    const q = s.cache.queue
    if (!q) return <Loading what="Queue" cooling={cooling} />
    return (
        <>
            <Sub>Now playing</Sub>
            {q.current ? <Tracks s={s} items={[q.current]} /> : <Empty>Nothing playing.</Empty>}
            <Sub end={<Count n={q.queue.length} />}>Next up</Sub>
            {q.queue.length ? <Tracks s={s} items={q.queue} /> : <Empty>The queue is empty. Add to it with + on any track.</Empty>}
            <p className="m-0 border-t border-line-2 px-3.5 pt-2.5 pb-3.5 text-[11px] text-muted-foreground">
                Spotify lets apps add to the queue and skip, but not remove or reorder. Do that in the Spotify app.
            </p>
        </>
    )
}

/** Up next's button: reload it. (Skip is ⏭ in <NowPlaying>, beside it.) */
export const QueueActions = () => <Refresh onClick={() => refresh("queue")} label="Refresh queue" />

/* ── Recently played ── */

export function RecentList({ s, cooling }: ListProps) {
    useEffect(() => { if (!document.hidden) ensureRecent() }, [s, cooling])
    const r = s.cache.recent
    if (s.cache.recentBlocked) {
        return (
            <Empty title="Reconnect to see what you played lately">
                Term needs one more permission from Spotify for this.
                <br />
                <a href="/api/spotify/connect" className={cn(chipButton, "mt-2.5 border-primary bg-primary text-primary-foreground no-underline hover:text-primary-foreground")}>Reconnect Spotify</a>
            </Empty>
        )
    }
    if (!r) {
        return s.busy.has("recent")
            ? <Loading what="Recently played" cooling={cooling} />
            : <Empty title="Pick a playlist, open the queue, or search">Play anything from here on whichever device Spotify is open on.</Empty>
    }
    if (!r.items.length) return <Empty title="Nothing played lately">Pick a playlist or search to start.</Empty>
    return <Tracks s={s} items={r.items} list="recent" />
}

export const RecentActions = ({ s }: { s: SpotifySnapshot }) =>
    s.cache.recent ? <Refresh onClick={() => refresh("recent")} label="Refresh recently played" /> : null

/* ── the library ── */

/** Liked Songs and the playlists as covers: three across `compact`, else as many as fit. */
export function Library({ s, cooling, compact }: ListProps & { compact: boolean }) {
    useEffect(() => { if (!document.hidden) ensurePlaylists() }, [s, cooling])
    const pl = s.cache.playlists
    const grid = cn("grid gap-3 px-3.5 py-3", compact ? "grid-cols-3" : "grid-cols-[repeat(auto-fill,minmax(118px,1fr))]")
    return (
        <>
            <div className={grid}>
                <LikedTile total={s.cache.tracks.liked ? s.cache.tracks.liked.total : null} />
                {pl?.items.map((p) => <PlaylistTile key={p.id} p={p} openable={canOpen(p, s.cache.me)} />)}
            </div>
            {!pl
                ? s.busy.has("playlists") ? <Loading what="Playlists" cooling={cooling} /> : null
                : !pl.items.length
                    ? <Empty>No playlists yet.</Empty>
                    : pl.next && <More onClick={() => more("playlists")} left={pl.total - pl.items.length} />}
        </>
    )
}

/** The library's heading: how many playlists, and ↻. */
export const LibraryHead = ({ s }: { s: SpotifySnapshot }) => (
    <>
        {s.cache.playlists && <em className="ml-auto text-[10.5px] tracking-[.04em] text-muted-foreground not-italic">{s.cache.playlists.total} playlists</em>}
        <span className={cn(!s.cache.playlists && "ml-auto")}><Refresh onClick={() => refresh("playlists")} label="Refresh playlists" /></span>
    </>
)

/* ── an opened playlist, album or artist ── */

/** The header over an opened list: ‹ Back, its name and line, then its buttons. */
function OpenHead({ name, line, children }: { name: string; line?: ReactNode; children?: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-3.5 py-2.5">
            <button type="button" onClick={goBack} className={chipButton}>‹ Back</button>
            <div className="min-w-0 flex-1 leading-[1.25]">
                <h3 className="m-0 truncate text-[14px] font-bold text-foreground">{name}</h3>
                {line && <span className="block truncate text-[11px] text-muted-foreground">{line}</span>}
            </div>
            <span className="flex flex-none items-center gap-1.5">{children}</span>
        </div>
    )
}

/** Play the whole list, with shuffle beside it. */
function PlayAll({ s, label, run }: { s: SpotifySnapshot; label: string; run: () => void }) {
    const p = s.player
    return (
        <>
            <button type="button" onClick={() => { activate(); run() }} className={cn(chipButton, "border-primary bg-primary text-primary-foreground hover:text-primary-foreground hover:brightness-110")}>▶ {label}</button>
            <button type="button" onClick={() => void toggleShuffle()} disabled={!p.device} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle"
                className={cn(ghost, p.shuffle && "border-[color-mix(in_srgb,var(--spotify)_45%,var(--line))] text-[var(--spotify)] hover:text-[var(--spotify)]")}>⤮</button>
        </>
    )
}

/** The filter inside a list of eight tracks or more, and how many it shows. */
function Filter({ s, items }: { s: SpotifySnapshot; items: Track[] }) {
    const f = s.place.filter || ""
    if (items.length < 8) return null
    const shown = f.trim() ? items.filter((t) => matchesFilter(t, f)).length : 0
    return (
        <div className="flex items-center gap-2 border-b border-line-2 px-3.5 py-2">
            <input
                type="search"
                placeholder="Filter these tracks"
                aria-label="Filter tracks"
                autoComplete="off"
                value={f}
                onChange={(e) => setFilter(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
            />
            <span className="flex-none font-mono text-[10.5px] text-muted-foreground">{f.trim() ? shown + " of " + items.length + " loaded" : ""}</span>
        </div>
    )
}

function TrackPane({ s, cooling, keyName, page, contextUri, list, emptyText }: ListProps & { keyName: string; page: Page<Track> | undefined; contextUri: string | null; list?: string | null; emptyText: string }) {
    if (!page) return <Loading what={s.cache.names[keyName] || "Tracks"} cooling={cooling} />
    if (!page.items.length) return <Empty>{emptyText}</Empty>
    return (
        <>
            <Filter s={s} items={page.items} />
            <Tracks s={s} items={page.items} contextUri={contextUri} list={list} filter={s.place.filter} />
            {page.next && <More onClick={() => more("tracks")} left={page.total - page.items.length} />}
        </>
    )
}

/* An opened list kept when the page is drawn again later: load what it shows if the
   session cache has lost it (or never had it). */
function useReopen(s: SpotifySnapshot, cooling: boolean) {
    const { pane, playlistId, albumId, artistId } = s.place
    useEffect(() => {
        if (document.hidden) return
        if (pane === "playlist" && playlistId && !s.cache.tracks[playlistId] && !s.busy.has("tracks") && due("tracks")) openPlaylist(playlistId)
        else if (pane === "album" && albumId && !s.cache.tracks["album:" + albumId] && !s.busy.has("tracks") && due("tracks")) openAlbum(albumId)
        else if (pane === "artist" && artistId && !s.cache.artistAlbums[artistId] && !s.busy.has("artist") && due("artist")) openArtist(artistId)
    }, [s, cooling, pane, playlistId, albumId, artistId])
}

/** The playlist, album or artist open now, with its header. */
export function OpenList({ s, cooling }: ListProps) {
    useReopen(s, cooling)
    const place = s.place, c = s.cache

    if (place.pane === "playlist") {
        const id = place.playlistId || "", t = c.tracks[id], liked = id === "liked", ctx = liked ? null : "spotify:playlist:" + id
        return (
            <>
                <OpenHead name={c.names[id] || "Playlist"} line={t ? t.total + " tracks" : null}>
                    <Refresh onClick={() => refresh("list")} />
                    {t && t.items.length > 0 && <PlayAll s={s} label="Play all" run={() => void play(null, ctx, liked ? "liked" : null)} />}
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={id} page={t} contextUri={ctx} list={liked ? "liked" : null} emptyText="Nothing in here yet." />
            </>
        )
    }
    if (place.pane === "album") {
        const id = place.albumId || "", a = c.albums[id] || { name: "Album", uri: "spotify:album:" + id, artists: "" }, t = c.tracks["album:" + id]
        return (
            <>
                <OpenHead name={a.name} line={a.artists || null}>
                    <Refresh onClick={() => refresh("list")} />
                    <PlayAll s={s} label="Play album" run={() => void play(null, a.uri)} />
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={"album:" + id} page={t} contextUri={a.uri} emptyText="This album has no tracks Spotify will play." />
            </>
        )
    }
    const id = place.artistId || "", a = c.artists[id] || { name: "Artist", uri: "spotify:artist:" + id }, list = c.artistAlbums[id]
    return (
        <>
            <OpenHead name={a.name} line="Artist">
                <PlayAll s={s} label="Play" run={() => void play(null, a.uri)} />
            </OpenHead>
            {!list
                ? <Loading what={a.name} cooling={cooling} />
                : !list.items.length
                    ? <Empty>No albums here.</Empty>
                    : <>
                        <Sub>Albums and singles</Sub>
                        {list.items.map((x) => <AlbumRow key={x.id} a={x} />)}
                        {list.next && <More onClick={() => more("artist")} left={list.total - list.items.length} />}
                    </>}
        </>
    )
}

/* ── search results ── */

export function Results({ s, cooling }: ListProps) {
    const r = s.cache.results
    if (!r || r.q !== s.place.q) return <Loading what="Searching" cooling={cooling} />
    if (!r.tracks.length && !r.artists.length && !r.albums.length && !r.playlists.length) return <Empty title="Nothing found">Try another spelling.</Empty>
    const section = (kind: "tracks" | "artists" | "albums" | "playlists", title: string, rows: ReactNode) => r[kind].length > 0 && (
        <section aria-label={title}>
            <Sub>{title}</Sub>
            {rows}
            {r.more[kind] && <More onClick={() => more("search:" + kind)} />}
        </section>
    )
    return (
        <>
            {section("tracks", "Tracks", <Tracks s={s} items={r.tracks} />)}
            {section("artists", "Artists", r.artists.map((a) => <ArtistRow key={a.id} a={a} />))}
            {section("albums", "Albums", r.albums.map((a) => <AlbumRow key={a.id} a={a} />))}
            {section("playlists", "Playlists", r.playlists.map((p) => <PlaylistRow key={p.id} p={p} openable={canOpen(p, s.cache.me)} />))}
        </>
    )
}
