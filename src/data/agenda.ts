// The Agenda: the Week as one list of days for a phone. It starts today (or on the Monday
// of the week the arrows moved to) and runs two weeks, longer with Show more. A day with
// nothing on it folds into the gap before the next one that has something: "Nothing until
// Thu 23 Oct". Today always shows, empty or not. The days themselves come from weekDays,
// so the Agenda shows exactly what the Week would: the same filters, tabs and eye toggles.
//
// Under 700px the Agenda is the default; the person can switch back to the Week, and the
// choice is kept for this browser only.

import { useMemo, useSyncExternalStore } from "react"
import { addDays, iso, monday, parse, shortDate } from "@/core/dates"
import { useWeekInput, weekDays, type Day, type ViewInput } from "./views"

/** Days in the Agenda before Show more, and what Show more adds. */
export const AGENDA_DAYS = 14

export type AgendaRow =
    | { kind: "day"; day: Day }
    /* a run of empty days: `until` is the next day shown, null when the range ends first */
    | { kind: "gap"; from: string; to: string; until: string | null }

export interface Agenda { from: string; to: string; rows: AgendaRow[]; count: number }

/** Where the Agenda starts: today, unless the arrows moved to a week without it. */
export function agendaStart(anchor: string, today: string): string {
    const mon = iso(monday(parse(anchor))), sun = iso(addDays(parse(mon), 6))
    return today >= mon && today <= sun ? today : mon
}

/** The rows from `from` for `days` days: the days with something on them, today, and the gaps between. */
export function agendaRows(input: ViewInput, from: string, days = AGENDA_DAYS): Agenda {
    const to = iso(addDays(parse(from), days - 1))
    const all: Day[] = []
    let count = 0
    /* each week the range touches, through weekDays, trimmed to the range */
    for (let mon = monday(parse(from)); iso(mon) <= to; mon = addDays(mon, 7)) {
        const w = weekDays({ ...input, anchor: iso(mon) })
        for (const d of w.days) if (d.date >= from && d.date <= to) {
            all.push(d)
            count += d.entries.filter((e) => e.kind === "item").length
        }
    }
    /* a day off, a break, exams or a marker is worth a line of its own, as in the Week */
    const tagged = (d: Day) => !!d.info && (d.info.kind === "off" || d.info.kind === "break" || d.info.kind === "exams" || d.info.kind === "swap" || d.info.notes.length > 0)
    const shown = (d: Day) => d.entries.length > 0 || d.isToday || tagged(d)
    const rows: AgendaRow[] = []
    let gap: string | null = null, last = from
    for (const d of all) {
        if (!shown(d)) { gap ??= d.date; last = d.date; continue }
        if (gap) rows.push({ kind: "gap", from: gap, to: last, until: d.date })
        gap = null
        rows.push({ kind: "day", day: d })
    }
    if (gap) rows.push({ kind: "gap", from: gap, to, until: null })
    return { from, to, rows, count }
}

/** "Nothing until Thu 23 Oct", or "Nothing else through Sun 2 Nov" at the end of the range. */
export const gapLabel = (row: Extract<AgendaRow, { kind: "gap" }>) =>
    row.until ? "Nothing until " + shortDate(row.until) : "Nothing else through " + shortDate(row.to)

/* ── the layout: Agenda or Week, on a phone ── */

const KEY = "rounds.weekLayout"
const QUERY = "(max-width: 700px)"
export type WeekLayout = "agenda" | "week"

let chosen: WeekLayout | null = null
try {
    const v = localStorage.getItem(KEY)
    if (v === "agenda" || v === "week") chosen = v
} catch {}
const listeners = new Set<() => void>()

const media = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null)

function subscribe(fn: () => void) {
    listeners.add(fn)
    const m = media()
    m?.addEventListener?.("change", fn)
    return () => { listeners.delete(fn); m?.removeEventListener?.("change", fn) }
}

/** The screen is phone-sized: the Agenda is offered (and the default). */
export const isNarrow = () => !!media()?.matches

/** What the Week page shows: on a wide screen always the Week; on a phone the person's choice, the Agenda by default. */
export const weekLayout = (): WeekLayout => (isNarrow() ? chosen ?? "agenda" : "week")

export function setWeekLayout(layout: WeekLayout) {
    chosen = layout
    try { localStorage.setItem(KEY, layout) } catch {}
    for (const fn of listeners) fn()
}

export const useWeekLayout = () => useSyncExternalStore(subscribe, weekLayout, () => "week" as WeekLayout)
export const useNarrow = () => useSyncExternalStore(subscribe, isNarrow, () => false)

/** The Agenda over the live data, `days` long. */
export const useAgenda = (days = AGENDA_DAYS) => {
    const input = useWeekInput()
    return useMemo(() => ({
        ...agendaRows(input, agendaStart(input.anchor, input.today), days),
        /* no items at all, before the eye toggles: a first run, as the Week says */
        empty: (input.total ?? input.items.length) === 0,
    }), [input, days])
}
