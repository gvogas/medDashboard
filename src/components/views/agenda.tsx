// The Agenda: the Week as one list of days on a phone (data/agenda.ts). Each day is a
// heading and its classes and items on two lines each, so a long title has room; the
// empty days between fold into one line. Items open in the sheet, as in the Week.

import { useState } from "react"
import { cn } from "@/lib/utils"
import { isTest, tmeta } from "@/core/model"
import { diffDays, shortDate, today } from "@/core/dates"
import { crunchesOn, type Crunch } from "@/core/workload"
import { courseByKey, courseKeyOf, keyOf } from "@/data/effective"
import { AGENDA_DAYS, gapLabel, setWeekLayout, useAgenda, useNarrow, type AgendaRow, type WeekLayout } from "@/data/agenda"
import { tintOf, type Day, type Entry } from "@/data/views"
import { newItemOn, openItem } from "@/data/actions"
import { useUi } from "@/data/ui"
import { useCrunches } from "@/data/next"
import { CrunchBand, CrunchTag } from "./crunch"
import { SourceMark } from "./source-mark"
import { accent, classTitle, Empty, hasSchoolTags, HeadNote, Panel, ScheduleTabs, SchoolTags, statusText, Steps, TINT } from "./bits"

/** Two more weeks at a time, up to ten. */
const MAX_DAYS = 70

export function AgendaView() {
    const [days, setDays] = useState(AGENDA_DAYS)
    const schedule = useUi((u) => u.schedule)
    const agenda = useAgenda(days), empty = agenda.empty
    const any = agenda.rows.some((r) => r.kind === "day" && r.day.entries.length)
    /* the crunches in the days shown, as the Week marks them: a band, and a tag on a crowded day */
    const crunch = useCrunches(agenda.from, agenda.to)

    return (
        <div className="grid gap-[13px]">
            <Panel
                label="Agenda"
                title="Agenda"
                head={<>
                    <HeadNote>{schedule === "classes" ? "classes" : agenda.count + " item" + (agenda.count === 1 ? "" : "s")}</HeadNote>
                    <ScheduleTabs value={schedule} />
                    <LayoutTabs value="agenda" />
                </>}
            >
                <CrunchBand list={crunch} />
                <ol className="m-0 list-none p-0">
                    {agenda.rows.map((row) => <AgendaLine key={row.kind === "day" ? row.day.date : "gap" + row.from} row={row} crunch={crunch} />)}
                </ol>
                {!any && (empty
                    ? <Empty title="Nothing here yet">Add a course from the sidebar, then a first item with “New item”.</Empty>
                    : <Empty title="Nothing coming up">Nothing in these {Math.round(days / 7)} weeks, or the search and filters hide it.</Empty>)}
                {days < MAX_DAYS && (
                    <div className="border-t border-line-2 px-4 py-2.5">
                        <button type="button" onClick={() => setDays((d) => Math.min(MAX_DAYS, d + AGENDA_DAYS))}
                            className="min-h-10 w-full cursor-pointer rounded-lg border border-border bg-card font-[inherit] text-[13px] font-medium text-ink-2 hover:text-foreground">
                            Show two more weeks
                        </button>
                    </div>
                )}
            </Panel>
        </div>
    )
}

/** Agenda or Week, on a phone only: a wide screen always has the Week. */
export function LayoutTabs({ value }: { value: WeekLayout }) {
    const narrow = useNarrow()
    if (!narrow) return null
    return (
        <div role="group" aria-label="Layout" className="flex rounded-lg border border-border bg-muted p-0.5">
            {(["agenda", "week"] as const).map((id) => (
                <button key={id} type="button" aria-pressed={value === id} onClick={() => setWeekLayout(id)}
                    className={cn(
                        "min-h-9 cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 hover:text-foreground",
                        value === id && "bg-card text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]",
                    )}>
                    {id === "agenda" ? "Agenda" : "Week"}
                </button>
            ))}
        </div>
    )
}

function AgendaLine({ row, crunch }: { row: AgendaRow; crunch: Crunch[] }) {
    if (row.kind === "gap") {
        return <li className="border-t border-line-2 px-4 py-2 text-[12.5px] text-muted-foreground">{gapLabel(row)}</li>
    }
    return <DayBlock day={row.day} crunch={crunchesOn(crunch, row.day.date).filter((c) => c.kind !== "week")} />
}

/** "Today", "Tomorrow" or "", for the day's heading. */
const nearWord = (day: Day) => (day.isToday ? "Today" : diffDays(today(), day.date) === 1 ? "Tomorrow" : "")

function DayBlock({ day, crunch }: { day: Day; crunch: Crunch[] }) {
    const tint = tintOf(day.info)
    return (
        <li aria-label={shortDate(day.date)} className={cn("border-t border-line-2 py-1.5", tint && TINT[tint], day.isToday && "bg-[var(--accent-soft)] shadow-[inset_3px_0_0_var(--accent)]")}>
            <div className="flex items-center gap-2 px-4 pt-1 pb-0.5">
                <h3 className="m-0 flex-1 text-[13px] font-semibold text-foreground">
                    {nearWord(day) && <span className={day.isToday ? "text-accent-foreground" : undefined}>{nearWord(day)} · </span>}{shortDate(day.date)}
                </h3>
                <CrunchTag list={crunch} />
                <button
                    type="button"
                    onClick={() => newItemOn(day.date)}
                    aria-label={"Add item on " + day.date}
                    className="grid size-9 flex-none cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[18px] leading-none text-ink-2 hover:text-[var(--accent)]"
                >+</button>
            </div>
            {hasSchoolTags(day.info) && <div className="flex flex-wrap gap-1 px-4 pb-1"><SchoolTags info={day.info} /></div>}
            {day.entries.length
                ? <ul className="m-0 flex list-none flex-col gap-0.5 px-2 pb-1">{day.entries.map((e) => <li key={e.key}><AgendaEntry entry={e} /></li>)}</ul>
                : <p className="m-0 px-4 pb-1.5 text-[12.5px] text-muted-foreground">{tint === "off" || tint === "break" ? "" : "Nothing scheduled"}</p>}
        </li>
    )
}

const ROW = "grid w-full grid-cols-[44px_minmax(0,1fr)] items-start gap-x-2.5 rounded-[6px] px-2 py-1.5 text-left text-[14px]"
const clock = (t: string | null | undefined) => (t ? t.slice(0, 5) : "")

function AgendaEntry({ entry }: { entry: Entry }) {
    if (entry.kind === "class") {
        const { slot } = entry
        return (
            <div style={accent(slot.course.color)} title={classTitle(slot)} className={cn(ROW, "text-ink-2")}>
                <span className="pt-px font-mono text-[12.5px] text-muted-foreground">{clock(slot.mtg.start)}</span>
                <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                        <i aria-hidden="true" className="size-2 flex-none rounded-full border-[1.5px] border-[var(--c)]" />
                        <span className="truncate">{slot.mtg.kind || "Class"} · {slot.course.code || slot.course.name}</span>
                    </span>
                    <span className="truncate pl-4 text-[12.5px] text-muted-foreground">{[clock(slot.mtg.start) + "–" + clock(slot.mtg.end), slot.mtg.room].filter(Boolean).join(" · ")}</span>
                </span>
            </div>
        )
    }
    const it = entry.inst.item, c = courseByKey(courseKeyOf(it))
    const st = statusText(it, entry.inst.date), done = st.tone === "done"
    const meta = [tmeta(it.type).label, c?.code || c?.name, it.where].filter(Boolean).join(" · ")
    return (
        <button
            type="button"
            onClick={() => openItem(keyOf(it))}
            data-done={done || undefined}
            style={accent(tmeta(it.type).color)}
            className={cn(ROW, "min-h-11 cursor-pointer border-0 font-[inherit]", done ? "bg-[var(--done)] text-[var(--done-ink)]" : "bg-transparent text-foreground hover:bg-muted")}
        >
            <span className={cn("pt-px font-mono text-[12.5px]", done ? "" : "text-muted-foreground")}>{clock(it.start || it.end)}</span>
            <span className="flex min-w-0 flex-col">
                <span className={cn("flex min-w-0 items-center gap-2", !done && isTest(it.type) && "font-semibold")}>
                    <i aria-hidden="true" className={cn("size-2 flex-none rounded-[2px]", done ? "bg-[var(--done-ink)]" : "bg-[var(--c)]")} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{it.title}</span>
                    <SourceMark item={it} course={c} />
                </span>
                <span className="flex min-w-0 items-center gap-2 pl-4 text-[12.5px]">
                    <span className={cn("min-w-0 truncate", done ? "" : "text-muted-foreground")}>{meta}</span>
                    {st.text && <span className={cn("flex-none", st.tone === "late" ? "font-medium text-destructive" : st.tone === "soon" ? "font-medium text-[var(--warn)]" : st.tone === "done" ? "font-medium" : "text-muted-foreground")}>· {st.text}</span>}
                    {!done && <Steps item={it} />}
                </span>
            </span>
        </button>
    )
}
