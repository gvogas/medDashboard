// The week board: seven days, each a date column beside its classes and items in time
// order, with office hours and tasks alongside. Items open in the sheet.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { isOpen, isOverdue, isTest, tmeta } from "@/core/model"
import { hhmm, parse, DOW } from "@/core/dates"
import { course as courseOf } from "@/core/store"
import { useUi } from "@/data/ui"
import { useWeek, tintOf, type Day, type Entry } from "@/data/views"
import { newItemOn, openItem, quickAddTask, toggleTask } from "@/data/actions"
import type { Course, Item } from "@/data/types"
import { accent, classTitle, Empty, HeadNote, Panel, ScheduleTabs, SchoolTags, statusText, Steps, TINT } from "./bits"

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

function DayRow({ day }: { day: Day }) {
    const tint = tintOf(day.info)
    return (
        <div className={cn(
            "grid grid-cols-[64px_minmax(0,1fr)] gap-1 border-t border-line-2 py-2 pr-3 pl-5 max-[520px]:grid-cols-[48px_minmax(0,1fr)] max-[520px]:pr-2 max-[520px]:pl-3",
            tint && TINT[tint],
            day.isToday && "bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]",
        )}>
            <div className="flex flex-col items-start gap-1 pt-1">
                <span className="flex items-baseline gap-1.5">
                    <span className="font-serif text-[21px] leading-none">{day.day}</span>
                    <span className="text-[12px] text-muted-foreground">{day.dow}</span>
                </span>
                {day.isToday && <span className="text-[11.5px] font-medium text-accent-foreground">Today</span>}
                <SchoolTags info={day.info} />
                <button
                    type="button"
                    onClick={() => newItemOn(day.date)}
                    aria-label={"Add item on " + day.date}
                    title={"Add on " + day.dow + " " + day.day + " " + day.mon}
                    className="grid size-6 cursor-pointer place-items-center rounded-md border border-border bg-card text-[15px] leading-none text-ink-2 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >+</button>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
                {day.entries.length
                    ? day.entries.map((e) => <EntryRow key={e.key} entry={e} />)
                    : <span className="px-2.5 py-1.5 text-[13px] text-muted-foreground">{tint === "off" || tint === "break" ? "" : "Nothing scheduled"}</span>}
            </div>
        </div>
    )
}

/* time, title, type, course, status; on a phone: time, title, status */
const ROW = "grid w-full grid-cols-[46px_minmax(0,1fr)_84px_124px_92px] items-center gap-3 rounded-[6px] px-2.5 min-h-[34px] text-left text-[14px] max-[720px]:grid-cols-[46px_minmax(0,1fr)_auto]"
const clock = (t: string | null | undefined) => (t ? t.slice(0, 5) : "")
/* the right-hand column; on a phone it can't squeeze the title */
const LAST = "max-[720px]:max-w-[40vw] truncate"

/** What the row no longer shows, for its tooltip: the title, where, and the time or the hour it's due. */
function rowTitle(it: Item) {
    const time = it.start && it.end ? clock(it.start) + "–" + clock(it.end) : it.start ? clock(it.start) : it.end ? "due " + clock(it.end) : ""
    return [it.title, it.where, time].filter(Boolean).join(" · ")
}

function EntryRow({ entry }: { entry: Entry }) {
    if (entry.kind === "class") {
        const { slot } = entry
        return (
            <div style={accent(slot.course.color)} title={classTitle(slot)} className={cn(ROW, "text-ink-2")}>
                <span className="font-mono text-[12.5px] text-muted-foreground">{clock(slot.mtg.start)}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                    <i aria-hidden="true" className="size-2 flex-none rounded-full border-[1.5px] border-[var(--c)]" />
                    <span className="truncate"><span>{slot.mtg.kind || "Class"}</span><span className="min-[721px]:hidden"> · {slot.course.code || slot.course.name}</span></span>
                </span>
                <span className="text-[12.5px] text-muted-foreground max-[720px]:hidden">Class</span>
                <span className="truncate text-[12.5px] text-muted-foreground max-[720px]:hidden">{slot.course.name || slot.course.code}</span>
                <span className={cn(LAST, "text-right text-[12.5px] text-muted-foreground")}>{slot.mtg.room}</span>
            </div>
        )
    }
    const it = entry.inst.item, c = courseOf(it.courseId) as Course | null
    const st = statusText(it, entry.inst.date), done = st.tone === "done"
    const key = !done && isTest(it.type)
    return (
        <button
            type="button"
            onClick={() => openItem(it.id)}
            data-done={done || undefined}
            title={rowTitle(it)}
            style={accent(tmeta(it.type).color)}
            className={cn(ROW, "cursor-pointer border-0 font-[inherit] transition-colors hover:brightness-[.975]",
                done ? "bg-[var(--done)] text-[var(--done-ink)]" : "bg-transparent text-foreground")}
        >
            <span className={cn("font-mono text-[12.5px]", done ? "" : "text-muted-foreground")}>{clock(it.start || it.end)}</span>
            <span className={cn("flex min-w-0 items-center gap-2.5 overflow-hidden", key && "font-semibold")}>
                <i aria-hidden="true" className={cn("size-2 flex-none rounded-[2px]", done ? "bg-[var(--done-ink)]" : "bg-[var(--c)]")} />
                <span className="truncate">{it.title}</span>
                {!done && <Steps item={it} />}
            </span>
            <span className={cn("text-[12.5px] max-[720px]:hidden", done ? "" : "text-muted-foreground")}>{tmeta(it.type).label}</span>
            <span className={cn("truncate text-[12.5px] max-[720px]:hidden", done ? "" : "text-muted-foreground")}>{c?.name || ""}</span>
            <span className={cn("flex items-center justify-end gap-1 text-right text-[12.5px] whitespace-nowrap max-[720px]:max-w-[40vw] overflow-hidden",
                st.tone === "late" ? "font-medium text-destructive" : st.tone === "soon" ? "font-medium text-[var(--warn)]" : st.tone === "done" ? "font-medium" : "text-muted-foreground")}>
                {done && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>}
                <span className="truncate">{st.text}</span>
            </span>
        </button>
    )
}

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
        <Panel label="Tasks" title="Tasks" head={<HeadNote>{open} open</HeadNote>} className="relative">
            {list.length === 0 && <Empty>No tasks</Empty>}
            <ul className="m-0 list-none px-1.5 py-0">
                {list.map((it) => {
                    const on = !isOpen(it)
                    return (
                        <li key={it.id} className={cn("flex items-center gap-2 rounded-[6px] px-2.5 py-1.5", on && "bg-[var(--done)] text-[var(--done-ink)]")}>
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
                                className={cn("min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-[inherit] text-[12.5px]", on ? "text-[var(--done-ink)]" : "text-foreground")}>
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
