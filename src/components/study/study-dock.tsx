// The corner dock: while a run goes and you are off the focus screen, a glass pill at the
// bottom right (full width on a phone) with the mini flip clock, the phase and round,
// pause or resume, today's goal ring when there is a goal, and Focus to go back. It
// turns to the break colours in a break. The music is the sidebar player's.

import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { useUi } from "@/data/ui"
import { openFocus, togglePause, useRun, useToday } from "@/data/study-timer"
import { FlipClock } from "./flip-clock"
import { GoalRing } from "./tiles"
import { PauseIcon, PhaseLabel, PlayIcon } from "./timer-bits"

export function StudyDock() {
    const run = useRun()
    const focusing = useUi((u) => u.focus)
    const today = useToday(run)
    if (!run || focusing) return null
    const phase = run.kind === "study" ? "Study" : "Break"
    return (
        <div
            role="region"
            aria-label="Study timer"
            data-phase={run.kind}
            className={cn(
                "study-fx fixed right-[18px] bottom-[calc(18px+env(safe-area-inset-bottom,0px))] z-30 flex items-center gap-3 rounded-full py-2 pr-2 pl-3.5 text-[var(--fx-ink)]",
                "border border-white/10 bg-[color-mix(in_srgb,var(--fx-bg)_84%,transparent)] shadow-[0_12px_30px_-8px_rgba(0,0,0,.5)] backdrop-blur-md",
                "transition-colors duration-500 motion-reduce:transition-none",
                /* a phone: the width of the screen, above the floating New item button */
                "max-[700px]:right-3 max-[700px]:left-3 max-[700px]:bottom-[calc(76px+env(safe-area-inset-bottom,0px))] max-[700px]:justify-between",
            )}
        >
            <FlipClock ms={run.leftMs} running={!run.paused} size="mini" />
            <PhaseLabel className="text-[11px] tracking-[.1em] whitespace-nowrap max-[380px]:before:hidden">
                {phase} · round {run.round} of {run.flow.rounds}{run.paused ? " · paused" : ""}
            </PhaseLabel>
            <button
                type="button"
                onClick={() => void togglePause()}
                aria-label={run.paused ? "Resume" : "Pause"}
                className="grid size-8 flex-none cursor-pointer place-items-center rounded-full border-0 bg-white/10 text-[var(--fx-ink)] hover:bg-white/20 [&_svg]:size-3.5"
            >
                {run.paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            {today.goal > 0 && (
                <span title={"Today: " + duration(today.minutes) + " of " + duration(today.goal)} className="grid place-items-center">
                    <GoalRing part={today.minutes} whole={today.goal} tone="fx" className="size-[30px]" />
                </span>
            )}
            <button
                type="button"
                onClick={openFocus}
                className="cursor-pointer rounded-full border-0 bg-[var(--ph)] px-3.5 py-1.5 font-[inherit] text-[12px] font-bold text-[var(--fx-on-ph)] hover:brightness-[1.08]"
            >
                Focus
            </button>
        </div>
    )
}
