// The item card's date: the chosen day in words, Today, and a Week / Month switch. Week is
// the chosen day's week as seven buttons with ‹ › (the day a week back or on); Month is a
// calendar with ‹ October 2026 ›, and picking a day there goes back to Week. Today is
// ringed; a day that already has something due has a dot.

import { useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { addDays, diffDays, iso, MON, monday, parse, shortDate, today } from "@/core/dates"
import { Segmented } from "./fields"

/** The seven days, Monday first, of the week holding `date`. */
export const weekOf = (date: string): string[] => {
    const m = monday(parse(date))
    return Array.from({ length: 7 }, (_, i) => iso(addDays(m, i)))
}

/** A month (0–11) as whole weeks, Monday first: days of the months around it fill the first and last rows. */
export function monthDays(year: number, month: number): string[] {
    const first = iso(monday(new Date(year, month, 1)))
    const n = diffDays(first, iso(new Date(year, month + 1, 0))) + 1
    return Array.from({ length: Math.ceil(n / 7) * 7 }, (_, i) => iso(addDays(parse(first), i)))
}

/** "Wed 23 Sep · today", "Thu 24 Sep · tomorrow", "Fri 2 Oct". */
export function pickedLabel(date: string, now = today()): string {
    const d = diffDays(now, date)
    return shortDate(date) + (d === 0 ? " · today" : d === 1 ? " · tomorrow" : "")
}

const MODES = [["week", "Week"], ["month", "Month"]] as const
const HEADS = ["M", "T", "W", "T", "F", "S", "S"]

const Chevron = ({ back }: { back?: boolean }) => (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={back ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} />
    </svg>
)
const ARROW = "grid cursor-pointer place-items-center rounded-lg border-0 bg-transparent p-0 text-ink-2 hover:bg-muted hover:text-foreground"

/** The day's name for a screen reader: "Fri 25 Sep", ", something due" when it has a dot. */
const dayName = (d: string, busy: ReadonlySet<string>) => shortDate(d) + (busy.has(d) ? ", something due" : "")

export function DatePicker({ value, onChange, busy }: { value: string; onChange: (date: string) => void; busy: ReadonlySet<string> }) {
    const [mode, setMode] = useState<"week" | "month">("week")
    /* the month shown: the chosen day's when Month opens, then wherever ‹ › take it */
    const [shown, setShown] = useState(() => { const d = parse(value); return [d.getFullYear(), d.getMonth()] as const })
    const [prevValue, setPrevValue] = useState(value)
    if (value !== prevValue) { setPrevValue(value); const d = parse(value); setShown([d.getFullYear(), d.getMonth()]) }
    const root = useRef<HTMLDivElement>(null)
    const refocus = useRef(false)   /* a pick in Month unmounts the focused button: focus the chosen day once Week is back */
    useLayoutEffect(() => {
        if (mode === "week" && refocus.current) { refocus.current = false; root.current?.querySelector<HTMLElement>("[role=group][aria-label=Days] [aria-pressed=true]")?.focus() }
    }, [mode])
    const now = today()
    const pick = (d: string) => { if (d !== value) onChange(d); if (mode === "month") refocus.current = true; setMode("week") }
    const openMode = (m: "week" | "month") => {
        if (m === "month") { const d = parse(value); setShown([d.getFullYear(), d.getMonth()]) }
        setMode(m)
    }
    const moveMonth = (by: number) => { const d = new Date(shown[0], shown[1] + by, 1); setShown([d.getFullYear(), d.getMonth()]) }
    const title = MON[shown[1]] + " " + shown[0]

    return (
        <div ref={root} className="flex flex-col gap-1.5">
            <div className="flex h-8 items-center gap-1">
                <span className="flex-1 text-[14px] font-semibold">{pickedLabel(value, now)}</span>
                <button type="button" onClick={() => pick(now)} className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2.5 font-[inherit] text-[12px] text-ink-2 hover:bg-muted hover:text-foreground">Today</button>
                <Segmented label="Show" value={mode} options={MODES} onChange={openMode} />
            </div>

            {mode === "week" ? (
                <div className="grid grid-cols-[26px_repeat(7,minmax(0,1fr))_26px] items-center gap-1">
                    <button type="button" aria-label="Previous week" onClick={() => onChange(iso(addDays(parse(value), -7)))} className={cn(ARROW, "h-[46px] w-[26px]")}><Chevron back /></button>
                    <div role="group" aria-label="Days" className="col-span-7 grid grid-cols-7 gap-1">
                        {weekOf(value).map((d) => {
                            const on = d === value
                            return (
                                <button key={d} type="button" aria-pressed={on} aria-label={dayName(d, busy)} aria-current={d === now ? "date" : undefined}
                                    onClick={() => pick(d)}
                                    className={cn(
                                        "relative flex h-[46px] cursor-pointer flex-col items-center justify-center gap-px rounded-lg border p-0 font-[inherit]",
                                        on ? "border-foreground bg-foreground text-background"
                                            : d === now ? "border-[var(--accent)] bg-[var(--accent-soft)] text-foreground"
                                            : "border-border bg-card text-foreground hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--line))]",
                                    )}>
                                    <span className="text-[10.5px] opacity-80">{d === now ? "Today" : shortDate(d).slice(0, 3)}</span>
                                    <span className="text-[15px] font-semibold tabular-nums">{parse(d).getDate()}</span>
                                    {busy.has(d) && !on && <span aria-hidden="true" className="absolute bottom-1 size-1 rounded-full bg-[var(--accent)]" />}
                                </button>
                            )
                        })}
                    </div>
                    <button type="button" aria-label="Next week" onClick={() => onChange(iso(addDays(parse(value), 7)))} className={cn(ARROW, "h-[46px] w-[26px]")}><Chevron /></button>
                </div>
            ) : (
                <div className="flex flex-col gap-1 rounded-[10px] border border-line-2 bg-[var(--panel-2)] p-2.5">
                    <div className="flex items-center justify-between">
                        <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className={cn(ARROW, "size-[30px] rounded-full hover:bg-card")}><Chevron back /></button>
                        <span aria-live="polite" className="text-[13px] font-semibold">{title}</span>
                        <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className={cn(ARROW, "size-[30px] rounded-full hover:bg-card")}><Chevron /></button>
                    </div>
                    <div aria-hidden="true" className="grid grid-cols-7 gap-0.5">
                        {HEADS.map((h, i) => <span key={i} className="grid h-[22px] place-items-center text-[11px] text-muted-foreground">{h}</span>)}
                    </div>
                    <div role="group" aria-label={title} className="grid grid-cols-7 gap-0.5">
                        {monthDays(shown[0], shown[1]).map((d) => {
                            const on = d === value, inMonth = parse(d).getMonth() === shown[1]
                            return (
                                <button key={d} type="button" aria-pressed={on} aria-label={dayName(d, busy)} aria-current={d === now ? "date" : undefined}
                                    onClick={() => pick(d)}
                                    className={cn(
                                        "relative h-8 cursor-pointer rounded-full border-0 p-0 font-[inherit] text-[12.5px] tabular-nums",
                                        on ? "bg-foreground font-semibold text-background"
                                            : cn("bg-transparent hover:bg-card", inMonth ? "text-foreground" : "text-muted-foreground",
                                                d === now && "font-semibold shadow-[inset_0_0_0_1.5px_var(--accent)]"),
                                    )}>
                                    {parse(d).getDate()}
                                    {busy.has(d) && !on && <span aria-hidden="true" className="absolute bottom-[3px] left-1/2 -ml-0.5 size-1 rounded-full bg-[var(--accent)]" />}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
