// Pieces the Ready card, the focus screen and the dock share: the phase label, the round
// strip and the timer's icons. They sit on the dark study surfaces (.study-fx in
// index.css), whose --ph, --fx-study and --fx-break turn to the break colours in a break.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { Segment } from "@/data/study-timer"

/** "READY", "STUDY · ROUND 2 OF 4": the phase's dot and words, in capitals. */
export const PhaseLabel = ({ children, className }: { children: ReactNode; className?: string }) => (
    <span className={cn(
        "inline-flex items-center gap-2 text-[11.5px] font-bold tracking-[.12em] text-[var(--ph-ink)] uppercase transition-colors duration-500 motion-reduce:transition-none",
        "before:size-2 before:flex-none before:rounded-full before:bg-[var(--ph)] before:shadow-[0_0_0_4px_var(--ph-soft)] before:content-['']",
        className,
    )}>{children}</span>
)

/** Every step of every round, as wide as its minutes, filled as far as the run has gone;
    the step running now is ringed. Rows of many steps pack closer. */
export function RoundStrip({ rows, className }: { rows: Segment[][]; className?: string }) {
    const steps = rows[0]?.length ?? 0
    return (
        <span aria-hidden="true" data-strip="" className={cn("flex w-full", rows.length > 6 ? "gap-1" : "gap-2", className)}>
            {rows.map((round, r) => (
                <span key={r} className={cn("flex min-w-0 flex-1", steps > 6 ? "gap-px" : "gap-[3px]")}>
                    {round.map((s, i) => (
                        <span
                            key={i}
                            data-kind={s.kind}
                            data-now={s.now || undefined}
                            style={{ flex: s.minutes + " 1 0" }}
                            className={cn(
                                "h-1.5 min-w-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--seg)_22%,transparent)]",
                                s.kind === "study" ? "[--seg:var(--fx-study)]" : "[--seg:var(--fx-break)]",
                                s.now && "shadow-[0_0_0_2px_var(--fx-bg),0_0_0_3.5px_var(--seg)]",
                            )}
                        >
                            <i style={{ width: Math.round(s.fill * 1000) / 10 + "%" }} className="block h-full rounded-full bg-[var(--seg)]" />
                        </span>
                    ))}
                </span>
            ))}
        </span>
    )
}

const svg = (path: ReactNode, fill = true) => (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-full"
        {...(fill ? { fill: "currentColor" } : { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const })}>
        {path}
    </svg>
)

export const PlayIcon = () => svg(<path d="M4.5 2.6v10.8L13 8z" />)
export const PauseIcon = () => svg(<><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" /><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" /></>)
export const SkipIcon = () => svg(<><rect x="11.2" y="3" width="2.2" height="10" rx=".8" /><path d="M2.5 3v10l8-5z" /></>)
export const StopIcon = () => svg(<rect x="3.5" y="3.5" width="9" height="9" rx="2" />)
export const BackIcon = () => svg(<path d="M10 3 5 8l5 5" />, false)
