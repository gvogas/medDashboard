// The Study page's Timer tab: the Ready card large on the left, in the theme's dark colour
// so starting feels like stepping into the focus screen (the phase in the theme's word,
// the flip clock on the first step, the flow's name, the round strip, the course and item
// picked, and Start); on the right Your flow (the steps, the rounds and the Quick start
// presets; every change saves the flow to the profile, study-timer.ts) and Today
// (today-card.tsx). Under 1000px, one column (the 314px Ready clock plus the card's
// padding does not fit beside the 260px sidebar and Your flow below about 996px; the card
// trims its padding to 24px under 1100px). Above Your flow, Study together: start a room with
// friends, or join a friend who is in one (data/room.ts).

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { Panel, HeadNote } from "@/components/views/bits"
import { RemoveButton } from "@/components/sheet/fields"
import { openCourse } from "@/data/actions"
import { useUi } from "@/data/ui"
import { useMaintenance } from "@/data/maintenance"
import { friendsStale, loadFriends, useFriends } from "@/data/friends"
import { useScreen } from "@/data/signin"
import { Button, Note } from "@/components/sheet/fields"
import { THEMES } from "@/data/themes"
import {
    addStep, applyPreset, delStep, flowName, flowTotals, joinRoomRun, JOIN_ENDS_FIRST, MAX_MINUTES, MAX_ROUNDS, MAX_STEPS, openFocus, openTogether, pickCourse, pickItem, presetsFor,
    sameFlow, setRounds, setStepKind, setStepMinutes, startRun, stripSegments, useFlow, useRun, useStudyPick,
} from "@/data/study-timer"
import type { Flow } from "@/data/types"
import { FlipClock } from "./flip-clock"
import { PhaseLabel, PlayIcon, RoundStrip } from "./timer-bits"
import { TodayCard } from "./today-card"
import { MINUTE_MS } from "@/lib/time"


export function TimerCards() {
    const flow = useFlow()
    return (
        <div className={cn("grid items-stretch gap-4 [grid-template-columns:minmax(0,1.4fr)_minmax(0,1fr)] max-[1000px]:[grid-template-columns:minmax(0,1fr)]")}>
            <ReadyCard flow={flow} />
            <div className="flex min-w-0 flex-col gap-4">
                <TogetherCard />
                <FlowCard flow={flow} />
                <TodayCard />
            </div>
        </div>
    )
}

/* ── Ready ── */

const PICK = "h-[38px] w-full min-w-0 cursor-pointer rounded-md border border-white/20 bg-white/[.06] px-2 font-[inherit] text-[13px] text-[var(--fx-ink)] outline-none hover:border-white/30 focus-visible:border-[var(--ph)] focus-visible:shadow-[0_0_0_3px_var(--ph-soft)] [&_option]:bg-card [&_option]:text-foreground"

function ReadyCard({ flow }: { flow: Flow }) {
    const pick = useStudyPick()
    const running = useRun() !== null
    const bg = useUi((u) => u.bg)
    const totals = flowTotals(flow)
    return (
        <section
            aria-label="Ready"
            className="study-fx flex min-w-0 flex-col justify-center gap-6 rounded-[10px] bg-[var(--fx-bg)] px-11 py-9 max-[1100px]:px-6 text-[var(--fx-ink)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)] max-[520px]:gap-5 max-[520px]:px-5 max-[520px]:py-6"
        >
            <PhaseLabel className="text-[12px] font-medium tracking-[.04em] normal-case">
                {THEMES[bg].studyWord} · round 1 of {flow.rounds}
            </PhaseLabel>
            <div className="flex flex-col items-start gap-3.5">
                <FlipClock ms={flow.steps[0][1] * MINUTE_MS} running={false} size="ready" />
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-[var(--fx-ink-2)] tabular-nums">
                    <span>{flowName(flow, bg)}</span>
                    <span>{duration(totals.study)} study · {duration(totals.total)} total</span>
                </div>
            </div>
            <RoundStrip rows={stripSegments(flow, null)} className="max-w-[520px]" />
            {pick.courses.length ? (
                <>
                    <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                        <select aria-label="Course" value={pick.courseId ?? ""} onChange={(e) => pickCourse(e.target.value)} className={PICK}>
                            {pick.courses.map((c) => <option key={c.id} value={c.id}>{c.code + " · " + c.name}</option>)}
                        </select>
                        <select aria-label="Item (optional)" value={pick.itemId ?? ""} onChange={(e) => pickItem(e.target.value || null)} className={PICK}>
                            <option value="">No item</option>
                            {pick.items.map((it) => <option key={it.id} value={it.id}>{it.title}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        {running
                            ? <GoButton onClick={openFocus}>Back to focus</GoButton>
                            : <GoButton onClick={() => void startRun()}><PlayIcon />Start focus</GoButton>}
                        <p className="m-0 text-[12.5px] text-[var(--fx-ink-2)]">Opens the focus screen: the clock and your music, nothing else.</p>
                    </div>
                </>
            ) : (
                <div className="flex flex-col items-start gap-3">
                    <p className="m-0 text-[12.5px] text-[var(--fx-ink-2)]">Add a course first; study time is logged against one.</p>
                    <GoButton onClick={() => openCourse(null)}>Add a course</GoButton>
                </div>
            )}
        </section>
    )
}

/* white on the dark card, as in the prototype */
const GoButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
    <button
        type="button"
        onClick={onClick}
        className="inline-flex h-12 cursor-pointer outline-none focus-visible:shadow-[0_0_0_2px_var(--fx-bg),0_0_0_4px_var(--ph)] items-center gap-2 rounded-full border-0 bg-white px-6 font-[inherit] text-[15px] font-semibold text-[#1C1C1A] hover:bg-white/90 active:bg-white/80 [&_svg]:size-3"
    >
        {children}
    </button>
)

/* ── Study together ── */

function TogetherCard() {
    const maintenance = useMaintenance("friends")
    const run = useRun()
    const { list } = useFriends()
    const screen = useScreen()
    const [err, setErr] = useState("")
    const [ask, setAsk] = useState("")
    const [busy, setBusy] = useState(false)
    useEffect(() => { if (screen === "app" && maintenance !== "blocked" && friendsStale()) void loadFriends() }, [screen, maintenance])
    if (maintenance === "blocked") return null
    const inRooms = (list?.friends ?? []).filter((f) => f.room)
    const join = async (id: string, anyway = false) => {
        setBusy(true); setErr(""); setAsk("")
        const e = await joinRoomRun(id, anyway)
        if (e === JOIN_ENDS_FIRST) setAsk(id)
        else setErr(e)
        setBusy(false)
    }
    return (
        <Panel label="Study together" title="Study together">
            <div className="flex flex-col gap-2.5 p-3.5">
                {run?.room ? (
                    <>
                        <p className="m-0 text-[12.5px] text-muted-foreground">You're in a group session.</p>
                        <div><Button onClick={openFocus}>Back to the room</Button></div>
                    </>
                ) : (
                    <>
                        <p className="m-0 text-[12.5px] text-muted-foreground">One shared timer with friends. Everyone's minutes go into their own sessions.</p>
                        {inRooms.length > 0 && (
                            <ul aria-label="Friends in a room" className="m-0 flex list-none flex-col gap-1.5 p-0">
                                {inRooms.slice(0, 3).map((f) => (
                                    <li key={f.userId} className="flex items-center gap-2 text-[13px]">
                                        <span className="min-w-0 flex-1 truncate">{f.name} <span className="text-muted-foreground">· in a room of {f.room!.size}</span></span>
                                        <Button variant="ghost" disabled={busy} aria-label={"Join " + f.name} onClick={() => void join(f.room!.id)}>Join</Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div><Button onClick={() => openTogether()}>Start a group session</Button></div>
                    </>
                )}
                {ask && (
                    <div role="status" className="flex flex-wrap items-center gap-2">
                        <Note>{JOIN_ENDS_FIRST}</Note>
                        <Button variant="ghost" disabled={busy} onClick={() => void join(ask, true)}>Join anyway</Button>
                    </div>
                )}
                {err && <div role="alert"><Note tone="bad">{err}</Note></div>}
            </div>
        </Panel>
    )
}

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
                                        "hit inline-flex cursor-pointer items-center gap-2 justify-self-start rounded-[7px] border-0 py-[5px] pr-[11px] pl-[9px] font-[inherit] text-[12.5px] font-bold disabled:cursor-default",
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
                                    "hit cursor-pointer rounded-full border px-[11px] py-1 font-[inherit] text-[12px] font-semibold outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]",
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
            "hit inline-flex cursor-pointer items-center gap-[7px] rounded-[9px] border border-dashed border-border bg-transparent px-3 py-1.5 font-[inherit] text-[12.5px] font-semibold",
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
