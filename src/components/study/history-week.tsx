// History, Week: a bar a day split by course against the goal, beside its sessions.

import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { type WeekHist } from "@/data/study"
import { courseColour, courseCode, SubHead, Hint } from "./history-bits"
import { Sessions } from "./history-session"

export function WeekPane({ w, goal, onDelete }: { w: WeekHist; goal: number; onDelete: (id: string) => void }) {
    return (
        <div className="grid items-start gap-x-8 gap-y-3.5 @min-[880px]:grid-cols-2">
            <div data-col="chart" className="flex min-w-0 flex-col gap-3.5">
                <div className="flex flex-wrap items-baseline gap-2">
                    <b className="font-mono text-[28px] font-extrabold tracking-[-.02em] text-foreground">{duration(w.total)}</b>
                    <span className="text-[12.5px] text-ink-2">{w.summary}</span>
                </div>
                <div>
                    <div className="relative mb-1.5 h-[130px] @min-[880px]:h-[210px]">
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
                                <b className={cn("text-[11.5px] font-semibold whitespace-nowrap text-foreground @max-[420px]:text-[10.5px]", d.isToday && "font-extrabold text-[var(--study-ink)]")}>{d.label}</b>
                                {d.isToday && <span className="sr-only">today</span>}
                                {d.total > 0 && duration(d.total)}
                            </li>
                        ))}
                    </ol>
                </div>
                {w.perCourse.length > 0 && <CourseBars list={w.perCourse} />}
            </div>
            {/* its own container: the rows take two lines when this column is narrow */}
            <div data-col="sessions" className="@container flex min-w-0 flex-col gap-3.5">
                <SubHead note="newest first">Sessions</SubHead>
                {w.sessions.length
                    ? <Sessions list={w.sessions} withDay onDelete={onDelete} />
                    : <Hint>No study logged this week.</Hint>}
            </div>
        </div>
    )
}

/** Minutes by course, most first, each against the top one. */
export function CourseBars({ list }: { list: [string, number][] }) {
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
