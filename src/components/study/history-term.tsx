// History, Term: a heatmap from the term's start, whose days open their month.

import { useRef, useState, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { type HeatWeek, type TermHist } from "@/data/study"
import { plural, HEAT, SubHead } from "./history-bits"
import { CourseBars } from "./history-week"

const DAY_NAMES = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

export function TermPane({ t, onPick }: { t: TermHist; onPick: (date: string) => void }) {
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
                            /* the ::after grows the hit area to 24px (WCAG 2.5.8) without moving the 16px squares */
                            square, "relative cursor-pointer border-0 after:absolute after:-inset-1 after:content-['']", HEAT[d.level] ?? HEAT[0],
                            "hover:shadow-[0_0_0_2px_var(--ink-3)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]",
                            d.isToday && "shadow-[0_0_0_2px_var(--ink)]",
                            d.picked && "shadow-[0_0_0_2px_var(--accent)]",
                        )}
                    />
                ))}
        </>
    )
}
