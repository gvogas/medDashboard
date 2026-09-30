// Pieces the week, month and table views share: the panel, the schedule tabs, the chips,
// the checklist bar, a class, the school calendar's tags. Colours are a type's or a
// course's, passed as --c through style (the CSP allows styles set through the DOM).

import type { CSSProperties, KeyboardEvent, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { isOverdue, statusLabel, tmeta } from "@/core/model"
import { hhmm, DOW } from "@/core/dates"
import { setSchedule } from "@/data/actions"
import type { ClassSlot, DayInfo } from "@/data/views"
import type { Item, Schedule } from "@/data/types"

/** A colour for --c, from a type or course; anything but #rrggbb is left out. */
export const accent = (color: string | undefined): CSSProperties | undefined =>
    color && /^#[0-9a-f]{6}$/i.test(color) ? ({ "--c": color } as CSSProperties) : undefined

/** Enter or Space on something that is not a button, as a click. */
export function onActivate(run: () => void) {
    return (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
        e.preventDefault()
        run()
    }
}

/** A panel: a card with a header line (title, then whatever `head` adds). `fill` takes the height left. */
export function Panel({ title, head, className, children, label, fill = false }: { title: ReactNode; head?: ReactNode; className?: string; children: ReactNode; label?: string; fill?: boolean }) {
    return (
        <Card className={cn("min-w-0 overflow-hidden", fill && "flex min-h-0 flex-1 flex-col", className)}>
            <section aria-label={label} className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border px-5 py-2">
                    <h2 className="m-0 flex-1 text-[14px] font-semibold text-foreground">{title}</h2>
                    {head}
                </div>
                {children}
            </section>
        </Card>
    )
}

/** The small grey count or note at the end of a panel's header. */
export const HeadNote = ({ children }: { children: ReactNode }) => (
    <em className="ml-auto text-[10.5px] tracking-[.04em] text-muted-foreground not-italic">{children}</em>
)

const TABS: [Schedule, string][] = [["all", "Everything"], ["deadlines", "Deadlines"], ["classes", "Classes"]]

/** Everything / Deadlines / Classes, shared by the week and the month. */
export function ScheduleTabs({ value }: { value: Schedule }) {
    return (
        <div role="group" aria-label="Show" className="flex rounded-lg border border-border bg-muted p-0.5">
            {TABS.map(([id, label]) => (
                <button
                    key={id}
                    type="button"
                    aria-pressed={value === id}
                    onClick={() => setSchedule(id)}
                    className={cn(
                        "cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 hover:text-foreground",
                        value === id && "bg-card text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]",
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}

const chip = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold"

export function TypeChip({ type }: { type: string }) {
    const m = tmeta(type)
    return <span style={accent(m.color)} className={cn(chip, "bg-[color-mix(in_srgb,var(--c)_14%,var(--panel))] text-[color-mix(in_srgb,var(--c)_80%,var(--ink))]")}>{m.label}</span>
}

const STATUS_TONE: Record<string, string> = {
    todo: "bg-[var(--chip-bg)] text-[var(--chip-ink)]",
    submitted: "bg-[var(--pink-bg)] text-[var(--pink-ink)]",
    graded: "bg-[var(--pink-bg)] text-[var(--pink-ink)]",
    done: "bg-[var(--pink-bg)] text-[var(--pink-ink)]",
    missed: "bg-[var(--red-bg)] text-[var(--red-ink)]",
}

/** Overdue, or the item's status in its type's words, with the grade once graded. */
export function StatusChip({ item }: { item: Item }) {
    if (isOverdue(item)) return <span className={cn(chip, "bg-[var(--red-bg)] text-[var(--red-ink)]")}>Overdue</span>
    return (
        <span className={cn(chip, STATUS_TONE[item.status] ?? STATUS_TONE.todo)}>
            {statusLabel(item)}{item.status === "graded" && typeof item.grade === "number" ? " " + item.grade + "%" : ""}
        </span>
    )
}

export const SoonChip = ({ children }: { children: ReactNode }) => (
    <span className={cn(chip, "bg-[var(--amber-bg)] text-[var(--amber-ink)]")}>{children}</span>
)

/** The checklist's progress: a bar that fills in pink, and "2 of 5 steps". */
export function Steps({ item }: { item: Item }) {
    const list = item.checklist || []
    if (!list.length) return null
    const done = list.filter((x) => x.done).length, full = done === list.length
    return (
        <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-2">
            <span className="h-[5px] w-[54px] flex-none overflow-hidden rounded-full bg-line-2">
                <i
                    className={cn("block h-full rounded-full", full ? "bg-[linear-gradient(90deg,#DE7A9C,#C8517A)]" : "bg-[linear-gradient(90deg,#EFAEC3,#D9648C)]")}
                    style={{ width: Math.round((done / list.length) * 100) + "%" }}
                />
            </span>
            {full ? "all " + list.length + " steps done" : done + " of " + list.length + " steps"}
        </span>
    )
}

/** "09:00 Anatomy · Hall B" for a class; `compact` is the month cell's one line. */
export function ClassText({ slot, compact = false }: { slot: ClassSlot; compact?: boolean }) {
    const { course, mtg } = slot
    return (
        <>
            <b className="font-mono font-semibold">{hhmm(mtg.start)}</b>{compact ? " " : "–" + hhmm(mtg.end) + " "}
            <span className={compact ? "" : "font-semibold text-foreground"}>{course.name || course.code}</span>
            {mtg.room && <span className="text-muted-foreground"> · {mtg.room}</span>}
        </>
    )
}

export const classTitle = ({ course, mtg }: ClassSlot) => [course.code, mtg.kind, mtg.room].filter(Boolean).join(" · ")

const TAG = "inline-flex max-w-full flex-none items-center gap-1 overflow-hidden rounded px-1.5 py-px text-[9.5px] font-bold tracking-[.04em] text-ellipsis whitespace-nowrap uppercase"
const TAG_TONE: Record<string, string> = {
    off: "bg-[var(--chip-bg)] text-ink-2",
    break: "bg-[color-mix(in_srgb,var(--good)_20%,var(--panel))] text-[var(--good)]",
    exams: "bg-[color-mix(in_srgb,var(--warn)_22%,var(--panel))] text-[var(--amber-ink)]",
    swap: "bg-accent text-accent-foreground",
}

/** A school day's tags: no classes, a break, exams, another day's timetable, and markers. */
export function SchoolTags({ info }: { info: DayInfo | null }) {
    if (!info) return null
    return (
        <>
            {(info.kind === "off" || info.kind === "break" || info.kind === "exams") && <span className={cn(TAG, TAG_TONE[info.kind])}>{info.label}</span>}
            {info.kind === "swap" && <span className={cn(TAG, TAG_TONE.swap)} title={info.label || undefined}>Follows {DOW[info.follows ?? 1]}</span>}
            {info.notes.map((n, i) => (
                <span key={i} className={cn(TAG, "px-0 font-semibold tracking-normal text-muted-foreground normal-case")}>
                    <i aria-hidden="true" className="size-1.5 flex-none rounded-full bg-muted-foreground" />{n}
                </span>
            ))}
        </>
    )
}

/** The tint of a school day with no classes, a break or exams. */
export const TINT: Record<string, string> = {
    off: "bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]",
    none: "bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]",
    break: "bg-[color-mix(in_srgb,var(--good)_7%,transparent)]",
    exams: "bg-[color-mix(in_srgb,var(--warn)_8%,transparent)]",
}

/** A message for an empty panel: a bold line and a hint. */
export const Empty = ({ title, children }: { title?: string; children?: ReactNode }) => (
    <div className="px-3.5 py-5 text-center text-[12.5px] text-muted-foreground">
        {title && <b className="mb-0.5 block font-semibold text-ink-2">{title}</b>}
        {children}
    </div>
)
