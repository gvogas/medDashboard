// The rows of the music's lists: a track, an album, an artist, a playlist, and the cover
// tiles of the library. Each is memoised on what it shows: the progress line moves every
// second while music plays, and a long playlist must not redraw with it.

import { memo } from "react"
import { cn } from "@/lib/utils"
import { activate, openAlbum, openArtist, openPlaylist, play, queueAdd, type Album, type Artist, type Playlist, type Track } from "@/data/spotify"
import { openFrom } from "./use-music"
import { Art, Eq, mmss } from "./bits"

const row = "group/row flex items-center gap-2.5 border-t border-line-2 px-3.5 py-1.5 text-[12.5px] first:border-t-0 hover:bg-muted"
const what = "min-w-0 flex-1 leading-[1.3]"
const line1 = "block truncate font-semibold text-foreground"
const line2 = "block truncate text-[11px] text-ink-2"
/* the row's buttons: faint until the row is pointed at or focused, always there on touch */
const acts = "flex flex-none gap-1 opacity-35 group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
const act = "grid size-[26px] cursor-pointer place-items-center rounded-full border border-border bg-card p-0 text-[11px] text-ink-2 hover:border-primary hover:text-primary pointer-coarse:size-9"

/** Play inside the click, so the Rounds tab may make sound. */
function playNow(uri: string | null, contextUri?: string | null, list?: string | null) {
    activate()
    void play(uri, contextUri, list)
}

interface TrackRowProps {
    t: Track
    now: boolean
    playing: boolean
    queued: boolean
    /* what to play it within: a playlist or album, or a list Spotify has no context for */
    contextUri?: string | null
    list?: string | null
    hidden?: boolean
}

export const TrackRow = memo(function TrackRow({ t, now, playing, queued, contextUri = null, list = null, hidden = false }: TrackRowProps) {
    return (
        <div hidden={hidden} data-now={now || undefined} className={cn(row, now && "bg-[color-mix(in_srgb,var(--spotify)_8%,var(--panel))]", hidden && "hidden")}>
            <Art src={t.art} className="size-[34px]" />
            <div className={what}>
                <b className={cn(line1, now && "text-accent-foreground")}>{t.title}</b>
                <span className={line2}>{t.artists}{t.album ? " · " + t.album : ""}</span>
            </div>
            <span className="w-[38px] flex-none text-right font-mono text-[11px] text-muted-foreground">
                {now && playing ? <Eq /> : mmss(t.durationMs)}
            </span>
            <span className={acts}>
                <button type="button" title="Play" aria-label={"Play " + t.title} className={act} onClick={() => playNow(t.uri, contextUri, list)}>▶</button>
                <button
                    type="button"
                    title="Add to queue"
                    aria-label={"Queue " + t.title}
                    disabled={queued}
                    onClick={() => { if (t.uri) void queueAdd(t.uri) }}
                    className={cn(act, queued && "cursor-default border-[var(--good)] text-[var(--good)] opacity-100 hover:border-[var(--good)] hover:text-[var(--good)]")}
                >
                    {queued ? "✓" : "+"}
                </button>
            </span>
        </div>
    )
})

export const AlbumRow = memo(function AlbumRow({ a }: { a: Album }) {
    return (
        <div className={row}>
            <Art src={a.art} className="size-[34px]" />
            <div className={what}>
                <b className={line1}>{a.name}</b>
                <span className={line2}>{a.artists}{a.count ? " · " + a.count + (a.count === 1 ? " track" : " tracks") : ""}</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play album" aria-label={"Play " + a.name} className={act} onClick={() => playNow(null, a.uri)}>▶</button>
                <button type="button" title="Open" aria-label={"Open " + a.name} className={act} onClick={() => openFrom(() => openAlbum(a.id))}>›</button>
            </span>
        </div>
    )
})

export const ArtistRow = memo(function ArtistRow({ a }: { a: Artist }) {
    return (
        <div className={row}>
            <Art src={a.art} round className="size-[34px]" />
            <div className={what}>
                <b className={line1}>{a.name}</b>
                <span className={line2}>Artist</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play artist" aria-label={"Play " + a.name} className={act} onClick={() => playNow(null, a.uri)}>▶</button>
                <button type="button" title="Open" aria-label={"Open " + a.name} className={act} onClick={() => openFrom(() => openArtist(a.id))}>›</button>
            </span>
        </div>
    )
})

const playlistLine = (p: Playlist) => [p.owner, p.count == null ? "" : p.count + " tracks"].filter(Boolean).join(" · ")

export const PlaylistRow = memo(function PlaylistRow({ p, openable }: { p: Playlist; openable: boolean }) {
    return (
        <div className={row}>
            <Art src={p.art} className="size-[34px]" />
            <div className={what}>
                <b className={line1}>{p.name}</b>
                <span className={line2}>{playlistLine(p)}</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play playlist" aria-label={"Play " + p.name} className={act} onClick={() => playNow(null, p.uri)}>▶</button>
                {openable && <button type="button" title="Open" aria-label={"Open " + p.name} className={act} onClick={() => openFrom(() => openPlaylist(p.id, p.name))}>›</button>}
            </span>
        </div>
    )
})

/* ── the library's cover grid ── */

const tile = "group/tile relative flex min-w-0 flex-col gap-1 text-left"
const tileButton = "flex min-w-0 cursor-pointer flex-col gap-1 rounded-[9px] border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
const cover = "aspect-square w-full rounded-[8px] shadow-[0_6px_16px_-10px_rgba(0,0,0,.45)] transition-transform duration-200 group-hover/tile:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover/tile:translate-y-0"
/* ▶ sits on the cover's corner: a square over the tile's top, the button in its corner */
function PlayOnCover({ name, onPlay }: { name: string; onPlay: () => void }) {
    return (
        <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-square items-end justify-end p-1.5">
            <button
                type="button"
                title={"Play " + name}
                aria-label={"Play " + name}
                onClick={onPlay}
                className="pointer-events-auto grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-[var(--spotify)] p-0 text-[11px] text-white opacity-0 shadow-[0_6px_14px_-4px_rgba(0,0,0,.5)] group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >▶</button>
        </span>
    )
}

/** Liked Songs: a heart on the accent, opening the saved tracks; `total` once they are loaded. */
export const LikedTile = memo(function LikedTile({ total }: { total: number | null }) {
    return (
        <div className={tile}>
            <button type="button" aria-label="Open Liked Songs" className={tileButton} onClick={() => openFrom(() => openPlaylist("liked", "Liked Songs"))}>
                <span aria-hidden="true" className={cn(cover, "grid place-items-center bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_65%,#fff),var(--accent)_55%,color-mix(in_srgb,var(--accent)_55%,#000))] text-[28px] text-white")}>♥</span>
                <b className="truncate text-[12px] font-semibold text-foreground">Liked Songs</b>
                <span className="truncate text-[11px] text-muted-foreground">{total == null ? "Your saved tracks" : total + " songs"}</span>
            </button>
            {/* Liked Songs has no context: it plays the tracks loaded, so only once they are */}
            {!!total && <PlayOnCover name="Liked Songs" onPlay={() => playNow(null, null, "liked")} />}
        </div>
    )
})

/** A playlist: opens it when Spotify lets Rounds, else plays it. */
export const PlaylistTile = memo(function PlaylistTile({ p, openable }: { p: Playlist; openable: boolean }) {
    const sub = [p.owner, p.count == null ? "" : String(p.count)].filter(Boolean).join(" · ")
    return (
        <div className={tile}>
            <button
                type="button"
                aria-label={(openable ? "Open " : "Play ") + p.name}
                title={openable ? undefined : "Spotify only lets Rounds open playlists you made or collaborate on; this one plays."}
                className={tileButton}
                onClick={() => openable ? openFrom(() => openPlaylist(p.id, p.name)) : playNow(null, p.uri)}
            >
                <Art src={p.art} className={cover} />
                <b className="truncate text-[12px] font-semibold text-foreground">{p.name}</b>
                <span className="truncate text-[11px] text-muted-foreground">{sub || " "}</span>
            </button>
            {openable && <PlayOnCover name={p.name} onPlay={() => playNow(null, p.uri)} />}
        </div>
    )
})
