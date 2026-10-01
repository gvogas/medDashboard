// The music, folded into one line: the cover, the track and artist over a thin progress
// line, ⏮ ❚❚ ⏭, the device, and ▴ Music to open the rest. Not connected: Connect Spotify.
// Nothing playing: "Pick something to play ▴". The cooldown or a failed command: the short
// note in place of the artist. Glass on the focus screen; `tone="page"` on the Music page
// on a phone, where ▴ Music opens the player card and the page shows the note.

import { cn } from "@/lib/utils"
import { activate, control, cooldownMessage, previous, useSpotify } from "@/data/spotify"
import { Art, controlError, FX, GLASS, Icon, SpotifyMark } from "@/components/spotify/bits"
import { useCooling } from "@/components/spotify/use-music"

export interface MusicPillProps {
    /** ▴ Music (or "Pick something to play ▴"): open the player. */
    onOpen: () => void
    /** The player is open: the pill says ▾ and aria-expanded. */
    open?: boolean
    tone?: "glass" | "page"
    className?: string
}

const round = "grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-ink-2 hover:text-primary"
const chip = "inline-flex max-w-[160px] min-w-0 flex-none items-center gap-1 rounded-full border border-border bg-[var(--panel)] px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-ink-2"

export function MusicPill({ onOpen, open = false, tone = "glass", className }: MusicPillProps) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const p = s.player, t = p.track
    /* on the Music page, the page says it above the pill */
    const note = tone === "page" ? null : cooling ? cooldownMessage(s.retryAt) : s.note && !s.note.ok ? s.note.text : controlError(p.error)
    const pct = t && t.durationMs ? Math.min(100, (t.progressMs / t.durationMs) * 100) : 0

    const shell = cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-1.5 text-[12.5px]",
        tone === "glass" ? cn(FX, GLASS) : "border border-border bg-card text-foreground shadow-[var(--shadow-1)]",
        p.stale && "opacity-70",
        className,
    )
    const toggle = (label: string) => (
        <button
            type="button"
            aria-expanded={open}
            onClick={onOpen}
            className={cn(chip, "cursor-pointer text-foreground hover:border-primary hover:text-primary")}
        >
            {open ? "▾" : "▴"} {label}
        </button>
    )

    if (!p.loaded) {
        return (
            <div role="region" aria-label="Music" className={shell}>
                <SpotifyMark className="ml-1.5 size-5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">Checking your connection…</span>
            </div>
        )
    }
    if (!p.connected) {
        return (
            <div role="region" aria-label="Music" className={shell}>
                <SpotifyMark className="ml-1.5 size-5" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">Spotify is not connected</span>
                <a href="/api/spotify/connect" className={cn(chip, "border-primary bg-primary text-primary-foreground no-underline hover:brightness-110")}>Connect Spotify</a>
            </div>
        )
    }
    if (!t) {
        return (
            <div role="region" aria-label="Music" className={shell}>
                <SpotifyMark className="ml-1.5 size-5" />
                <button type="button" aria-expanded={open} onClick={onOpen}
                    className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-ink-2 hover:text-primary">
                    {note || (open ? "Pick something to play ▾" : "Pick something to play ▴")}
                </button>
                {s.target === "here" && (
                    <button type="button" aria-label="Play in Term" title="Play in Term" className={round} onClick={() => { activate(); void control("play") }}>
                        <Icon name="play" />
                    </button>
                )}
                {p.device && <span className={chip}><span aria-hidden="true">🔈</span><span className="truncate">{p.device}</span></span>}
            </div>
        )
    }
    return (
        <div role="region" aria-label="Music" className={shell}>
            <Art src={t.art} round className="size-[30px]" />
            <div className="min-w-0 flex-1">
                <span className="block truncate" title={note || undefined}>
                    <b className="font-semibold text-foreground">{t.title}</b>
                    {note
                        ? <span role="status" className="text-[var(--warn-ink)]"> · {note}</span>
                        : <span className="text-muted-foreground"> · {t.artists}</span>}
                </span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-line-2">
                    <i className="block h-full rounded-full bg-foreground" style={{ width: pct + "%" }} />
                </span>
            </div>
            <span className="flex flex-none items-center">
                <button type="button" aria-label="Previous" className={round} onClick={() => { activate(); void previous() }}><Icon name="prev" /></button>
                <button type="button" aria-label={p.playing ? "Pause" : "Play"} className={round} onClick={() => { activate(); void control(p.playing ? "pause" : "play") }}>
                    <Icon name={p.playing ? "pause" : "play"} />
                </button>
                <button type="button" aria-label="Next" className={round} onClick={() => { activate(); void control("next") }}><Icon name="next" /></button>
            </span>
            {p.device && <span className={cn(chip, "max-[560px]:hidden")}><span aria-hidden="true">🔈</span><span className="truncate">{p.device}</span></span>}
            {toggle("Music")}
        </div>
    )
}
