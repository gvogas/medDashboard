// The Study page's timer: two cards at the top of the left column. Ready is dark with the
// focus screen's glow, so starting feels like stepping into it: the flip clock on the
// first step, the round strip, the course and item picked, and Start. Your flow is a
// Texture card with the steps, the rounds and the Quick start presets; every change saves
// the flow to the profile (study-timer.ts).

import { useState, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { Panel, HeadNote } from "@/components/views/bits"
import { Button, RemoveButton } from "@/components/sheet/fields"
import { openCourse } from "@/data/actions"
import { useUi } from "@/data/ui"
import {
    addStep, applyPreset, delStep, flowTotals, MAX_MINUTES, MAX_ROUNDS, MAX_STEPS, openFocus, pickCourse, pickItem, presetsFor, sameFlow,
    setRounds, setStepKind, setStepMinutes, startRun, stripSegments, useFlow, useRun, useStudyPick,
} from "@/data/study-timer"
import type { Flow } from "@/data/types"
import { FlipClock } from "./flip-clock"
import { PhaseLabel, PlayIcon, RoundStrip } from "./timer-bits"

const MIN = 60_000

export function TimerCards({ className }: { className?: string }) {
    const flow = useFlow()
    return (
        <div className={cn("flex min-w-0 flex-col gap-[13px]", className)}>
            <ReadyCard flow={flow} />
            <FlowCard flow={flow} />
        </div>
    )
}

/* ── Ready ── */

const PICK = "min-w-0 flex-[1_1_190px] max-w-[280px] cursor-pointer rounded-[9px] border border-white/15 bg-white/[.06] px-2.5 py-[7px] font-[inherit] text-[13px] text-[var(--fx-ink)] outline-none hover:border-white/30 focus-visible:border-[var(--ph)] focus-visible:shadow-[0_0_0_3px_var(--ph-soft)] [&_option]:bg-card [&_option]:text-foreground"

function ReadyCard({ flow }: { flow: Flow }) {
    const pick = useStudyPick()
    const running = useRun() !== null
    const totals = flowTotals(flow)
    return (
        <section
            aria-label="Ready"
            className={cn(
                "study-fx flex min-w-0 flex-col items-center gap-4 rounded-[var(--radius)] border border-[var(--fx-study-card)] px-[18px] pt-[26px] pb-[22px] text-[var(--fx-ink)]",
                "bg-[radial-gradient(60%_55%_at_50%_30%,var(--fx-glow),transparent_70%),var(--fx-bg)] shadow-[0_12px_28px_-18px_rgba(0,0,0,.6)]",
            )}
        >
            <PhaseLabel>Ready</PhaseLabel>
            <FlipClock ms={flow.steps[0][1] * MIN} running={false} size="ready" />
            <div className="flex w-full max-w-[520px] flex-col gap-2">
                <RoundStrip rows={stripSegments(flow, null)} />
                <div className="flex flex-wrap justify-between gap-x-2.5 text-[11.5px] text-[var(--fx-ink-2)] tabular-nums">
                    <span>Round 1 of {flow.rounds}</span>
                    <span>{duration(totals.study)} study · {duration(totals.total)} total</span>
                </div>
            </div>
            {pick.courses.length ? (
                <>
                    <div className="flex w-full flex-wrap justify-center gap-2">
                        <select aria-label="Course" value={pick.courseId ?? ""} onChange={(e) => pickCourse(e.target.value)} className={PICK}>
                            {pick.courses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                        </select>
                        <select aria-label="Item (optional)" value={pick.itemId ?? ""} onChange={(e) => pickItem(e.target.value || null)} className={PICK}>
                            <option value="">No item</option>
                            {pick.items.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                        </select>
                    </div>
                    {running
                        ? <GoButton onClick={openFocus}>Back to focus</GoButton>
                        : <GoButton onClick={() => void startRun()}><PlayIcon />Start focus</GoButton>}
                    <p className="m-0 text-center text-[12.5px] text-[var(--fx-ink-2)]">Opens the focus screen: the clock and your music, nothing else.</p>
                </>
            ) : (
                <>
                    <p className="m-0 text-center text-[12.5px] text-[var(--fx-ink-2)]">Add a course first; study time is logged against one.</p>
                    <GoButton onClick={() => openCourse(null)}>Add a course</GoButton>
                </>
            )}
        </section>
    )
}

const GoButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            "inline-flex cursor-pointer items-center gap-2 rounded-full border-0 bg-[var(--ph)] px-6 py-[11px] font-[inherit] text-[14px] font-bold text-[var(--fx-on-ph)]",
            "shadow-[0_8px_24px_-8px_var(--ph)] hover:brightness-[1.08] active:brightness-95 [&_svg]:size-3.5",
        )}
    >
        {children}
    </button>
)

/* ── Your flow ── */

function FlowCard({ flow }: { flow: Flow }) {
    const totals = flowTotals(flow)
    const full = flow.steps.length >= MAX_STEPS
    const studies = flow.steps.filter(([k]) => k === "study").length
    const bg = useUi((u) => u.bg)
    return (
        <Panel label="Your flow" title="Your flow" head={<HeadNote>Tap Study or Break to switch it</HeadNote>}>
            <div className="flex flex-col gap-3 p-3.5">
                {/* one round, each step as long as its minutes */}
                <div aria-hidden="true" data-round="" className="flex h-2.5 gap-[3px]">
                    {flow.steps.map(([kind, minutes], i) => (
                        <i key={i} style={{ flex: minutes + " 1 0" }} className={cn("min-w-0 rounded-full", kind === "study" ? "bg-[var(--study)]" : "bg-[var(--break)]")} />
                    ))}
                </div>
                <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {flow.steps.map(([kind, minutes], i) => {
                        const only = kind === "study" && studies === 1
                        return (
                            <li key={i} className="grid grid-cols-[18px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-[10px] border border-line-2 bg-muted px-2 py-1.5">
                                <span className="text-right text-[11px] text-muted-foreground tabular-nums">{i + 1}</span>
                                <button
                                    type="button"
                                    disabled={only}
                                    onClick={() => void setStepKind(i)}
                                    aria-label={"Step " + (i + 1) + ": " + (kind === "study" ? "Study" : "Break") + (only ? "" : ", switch to " + (kind === "study" ? "a break" : "study"))}
                                    title={only ? "A flow needs a Study step" : "Switch between Study and Break"}
                                    className={cn(
                                        "inline-flex cursor-pointer items-center gap-2 justify-self-start rounded-[7px] border-0 py-[5px] pr-[11px] pl-[9px] font-[inherit] text-[12.5px] font-bold disabled:cursor-default",
                                        "before:size-2 before:rounded-full before:content-['']",
                                        kind === "study"
                                            ? "bg-[var(--study-soft)] text-[var(--study-ink)] before:bg-[var(--study)]"
                                            : "bg-[var(--break-soft)] text-[var(--break-ink)] before:bg-[var(--break)]",
                                    )}
                                >
                                    {kind === "study" ? "Study" : "Break"}
                                </button>
                                <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                    <NumberBox value={minutes} min={1} max={MAX_MINUTES} label={"Minutes for step " + (i + 1)} onCommit={(n) => setStepMinutes(i, n)} />
                                    min
                                </label>
                                <RemoveButton
                                    disabled={flow.steps.length < 2 || only}
                                    onClick={() => void delStep(i)}
                                    aria-label={"Remove step " + (i + 1)}
                                    className="disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted-foreground"
                                />
                            </li>
                        )
                    })}
                </ol>
                <div className="flex flex-wrap gap-2">
                    <AddButton kind="study" disabled={full} />
                    <AddButton kind="break" disabled={full} />
                </div>
                <div className="flex flex-wrap items-center gap-2.5 border-t border-line-2 pt-3.5 text-[13px] text-foreground">
                    <label htmlFor="studyRounds">Repeat</label>
                    <NumberBox id="studyRounds" value={flow.rounds} min={1} max={MAX_ROUNDS} onCommit={setRounds} />
                    <span>rounds</span>
                    <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">{duration(totals.study)} study · {duration(totals.total)} total</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] text-muted-foreground">Quick start</span>
                    {presetsFor(bg).map(([name, preset], i) => {
                        const on = sameFlow(preset, flow)
                        return (
                            <button key={i} type="button" aria-pressed={on} onClick={() => void applyPreset(i)}
                                className={cn(
                                    "cursor-pointer rounded-full border px-[11px] py-1 font-[inherit] text-[12px] font-semibold",
                                    on ? "border-foreground bg-foreground text-background" : "border-border bg-card text-ink-2 hover:border-muted-foreground hover:text-foreground",
                                )}>
                                {name}
                            </button>
                        )
                    })}
                </div>
            </div>
        </Panel>
    )
}

const AddButton = ({ kind, disabled }: { kind: "study" | "break"; disabled: boolean }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={() => void addStep(kind)}
        className={cn(
            "inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-dashed border-border bg-transparent px-3 py-1.5 font-[inherit] text-[12.5px] font-semibold",
            "before:size-2 before:rounded-full before:bg-current before:content-[''] disabled:cursor-default disabled:opacity-40",
            kind === "study" ? "text-[var(--study-ink)]" : "text-[var(--break-ink)]",
        )}
    >
        {kind === "study" ? "Add study" : "Add break"}
    </button>
)

/* A number box that saves when it loses focus or on Enter, not on every keystroke (typing
   "25" would save 2 first). Left empty or not a number, it goes back to what is saved; a
   number out of range is saved at the nearest limit, and the box shows what was saved. */
function NumberBox({ value, min, max, label, id, onCommit }: {
    value: number; min: number; max: number; label?: string; id?: string; onCommit: (n: number) => Promise<boolean>
}) {
    const [draft, setDraft] = useState(String(value))
    const [shown, setShown] = useState(value)
    if (shown !== value) { setShown(value); setDraft(String(value)) }

    const commit = () => {
        const n = Number(draft)
        if (draft.trim() === "" || !Number.isFinite(n)) { setDraft(String(value)); return }
        if (n === value) return
        void onCommit(n).then((saved) => { if (!saved) setDraft(String(value)) })
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") { e.preventDefault(); commit() }
        if (e.key === "Escape") { e.preventDefault(); setDraft(String(value)) }
    }
    return (
        <input
            type="number"
            inputMode="numeric"
            id={id}
            aria-label={label}
            min={min}
            max={max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className="w-[62px] rounded-[8px] border border-border bg-card px-2 py-[5px] text-right font-[inherit] text-[13px] text-foreground outline-none focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_24%,transparent)]"
        />
    )
}
