// Finding music: a search box (/ focuses it on the Music page, Enter searches) over the
// library's covers, an opened playlist, album or artist, or search results. `compact` (the
// focus panel) adds the Up next and Recent tabs and puts three covers across; the page has
// those in its left card (<UpNextRecent>). The open place is `ui.spotify`, shared by both.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ensureMe, openHome, openQueue, openRecent, search, typed, useSpotify, type SpotifyPlace } from "@/data/spotify"
import { chipButton, Icon, SpotifyMark } from "./bits"
import { Library, LibraryHead, OpenList, QueueActions, QueueList, RecentActions, RecentList, Results } from "./lists"
import { openRoot, useCooling } from "./use-music"

export interface TabDef<T extends string> { id: T; label: string }

/** A row of tabs as pressed buttons: a segmented switch on the page, pills on the focus screen. */
export function Tabs<T extends string>({ tabs, value, onPick, label, tone = "segment" }: {
    tabs: TabDef<T>[]; value: T | null; onPick: (id: T) => void; label: string; tone?: "segment" | "pills"
}) {
    const pills = tone === "pills"
    return (
        <div role="group" aria-label={label} className={cn("flex flex-none", pills ? "gap-1" : "gap-0.5 rounded-[6px] bg-[var(--chip-bg)] p-0.5")}>
            {tabs.map((t) => {
                const on = value === t.id
                return (
                    <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => onPick(t.id)}
                        className={cn(
                            "cursor-pointer border-0 text-[12.5px] whitespace-nowrap",
                            pills ? "h-[30px] rounded-full px-3" : "h-[26px] rounded-[4px] px-2.5",
                            on
                                ? pills ? "bg-white/[.18] font-semibold text-foreground" : "bg-card font-semibold text-foreground shadow-[0_0_0_1px_var(--line)]"
                                : "bg-transparent text-ink-2 hover:text-foreground",
                        )}
                    >
                        {t.label}
                    </button>
                )
            })}
        </div>
    )
}

/** The search box. What is typed searches after a pause; Enter at once. On the page (`page`)
    the / hint and "Spotify" beside it. */
function SearchBox({ q, page }: { q: string; page: boolean }) {
    const [value, setValue] = useState(q)
    const box = useRef<HTMLInputElement>(null)
    /* a search started elsewhere (the other place the browser shows, the theme's pick) fills the box, unless it is being typed in */
    useEffect(() => { if (document.activeElement !== box.current) setValue(q) }, [q])

    return (
        <form
            role="search"
            onSubmit={(e) => {
                e.preventDefault()
                typed("")                                   /* no delayed search after this one */
                openRoot(() => search(value))
            }}
            className="flex min-w-0 flex-1 basis-[240px] items-center gap-2"
        >
            <label className="group/search flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-border px-3.5 text-muted-foreground focus-within:border-primary">
                <Icon name="search" className="size-[15px]" />
                <input
                    ref={box}
                    type="search"
                    name="q"
                    data-music-search=""
                    placeholder="Songs, artists, albums, playlists"
                    aria-label="Search Spotify"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => { setValue(e.target.value); typed(e.target.value) }}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                {page && <kbd title="Press / to search" className="flex-none rounded border border-border px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground group-focus-within/search:hidden">/</kbd>}
            </label>
            <button type="submit" className="h-10 flex-none cursor-pointer rounded-full border-0 bg-foreground px-[18px] text-[13px] font-medium text-background hover:bg-primary hover:text-primary-foreground">Search</button>
            {page && <span className="ml-1.5 flex flex-none items-center gap-1.5 text-[12px] text-ink-2 max-[560px]:hidden"><SpotifyMark className="size-4" />Spotify</span>}
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
    useEffect(() => { if (!document.hidden) ensureMe() }, [s, cooling])

    /* Each list keeps its scroll: back from a playlist to the library lands where you were. */
    const scroller = useRef<HTMLDivElement>(null)
    const scrolls = useRef(new Map<string, number>())
    const key = placeKey(s.place)
    useLayoutEffect(() => {
        if (scroller.current) scroller.current.scrollTop = scrolls.current.get(key) ?? 0
    }, [key])

    const pick = (t: Tab) => openRoot(() => t === "queue" ? openQueue(true) : t === "recent" ? openRecent() : openHome())

    let head: ReactNode = null
    /* on the page the library heads its own list, under the theme's pick */
    if (what === "library") head = compact ? <Heading title="Library"><LibraryHead s={s} /></Heading> : null
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
            <div className={cn("flex flex-none flex-col gap-2.5 border-b border-line-2", compact ? "px-5 pt-3 pb-2.5" : "px-[18px] py-3.5 max-[560px]:px-3.5")}>
                {compact && <Tabs label="Music" tabs={TABS} value={tab} onPick={pick} />}
                <SearchBox q={s.place.q} page={!compact} />
                {head}
            </div>
            <div
                ref={scroller}
                onScroll={(e) => { scrolls.current.set(key, e.currentTarget.scrollTop) }}
                className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
                {what === "open" && <OpenList s={s} cooling={cooling} compact={compact} />}
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
            <h3 className="m-0 text-[14px] font-semibold text-foreground">{title}</h3>
            {note && <span className="min-w-0 truncate text-[12px] text-muted-foreground">{note}</span>}
            {children}
        </div>
    )
}

type Side = "queue" | "recent"
const SIDE_TABS: TabDef<Side>[] = [{ id: "queue", label: "Up next" }, { id: "recent", label: "Recent" }]

/** The Music page's left card, under <NowPlaying>: Up next or Recently played, with how many beside. */
export function UpNextRecent() {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const [side, setSide] = useState<Side>("queue")
    const note = side === "queue"
        ? s.cache.queue ? s.cache.queue.queue.length + " queued" : null
        : s.cache.recent?.items.length ? "Last " + s.cache.recent.items.length : null
    return (
        <section aria-label="Up next and recent" className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 pb-2">
                <Tabs label="Show" tabs={SIDE_TABS} value={side} onPick={setSide} />
                <span className="ml-auto flex items-center gap-2">
                    {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
                    {side === "queue" ? <QueueActions /> : <RecentActions s={s} />}
                </span>
            </div>
            <div className="-mx-3">
                {side === "queue" ? <QueueList s={s} cooling={cooling} /> : <RecentList s={s} cooling={cooling} />}
            </div>
        </section>
    )
}
