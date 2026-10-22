// The focus screen, in <App>'s #focus: while a run goes and ui.focus is on, the clock
// takes the stage and everything else on the page is hidden (html.focusing). Dark in both
// themes, the glow behind the clock, the break colours in a break. The top line: ← Leave,
// the course chip, today against the goal. The stage: the phase and round, the big flip
// clock, the round strip, what comes next and when the run is done, Skip, pause and
// Stop & log. The music: a pill at the bottom that opens a glass side panel (a bottom
// sheet on a phone); the stage re-centres in what is left. Space pauses, M opens or shuts
// the music; Esc (data/keyboard.ts, escapeFocus) shuts the music, then leaves.
// In a study room (data/room.ts) the course chip picks what you log to, the controls are the
// host's (Pause and End for everyone) or a note naming the host, Stop & log becomes Leave,
// and the people panel (room-panel.tsx) sits on the right.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { isTyping } from "@/lib/dom"
import { accent } from "@/components/views/bits"
import { FlipClock } from "@/components/study/flip-clock"
import { GoalRing } from "@/components/study/tiles"
import { BackIcon, PauseIcon, PhaseLabel, PlayIcon, RoundStrip, SkipIcon, StopIcon } from "@/components/study/timer-bits"
import { useCourses, useItems, useProfile } from "@/data/store"
import { keyedCourses, keyedItems } from "@/data/refs"
import { withProjects } from "@/data/projects"
import { useUi } from "@/data/ui"
import { THEMES } from "@/data/themes"
import { getSheet } from "@/data/overlay"
import { keysOpen } from "@/data/keys"
import { getBusy } from "@/data/ai-read"
import {
    clockTime, doneAt, leaveFocus, nextLine, pickRoomClass, skip, stopRun, stripSegments, toggleMusic, togglePause, useRun, useToday, type Run,
} from "@/data/study-timer"
import { hostClock, isHost, useRoom } from "@/data/room"
import { RoomLine, RoomPanel } from "./room-panel"
import { MusicPill } from "./music-pill"
import { MusicPanel } from "./music-panel"

/** The focus screen while it is up, and the page's chrome hidden behind it. */
export function Focus() {
    const run = useRun()
    const on = useUi((u) => u.focus)
    const showing = on && run !== null

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("focusing", showing)
        return () => { document.documentElement.classList.remove("focusing") }
    }, [showing])

    /* The screen belongs to a run: one that ended unseen (another tab logged it) leaves it. */
    useEffect(() => { if (on && run === null) leaveFocus() }, [on, run])

    return showing ? <FocusScreen run={run} /> : null
}

/* Keys a focused control or box keeps: Space presses a button, a tab or a slider. */
const OWN_SPACE = "button, a, input, select, textarea, summary, [role=button], [role=tab], [role=option], [role=slider], [role=switch], [role=checkbox], [contenteditable]"

function FocusScreen({ run }: { run: Run }) {
    const music = useUi((u) => u.focusMusic)
    const bg = useUi((u) => u.bg)
    const today = useToday(run)
    const own = keyedCourses(useCourses()), all = keyedItems(useItems()), me = useProfile()?.id ?? ""
    const { courses, items } = useMemo(() => withProjects(own, all, me), [own, all, me])
    const root = useRef<HTMLDivElement>(null)

    /* Space, M and /, when no sheet, overlay or box has them (Esc is data/keyboard.ts's). */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
            if (keysOpen() || getSheet() || getBusy()) return
            const el = e.target instanceof Element ? e.target : null
            if (el && isTyping(el)) return
            if (e.key === " ") {
                if (el && el !== document.body && el.closest(OWN_SPACE)) return
                e.preventDefault()
                void togglePause()
            } else if (e.key === "m" || e.key === "M") {
                e.preventDefault()
                toggleMusic()
            } else if (e.key === "/") {
                /* the music's search box: the panel opens first if it is shut */
                e.preventDefault()
                toggleMusic(true)
                requestAnimationFrame(() => root.current?.querySelector<HTMLInputElement>("[data-music-search]")?.focus())
            }
        }
        document.addEventListener("keydown", onKey)
        return () => document.removeEventListener("keydown", onKey)
    }, [])

    /* The page behind is hidden, so focus starts here; and comes back here when the music
       panel shuts from inside (✕, Esc), not to nowhere. */
    useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])
    useEffect(() => {
        if (!music && (!document.activeElement || document.activeElement === document.body)) root.current?.focus({ preventScroll: true })
    }, [music])

    const course = courses.find((c) => c.id === run.courseId)
    const item = run.itemId ? items.find((it) => it.id === run.itemId) : null
    const next = nextLine(run)
    const at = clockTime(doneAt(run, run.at))
    const phase = run.kind === "study" ? THEMES[bg].studyWord : "Break"
    const roomState = useRoom()
    const inRoom = run.room !== null
    const host = inRoom && isHost(roomState)
    const hostName = roomState.view?.members.find((m) => m.userId === roomState.view?.room.hostId)?.name ?? "The host"
    const [ending, setEnding] = useState(false)

    return (
        <div
            ref={root}
            tabIndex={-1}
            role="region"
            aria-label="Focus"
            data-phase={run.kind}
            className={cn(
                "study-fx fixed inset-0 z-20 flex overflow-hidden bg-[var(--fx-bg)] text-[var(--fx-ink)] outline-none",
                "transition-colors duration-700 motion-reduce:transition-none",
            )}
        >
            {/* the stage: everything but the music panel; it re-centres when the panel opens */}
            <div className={cn(
                "relative flex min-h-0 min-w-0 flex-1 flex-col px-6 pt-[max(16px,env(safe-area-inset-top))] pb-[max(18px,env(safe-area-inset-bottom))]",
                "max-[700px]:px-4",
                music && "max-[700px]:pb-[calc(70dvh+10px)]",
            )}>
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_45%_at_50%_45%,var(--fx-glow),transparent_70%)] transition-[background] duration-700 motion-reduce:transition-none" />

                <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <button
                        type="button"
                        onClick={leaveFocus}
                        aria-keyshortcuts="Escape"
                        title="Leave focus (Esc)"
                        className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0.5 py-1 font-[inherit] text-[12.5px] font-semibold text-[var(--fx-ink-3)] hover:text-[var(--fx-ink)] [&_svg]:size-[15px]"
                    >
                        <BackIcon />{inRoom ? "Back" : "Leave"}
                    </button>
                    {inRoom ? (
                        <label className="inline-flex max-w-full min-w-0 items-center gap-2 text-[12.5px] text-[var(--fx-ink-2)]">
                            Logging to
                            <select value={run.courseId ?? ""} onChange={(e) => void pickRoomClass(e.target.value, null)}
                                className="h-8 max-w-[220px] min-w-0 cursor-pointer rounded-full border border-white/10 bg-white/5 px-3 font-[inherit] text-[12.5px] text-[var(--fx-ink)] [&_option]:bg-card [&_option]:text-foreground">
                                {courses.filter((c) => !c.archived || c.id === run.courseId).map((c) => <option key={c.id} value={c.id}>{c.code}{run.courseId === c.id && item ? " · " + item.title : ""}</option>)}
                            </select>
                        </label>
                    ) : (
                    <span className="inline-flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full border border-white/10 bg-white/5 px-3 py-[5px] text-[12.5px] whitespace-nowrap text-[var(--fx-ink-2)]">
                        <i aria-hidden="true" style={accent(course?.color)} className="size-2 flex-none rounded-[2px] bg-[var(--c,#7D8A99)]" />
                        <span className="min-w-0 truncate">
                            <b className="font-bold text-[var(--fx-ink)]">{course ? course.code : "No course"}</b>
                            {item && " · " + item.title}
                        </span>
                    </span>
                    )}
                    {today.goal > 0 && (
                        <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--fx-ink-2)] tabular-nums">
                            <GoalRing part={today.minutes} whole={today.goal} tone="fx" className="size-[22px]" />
                            <span>{duration(today.minutes)} <span className="text-[var(--fx-ink-3)]">of {duration(today.goal)} today</span></span>
                        </span>
                    )}
                </div>

                <div className={cn(
                    "relative flex min-h-0 flex-1 flex-col items-center justify-center gap-5 py-4",
                    music && "max-[700px]:gap-2.5 max-[700px]:py-2",
                )}>
                    {inRoom && roomState.reconnecting && <p role="status" className="m-0 text-[12.5px] text-[var(--fx-ink-3)]">Reconnecting… the clock keeps running.</p>}
                    <PhaseLabel>{phase} · round {run.round} of {run.flow.rounds}{run.paused ? (inRoom && !host ? " · paused by " + hostName : " · paused") : ""}</PhaseLabel>
                    <FlipClock
                        ms={run.leftMs}
                        running={!run.paused}
                        size="big"
                        className={music
                            ? "[--flip-w:clamp(40px,min(7.5vw,17vh),112px)] max-[700px]:[--flip-w:min(12vw,6.5dvh)]"
                            : "[--flip-w:clamp(48px,min(12.5vw,21vh),156px)] max-[700px]:[--flip-w:min(18vw,15dvh)]"}
                    />
                    <div className={cn("flex w-full max-w-[560px] flex-col items-center gap-4", music && "max-[700px]:hidden")}>
                        <RoundStrip rows={stripSegments(run.flow, run)} />
                        <p data-next="" className="m-0 text-center text-[13px] text-[var(--fx-ink-3)] tabular-nums [&_b]:font-semibold [&_b]:text-[var(--fx-ink-2)]">
                            {next.last
                                ? <>Last step · done at <b>{at}</b></>
                                : <>Next · <b>{next.kind === "study" ? THEMES[bg].studyWord : "Break"} {next.minutes} min</b> · done at <b>{at}</b></>}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3.5">
                        {(!inRoom || host) && <GhostButton onClick={() => void skip()} className={cn(music && "max-[700px]:hidden")}><SkipIcon />Skip</GhostButton>}
                        <button
                            type="button"
                            onClick={() => void togglePause()}
                            disabled={inRoom && !host}
                            title={inRoom && !host ? "Only the host can pause" : undefined}
                            aria-label={(run.paused ? "Resume timer" : "Pause timer") + (inRoom ? " for everyone" : "")}
                            aria-keyshortcuts="Space"
                            className={cn(
                                "grid size-16 cursor-pointer place-items-center rounded-full border-0 bg-[var(--ph)] text-[var(--fx-on-ph)] shadow-[0_10px_26px_-8px_var(--ph)] [&_svg]:size-[22px]",
                                "transition-[background-color,transform] duration-500 hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100",
                                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100",
                                music && "max-[700px]:size-11 max-[700px]:[&_svg]:size-4",
                            )}
                        >
                            {run.paused ? <PlayIcon /> : <PauseIcon />}
                        </button>
                        {inRoom && host && (ending
                            ? <GhostButton onClick={() => { setEnding(false); void hostClock("end") }} className={cn(music && "max-[700px]:hidden")}>End for everyone?</GhostButton>
                            : <GhostButton onClick={() => setEnding(true)} className={cn(music && "max-[700px]:hidden")}><StopIcon />End for everyone</GhostButton>)}
                        <GhostButton onClick={() => void stopRun()} className={cn(music && "max-[700px]:hidden")}>{inRoom ? "Leave" : <><StopIcon />Stop &amp; log</>}</GhostButton>
                    </div>
                    {inRoom && <RoomLine run={run} />}
                    {inRoom && (
                        <p className={cn("m-0 text-center text-[12.5px] text-[var(--fx-ink-3)]", music && "max-[700px]:hidden")}>
                            {host ? "You're the host: Pause, Skip and End act for everyone." : hostName + " controls the timer. Your minutes count from when you joined."}
                        </p>
                    )}
                </div>

                {!music && (
                    <div className="relative flex justify-center">
                        <MusicPill onOpen={() => toggleMusic(true)} tone="glass" className="max-w-[560px]" />
                    </div>
                )}
            </div>

            {inRoom && !music && <RoomPanel run={run} />}

            {music && (
                <MusicPanel
                    onClose={() => toggleMusic(false)}
                    className={cn(
                        "relative z-[1] m-3 ml-0 w-[38%] max-w-[560px] min-w-[320px] flex-none rounded-2xl bg-[color-mix(in_srgb,var(--fx-bg)_70%,transparent)]",
                        "animate-[focus-panel-in_.28s_ease-out] motion-reduce:animate-none",
                        /* a phone: a sheet over the lower 70%, the clock line above it */
                        "max-[700px]:absolute max-[700px]:inset-x-0 max-[700px]:bottom-0 max-[700px]:m-0 max-[700px]:h-[70dvh] max-[700px]:w-auto max-[700px]:max-w-none max-[700px]:min-w-0",
                        "max-[700px]:rounded-t-[18px] max-[700px]:rounded-b-none max-[700px]:border-x-0 max-[700px]:border-t max-[700px]:border-b-0",
                        "max-[700px]:animate-[focus-sheet-in_.28s_ease-out] motion-reduce:max-[700px]:animate-none",
                    )}
                />
            )}
        </div>
    )
}

const GhostButton = ({ onClick, className, children }: { onClick: () => void; className?: string; children: ReactNode }) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "inline-flex cursor-pointer items-center gap-[7px] rounded-full border border-white/10 bg-white/5 px-[15px] py-[9px] font-[inherit] text-[13px] font-semibold text-[var(--fx-ink-2)]",
            "hover:border-white/25 hover:text-[var(--fx-ink)] [&_svg]:size-3.5",
            className,
        )}
    >
        {children}
    </button>
)
