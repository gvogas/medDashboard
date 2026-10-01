// The rows of the music's lists: a track, an album, an artist, a playlist, and the cover
// tiles of the library. Each is memoised on what it shows: the progress line moves every
// second while music plays, and a long playlist must not redraw with it. A track in an
// opened list on the Music page has its number (`n`) and the list's columns (the
// prototype's lines 779–790); under 560px of list (a container query) the artist goes.

import { memo } from "react"
import { cn } from "@/lib/utils"
import { activate, openAlbum, openArtist, openPlaylist, play, queueAdd, type Album, type Artist, type Playlist, type Track } from "@/data/spotify"
import { openFrom } from "./use-music"
import { Art, Eq, Icon, mmss } from "./bits"

const row = "group/row mx-2 flex h-12 items-center gap-2.5 rounded-[6px] px-2.5 text-[13px]"
const rowHover = "hover:bg-line-2"
const what = "min-w-0 flex-1 leading-[1.3]"
const line1 = "block truncate font-normal text-foreground"
const line2 = "block truncate text-[12px] text-muted-foreground"
const acts = "flex flex-none justify-end gap-0.5"
const act = "grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[15px] leading-none text-foreground hover:bg-border hover:text-primary pointer-coarse:size-10"
/* an opened list's columns: #, title, artist, time, the buttons; the header in lists.tsx uses the same */
export const COLUMNS = "[grid-template-columns:28px_minmax(0,1fr)_minmax(0,.7fr)_52px_72px] @max-[560px]:[grid-template-columns:28px_minmax(0,1fr)_44px_72px]"

/** Play inside the click, so the Term tab may make sound. */
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
    /* its number in an opened list on the Music page: the columns' layout */
    n?: number
}

export const TrackRow = memo(function TrackRow({ t, now, playing, queued, contextUri = null, list = null, hidden = false, n }: TrackRowProps) {
    const sub = t.artists + (t.album ? " · " + t.album : "")
    const buttons = (
        <span className={acts}>
            <button type="button" title="Play" aria-label={"Play " + t.title} className={act} onClick={() => playNow(t.uri, contextUri, list)}>
                <Icon name="play" className="size-3" />
            </button>
            <button
                type="button"
                title="Add to queue"
                aria-label={"Queue " + t.title}
                disabled={queued}
                onClick={() => { if (t.uri) void queueAdd(t.uri) }}
                className={cn(act, queued && "cursor-default text-[var(--good)] hover:bg-transparent hover:text-[var(--good)]")}
            >
                {queued ? "✓" : "+"}
            </button>
        </span>
    )
    if (n != null) {
        return (
            <div hidden={hidden} data-now={now || undefined} className={cn(
                "group/row mx-2 grid h-12 items-center gap-3 rounded-[6px] px-2.5", COLUMNS,
                now ? "bg-secondary" : rowHover,
                hidden && "hidden",
            )}>
                <span className={cn("font-mono text-[12px]", now ? "text-primary" : "text-muted-foreground")}>{now && playing ? <Eq /> : n}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                    <Art src={t.art} className="size-8 rounded-[4px]" />
                    <b className={cn("truncate text-[13.5px]", now ? "font-semibold text-primary" : "font-normal text-foreground")}>{t.title}</b>
                </span>
                <span className="truncate text-[13px] text-ink-2 @max-[560px]:hidden">{sub}</span>
                <span className="text-right font-mono text-[12px] text-muted-foreground">{mmss(t.durationMs)}</span>
                {buttons}
            </div>
        )
    }
    return (
        <div hidden={hidden} data-now={now || undefined} className={cn(row, now ? "bg-secondary" : rowHover, hidden && "hidden")}>
            <Art src={t.art} className="size-9 rounded-[4px]" />
            <div className={what}>
                <b className={cn(line1, now && "font-semibold text-primary")}>{t.title}</b>
                <span className={line2}>{sub}</span>
            </div>
            <span className="w-10 flex-none text-right font-mono text-[11.5px] text-muted-foreground">
                {now && playing ? <Eq /> : mmss(t.durationMs)}
            </span>
            {buttons}
        </div>
    )
})

export const AlbumRow = memo(function AlbumRow({ a }: { a: Album }) {
    return (
        <div className={cn(row, rowHover)}>
            <Art src={a.art} className="size-9 rounded-[4px]" />
            <div className={what}>
                <b className={line1}>{a.name}</b>
                <span className={line2}>{a.artists}{a.count ? " · " + a.count + (a.count === 1 ? " track" : " tracks") : ""}</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play album" aria-label={"Play " + a.name} className={act} onClick={() => playNow(null, a.uri)}><Icon name="play" className="size-3" /></button>
                <button type="button" title="Open" aria-label={"Open " + a.name} className={act} onClick={() => openFrom(() => openAlbum(a.id))}>›</button>
            </span>
        </div>
    )
})

export const ArtistRow = memo(function ArtistRow({ a }: { a: Artist }) {
    return (
        <div className={cn(row, rowHover)}>
            <Art src={a.art} round className="size-9" />
            <div className={what}>
                <b className={line1}>{a.name}</b>
                <span className={line2}>Artist</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play artist" aria-label={"Play " + a.name} className={act} onClick={() => playNow(null, a.uri)}><Icon name="play" className="size-3" /></button>
                <button type="button" title="Open" aria-label={"Open " + a.name} className={act} onClick={() => openFrom(() => openArtist(a.id))}>›</button>
            </span>
        </div>
    )
})

const playlistLine = (p: Playlist) => [p.owner, p.count == null ? "" : p.count + " tracks"].filter(Boolean).join(" · ")

export const PlaylistRow = memo(function PlaylistRow({ p, openable }: { p: Playlist; openable: boolean }) {
    return (
        <div className={cn(row, rowHover)}>
            <Art src={p.art} className="size-9 rounded-[4px]" />
            <div className={what}>
                <b className={line1}>{p.name}</b>
                <span className={line2}>{playlistLine(p)}</span>
            </div>
            <span className={acts}>
                <button type="button" title="Play playlist" aria-label={"Play " + p.name} className={act} onClick={() => playNow(null, p.uri)}><Icon name="play" className="size-3" /></button>
                {openable && <button type="button" title="Open" aria-label={"Open " + p.name} className={act} onClick={() => openFrom(() => openPlaylist(p.id, p.name))}>›</button>}
            </span>
        </div>
    )
})

/* ── the library's cover grid (the prototype's lines 740–752) ── */

const tile = "group/tile relative flex min-w-0 flex-col text-left"
const tileButton = "flex min-w-0 cursor-pointer flex-col gap-2 rounded-[6px] border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
const cover = "aspect-square w-full rounded-[6px]"
const tileName = "truncate text-[13px] font-semibold text-foreground"
const tileLine = "truncate text-[12px] text-muted-foreground"

/* ▶ sits on the cover's corner: a square over the tile's top, the button in its corner */
function PlayOnCover({ name, onPlay }: { name: string; onPlay: () => void }) {
    return (
        <span className="pointer-events-none absolute inset-x-0 top-0 flex aspect-square items-end justify-end p-2">
            <button
                type="button"
                title={"Play " + name}
                aria-label={"Play " + name}
                onClick={onPlay}
                className="pointer-events-auto grid size-9 cursor-pointer place-items-center rounded-full border-0 bg-primary p-0 text-primary-foreground opacity-0 shadow-[0_6px_14px_-4px_rgba(0,0,0,.5)] group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >
                <Icon name="play" className="size-3.5" />
            </button>
        </span>
    )
}

/** Liked Songs: a heart on the accent, opening the saved tracks; `total` once they are loaded. */
export const LikedTile = memo(function LikedTile({ total }: { total: number | null }) {
    return (
        <div className={tile}>
            <button type="button" aria-label="Open Liked Songs" className={tileButton} onClick={() => openFrom(() => openPlaylist("liked", "Liked Songs"))}>
                <span aria-hidden="true" className={cn(cover, "grid place-items-center bg-primary text-primary-foreground")}>
                    <Icon name="heart" className="size-10" />
                </span>
                <span className="flex min-w-0 flex-col">
                    <b className={tileName}>Liked Songs</b>
                    <span className={tileLine}>{total == null ? "Your saved tracks" : total + " songs"}</span>
                </span>
            </button>
            {/* Liked Songs has no context: it plays the tracks loaded, so only once they are */}
            {!!total && <PlayOnCover name="Liked Songs" onPlay={() => playNow(null, null, "liked")} />}
        </div>
    )
})

/** A playlist: opens it when Spotify lets Term, else plays it. */
export const PlaylistTile = memo(function PlaylistTile({ p, openable }: { p: Playlist; openable: boolean }) {
    const sub = [p.owner, p.count == null ? "" : String(p.count)].filter(Boolean).join(" · ")
    return (
        <div className={tile}>
            <button
                type="button"
                aria-label={(openable ? "Open " : "Play ") + p.name}
                title={openable ? undefined : "Spotify only lets Term open playlists you made or collaborate on; this one plays."}
                className={tileButton}
                onClick={() => openable ? openFrom(() => openPlaylist(p.id, p.name)) : playNow(null, p.uri)}
            >
                <Art src={p.art} className={cover} />
                <span className="flex min-w-0 flex-col">
                    <b className={tileName}>{p.name}</b>
                    <span className={tileLine}>{sub || " "}</span>
                </span>
            </button>
            {openable && <PlayOnCover name={p.name} onPlay={() => playNow(null, p.uri)} />}
        </div>
    )
})
