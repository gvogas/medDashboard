// Finding music: a search box (/ focuses it on the Spotify page, Enter searches) over the
// library's covers, an opened playlist, album or artist, or search results. `compact` (the
// focus panel) adds the Up next and Recent tabs and puts three covers across; the page has
// those in its left card (<UpNextRecent>). The open place is `ui.spotify`, shared by both.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ensureMe, openHome, openQueue, openRecent, search, typed, useSpotify, type SpotifyPlace } from "@/data/spotify"
import { chipButton, SpotifyMark } from "./bits"
import { Library, LibraryHead, OpenList, QueueActions, QueueList, RecentActions, RecentList, Results } from "./lists"
import { openRoot, useCooling } from "./use-music"

export interface TabDef<T extends string> { id: T; label: string }

/** A row of tabs as pressed buttons, like the week's Everything / Deadlines / Classes. */
export function Tabs<T extends string>({ tabs, value, onPick, label }: { tabs: TabDef<T>[]; value: T | null; onPick: (id: T) => void; label: string }) {
    return (
        <div role="group" aria-label={label} className="flex flex-none rounded-full border border-line-2 bg-muted p-0.5">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    aria-pressed={value === t.id}
                    onClick={() => onPick(t.id)}
                    className={cn(
                        "cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground",
                        value === t.id && "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,.12)]",
                    )}
                >
                    {t.label}
                </button>
            ))}
        </div>
    )
}

/** The search box. What is typed searches after a pause; Enter at once. */
function SearchBox({ q, hint }: { q: string; hint: boolean }) {
    const [value, setValue] = useState(q)
    const box = useRef<HTMLInputElement>(null)
    /* a search started elsewhere (the other place the browser shows) fills the box, unless it is being typed in */
    useEffect(() => { if (document.activeElement !== box.current) setValue(q) }, [q])

    return (
        <form
            role="search"
            onSubmit={(e) => {
                e.preventDefault()
                typed("")                                   /* no delayed search after this one */
                openRoot(() => search(value))
            }}
            className="group/search flex min-w-0 flex-1 basis-[220px] items-center gap-2 rounded-full border border-border bg-muted py-1 pr-1 pl-3 focus-within:border-primary"
        >
            <SpotifyMark className="size-4" />
            <input
                ref={box}
                type="search"
                name="q"
                data-music-search=""
                placeholder="Search tracks, artists, albums, playlists"
                aria-label="Search Spotify"
                autoComplete="off"
                value={value}
                onChange={(e) => { setValue(e.target.value); typed(e.target.value) }}
                className="min-w-0 flex-1 border-0 bg-transparent py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {hint && <kbd title="Press / to search" className="flex-none rounded border border-border px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground group-focus-within/search:hidden">/</kbd>}
            <button type="submit" className="flex-none cursor-pointer rounded-full border-0 bg-primary px-3 py-1 text-[12px] font-bold text-primary-foreground hover:brightness-110">Search</button>
        </form>
    )
}

type Tab = "queue" | "recent" | "library"
const TABS: TabDef<Tab>[] = [{ id: "queue", label: "Up next" }, { id: "recent", label: "Recent" }, { id: "library", label: "Library" }]

/** Which list a place shows, as the browser draws it. */
function shown(pane: SpotifyPlace["pane"], compact: boolean) {
    if (pane === "playlist" || pane === "album" || pane === "artist") return "open"
    if (pane === "search") return "search"
    if (compact && (pane === "queue" || pane === "recent")) return pane
    return "library"
}

/** A key for the list open now: each keeps its own scroll. */
const placeKey = (p: SpotifyPlace) =>
    p.pane + ":" + (p.pane === "playlist" ? p.playlistId : p.pane === "album" ? p.albumId : p.pane === "artist" ? p.artistId : p.pane === "search" ? p.q : "")

export function MusicBrowser({ compact = false }: { compact?: boolean }) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const what = shown(s.place.pane, compact)
    const tab: Tab | null = what === "queue" || what === "recent" ? what : what === "search" ? null : "library"
    /* who the account is: only its own playlists (and those it collaborates on) open */
    useEffect(() => { ensureMe() }, [s, cooling])

    /* Each list keeps its scroll: back from a playlist to the library lands where you were. */
    const scroller = useRef<HTMLDivElement>(null)
    const scrolls = useRef(new Map<string, number>())
    const key = placeKey(s.place)
    useLayoutEffect(() => {
        if (scroller.current) scroller.current.scrollTop = scrolls.current.get(key) ?? 0
    }, [key])

    const pick = (t: Tab) => openRoot(() => t === "queue" ? openQueue(true) : t === "recent" ? openRecent() : openHome())

    let head: ReactNode = null
    if (what === "library") head = <Heading title="Library"><LibraryHead s={s} /></Heading>
    else if (what === "queue") head = <Heading title="Up next"><span className="ml-auto"><QueueActions /></span></Heading>
    else if (what === "recent") head = <Heading title="Recently played"><span className="ml-auto"><RecentActions s={s} /></span></Heading>
    else if (what === "search") {
        head = (
            <Heading title="Results" note={s.cache.results ? "for “" + s.cache.results.q + "”" : undefined}>
                <button type="button" onClick={() => openRoot(openHome)} className={cn(chipButton, "ml-auto")}>‹ Library</button>
            </Heading>
        )
    }

    return (
        <section aria-label="Find music" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-col gap-2.5 border-b border-line-2 px-3.5 pt-3 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                    {compact && <Tabs label="Music" tabs={TABS} value={tab} onPick={pick} />}
                    <SearchBox q={s.place.q} hint={!compact} />
                </div>
                {head}
            </div>
            <div
                ref={scroller}
                onScroll={(e) => { scrolls.current.set(key, e.currentTarget.scrollTop) }}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
                {what === "open" && <OpenList s={s} cooling={cooling} />}
                {what === "search" && <Results s={s} cooling={cooling} />}
                {what === "queue" && <QueueList s={s} cooling={cooling} />}
                {what === "recent" && <RecentList s={s} cooling={cooling} />}
                {what === "library" && <Library s={s} cooling={cooling} compact={compact} />}
            </div>
        </section>
    )
}

function Heading({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
    return (
        <div className="flex min-h-7 items-center gap-2">
            <h3 className="m-0 text-[11px] font-bold tracking-[.1em] text-ink-2 uppercase">{title}</h3>
            {note && <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{note}</span>}
            {children}
        </div>
    )
}

type Side = "queue" | "recent"
const SIDE_TABS: TabDef<Side>[] = [{ id: "queue", label: "Up next" }, { id: "recent", label: "Recent" }]

/** The Spotify page's left card, under <NowPlaying>: Up next or Recently played. */
export function UpNextRecent() {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const [side, setSide] = useState<Side>("queue")
    return (
        <section aria-label="Up next and recent" className="flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center gap-2 pb-1.5">
                <Tabs label="Show" tabs={SIDE_TABS} value={side} onPick={setSide} />
                <span className="ml-auto flex items-center gap-1.5">
                    {side === "queue" && s.cache.queue && <em className="text-[10.5px] text-muted-foreground not-italic">{s.cache.queue.queue.length} next</em>}
                    {side === "queue" ? <QueueActions /> : <RecentActions s={s} />}
                </span>
            </div>
            <div className="-mx-3.5">
                {side === "queue" ? <QueueList s={s} cooling={cooling} /> : <RecentList s={s} cooling={cooling} />}
            </div>
        </section>
    )
}
