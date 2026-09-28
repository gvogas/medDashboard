// What plays and how: the cover, the title and artist, the progress (not seekable),
// shuffle, previous, play or pause, next, repeat, the device and the volume. The Spotify
// page shows it big in its left card; the focus panel `compact`, the cover beside the title.

import { cn } from "@/lib/utils"
import {
    activate, control, cycleRepeat, playHere, previous, toggleShuffle, useSpotify,
} from "@/data/spotify"
import { Art, controlError, Icon, mmss, REPEAT_LABEL, SpotifyMark } from "./bits"
import { Devices, Volume } from "./devices"
import { useCooling } from "./use-music"

const mode = "grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-[15px] text-muted-foreground hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted-foreground"
const skip = "grid size-9 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-ink-2 hover:text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:text-ink-2"

export function NowPlaying({ compact = false }: { compact?: boolean }) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const p = s.player, t = p.track
    const live = !!p.device
    const canPlay = !!t || s.target === "here"
    const pct = t && t.durationMs ? Math.min(100, (t.progressMs / t.durationMs) * 100) : 0
    const error = controlError(p.error)

    const title = t
        ? t.url
            ? <a href={t.url} target="_blank" rel="noopener" title="Open in Spotify" className="block truncate font-bold text-foreground no-underline hover:text-primary hover:underline">{t.title}</a>
            : <b className="block truncate font-bold text-foreground">{t.title}</b>
        : <b className="block truncate font-bold text-foreground">Nothing playing</b>
    const sub = t ? t.artists + (t.album ? " · " + t.album : "") : "Pick something to play from your library, or search."

    const cover = t?.art
        ? <Art src={t.art} className={compact ? "size-14 rounded-[8px]" : "aspect-[3/2] w-full rounded-[10px]"} />
        : (
            <span aria-hidden="true" className={cn("grid flex-none place-items-center bg-muted", compact ? "size-14 rounded-[8px]" : "aspect-[3/2] w-full rounded-[10px]")}>
                <SpotifyMark className={compact ? "size-6" : "size-10"} />
            </span>
        )

    const progress = (
        <div className={cn(!t && "invisible")}>
            <span className="block h-[3px] overflow-hidden rounded-full bg-line-2">
                <i className="block h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--spotify))]" style={{ width: pct + "%" }} />
            </span>
            <span className="mt-1 flex justify-between font-mono text-[10.5px] text-muted-foreground">
                <span>{mmss(t?.progressMs ?? 0)}</span>
                <span>{mmss(t?.durationMs ?? 0)}</span>
            </span>
        </div>
    )

    return (
        <section aria-label="Now playing" className={cn("flex min-w-0 flex-col", compact ? "gap-2.5" : "gap-3", p.stale && "opacity-60")}>
            {compact
                ? (
                    <div className="flex min-w-0 items-center gap-3">
                        {cover}
                        <div className="min-w-0 flex-1 text-[12.5px] leading-[1.3]">
                            {title}
                            <span className="block truncate text-[11.5px] text-muted-foreground">{sub}</span>
                            <div className="mt-1.5">{progress}</div>
                        </div>
                    </div>
                )
                : <>
                    {cover}
                    <div className="min-w-0 text-[15px] leading-[1.3]">
                        {title}
                        <span className="block truncate text-[12px] text-muted-foreground">{sub}</span>
                    </div>
                    {progress}
                </>}

            <div className="flex items-center justify-between gap-1">
                <button type="button" onClick={() => void toggleShuffle()} disabled={!live} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle"
                    className={cn(mode, p.shuffle && "text-[var(--spotify)] hover:text-[var(--spotify)]")}>⤮</button>
                <span className="flex items-center gap-2">
                    <button type="button" aria-label="Previous" disabled={!t} className={skip} onClick={() => { activate(); void previous() }}><Icon name="prev" /></button>
                    <button
                        type="button"
                        disabled={!canPlay}
                        aria-label={p.playing ? "Pause" : t ? "Play" : "Play in Rounds"}
                        onClick={() => { activate(); void control(p.playing ? "pause" : "play") }}
                        className={cn(
                            "grid flex-none cursor-pointer place-items-center rounded-full border-0 bg-foreground p-0 text-background hover:bg-primary hover:text-primary-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-foreground disabled:hover:text-background",
                            compact ? "size-9" : "size-11",
                        )}
                    >
                        <Icon name={p.playing ? "pause" : "play"} className={compact ? "size-3" : "size-3.5"} />
                    </button>
                    <button type="button" aria-label="Next" disabled={!t} className={skip} onClick={() => { activate(); void control("next") }}><Icon name="next" /></button>
                </span>
                <button type="button" onClick={() => void cycleRepeat()} disabled={!live} data-mode={p.repeat} title={REPEAT_LABEL[p.repeat]} aria-label={REPEAT_LABEL[p.repeat]}
                    className={cn(mode, p.repeat !== "off" && "text-[var(--spotify)] hover:text-[var(--spotify)]")}>
                    {p.repeat === "track" ? "↻¹" : "↻"}
                </button>
            </div>

            <Devices s={s} cooling={cooling} beside={<Volume s={s} />} />

            {(s.target === "offer" || error) && (
                <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
                    {s.target === "offer" && (
                        <span>
                            Playing on <b className="font-medium text-ink-2">{p.device}</b> ·{" "}
                            <button type="button" title="Move the music into this tab" onClick={() => void playHere()}
                                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-primary underline underline-offset-2">Play here</button>
                        </span>
                    )}
                    {error && <span role="status" className="rounded-md border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2 py-1 text-[var(--warn-ink)]">{error}</span>}
                </div>
            )}
        </section>
    )
}
