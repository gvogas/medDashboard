// What plays and how: the cover, the title and artist (the equaliser beside them while it
// plays), the progress (not seekable), shuffle, previous, play or pause, next, repeat, the
// device and the volume. The Music page shows it large, as the prototype's player (lines
// 666–699); the focus panel `compact`, the cover beside the title, white on the glass
// (lines 1161–1179).

import { cn } from "@/lib/utils"
import {
    activate, control, cycleRepeat, playHere, previous, toggleShuffle, useSpotify,
} from "@/data/spotify"
import { Art, controlError, Eq, Icon, mmss, REPEAT_LABEL, SpotifyMark } from "./bits"
import { Devices, Volume } from "./devices"
import { useCooling } from "./use-music"

/** Whole seconds, for the progressbar's values. */
const secs = (ms: number | undefined) => Math.round((ms || 0) / 1000)

export function NowPlaying({ compact = false }: { compact?: boolean }) {
    const s = useSpotify()
    const cooling = useCooling(s.retryAt)
    const p = s.player, t = p.track
    const live = !!p.device
    const canPlay = !!t || s.target === "here"
    const pct = t && t.durationMs ? Math.min(100, (t.progressMs / t.durationMs) * 100) : 0
    const error = controlError(p.error)
    const moving = !!t && p.playing && !p.stale

    const titleCls = compact
        ? "block truncate text-[15px] font-semibold text-foreground"
        : "block truncate font-serif text-[22px] leading-[1.2] font-medium text-foreground"
    const title = t
        ? t.url
            ? <a href={t.url} target="_blank" rel="noopener" title="Open in Spotify" className={cn(titleCls, "no-underline hover:text-primary hover:underline")}>{t.title}</a>
            : <b className={titleCls}>{t.title}</b>
        : <b className={titleCls}>Nothing playing</b>
    const sub = t ? t.artists + (t.album ? " · " + t.album : "") : "Pick something to play from your library, or search."

    const coverCls = compact
        ? "size-16 rounded-[6px]"
        : "aspect-square w-[240px] max-w-full self-center rounded-[8px] shadow-[0_10px_30px_rgba(28,28,26,.14)]"
    const cover = t?.art
        ? <Art src={t.art} className={coverCls} />
        : (
            <span aria-hidden="true" className={cn("grid flex-none place-items-center bg-muted", coverCls)}>
                <SpotifyMark className={compact ? "size-6" : "size-12"} />
            </span>
        )

    const progress = (
        <div className={cn("flex flex-col", compact ? "gap-1" : "gap-[5px]", !t && "invisible")}>
            <span
                role="progressbar"
                aria-label="Track progress"
                aria-valuemin={0}
                aria-valuemax={Math.max(secs(t?.durationMs), secs(t?.progressMs))}
                aria-valuenow={secs(t?.progressMs)}
                aria-valuetext={mmss(t?.progressMs ?? 0) + " of " + mmss(t?.durationMs ?? 0)}
                className={cn("block overflow-hidden rounded-full", compact ? "h-[3px] bg-white/15" : "h-1 bg-line-2")}
            >
                <i className={cn("block h-full rounded-full", compact ? "bg-foreground" : "bg-primary")} style={{ width: pct + "%" }} />
            </span>
            <span className={cn("flex justify-between font-mono text-muted-foreground", compact ? "text-[11px]" : "text-[11.5px]")}>
                <span>{mmss(t?.progressMs ?? 0)}</span>
                <span>{mmss(t?.durationMs ?? 0)}</span>
            </span>
        </div>
    )

    /* shuffle and repeat: a soft circle behind them when on (the accent's on the page, white on the glass) */
    const mode = (on: boolean) => cn(
        "relative grid flex-none cursor-pointer place-items-center rounded-full border-0 p-0 disabled:cursor-default disabled:opacity-40",
        compact ? "size-[38px]" : "size-10",
        on
            ? compact ? "bg-white/20 text-foreground" : "bg-secondary text-primary"
            : compact ? "bg-transparent text-foreground hover:bg-white/10 disabled:hover:bg-transparent" : "bg-transparent text-ink-2 hover:text-primary disabled:hover:text-ink-2",
    )
    const skip = cn(
        "grid size-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-foreground disabled:cursor-default disabled:opacity-40",
        compact ? "hover:bg-white/10 disabled:hover:bg-transparent" : "hover:text-primary disabled:hover:text-foreground",
    )
    const icon = compact ? "size-4" : "size-[17px]"
    const skipIcon = compact ? "size-[18px]" : "size-5"

    return (
        <section aria-label="Now playing" className={cn("flex min-w-0 flex-col", compact ? "gap-3" : "gap-3.5", p.stale && "opacity-60")}>
            {compact
                ? (
                    <div className="flex min-w-0 items-center gap-3.5">
                        {cover}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {title}
                            <span className="block truncate text-[12.5px] text-ink-2">{sub}</span>
                        </div>
                        {moving && <Eq className="flex-none" />}
                    </div>
                )
                : <>
                    {cover}
                    <div className="flex min-w-0 items-start gap-2.5">
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            {title}
                            <span className="block truncate text-[13px] text-ink-2">{sub}</span>
                        </div>
                        {moving && <Eq className="mt-2 flex-none" />}
                    </div>
                </>}

            {progress}

            <div className="flex items-center justify-between">
                <button type="button" onClick={() => void toggleShuffle()} disabled={!live} aria-pressed={p.shuffle} title="Shuffle" aria-label="Shuffle" className={mode(p.shuffle)}>
                    <Icon name="shuffle" className={icon} />
                </button>
                <button type="button" aria-label="Previous" disabled={!t} className={skip} onClick={() => { activate(); void previous() }}>
                    <Icon name="prev" className={skipIcon} />
                </button>
                <button
                    type="button"
                    disabled={!canPlay}
                    aria-label={p.playing ? "Pause" : t ? "Play" : "Play in Term"}
                    onClick={() => { activate(); void control(p.playing ? "pause" : "play") }}
                    className={cn(
                        "grid flex-none cursor-pointer place-items-center rounded-full border-0 p-0 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100",
                        compact
                            ? "size-[52px] bg-foreground text-background hover:brightness-90"
                            : "size-[60px] bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(28,28,26,.18)] hover:brightness-110",
                    )}
                >
                    <Icon name={p.playing ? "pause" : "play"} className={compact ? "size-5" : "size-[22px]"} />
                </button>
                <button type="button" aria-label="Next" disabled={!t} className={skip} onClick={() => { activate(); void control("next") }}>
                    <Icon name="next" className={skipIcon} />
                </button>
                <button type="button" onClick={() => void cycleRepeat()} disabled={!live} data-mode={p.repeat} title={REPEAT_LABEL[p.repeat]} aria-label={REPEAT_LABEL[p.repeat]}
                    className={mode(p.repeat !== "off")}>
                    <Icon name="repeat" className={icon} />
                    {p.repeat === "track" && <span aria-hidden="true" className="absolute top-[5px] right-1.5 text-[9px] leading-none font-bold">1</span>}
                </button>
            </div>

            <Devices s={s} cooling={cooling} beside={<Volume s={s} />} />

            {(s.target === "offer" || error) && (
                <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                    {s.target === "offer" && (
                        <span>
                            Playing on <b className="font-medium text-ink-2">{p.device}</b> ·{" "}
                            <button type="button" title="Move the music into this tab" onClick={() => void playHere()}
                                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-primary underline underline-offset-2">Play here</button>
                        </span>
                    )}
                    {error && <span role="status" className="rounded-[6px] border border-[var(--warn-line)] bg-[var(--warn-bg)] px-2.5 py-1.5 text-[var(--warn-ink)]">{error}</span>}
                </div>
            )}
        </section>
    )
}
