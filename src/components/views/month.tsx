// The month: six weeks of classes and dated deadlines, as the tab asks, and the weekly
// timetable below. A day opens its week; a class opens its course.

import { cn } from "@/lib/utils"
import { isComplete, tmeta } from "@/core/model"
import { hhmm } from "@/core/dates"
import { useMonth, cellLabel, tintOf, type Cell, type Chip, type TimetableDay } from "@/data/views"
import { goToDay, openCourse } from "@/data/actions"
import { courseByKey, courseKeyOf, keyOf } from "@/data/effective"
import { SourceMark } from "./source-mark"
import { accent, classTitle, ClassText, HeadNote, Panel, ScheduleTabs, SchoolTags, TINT } from "./bits"

const HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function MonthView() {
    const { month, timetable, schedule } = useMonth()
    const n = month.classCount
    return (
        <div className="grid gap-[13px]">
            <Panel
                label="Month"
                title={month.title}
                head={<>
                    {month.range && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10.5px] font-bold tracking-[.04em] text-accent-foreground">{month.range}</span>}
                    <HeadNote>{n} weekly class{n === 1 ? "" : "es"}</HeadNote>
                    <ScheduleTabs value={schedule} />
                </>}
            >
                <div className="grid grid-cols-7">
                    {HEADS.map((d) => (
                        <div key={d} className="border-b border-border px-2 py-1.5 text-[10.5px] font-bold tracking-[.1em] text-muted-foreground uppercase">{d}</div>
                    ))}
                    {month.cells.map((c) => <MonthCell key={c.date} cell={c} />)}
                </div>
            </Panel>
            <Timetable days={timetable} />
        </div>
    )
}

function MonthCell({ cell }: { cell: Cell }) {
    const tint = tintOf(cell.info)
    return (
        <button
            type="button"
            onClick={() => goToDay(cell.date)}
            aria-label={cellLabel(cell)}
            className={cn(
                "flex min-h-[96px] min-w-0 cursor-pointer flex-col items-stretch gap-0.5 overflow-hidden border-0 border-r border-b border-line-2 bg-transparent p-1.5 text-left font-[inherit] [&:nth-child(7n)]:border-r-0",
                "hover:bg-muted max-[700px]:min-h-[64px] max-[700px]:p-1",
                tint && TINT[tint],
                cell.out && "opacity-45",
                cell.isToday && "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]",
            )}
        >
            <span className={cn(
                "self-start text-[12px] font-bold tabular-nums",
                cell.isToday ? "grid size-6 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground" : "text-ink-2",
            )}>{cell.day}</span>
            <span className="flex min-w-0 flex-wrap gap-0.5"><SchoolTags info={cell.info} /></span>
            {cell.chips.map((chip) => <MonthChip key={chip.key} chip={chip} />)}
            {cell.more > 0 && <span className="text-[10.5px] font-semibold text-muted-foreground">+{cell.more} more</span>}
            {cell.off > 0 && <span className="text-[10.5px] text-muted-foreground italic">{cell.off} class{cell.off === 1 ? "" : "es"} off</span>}
        </button>
    )
}

const CHIP = "flex h-5 min-w-0 flex-none items-center gap-1.5 rounded-[4px] px-1.5 text-[11.5px] max-[700px]:gap-1 max-[700px]:px-1 max-[700px]:text-[10px]"

/** A class in its course's colour; a deadline white with its type's square, tinted once completed. */
function MonthChip({ chip }: { chip: Chip }) {
    if (chip.kind === "class") {
        return (
            <span data-class-chip style={accent(chip.slot.course.color)} title={classTitle(chip.slot)}
                className={cn(CHIP, "bg-[color-mix(in_srgb,var(--c)_12%,var(--panel))] font-medium text-[color-mix(in_srgb,var(--c)_85%,var(--ink))]")}>
                <i aria-hidden="true" className="size-1.5 flex-none rounded-full bg-[var(--c)]" />
                <span className="truncate"><ClassText slot={chip.slot} compact /></span>
            </span>
        )
    }
    const it = chip.inst.item, m = tmeta(it.type), done = isComplete(it)
    return (
        <span style={accent(m.color)} title={m.label + ": " + it.title + (done ? " · Done" : "")} data-done={done || undefined}
            className={cn(CHIP, done ? "bg-[var(--done)] text-[var(--done-ink)]" : "bg-card text-foreground shadow-[inset_0_0_0_1px_var(--line)]")}>
            <i aria-hidden="true" className={cn("size-1.5 flex-none rounded-[1.5px]", done ? "bg-[var(--done-ink)]" : "bg-[var(--c)]")} />
            <span className="truncate">{it.start && <b className="font-mono font-medium">{hhmm(it.start)} </b>}{it.title}</span>
            <SourceMark item={it} course={courseByKey(courseKeyOf(it))} />
        </span>
    )
}

function Timetable({ days }: { days: TimetableDay[] }) {
    return (
        <Panel label="Weekly timetable" title="Weekly timetable" head={<HeadNote>time · room</HeadNote>}>
            <div className="grid gap-2.5 p-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                {days.map((d) => (
                    <div key={d.weekday} className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex items-baseline justify-between text-[11px] font-bold tracking-[.1em] text-ink-2 uppercase">
                            {d.dow}<em className="font-mono text-[10.5px] tracking-normal text-muted-foreground not-italic normal-case">{d.hours ? d.hours + " h" : "—"}</em>
                        </div>
                        {d.slots.length === 0 && <div className="rounded-lg border border-dashed border-line-2 px-2 py-2 text-[11.5px] text-muted-foreground">No classes</div>}
                        {d.slots.map((x) => (
                            <button
                                key={keyOf(x.course) + x.mtg.id}
                                type="button"
                                onClick={() => openCourse(keyOf(x.course))}
                                style={accent(x.course.color)}
                                className="flex cursor-pointer flex-col gap-px rounded-lg border border-border border-l-[3px] border-l-[var(--c)] bg-card px-2.5 py-1.5 text-left font-[inherit] hover:border-[color-mix(in_srgb,var(--c)_50%,var(--line))] hover:border-l-[var(--c)]"
                            >
                                <span className="font-mono text-[11px] text-ink-2">{hhmm(x.mtg.start)}–{hhmm(x.mtg.end)} <span className="font-sans text-muted-foreground">{x.mtg.kind || "Class"}</span></span>
                                <span className="truncate text-[12.5px] font-semibold text-foreground">{x.course.name}</span>
                                <span className="truncate text-[11px] text-muted-foreground">{x.mtg.room || "Room not set"}{x.course.instructor ? " · " + x.course.instructor : ""}</span>
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </Panel>
    )
}
