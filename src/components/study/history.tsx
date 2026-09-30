// The History card on the Study page: Week, Month and Term. The week is a bar a day, split
// by course, against the goal; the month a calendar whose days open their sessions; the
// term a heatmap from its start, whose days open their month. A deleted session waits in
// the card's foot for Undo, whichever tab is showing.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { dayOf } from "@/core/history"
import { shortDate, DOW } from "@/core/dates"
import { course as courseOf, item as itemOf } from "@/core/store"
import { accent, Panel } from "@/components/views/bits"
import { Segmented } from "@/components/sheet/fields"
import {
    pickDay, setHistTab, stepHist, undoSessionDelete, useHistory,
    type HeatWeek, type MonthHist, type TermHist, type WeekHist,
} from "@/data/study"
import { deleteSession, openSession } from "@/data/actions"
import type { Course, HistTab, Item, SessionUndo, StudySession } from "@/data/types"

const TABS = [["week", "Week"], ["month", "Month"], ["term", "Term"]] as const

/* A course's colour for --c; sessions with none, or a course since deleted, are grey. */
const NO_COURSE = "#7D8A99"
const courseColour = (id: string | null): CSSProperties | undefined => accent((courseOf(id) as Course | null)?.color) ?? accent(NO_COURSE)
const courseCode = (id: string | null) => (courseOf(id) as Course | null)?.code || "No course"
const plural = (n: number, one: string) => n + " " + one + (n === 1 ? "" : "s")
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/** The level tints, 0 to 4, of the heatmap's squares and the month's days. */
const HEAT = [
    "bg-line-2",
    "bg-[color-mix(in_srgb,var(--study)_28%,var(--panel-2))]",
    "bg-[color-mix(in_srgb,var(--study)_52%,var(--panel-2))]",
    "bg-[color-mix(in_srgb,var(--study)_76%,var(--panel-2))]",
    "bg-[var(--study)]",
]
const DAY_TINT = [
    "bg-card",
    "bg-[color-mix(in_srgb,var(--study)_8%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_16%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_26%,var(--panel))]",
    "bg-[color-mix(in_srgb,var(--study)_36%,var(--panel))]",
]

export function HistoryCard({ className }: { className?: string }) {
    const h = useHistory()
    const card = useRef<HTMLDivElement>(null)
    /* a heatmap day, to bring into view once its month is drawn */
    const reveal = useRef<string | null>(null)
    /* after ✕, focus goes to Undo; after Undo, to the session back in its place */
    const focusUndo = useRef(false)
    const restored = useRef<string | null>(null)

    useEffect(() => {
        const root = card.current
        if (!root) return
        if (reveal.current && h.tab === "month") {
            const day = reveal.current
            reveal.current = null
            document.getElementById("hday-" + day)?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" })
            root.querySelector<HTMLElement>('[data-day="' + day + '"]')?.focus({ preventScroll: true })
        }
        if (focusUndo.current && h.undo) {
            focusUndo.current = false
            root.querySelector<HTMLElement>("[data-undo]")?.focus()
        }
        if (restored.current && !h.undo) {
            const id = restored.current
            restored.current = null
            root.querySelector<HTMLElement>('[data-session="' + CSS.escape(id) + '"] [data-edit]')?.focus()
        }
    })

    const remove = (id: string) => {
        focusUndo.current = true
        deleteSession(id)
    }
    const undo = () => {
        restored.current = h.undo?.session.id ?? null
        undoSessionDelete()
    }

    return (
        <div ref={card} className={cn("min-w-0", className)}>
            <Panel
                label="History"
                title="History"
                head={<>
                    <Segmented label="Show history for" value={h.tab} options={TABS} onChange={(v: HistTab) => setHistTab(v)} />
                    {h.week && <Stepper unit="week" offset={h.week.offset} range={h.week.range} />}
                    {h.month && <Stepper unit="month" offset={h.month.offset} range={h.month.title} />}
                    {h.term && <span className="font-mono text-[12px] text-ink-2">{h.term.title} · {h.term.range}</span>}
                    <button type="button" onClick={() => openSession(null)}
                        className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-[9px] border border-border bg-[linear-gradient(var(--panel),var(--panel-2))] px-2.5 py-1 font-[inherit] text-[12px] font-semibold text-ink-2 shadow-[var(--shadow-1),inset_0_1px_0_var(--rim-hi)] hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] hover:text-accent-foreground">
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="size-3.5"><path d="M8 3v10M3 8h10" /></svg>
                        Log study
                    </button>
                </>}
            >
                <div className="@container flex flex-col gap-3.5 p-3.5">
                    {h.week && <WeekPane w={h.week} goal={h.goal} onDelete={remove} />}
                    {h.month && <MonthPane m={h.month} onDelete={remove} />}
                    {h.term && <TermPane t={h.term} onPick={(date) => { reveal.current = date; pickDay(date) }} />}
                </div>
                <div role="status">{h.undo && <UndoBar undo={h.undo} onUndo={undo} />}</div>
            </Panel>
        </div>
    )
}

/** ‹ the range › for the week or month shown; › stops at this one, and a chip comes back to it. */
function Stepper({ unit, offset, range }: { unit: "week" | "month"; offset: number; range: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <NavButton label={"Previous " + unit} onClick={() => stepHist(-1)}><path d="M10 3 5 8l5 5" /></NavButton>
            <span className="min-w-[96px] text-center font-mono text-[12.5px] text-foreground">{range}</span>
            <NavButton label={"Next " + unit} disabled={offset >= 0} onClick={() => stepHist(1)}><path d="M6 3l5 5-5 5" /></NavButton>
            {offset < 0 && (
                <button type="button" onClick={() => stepHist(0)}
                    className="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 font-[inherit] text-[12px] font-semibold text-ink-2 hover:text-foreground">
                    This {unit}
                </button>
            )}
        </span>
    )
}

const NavButton = ({ label, disabled = false, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
        className="grid size-[34px] cursor-pointer place-items-center rounded-[9px] border border-border bg-muted p-0 text-foreground hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))] disabled:cursor-default disabled:opacity-35 max-[700px]:size-10">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3.5">{children}</svg>
    </button>
)

const SubHead = ({ children, note }: { children: ReactNode; note?: string }) => (
    <h3 className="m-0 flex items-baseline gap-2 text-[11px] font-semibold tracking-[.12em] text-ink-2 uppercase">
        {children}
        {note && <em className="text-[11px] font-medium tracking-normal text-muted-foreground not-italic normal-case">{note}</em>}
    </h3>
)

const Hint = ({ children }: { children: ReactNode }) => <p className="m-0 px-0.5 py-2.5 text-[12.5px] text-ink-2">{children}</p>

/* ── the week ── */

function WeekPane({ w, goal, onDelete }: { w: WeekHist; goal: number; onDelete: (id: string) => void }) {
    return (
        <>
            <div className="flex flex-wrap items-baseline gap-2">
                <b className="font-mono text-[28px] font-extrabold tracking-[-.02em] text-foreground">{duration(w.total)}</b>
                <span className="text-[12.5px] text-ink-2">{w.summary}</span>
            </div>
            <div>
                <div className="relative mb-1.5 h-[130px]">
                    <div aria-hidden="true" className="grid h-full grid-cols-7 gap-2">
                        {w.days.map((d) => (
                            <span key={d.date} title={d.title} className={cn(
                                "box-border flex h-full flex-col-reverse gap-0.5 rounded-md",
                                d.future ? "border-[1.5px] border-dashed border-border" : "bg-[repeating-linear-gradient(to_top,var(--line-2)_0_1px,transparent_1px_25%)]",
                            )}>
                                {d.bars.map((b) => <i key={b.courseId} style={{ ...courseColour(b.courseId || null), height: b.height + "%" }} className="block min-h-0.5 rounded bg-[var(--c)]" />)}
                            </span>
                        ))}
                    </div>
                    {w.goalLine !== null && (
                        <span aria-hidden="true" style={{ bottom: w.goalLine + "%" }}
                            className="pointer-events-none absolute right-0 left-0 border-t-[1.5px] border-dashed border-[color-mix(in_srgb,var(--study)_60%,transparent)]">
                            <em className="absolute -top-[17px] right-0 rounded bg-card px-1 text-[11px] font-semibold text-[var(--study-ink)] not-italic">{duration(goal)} goal</em>
                        </span>
                    )}
                </div>
                <ol className="m-0 grid list-none grid-cols-7 gap-2 p-0 text-center text-[11px] text-ink-2 tabular-nums">
                    {w.days.map((d) => (
                        <li key={d.date} className="flex min-w-0 flex-col gap-px">
                            <b className={cn("text-[11.5px] font-semibold text-foreground", d.isToday && "font-extrabold text-[var(--study-ink)]")}>{d.label}</b>
                            {d.isToday && <span className="sr-only">today</span>}
                            {d.total > 0 && duration(d.total)}
                        </li>
                    ))}
                </ol>
            </div>
            {w.perCourse.length > 0 && <CourseBars list={w.perCourse} />}
            <SubHead note="newest first">Sessions</SubHead>
            {w.sessions.length
                ? <Sessions list={w.sessions} withDay onDelete={onDelete} />
                : <Hint>No study logged this week.</Hint>}
        </>
    )
}

/** Minutes by course, most first, each against the top one. */
function CourseBars({ list }: { list: [string, number][] }) {
    const top = list[0]?.[1] || 1
    return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {list.map(([id, minutes]) => (
                <li key={id} style={courseColour(id || null)} className="grid grid-cols-[minmax(64px,auto)_minmax(0,1fr)_62px] items-center gap-2.5 text-[12.5px]">
                    <span className="inline-flex items-center gap-[7px] text-[11.5px] font-bold tracking-[.04em] whitespace-nowrap text-foreground">
                        <i aria-hidden="true" className="size-2 rounded-full bg-[var(--c)]" />{courseCode(id || null)}
                    </span>
                    <span aria-hidden="true" className="h-[7px] overflow-hidden rounded-full bg-line-2">
                        <i style={{ width: Math.round((minutes / top) * 1000) / 10 + "%" }} className="block h-full rounded-full bg-[var(--c)]" />
                    </span>
                    <span className="text-right font-mono text-foreground">{duration(minutes)}</span>
                </li>
            ))}
        </ul>
    )
}

/* ── a session ── */

function Sessions({ list, withDay, onDelete }: { list: StudySession[]; withDay: boolean; onDelete: (id: string) => void }) {
    return (
        <ul className="m-0 flex list-none flex-col p-0">
            {list.map((s) => <SessionRow key={s.id} s={s} withDay={withDay} onDelete={onDelete} />)}
        </ul>
    )
}

const hm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") }

/** When, the course, what, how long, Timer or By hand, ✎ and ✕. Narrow, it takes two lines. */
function SessionRow({ s, withDay, onDelete }: { s: StudySession; withDay: boolean; onDelete: (id: string) => void }) {
    const it = s.itemId ? (itemOf(s.itemId) as Item | null) : null
    const note = s.note || (s.roundsDone ? plural(s.roundsDone, "round") : "")
    const at = new Date(s.startedAt)
    return (
        <li data-session={s.id} className={cn(
            "grid items-center gap-x-2.5 gap-y-1 border-t border-line-2 px-0.5 py-[7px] text-[13px] text-foreground",
            "[grid-template-columns:108px_84px_minmax(0,1fr)_64px_70px_auto]",
            "@max-[560px]:py-2.5 @max-[560px]:[grid-template-areas:'chip_what_mins'_'tm_src_acts'] @max-[560px]:[grid-template-columns:auto_minmax(0,1fr)_auto]",
        )}>
            <span className="font-mono text-[12px] whitespace-nowrap text-ink-2 @max-[560px]:[grid-area:tm]">
                {withDay && DOW[at.getDay()] + " " + at.getDate() + " · "}{hm(s.startedAt)}
            </span>
            <span style={courseColour(s.courseId)}
                className="inline-flex max-w-full items-center gap-1.5 justify-self-start overflow-hidden rounded-md bg-muted px-2 py-[3px] text-[11px] font-bold tracking-[.05em] whitespace-nowrap @max-[560px]:[grid-area:chip]">
                <i aria-hidden="true" className="size-[7px] flex-none rounded-full bg-[var(--c)]" />{courseCode(s.courseId)}
            </span>
            <span className="flex min-w-0 flex-col @max-[560px]:[grid-area:what]">
                <b className="truncate font-semibold">{it ? it.title : (courseOf(s.courseId) as Course | null)?.name || "No course"}</b>
                {note && <em className="truncate font-serif text-[12.5px] text-ink-2 italic">{note}</em>}
            </span>
            <span className="text-right font-mono font-semibold @max-[560px]:[grid-area:mins]">{duration(s.studyMinutes)}</span>
            <span className={cn(
                "justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold @max-[560px]:[grid-area:src]",
                s.manual ? "bg-[var(--chip-bg)] text-[var(--chip-ink)]" : "bg-[var(--study-soft)] text-[var(--study-ink)]",
            )}>{s.manual ? "By hand" : "Timer"}</span>
            <span className="flex gap-0.5 @max-[560px]:justify-self-end @max-[560px]:[grid-area:acts]">
                <RowButton label="Edit this session" data-edit onClick={() => openSession(s.id)}>
                    <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" strokeWidth="1.6" strokeLinejoin="round" />
                </RowButton>
                <RowButton label="Delete this session" onClick={() => onDelete(s.id)}>
                    <path d="m4.5 4.5 7 7m0-7-7 7" strokeWidth="1.8" strokeLinecap="round" />
                </RowButton>
            </span>
        </li>
    )
}

const RowButton = ({ label, onClick, children, ...rest }: { label: string; onClick: () => void; children: ReactNode; "data-edit"?: boolean }) => (
    <button type="button" aria-label={label} onClick={onClick} {...rest}
        className="grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-line-2 hover:text-foreground @max-[560px]:size-10">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true" className="size-3.5">{children}</svg>
    </button>
)

/** "Deleted ANAT · 45m from Tue 22 Sep." and Undo, until the delete is final. */
function UndoBar({ undo, onUndo }: { undo: SessionUndo; onUndo: () => void }) {
    const s = undo.session
    return (
        <div className="mx-3.5 mb-3.5 flex items-center gap-2.5 rounded-[10px] bg-muted py-2 pr-2 pl-3.5 text-[13px] text-foreground">
            <span className="flex-1">Deleted <b>{courseCode(s.courseId)} · {duration(s.studyMinutes)}</b> from {shortDate(dayOf(s))}.</span>
            <button type="button" data-undo onClick={onUndo}
                className="cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-1.5 font-[inherit] text-[13px] font-bold text-accent-foreground hover:bg-accent">
                Undo
            </button>
        </div>
    )
}

/* ── the month ── */

function MonthPane({ m, onDelete }: { m: MonthHist; onDelete: (id: string) => void }) {
    const s = m.stats, p = m.picked
    return (
        <>
            <div className="grid grid-cols-4 gap-2 @max-[520px]:grid-cols-2">
                <Stat value={duration(s.total)} label="studied" />
                <Stat value={s.count} label={s.count === 1 ? "session" : "sessions"} />
                <Stat value={<>{s.daysStudied}<small>/{s.daysSoFar}</small></>} label="days studied" />
                <Stat value={duration(s.average)} label="a day on average" />
            </div>
            <div role="group" aria-label={m.title} className="grid grid-cols-7 gap-[5px] @max-[520px]:gap-[3px]">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <span key={d} aria-hidden="true" className="pb-0.5 text-center text-[11px] font-semibold tracking-[.06em] text-ink-2 uppercase">{d}</span>
                ))}
                {Array.from({ length: m.lead }, (_, i) => <span key={"lead" + i} />)}
                {m.cells.map((c) => {
                    const box = "relative box-border flex min-h-[62px] min-w-0 flex-col items-start gap-0.5 rounded-[9px] border px-[7px] py-1.5 text-left font-[inherit] @max-[520px]:min-h-12 @max-[520px]:p-1"
                    if (c.future) {
                        return (
                            <span key={c.date} aria-hidden="true" className={cn(box, "border-dashed border-line-2 opacity-45")}>
                                <span className="text-[12px] font-bold text-ink-2">{c.day}</span>
                            </span>
                        )
                    }
                    return (
                        <button
                            key={c.date}
                            type="button"
                            data-day={c.date}
                            aria-pressed={c.picked}
                            aria-label={c.label + (c.met ? ", goal reached" : "")}
                            onClick={() => pickDay(c.date)}
                            className={cn(
                                box, "cursor-pointer text-foreground hover:border-muted-foreground", DAY_TINT[c.level] ?? DAY_TINT[0],
                                c.isToday ? "border-[color-mix(in_srgb,var(--study)_55%,transparent)]" : "border-line-2",
                                c.picked && "border-transparent shadow-[0_0_0_2px_var(--accent)]",
                            )}
                        >
                            <span className={cn("text-[12px] font-bold", c.isToday ? "text-[var(--study-ink)]" : "text-ink-2")}>{c.day}</span>
                            {c.minutes > 0 && <span className="font-mono text-[12px] font-semibold @max-[520px]:text-[10px]">{duration(c.minutes)}</span>}
                            {c.split.length > 0 && (
                                <span className="mt-auto flex h-1 w-full gap-px overflow-hidden rounded-full">
                                    {c.split.map(([id, v]) => <i key={id} style={{ ...courseColour(id || null), flexGrow: v }} className="block min-w-0.5 bg-[var(--c)]" />)}
                                </span>
                            )}
                            {c.met && <span aria-hidden="true" className="absolute top-[5px] right-[7px] text-[11px] font-extrabold text-[var(--study-ink)] @max-[520px]:top-[3px] @max-[520px]:right-1">✓</span>}
                        </button>
                    )
                })}
            </div>
            {p && (
                <div id={"hday-" + p.date}>
                    <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted px-2.5 py-2 text-[13px] text-foreground">
                        <b className={cn(p.isToday && "text-[var(--study-ink)]")}>{p.label}{p.isToday && " · today"}</b>
                        <span className="font-mono font-bold">{p.sessions.length ? duration(p.total) + " · " + plural(p.sessions.length, "session") : "No study"}</span>
                    </div>
                    {p.sessions.length
                        ? <Sessions list={p.sessions} withDay={false} onDelete={onDelete} />
                        : (
                            <Hint>
                                Nothing logged this day.{" "}
                                <button type="button" onClick={() => openSession(null)}
                                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[12.5px] font-semibold text-accent-foreground underline underline-offset-2">
                                    Log study
                                </button>
                            </Hint>
                        )}
                </div>
            )}
        </>
    )
}

const Stat = ({ value, label }: { value: ReactNode; label: string }) => (
    <span className="flex min-w-0 flex-col gap-px rounded-[10px] bg-muted px-3 py-[9px]">
        <b className="font-mono text-[19px] font-bold tracking-[-.01em] text-foreground [&_small]:text-[12px] [&_small]:font-semibold [&_small]:text-ink-2">{value}</b>
        <span className="text-[11.5px] text-ink-2">{label}</span>
    </span>
)

/* ── the term ── */

const DAY_NAMES = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

function TermPane({ t, onPick }: { t: TermHist; onPick: (date: string) => void }) {
    const grid = useRef<HTMLDivElement>(null)
    const past = t.weeks.flatMap((w) => w.days).filter((d) => !d.future)
    /* one day takes Tab (the picked one, else today); the arrows move between days */
    const [current, setCurrent] = useState<string | null>(null)
    const tabbable = (current && past.some((d) => d.date === current) ? current : null)
        ?? past.find((d) => d.picked)?.date ?? past.at(-1)?.date ?? null

    const onKey = (e: KeyboardEvent) => {
        const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key]
        const from = (e.target as HTMLElement).dataset?.day
        if (!step || !from) return
        const i = past.findIndex((d) => d.date === from), next = past[i + step]
        e.preventDefault()
        if (!next) return
        setCurrent(next.date)
        grid.current?.querySelector<HTMLElement>('[data-day="' + next.date + '"]')?.focus()
    }

    return (
        <>
            <p className="sr-only">Studied on {plural(t.daysStudied, "day")} in this range.</p>
            <div className="flex gap-1.5 overflow-x-auto px-0.5 pt-0.5 pb-1.5">
                <span aria-hidden="true" className="mt-[19px] grid grid-rows-[repeat(7,16px)] gap-[3px] font-mono text-[10.5px] leading-4 text-muted-foreground">
                    {DAY_NAMES.map((d, i) => <i key={i} className="not-italic">{d}</i>)}
                </span>
                <span className="flex flex-col gap-[5px]">
                    <span aria-hidden="true" className="grid h-3.5 auto-cols-[16px] grid-flow-col gap-[3px] font-mono text-[10.5px] whitespace-nowrap text-ink-2">
                        {t.weeks.map((w) => <span key={w.monday}>{w.month}</span>)}
                    </span>
                    <div ref={grid} role="group" aria-label={"Study by day, " + t.range} onKeyDown={onKey}
                        className="grid auto-cols-[16px] grid-flow-col grid-rows-[repeat(7,16px)] gap-[3px]">
                        {t.weeks.map((w) => <HeatColumn key={w.monday} week={w} tabbable={tabbable} onPick={onPick} onFocusDay={setCurrent} />)}
                    </div>
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-[5px] text-[11.5px] text-ink-2">
                <span>Click a day to see its sessions</span>
                <span className="flex-1" />
                <span>Less</span>
                {HEAT.map((tone, i) => <span key={i} aria-hidden="true" className={cn("block size-3 rounded-[3px]", tone)} />)}
                <span>More</span>
            </div>
            {t.perCourse.length > 0 && <>
                <SubHead>By course</SubHead>
                <CourseBars list={t.perCourse} />
            </>}
        </>
    )
}

function HeatColumn({ week, tabbable, onPick, onFocusDay }: { week: HeatWeek; tabbable: string | null; onPick: (date: string) => void; onFocusDay: (date: string) => void }) {
    const square = "box-border block size-4 rounded-[3px] p-0"
    return (
        <>
            {week.days.map((d) => d.future
                ? <span key={d.date} aria-hidden="true" className={cn(square, "border border-line-2")} />
                : (
                    <button
                        key={d.date}
                        type="button"
                        data-day={d.date}
                        aria-label={d.label}
                        title={d.label}
                        tabIndex={d.date === tabbable ? 0 : -1}
                        onFocus={() => onFocusDay(d.date)}
                        onClick={() => onPick(d.date)}
                        className={cn(
                            square, "cursor-pointer border-0", HEAT[d.level] ?? HEAT[0],
                            "hover:shadow-[0_0_0_2px_var(--ink-3)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]",
                            d.isToday && "shadow-[0_0_0_2px_var(--ink)]",
                            d.picked && "shadow-[0_0_0_2px_var(--accent)]",
                        )}
                    />
                ))}
        </>
    )
}
