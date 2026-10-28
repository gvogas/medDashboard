// Crunch marks (core/workload.ts): a band naming the crunches a view's range holds, and a
// small tag on a crowded day. Warm, not loud: the theme's warn colours on a light tint.

import { cn } from "@/lib/utils"
import type { Crunch } from "@/core/workload"

/** One line under a panel's header: "Heavy stretch: 3 exams the week of 12 Oct · 2 exams or quizzes on Tue 13 Oct". */
export function CrunchBand({ list, className }: { list: Crunch[]; className?: string }) {
    if (!list.length) return null
    const lines = [...new Set(list.map((c) => c.text))]
    return (
        <p role="note" data-crunch-band
            className={cn("m-0 flex flex-wrap items-baseline gap-x-1.5 border-b border-[var(--warn-line)] bg-[var(--warn-bg)] px-5 py-1.5 text-[12px] text-[var(--warn-ink)] max-[520px]:px-3", className)}>
            <WarnIcon />
            <b className="font-semibold">Heavy stretch:</b>
            <span>{lines.join(" · ")}</span>
        </p>
    )
}

/** A crowded day's tag; its title says why. */
export function CrunchTag({ list, compact = false }: { list: Crunch[]; compact?: boolean }) {
    if (!list.length) return null
    const why = [...new Set(list.map((c) => c.text))].join(" · ")
    return (
        <span data-crunch role="img" title={why} aria-label={"Busy: " + why}
            className={cn("inline-flex flex-none items-center gap-1 rounded bg-[var(--warn-bg)] font-semibold text-[var(--warn-ink)] shadow-[inset_0_0_0_1px_var(--warn-line)]",
                compact ? "px-1 py-px text-[9.5px]" : "px-1.5 py-px text-[10.5px]")}>
            <WarnIcon />Busy
        </span>
    )
}

const WarnIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none self-center">
        <path d="M8 2.2 14.5 13.5h-13z" /><path d="M8 6.5v3.2M8 11.8v.1" />
    </svg>
)
