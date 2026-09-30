// The next-exam box's animation, one per theme, in --motif (prototype lines 226–263):
// an ECG trace, a terminal countdown, swaying scales, a plane on its route, a stopwatch,
// two gears. The keyframes are in index.css and stop under prefers-reduced-motion.

import { useEffect, useState } from "react"
import type { Bg } from "@/data/themes"

const pad = (n: number) => String(n).padStart(2, "0")

/** "25:01:01": hours (past 24 too), minutes and seconds until then; from 100 hours on, "4d 03:10". */
export function countdown(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000))
    if (s >= 100 * 3600) {
        const h = Math.floor(s / 3600)
        return Math.floor(h / 24) + "d " + pad(h % 24) + ":" + pad(Math.floor((s % 3600) / 60))
    }
    return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor((s % 3600) / 60)) + ":" + pad(s % 60)
}

function useCountdown(at: Date, on: boolean) {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!on) return
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [on])
    return countdown(at.getTime() - now)
}

const TRACE = "M0 18h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23h20l3-3 4 6 3-3h10l4-12 4 20 4-8h23"

export function ExamMotif({ bg, at, steps }: { bg: Bg; at: Date; steps: string }) {
    const clock = useCountdown(at, bg === "cs" || bg === "sports")
    const rule = steps ? <><span className="h-px min-w-2 grow bg-border" /><span className="min-w-0 truncate">{steps}</span></> : null
    return (
        <span data-motif={bg} aria-hidden="true" className="relative mt-auto flex h-[26px] w-full min-w-0 items-center overflow-hidden gap-2.5 text-[12px] text-ink-2">
            {bg === "med" && (
                <svg viewBox="0 0 300 26" preserveAspectRatio="none" width="100%" height="26" className="block w-full">
                    <path d={TRACE} fill="none" stroke="var(--motif)" strokeOpacity=".16" strokeWidth="1.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    <path d={TRACE} pathLength={100} fill="none" stroke="var(--motif)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="24 76" vectorEffect="non-scaling-stroke" className="motif-ecg" />
                </svg>
            )}
            {bg === "cs" && (
                <span className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
                    <span className="shrink-0 text-[var(--accent)]">$</span><span className="max-[700px]:hidden">countdown --next</span><span className="font-medium text-foreground">{clock}</span>
                    <span className="motif-blink h-3.5 w-[7px] bg-[var(--accent)]" />
                </span>
            )}
            {bg === "law" && (
                <>
                    <svg width="30" height="24" viewBox="0 0 30 24" fill="none" stroke="var(--motif)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 4v17M10 21h10" />
                        <g className="motif-sway"><path d="M4 5h22" /><path d="M4 5l-3 8h6zM26 5l-3 8h6z" /></g>
                    </svg>
                    {rule}
                </>
            )}
            {bg === "pilot" && (
                <span className="relative block h-5 w-full">
                    <span className="absolute top-2.5 right-1 left-1 border-t-[1.5px] border-dashed border-[var(--box-line)]" />
                    <span className="absolute top-[7px] left-0 size-[7px] rounded-full bg-[var(--box-line)]" />
                    <span className="absolute top-[5px] right-0 size-[11px] rounded-full border-2 border-[var(--motif)]" />
                    <svg width="20" height="20" viewBox="0 0 24 24" className="motif-fly absolute top-0 left-0">
                        <path d="M21 12c0-.8-.7-1.5-1.5-1.5H14L9.5 3H7.5l2.5 7.5H5L3.5 8H2l1 4-1 4h1.5L5 13.5h5L7.5 21h2l4.5-7.5h5.5c.8 0 1.5-.7 1.5-1.5z" fill="var(--motif)" />
                    </svg>
                </span>
            )}
            {bg === "sports" && (
                <>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--motif)" strokeWidth="1.6" strokeLinecap="round">
                        <circle cx="12" cy="13.5" r="8" /><path d="M10 2.5h4M12 2.5v3" /><path d="M12 13.5V8.5" className="motif-hand" />
                    </svg>
                    {/* the {" "} keeps a space in the text ("12:00:00 to go"); the flex gap only spaces it visually */}
                    <span className="font-mono text-[13px] font-medium text-foreground">{clock}</span>{" "}<span>to go</span>
                </>
            )}
            {bg === "eng" && (
                <>
                    <svg width="34" height="24" viewBox="0 0 34 24" fill="none" stroke="var(--motif)">
                        <g className="motif-gear-a"><circle cx="11" cy="12" r="7" strokeWidth="3.5" strokeDasharray="2.6 2.4" /><circle cx="11" cy="12" r="3" strokeWidth="1.6" /></g>
                        <g className="motif-gear-b"><circle cx="26" cy="8" r="4.5" strokeWidth="2.6" strokeDasharray="1.9 1.6" /><circle cx="26" cy="8" r="1.6" strokeWidth="1.4" /></g>
                    </svg>
                    {rule}
                </>
            )}
        </span>
    )
}
