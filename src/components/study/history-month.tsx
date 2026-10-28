// History, Month: a calendar whose days open their sessions.

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { duration } from "@/lib/time"
import { pickDay, type MonthHist, type PickedDay } from "@/data/study"
import { shortDate } from "@/core/dates"
import { openSession } from "@/data/actions"
import { courseColour, plural, DAY_TINT, Hint } from "./history-bits"
import { Sessions } from "./history-session"

export function MonthPane({ m, onDelete }: { m: MonthHist; onDelete: (id: string) => void }) {
    const s = m.stats, p = m.picked
    return (
        <>
            <div className="grid grid-cols-4 gap-2 @max-[520px]:grid-cols-2">
                <Stat value={duration(s.total)} label="studied" />
                <Stat value={s.count} label={s.count === 1 ? "session" : "sessions"} />
                <Stat value={<>{s.daysStudied}<small>/{s.daysSoFar}</small></>} label="days studied" />
            <Stat value={duration(s.average)} label={"a day on average" + (s.from ? " from " + shortDate(s.from) : "")} />
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
            {p && <DayPanel p={p} onDelete={onDelete} />}
        </>
    )
}

export function DayPanel({ p, onDelete }: { p: PickedDay; onDelete: (id: string) => void }) {
    return (
        <div data-picked>
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
    )
}

const Stat = ({ value, label }: { value: ReactNode; label: string }) => (
    <span className="flex min-w-0 flex-col gap-px rounded-[10px] bg-muted px-3 py-[9px]">
        <b className="font-mono text-[19px] font-bold tracking-[-.01em] text-foreground [&_small]:text-[12px] [&_small]:font-semibold [&_small]:text-ink-2">{value}</b>
        <span className="text-[11.5px] text-ink-2">{label}</span>
    </span>
)
