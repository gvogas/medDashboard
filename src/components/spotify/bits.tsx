// Small pieces the music shares: the Spotify mark, the control icons, a cover, the
// equaliser, the empty and loading lines, Show more and ↻, the short note, and the glass
// tokens that turn any of it dark for the focus screen.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The focus screen's glass: Rounds' tokens re-pointed at the dark --fx-* palette, so the
    same parts draw light-on-dark there. The focus screen may set --fx-ph to its phase's
    colour (a break's); it defaults to the study colour. */
export const FX = cn(
    "[--ink:#EEF6F4] [--ink-2:rgba(238,246,244,.68)] [--ink-3:rgba(238,246,244,.5)]",
    "[--line:rgba(255,255,255,.12)] [--line-2:rgba(255,255,255,.07)] [--panel:rgba(255,255,255,.06)] [--panel-2:rgba(255,255,255,.1)]",
    "[--accent:var(--fx-ph,var(--fx-study))] [--accent-soft:rgba(255,255,255,.12)] [--accent-ink:var(--fx-ph,var(--fx-study))] [--on-accent:var(--fx-study-bg)]",
    "[--warn-bg:rgba(255,255,255,.07)] [--warn-line:rgba(255,255,255,.14)] [--warn-ink:#F6D9C9] [--good:#8FE0A8] [--rim-hi:rgba(255,255,255,.07)]",
    "[--bg:var(--fx-study-bg)] [color-scheme:dark] text-foreground",
)

/** The glass surface itself, over the focus screen's glow. */
export const GLASS = "border border-white/10 bg-[color-mix(in_srgb,var(--fx-study-bg)_78%,transparent)] shadow-[0_20px_50px_-10px_rgba(0,0,0,.7)] backdrop-blur-[14px]"

export const SpotifyMark = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-3.5 flex-none text-[color:var(--spotify)]", className)}>
        <circle cx="12" cy="12" r="12" fill="currentColor" />
        <path d="M6.2 9.4c3.9-1.1 8.4-.8 11.7 1.2M6.9 12.5c3.2-.9 6.9-.6 9.7 1M7.5 15.4c2.5-.7 5.3-.5 7.6.8" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
)

const PATHS = {
    prev: "M2 1h1.6v10H2zM10 1.5v9L4 6z",
    next: "M8.4 1H10v10H8.4zM2 1.5v9l6-4.5z",
    play: "M3.2 1.5v9l7-4.5z",
    pause: "M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z",
}

export const Icon = ({ name, className }: { name: keyof typeof PATHS; className?: string }) => (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className={cn("size-3", className)}><path d={PATHS[name]} /></svg>
)

/** 3:07, from milliseconds. */
export function mmss(ms: number) {
    const s = Math.round((ms || 0) / 1000)
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0")
}

/** A cover, or an empty square where Spotify has none. */
export function Art({ src, className, round = false }: { src: string | null | undefined; className?: string; round?: boolean }) {
    const cls = cn("block flex-none bg-muted object-cover", round ? "rounded-full" : "rounded-[5px]", className)
    return src ? <img src={src} alt="" loading="lazy" className={cls} /> : <span aria-hidden="true" className={cls} />
}

/** The three bars beside the track that is playing; still with reduced motion. */
export function Eq({ className }: { className?: string }) {
    const bar = "h-1.5 w-[3px] origin-bottom rounded-[1px] bg-[var(--spotify)] animate-[spot-eq_1s_ease-in-out_infinite] motion-reduce:animate-none"
    return (
        <i role="img" aria-label="Playing" className={cn("inline-flex h-[11px] items-end gap-[2px] not-italic", className)}>
            <b className={bar} /><b className={cn(bar, "[animation-delay:.25s]")} /><b className={cn(bar, "[animation-delay:.5s]")} />
        </i>
    )
}

/** An empty list's line: a bold first line, then what to do. */
export const Empty = ({ title, children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) => (
    <div className={cn("px-3.5 py-5 text-center text-[12.5px] text-muted-foreground", className)}>
        {title && <b className="mb-0.5 block font-semibold text-ink-2">{title}</b>}
        {children}
    </div>
)

/** A list still on its way: Spotify is asked, or the way is shut until the cooldown ends. */
export const Loading = ({ what, cooling }: { what: string; cooling: boolean }) => (
    <Empty title={what}>{cooling ? "Waiting for the Spotify request limit to reset." : "Asking Spotify…"}</Empty>
)

/** A small heading inside a list, with a count or a button at its end. */
export const Sub = ({ children, end }: { children: ReactNode; end?: ReactNode }) => (
    <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-[9.5px] font-semibold tracking-[.12em] text-muted-foreground uppercase">
        {children}
        {end}
    </div>
)

export const Count = ({ n }: { n: number }) => (
    <em className="ml-auto text-[10px] tracking-[.04em] text-muted-foreground not-italic">{n}</em>
)

export function More({ onClick, left = 0 }: { onClick: () => void; left?: number }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="mx-3.5 mt-2 mb-3 block w-[calc(100%-28px)] cursor-pointer rounded-[9px] border border-dashed border-border bg-transparent px-2 py-1.5 text-[12px] text-ink-2 hover:border-primary hover:text-primary"
        >
            Show more{left > 0 ? " · " + left + " left" : ""}
        </button>
    )
}

/** A round ghost button: ↻, ‹, ✕ and the like. */
export const ghost = "grid size-7 flex-none cursor-pointer place-items-center rounded-full border border-border bg-card p-0 text-[13px] text-ink-2 hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-45 disabled:hover:border-border disabled:hover:text-ink-2"

export const Refresh = ({ onClick, label = "Refresh" }: { onClick: () => void; label?: string }) => (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={ghost}>↻</button>
)

/** A pill-shaped text button, like ‹ Back or ▶ Play all. */
export const chipButton = "inline-flex flex-none cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-ink-2 hover:border-primary hover:text-primary disabled:cursor-default disabled:opacity-45"

/** The short line under the controls: a failure, the cooldown, or a quiet "Playing.". */
export function Notice({ text, ok = false, className }: { text: string | null | undefined; ok?: boolean; className?: string }) {
    if (!text) return null
    return (
        <div role="status" className={cn(
            "rounded-lg border px-2.5 py-1.5 text-[12px]",
            ok ? "border-[color-mix(in_srgb,var(--accent)_30%,var(--line))] bg-secondary text-accent-foreground" : "border-[var(--warn-line)] bg-[var(--warn-bg)] text-[var(--warn-ink)]",
            className,
        )}>
            {text}
        </div>
    )
}

/** What a failed control says, in the sidebar player and the pill. */
const CONTROL_ERRORS: Record<string, string> = {
    no_device: "Open Spotify somewhere, or use a desktop browser",
    nothing_to_resume: "Pick something in the Spotify view",
    premium_required: "Controls need Spotify Premium",
    not_allowed: "Spotify would not do that right now",
    spotify_unavailable: "Spotify is not answering",
    rate_limited: "Spotify asked us to slow down",
    offline: "You seem to be offline",
}
export const controlError = (code: string | null) => code ? CONTROL_ERRORS[code] || CONTROL_ERRORS.spotify_unavailable : null

export const REPEAT_LABEL: Record<string, string> = { off: "Repeat is off", context: "Repeating the playlist or album", track: "Repeating this track" }

const DEVICE_ICON: Record<string, string> = {
    Computer: "💻", Smartphone: "📱", Tablet: "📱", Speaker: "🔈", TV: "📺", CastVideo: "📺", CastAudio: "🔈", AVR: "🔈", STB: "📺", GameConsole: "🎮", Automobile: "🚗",
}
export const deviceIcon = (type: string) => DEVICE_ICON[type] || "🔈"
