// The week board: seven days, each a date column beside its classes and items in time
// order, with office hours and tasks alongside. Items open in the legacy drawer.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { dueSoon, isComplete, isOpen, isOverdue, isTest, tmeta } from "@/legacy/js/model.js"
import { diffDays, hhmm, parse, today, DOW } from "@/legacy/js/dates.js"
import { course as courseOf } from "@/legacy/js/store.js"
import { useUi } from "@/data/ui"
import { useWeek, tintOf, type Day, type Entry, type Instance } from "@/data/views"
import { newItemOn, openItem, quickAddTask, toggleTask } from "@/data/actions"
import type { Course, Item } from "@/data/types"
import {
    accent, classTitle, ClassText, Empty, HeadNote, onActivate, Panel, ScheduleTabs, SchoolTags, SoonChip, StatusChip, Steps, TINT, TypeChip,
} from "./bits"

export function WeekView() {
    const { week, officeHours, tasks, empty, schedule } = useWeek()
    const cs = useUi((u) => u.bg === "cs")
    const n = week.count

    return (
        <div className="grid items-start gap-[13px] [grid-template-columns:minmax(0,1fr)_256px] max-[1040px]:[grid-template-columns:minmax(0,1fr)]">
            <Panel
                label="Schedule"
                title="Schedule"
                head={<>
                    <HeadNote>{schedule === "classes" ? "classes" : n + " item" + (n === 1 ? "" : "s")}</HeadNote>
                    <ScheduleTabs value={schedule} />
                </>}
            >
                <Rule cs={cs} />
                {week.days.map((d) => <DayRow key={d.date} day={d} />)}
                {!week.any && (empty
                    ? <Empty title="Nothing here yet">Add a course from the sidebar, then a first item with “New item”.</Empty>
                    : <Empty title="No matches this week">Try clearing the search or a filter.</Empty>)}
            </Panel>

            <div className="grid min-w-0 gap-[13px]">
                <OfficeHours rows={officeHours} cs={cs} />
                <Tasks list={tasks.shown} open={tasks.open} cs={cs} />
            </div>
        </div>
    )
}

/** Med: the double helix under the header. CS: a two-line data bus, ticked where the rungs are. */
const HELIX_A = 'M0 5.5c12-5.5 24-5.5 36 0s24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0'
const HELIX_B = 'M0 5.5c12 5.5 24 5.5 36 0s24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0 24-5.5 36 0 24 5.5 36 0'
const TICKS = Array.from({ length: 11 }, (_, i) => 18 + 36 * i)

const Rule = ({ cs }: { cs: boolean }) => (
    <svg viewBox="0 0 400 11" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="1.05" aria-hidden="true" className="block h-[11px] w-full text-[var(--accent)] opacity-35">
        {cs
            ? <><path d="M0 3h400M0 8h400" /><path d={TICKS.map((x) => `M${x} 3v5`).join("")} /></>
            : <><path d={HELIX_A} /><path d={HELIX_B} /><path d={TICKS.map((x) => `M${x} 1.8v7.4`).join("")} /></>}
    </svg>
)

function DayRow({ day }: { day: Day }) {
    const tint = tintOf(day.info)
    return (
        <div className={cn(
            "grid [grid-template-columns:72px_minmax(0,1fr)] gap-3 border-b border-line-2 px-3.5 py-2.5 last:border-b-0 max-[520px]:[grid-template-columns:52px_minmax(0,1fr)] max-[520px]:gap-2 max-[520px]:px-2.5",
            tint && TINT[tint],
            day.isToday && "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
        )}>
            <div className="flex flex-col items-start gap-1">
                <span className={cn("text-[10.5px] font-bold tracking-[.1em] uppercase", day.isToday ? "text-accent-foreground" : "text-muted-foreground")}>{day.dow}</span>
                <span className={cn(
                    "text-[22px] leading-none font-bold tabular-nums",
                    day.isToday ? "grid size-9 place-items-center rounded-full bg-primary text-[17px] text-primary-foreground" : "text-foreground",
                )}>{day.day}</span>
                {day.isToday && <span className="sr-only">Today</span>}
                <SchoolTags info={day.info} />
                <button
                    type="button"
                    onClick={() => newItemOn(day.date)}
                    aria-label={"Add item on " + day.date}
                    title={"Add on " + day.dow + " " + day.day + " " + day.mon}
                    className="grid size-6 cursor-pointer place-items-center rounded-md border border-border bg-card text-[15px] leading-none text-ink-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >+</button>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
                {day.entries.length
                    ? day.entries.map((e) => <EntryCard key={e.key} entry={e} />)
                    : <span className="py-1.5 text-[12px] text-muted-foreground">{tint === "off" || tint === "break" ? "" : "Nothing due"}</span>}
            </div>
        </div>
    )
}

function EntryCard({ entry }: { entry: Entry }) {
    if (entry.kind === "class") {
        const { slot } = entry
        return (
            <div style={accent(slot.course.color)} title={classTitle(slot)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-[color-mix(in_srgb,var(--c)_45%,var(--line))] px-2.5 py-1.5 text-[12px] text-ink-2">
                <i aria-hidden="true" className="h-4 w-[3px] flex-none rounded-full bg-[var(--c)] opacity-60" />
                <span className="min-w-0 truncate"><ClassText slot={slot} /></span>
                {slot.mtg.kind && <span className="ml-auto flex-none text-[10.5px] text-muted-foreground">{slot.mtg.kind}</span>}
            </div>
        )
    }
    return <ItemCard inst={entry.inst} />
}

function ItemCard({ inst }: { inst: Instance }) {
    const it = inst.item, c = courseOf(it.courseId) as Course | null
    const done = isComplete(it)
    const bits = [c?.name, it.where, it.start && it.end ? hhmm(it.start) + "–" + hhmm(it.end) : it.start ? hhmm(it.start) : it.end ? "due " + hhmm(it.end) : "", it.recur === "weekly" ? "weekly" : ""].filter(Boolean)
    const soon = !isOverdue(it) && it.status === "todo" && dueSoon(it) && (it.type === "assignment" || isTest(it.type))
    return (
        <button
            type="button"
            onClick={() => openItem(it.id)}
            style={accent(tmetaColor(it))}
            className={cn(
                "flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card py-2 pr-2.5 pl-0 text-left font-[inherit] shadow-[0_1px_2px_rgba(0,0,0,.05)]",
                "transition-[border-color,box-shadow] hover:border-[color-mix(in_srgb,var(--c)_50%,var(--line))] hover:shadow-[0_2px_8px_rgba(0,0,0,.08)]",
                done && "opacity-60",
            )}
        >
            <i aria-hidden="true" className="ml-1.5 w-[3px] self-stretch rounded-full bg-[var(--c)]" />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-[13px] font-semibold text-foreground", done && it.type === "task" && "line-through")}>{it.title}</span>
                {bits.length > 0 && <span className="truncate text-[11.5px] text-muted-foreground">{bits.join(" · ")}</span>}
                <Steps item={it} />
            </span>
            <span className="flex flex-none flex-wrap justify-end gap-1">
                <TypeChip type={it.type} />
                {isOverdue(it) || it.status !== "todo"
                    ? <StatusChip item={it} />
                    : soon && <SoonChip>{diffDays(today(), inst.date) === 0 ? "Today" : "Soon"}</SoonChip>}
            </span>
        </button>
    )
}

const tmetaColor = (it: Item) => tmeta(it.type).color as string

function OfficeHours({ rows, cs }: { rows: Item[]; cs: boolean }) {
    return (
        <Panel label="Office hours" title="Office hours" head={<HeadNote>weekly</HeadNote>}>
            {rows.length === 0 && <Empty>None yet</Empty>}
            <ul className="m-0 list-none p-0">
                {rows.map((it, i) => {
                    const c = courseOf(it.courseId) as Course | null
                    const when = (it.recur === "weekly" ? DOW[it.weekday ?? 0] : DOW[parse(it.date).getDay()]) + " " + hhmm(it.start)
                    return (
                        <li key={it.id}>
                            <button type="button" onClick={() => openItem(it.id)}
                                className="flex w-full cursor-pointer items-start gap-2 border-0 border-b border-line-2 bg-transparent px-3.5 py-2 text-left font-[inherit] last:border-b-0 hover:bg-muted">
                                {i === 0 && <Scope cs={cs} />}
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[12.5px] font-semibold text-foreground">{it.title.replace(" — office hours", "")}</span>
                                    <span className="block text-[11px] text-muted-foreground">{it.dept || c?.code || ""}</span>
                                </span>
                                <span className="flex-none text-right font-mono text-[11.5px] text-ink-2">
                                    {when}
                                    {it.where && <span className="block font-sans text-[11px] text-muted-foreground">{it.where}</span>}
                                </span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </Panel>
    )
}

/** The next office hour's mark: a stethoscope, or a prompt on CS. */
const Scope = ({ cs }: { cs: boolean }) => (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-label="Next" role="img" className="mt-0.5 size-4 flex-none text-[var(--accent)]">
        {cs ? <path d="M3 6l5 4-5 4M10 15h7" /> : <><path d="M4 3c0 6 2 7 4 9s6 3 8 1" /><circle cx="16" cy="14" r="3.4" /></>}
    </svg>
)

function Tasks({ list, open, cs }: { list: Item[]; open: number; cs: boolean }) {
    const [text, setText] = useState("")
    return (
        <Panel label="Tasks" title="Tasks" head={<HeadNote>{open} open</HeadNote>} className="relative overflow-hidden">
            {list.length === 0 && <Empty>No tasks</Empty>}
            <ul className="m-0 list-none p-0">
                {list.map((it) => {
                    const on = !isOpen(it)
                    return (
                        <li key={it.id} className="flex items-center gap-2 px-3.5 py-1.5">
                            <button
                                type="button"
                                aria-pressed={on}
                                aria-label={"Done: " + it.title}
                                onClick={(e) => { void toggleTask(it.id, e.currentTarget) }}
                                className={cn(
                                    "grid size-[18px] flex-none cursor-pointer place-items-center rounded-[5px] border-[1.5px] p-0",
                                    on ? "border-primary bg-primary text-primary-foreground" : "border-line-2 bg-card text-transparent hover:border-[var(--accent)]",
                                )}
                            >
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-3"><path d="M2 6.5l2.6 2.6L10 3.5" /></svg>
                            </button>
                            <button type="button" onClick={() => openItem(it.id)}
                                className={cn("min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[12.5px]", on ? "text-muted-foreground line-through" : "text-foreground")}>
                                {it.title}
                                {it.date && <span className="ml-1 text-[11px] text-muted-foreground">· {isOverdue(it) ? "overdue" : DOW[parse(it.date).getDay()] + " " + parse(it.date).getDate()}</span>}
                            </button>
                        </li>
                    )
                })}
            </ul>
            <div className="relative z-[1] px-3.5 pt-1.5 pb-3">
                <input
                    type="text"
                    value={text}
                    maxLength={140}
                    placeholder="Add a task, press Enter"
                    aria-label="Add a task"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || !text.trim()) return
                        e.preventDefault()
                        const title = text
                        setText("")
                        void quickAddTask(title)
                    }}
                    className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 font-[inherit] text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--accent)]"
                />
            </div>
            <Corner cs={cs} />
        </Panel>
    )
}

/** Med: a steroid in the corner. CS: a small binary tree. */
const Corner = ({ cs }: { cs: boolean }) => (
    <svg viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"
        className="pointer-events-none absolute -right-2 -bottom-3 h-[60px] w-[90px] text-[var(--accent)] opacity-[calc(.35*var(--orn-art))]">
        {cs ? (
            <>
                <circle cx="60" cy="12" r="6" /><circle cx="32" cy="40" r="6" /><circle cx="88" cy="40" r="6" />
                <circle cx="18" cy="68" r="5" /><circle cx="46" cy="68" r="5" /><circle cx="102" cy="68" r="5" />
                <path d="M55 16L37 36M65 16l18 20M28 45l-7 18M36 45l7 18M92 45l7 18" />
            </>
        ) : (
            <>
                <path d="M14 46l-9-16 9-16 18 1 8 15-8 16z" /><path d="M32 31l18 1 8 15-8 16-18-1-8-15" />
                <path d="M50 32l17-8 13 11-5 17-17 3-8-15" /><path d="M80 35l16-4 8 12-11 11-13-5z" />
            </>
        )}
    </svg>
)
