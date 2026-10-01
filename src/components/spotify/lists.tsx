// The music's lists, drawn from the engine's session cache: Up next, Recently played, the
// library's cover grid, an opened playlist, album or artist, and search results. The loads
// start from effects (they mark what is busy at once), never while drawing.

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
    activate, canOpen, due, ensurePlaylists, ensureQueue, ensureRecent, matchesFilter, more, openAlbum, openArtist,
    openPlaylist, play, refresh, setFilter, toggleShuffle, watchQueue, type Page, type SpotifySnapshot, type Track,
} from "@/data/spotify"
import { Art, chipButton, Count, Empty, Icon, Loading, More, Refresh, Sub } from "./bits"
import { AlbumRow, ArtistRow, COLUMNS, LikedTile, PlaylistRow, PlaylistTile, TrackRow } from "./rows"
import { ForTheme } from "./for-theme"
import { goBack } from "./use-music"

interface ListProps { s: SpotifySnapshot; cooling: boolean }

/** Rows of tracks; `filter` hides those it does not match (they stay loaded); `numbered` on the page's opened lists. */
function Tracks({ s, items, contextUri = null, list = null, filter = "", numbered = false }: {
    s: SpotifySnapshot; items: Track[]; contextUri?: string | null; list?: string | null; filter?: string; numbered?: boolean
}) {
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
            n={numbered ? i + 1 : undefined}
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
            <p className="m-0 mx-2 mt-2 border-t border-line-2 px-2.5 pt-2.5 pb-3.5 text-[12px] text-muted-foreground">
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

/** Liked Songs and the playlists as covers: three across `compact` (the focus panel, whose
    head says "Library"); on the page as many as fit, under the theme's pick and a heading. */
export function Library({ s, cooling, compact }: ListProps & { compact: boolean }) {
    useEffect(() => { if (!document.hidden) ensurePlaylists() }, [s, cooling])
    const pl = s.cache.playlists
    const tiles = (
        <div className={compact ? "grid grid-cols-3 gap-3 px-5 py-3" : "grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3.5"}>
            <LikedTile total={s.cache.tracks.liked ? s.cache.tracks.liked.total : null} />
            {pl?.items.map((p) => <PlaylistTile key={p.id} p={p} openable={canOpen(p, s.cache.me)} />)}
        </div>
    )
    const after = !pl
        ? s.busy.has("playlists") ? <Loading what="Playlists" cooling={cooling} /> : null
        : !pl.items.length
            ? <Empty>No playlists yet.</Empty>
            : pl.next && <More onClick={() => more("playlists")} left={pl.total - pl.items.length} />
    if (compact) return <>{tiles}{after}</>
    return (
        <div className="flex flex-col gap-[22px] p-[18px] max-[560px]:p-3.5">
            <ForTheme />
            <section aria-label="Your library" className="flex flex-col gap-2.5">
                <div className="flex min-h-7 items-center gap-2">
                    <h3 className="m-0 text-[14px] font-semibold text-foreground">Library</h3>
                    <LibraryHead s={s} />
                </div>
                {tiles}
                {after}
            </section>
        </div>
    )
}

/** The library's heading: how many playlists, and ↻. */
export const LibraryHead = ({ s }: { s: SpotifySnapshot }) => (
    <>
        {s.cache.playlists && <em className="ml-auto text-[12px] text-muted-foreground not-italic">{s.cache.playlists.total} playlists</em>}
        <span className={cn(!s.cache.playlists && "ml-auto")}><Refresh onClick={() => refresh("playlists")} label="Refresh playlists" /></span>
    </>
)

/* ── an opened playlist, album or artist ── */

/** A playlist's cover from what the session has seen of it: the library or a search. */
const playlistArt = (c: SpotifySnapshot["cache"], id: string) =>
    c.playlists?.items.find((p) => p.id === id)?.art ?? c.results?.playlists.find((p) => p.id === id)?.art ?? null

/* a cover's size and shadow; coverBox adds the corners (an artist's is round instead, by Art's prop) */
const coverFit = "size-full shadow-[0_8px_24px_rgba(28,28,26,.14)]"
const coverBox = cn(coverFit, "rounded-[6px]")
const LikedCover = () => (
    <span aria-hidden="true" className={cn(coverBox, "grid place-items-center bg-primary text-primary-foreground")}>
        <Icon name="heart" className="size-1/3" />
    </span>
)

/** The header over an opened list: its cover, ‹ Back, its kind, name and line, then its buttons. */
function OpenHead({ compact, kind, name, line, cover, children }: {
    compact: boolean; kind: string; name: string; line?: ReactNode; cover: ReactNode; children?: ReactNode
}) {
    return (
        <div className={cn("flex flex-wrap items-end", compact ? "gap-3 px-5 pt-3 pb-2" : "gap-[18px] px-[18px] pt-[18px] pb-3 @max-[560px]:gap-3 @max-[560px]:px-3.5")}>
            <span className={cn("flex-none", compact ? "size-16" : "size-[132px] @max-[560px]:size-24")}>{cover}</span>
            <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-1.5">
                <button type="button" onClick={goBack} className={cn(chipButton, "self-start")}>‹ Back</button>
                <span className="text-[12px] text-muted-foreground">{kind}</span>
                <h3 className={cn("m-0 truncate font-serif leading-[1.1] font-medium text-foreground", compact ? "text-[20px]" : "text-[30px] @max-[560px]:text-[22px]")}>{name}</h3>
                {line && <span className="truncate text-[13px] text-ink-2">{line}</span>}
            </div>
            <span className="flex flex-none items-center gap-2">{children}</span>
        </div>
    )
}

/** Play the whole list, with shuffle beside it (the prototype's lines 768–771). */
function PlayAll({ s, label, run }: { s: SpotifySnapshot; label: string; run: () => void }) {
    const p = s.player
    return (
        <>
            <button type="button" onClick={() => { activate(); run() }}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border-0 bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:brightness-110">
                <Icon name="play" className="size-3" />{label}
            </button>
            <button type="button" onClick={() => void toggleShuffle()} disabled={!p.device} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle"
                className={cn(
                    "grid size-10 cursor-pointer place-items-center rounded-full border border-border p-0 hover:border-primary disabled:cursor-default disabled:opacity-45",
                    p.shuffle ? "bg-secondary text-primary" : "bg-transparent text-ink-2 hover:text-primary",
                )}>
                <Icon name="shuffle" className="size-4" />
            </button>
        </>
    )
}

/** The filter inside a list of eight tracks or more, and how many it shows. */
function Filter({ s, items }: { s: SpotifySnapshot; items: Track[] }) {
    const f = s.place.filter || ""
    if (items.length < 8) return null
    const shown = f.trim() ? items.filter((t) => matchesFilter(t, f)).length : 0
    return (
        <label className="mx-4 mb-2 flex h-9 items-center gap-2 rounded-[6px] border border-border px-3 text-[12px] text-muted-foreground focus-within:border-primary">
            <Icon name="filter" className="size-[13px]" />
            <input
                type="search"
                placeholder="Filter this list"
                aria-label="Filter tracks"
                autoComplete="off"
                value={f}
                onChange={(e) => setFilter(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <span className="flex-none font-mono text-[11px]">{f.trim() ? shown + " of " + items.length + " loaded" : ""}</span>
        </label>
    )
}

function TrackPane({ s, cooling, keyName, page, contextUri, list, emptyText, numbered }: ListProps & {
    keyName: string; page: Page<Track> | undefined; contextUri: string | null; list?: string | null; emptyText: string; numbered: boolean
}) {
    if (!page) return <Loading what={s.cache.names[keyName] || "Tracks"} cooling={cooling} />
    if (!page.items.length) return <Empty>{emptyText}</Empty>
    return (
        <>
            <Filter s={s} items={page.items} />
            {numbered && (
                <div aria-hidden="true" className={cn("mx-2 grid h-[30px] items-center gap-3 border-b border-line-2 px-2.5 text-[11.5px] text-muted-foreground", COLUMNS)}>
                    <span>#</span><span>Title</span><span className="@max-[560px]:hidden">Artist</span><span className="text-right">Time</span><span />
                </div>
            )}
            <Tracks s={s} items={page.items} contextUri={contextUri} list={list} filter={s.place.filter} numbered={numbered} />
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

/** The playlist, album or artist open now, with its header; `compact` in the focus panel. */
export function OpenList({ s, cooling, compact = false }: ListProps & { compact?: boolean }) {
    useReopen(s, cooling)
    const place = s.place, c = s.cache

    if (place.pane === "playlist") {
        const id = place.playlistId || "", t = c.tracks[id], liked = id === "liked", ctx = liked ? null : "spotify:playlist:" + id
        return (
            <>
                <OpenHead compact={compact} kind={liked ? "Your saved tracks" : "Playlist"} name={c.names[id] || "Playlist"} line={t ? t.total + " tracks" : null}
                    cover={liked ? <LikedCover /> : <Art src={playlistArt(c, id)} className={coverBox} />}>
                    <Refresh onClick={() => refresh("list")} />
                    {t && t.items.length > 0 && <PlayAll s={s} label="Play all" run={() => void play(null, ctx, liked ? "liked" : null)} />}
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={id} page={t} contextUri={ctx} list={liked ? "liked" : null} emptyText="Nothing in here yet." numbered={!compact} />
            </>
        )
    }
    if (place.pane === "album") {
        const id = place.albumId || "", a = c.albums[id] || { name: "Album", uri: "spotify:album:" + id, artists: "", art: null }, t = c.tracks["album:" + id]
        return (
            <>
                <OpenHead compact={compact} kind="Album" name={a.name} line={a.artists || null} cover={<Art src={a.art} className={coverBox} />}>
                    <Refresh onClick={() => refresh("list")} />
                    <PlayAll s={s} label="Play album" run={() => void play(null, a.uri)} />
                </OpenHead>
                <TrackPane s={s} cooling={cooling} keyName={"album:" + id} page={t} contextUri={a.uri} emptyText="This album has no tracks Spotify will play." numbered={!compact} />
            </>
        )
    }
    const id = place.artistId || "", a = c.artists[id] || { name: "Artist", uri: "spotify:artist:" + id, art: null }, list = c.artistAlbums[id]
    return (
        <>
            <OpenHead compact={compact} kind="Artist" name={a.name} cover={<Art src={a.art} round className={coverFit} />}>
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
