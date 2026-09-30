// The Spotify badge at the bottom of the sidebar, clipped to the sidebar picture (on Medicine, the coat):
// the cover, the track and artist with the equaliser, the mark, the progress line,
// previous / play / next, a failed control's reason, and the device (with Play here when
// the music is on another device and this tab can take it). Hidden until the first answer.

import { cn } from "@/lib/utils"
import { activate, control, playHere, previous, useSpotify } from "@/data/spotify"
import { controlError, Icon, SpotifyMark } from "./bits"

const ctl = "grid size-7 flex-none cursor-pointer place-items-center rounded-full border border-border bg-card p-0 text-ink-2 hover:border-primary hover:text-primary"
const pp = "grid flex-none cursor-pointer place-items-center rounded-full border-0 bg-foreground p-0 text-card hover:bg-primary hover:text-primary-foreground"

export function SidebarPlayer() {
    const s = useSpotify()
    const p = s.player, t = p.track
    if (!p.loaded) return null
    const state = !p.connected ? "off" : !t ? "idle" : p.playing ? "playing" : "paused"
    const error = controlError(p.error)
    const message = error && (
        <div role="status" className="rounded-md border border-[var(--warn-line)] bg-[var(--warn-bg)] px-[7px] py-[3px] text-center text-[10.5px] leading-[1.35] text-[var(--warn-ink)]">{error}</div>
    )

    let body
    if (!p.connected) {
        body = (
            <a href="/api/spotify/connect" className="group/connect flex w-full items-center gap-2 rounded-md py-px text-left text-[12px] text-muted-foreground no-underline hover:text-primary">
                <SpotifyMark className="text-muted-foreground group-hover/connect:text-[var(--spotify)]" />
                Connect Spotify
            </a>
        )
    } else if (!t) {
        body = <>
            <div className="flex items-center gap-2 py-px text-[12px] text-muted-foreground">
                <SpotifyMark className="text-muted-foreground" />
                Nothing playing
                {s.target === "here" && (
                    <button type="button" aria-label="Play in Term" title="Play in Term" className={cn(pp, "ml-auto size-[26px]")} onClick={() => { activate(); void control("play") }}>
                        <Icon name="play" className="size-[11px]" />
                    </button>
                )}
            </div>
            {message}
        </>
    } else {
        const pct = t.durationMs ? Math.min(100, (t.progressMs / t.durationMs) * 100) : 0
        const moving = p.playing && !p.stale
        const bar = cn("h-1.5 w-[3px] origin-bottom rounded-[1px] bg-[var(--spotify)]", moving && "animate-[spot-eq_1s_ease-in-out_infinite] motion-reduce:animate-none")
        body = <>
            <div className="flex min-w-0 items-center gap-[9px]">
                {t.art
                    ? <img src={t.art} alt="" width={42} height={42} className="size-[42px] flex-none rounded-[7px] bg-muted object-cover shadow-[0_1px_3px_rgba(20,48,45,.22)]" />
                    : <span className="size-[42px] flex-none rounded-[7px] bg-muted shadow-[0_1px_3px_rgba(20,48,45,.22)]" />}
                <div className="min-w-0 flex-1 leading-[1.3]">
                    {t.url
                        ? <a href={t.url} target="_blank" rel="noopener" title="Open in Spotify" className="block truncate font-semibold text-foreground no-underline hover:text-primary hover:underline">{t.title}</a>
                        : <span className="block truncate font-semibold text-foreground">{t.title}</span>}
                    <span className="block truncate text-[11px] text-ink-2">{t.artists}</span>
                    <span aria-hidden="true" className="mt-[3px] flex h-3 items-end gap-[2px]">
                        <i className={bar} /><i className={cn(bar, "[animation-delay:.2s]")} /><i className={cn(bar, "[animation-delay:.45s]")} /><i className={cn(bar, "[animation-delay:.1s]")} />
                    </span>
                </div>
                <SpotifyMark />
            </div>
            <span className="block h-[3px] overflow-hidden rounded-full bg-line-2">
                <i className="block h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--spotify))]" style={{ width: pct + "%" }} />
            </span>
            <div className="flex items-center justify-center gap-2.5">
                <button type="button" aria-label="Previous" className={ctl} onClick={() => { activate(); void previous() }}><Icon name="prev" /></button>
                <button type="button" aria-label={p.playing ? "Pause" : "Play"} className={cn(pp, "size-[34px]")} onClick={() => { activate(); void control(p.playing ? "pause" : "play") }}>
                    <Icon name={p.playing ? "pause" : "play"} className="size-[13px]" />
                </button>
                <button type="button" aria-label="Next" className={ctl} onClick={() => { activate(); void control("next") }}><Icon name="next" /></button>
            </div>
            {message}
            {p.device && (
                <div className="truncate text-center text-[10px] tracking-[.04em] text-muted-foreground">
                    on <b className="font-medium text-ink-2">{p.device}</b>
                    {s.target === "offer" && <>
                        {" · "}
                        <button type="button" title="Move the music into this tab" onClick={() => { activate(); void playHere() }}
                            className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] tracking-[inherit] text-primary underline underline-offset-2">Play here</button>
                    </>}
                </div>
            )}
        </>
    }

    return (
        <div
            role="region"
            aria-label="Spotify"
            data-state={state}
            data-stale={p.stale || undefined}
            className={cn(
                "relative mt-[3px] flex flex-col gap-2 rounded-[9px] border border-[color-mix(in_srgb,var(--coat)_22%,var(--line))] bg-card px-2.5 pt-[9px] pb-2.5 text-[12.5px] text-ink-2",
                "shadow-[0_1px_2px_rgba(20,48,45,.10),0_6px_16px_rgba(20,48,45,.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,.4),0_6px_16px_rgba(0,0,0,.35)]",
                /* the clip: a short bar of the coat colour over the top edge, like the pen on the pocket; only Medicine has a coat */
                "before:absolute before:top-[-5px] before:left-1/2 before:-ml-[17px] before:h-2 before:w-[34px] before:rounded-[3px] before:bg-[color-mix(in_srgb,var(--coat)_70%,var(--ink))] before:shadow-[0_1px_1px_rgba(20,48,45,.2)] before:content-['']",
                "[:root:not([data-bg=med])_&]:border-border [:root:not([data-bg=med])_&]:before:hidden",
                p.stale && "opacity-50",
            )}
        >
            {body}
        </div>
    )
}
