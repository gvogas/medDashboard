// What the week, month and table views and the stat tiles show, worked out from the
// collections and the filters. Pure: nothing here reads the DOM or the `ui` object, so
// each selector can be tested on its own. The hooks at the end feed them the live data.

import { useMemo, useSyncExternalStore } from "react"
import { getVersion, subscribe } from "@/bridge"
import { isOpen, isOverdue, isTest, normalizePrefs, occurrences, statusLabel, tmeta } from "@/core/model"
import { addDays, diffDays, dur, iso, monday, parse, today as todayIso, DOW, MON } from "@/core/dates"
import { classWeekday, courseRunsOn, currentTerm, dayInfo, inTerm, weekOf } from "@/core/school"
import type { SchoolCalendar } from "@/core/school"
import { weekLabel } from "@/lib/school-bits"
import { schoolCal } from "@/data/query"
import { minutesByDay, streak } from "@/core/history"

import { prepPace } from "@/core/prep"
import { useCourses, useItems, useProfile, useQuotes, useStudySessions } from "./store"
import { courseKeyOf, keyOf, onCalendar } from "./effective"
import { ui } from "./ui"
import type { Course, Item, Meeting, Quote, Schedule, Show, SortKey, StudySession } from "./types"

/* ── the filters: the sidebar's course and the search; the table adds its chips ── */

export interface Filters { search: string; course: string }

/** The All items table's filters: the course and search, the type chips and the status chips. */
export interface TableFilters extends Filters { types: Record<string, boolean>; show: Show }

/** A type is on unless it was switched off; new types start on. */
export const typeOn = (f: TableFilters, type: string) => f.types[type] !== false

/** Open, overdue, or anything, as the table's status chips ask. */
export const passShow = (it: Item, show: Show) => (show === "open" ? isOpen(it) : show === "overdue" ? isOverdue(it) : true)

/* Courses by key: a class course and a personal one may share an id (effective.ts). */
const courseMap = (courses: Course[]) => new Map(courses.map((c) => [keyOf(c), c]))

export function matchSearch(it: Item, byId: Map<string, Course>, search: string): boolean {
    if (!search) return true
    const key = courseKeyOf(it), c = key ? byId.get(key) : undefined
    const hay = (it.title + " " + (it.where || "") + " " + (it.notes || "") + " " + (c ? c.name + " " + c.code : "") + " " + tmeta(it.type).label).toLowerCase()
    return hay.includes(search.toLowerCase())
}

/** The course and the search: what the week, the month and the table share. */
export const passFilters = (it: Item, f: Filters, byId: Map<string, Course>) =>
    (f.course === "all" || courseKeyOf(it) === f.course) && matchSearch(it, byId, f.search)

export interface Instance { item: Item; date: string }

/** Every filtered item on [from, to], weekly ones once per week, by date then time. */
export function instances(items: Item[], courses: Course[], f: Filters, from: string, to: string): Instance[] {
    const byId = courseMap(courses), out: Instance[] = []
    for (const it of items) if (passFilters(it, f, byId)) out.push(...(occurrences(it, from, to) as Instance[]))
    return out.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1
        const as = timeOf(a.item), bs = timeOf(b.item)
        return as < bs ? -1 : as > bs ? 1 : 0
    })
}

/** An item's place in its day: the start, else the end (a deadline), else last. */
const timeOf = (it: Item) => it.start || it.end || "zz"

export interface ClassSlot { course: Course; mtg: Meeting }

/** Every class meeting of the live courses that pass the course filter and the search, Monday first. */
export function classes(courses: Course[], f: Filters): ClassSlot[] {
    const out: ClassSlot[] = []
    for (const c of courses) {
        if (c.archived || (f.course !== "all" && keyOf(c) !== f.course)) continue
        for (const m of c.meetings || []) {
            if (f.search) {
                const hay = (c.name + " " + c.code + " " + (c.instructor || "") + " " + (m.room || "") + " " + (m.kind || "")).toLowerCase()
                if (!hay.includes(f.search.toLowerCase())) continue
            }
            out.push({ course: c, mtg: m })
        }
    }
    return out.sort((a, b) => (a.mtg.weekday + 6) % 7 - (b.mtg.weekday + 6) % 7 || cmp(a.mtg.start, b.mtg.start))
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const byWeekday = (list: ClassSlot[]) => {
    const out = new Map<number, ClassSlot[]>()
    for (const x of list) out.set(x.mtg.weekday, [...(out.get(x.mtg.weekday) || []), x])
    return out
}

/** The classes of a weekday that run on `date`: a course set to one semester has none outside it. */
const runningOn = (list: ClassSlot[] | undefined, cal: SchoolCal, date: string) =>
    (list || []).filter((slot) => courseRunsOn(cal, slot.course.term, date))

/* ── the school calendar ── */

/** A day as the school calendar sees it (dayInfo in core/school.ts). */
export interface DayInfo { kind: "class" | "swap" | "off" | "break" | "exams" | "none"; label: string; notes: string[]; follows?: number }
export type SchoolCal = SchoolCalendar | null

const infoOf = (cal: SchoolCal, date: string): DayInfo | null => (cal ? (dayInfo(cal, date) as DayInfo) : null)
/** The kind a day is tinted by: off, break, exams or none; null for an ordinary day. */
export const tintOf = (info: DayInfo | null) => (info && info.kind !== "class" && info.kind !== "swap" ? info.kind : null)

/** "Weeks 6 – 11 · Autumn 2026" for the month's rows, or "" without a calendar. */
export function weekRange(cal: SchoolCal, dates: string[]): string {
    if (!cal) return ""
    const weeks = dates.map((d) => weekOf(cal, d))
    const first = weeks.find((w) => w && w.kind === "week" && w.week)
    if (!first) {
        const other = weeks.find(Boolean)
        return other ? weekLabel(other) : ""
    }
    const nums = weeks.filter((w) => w && w.term === first.term && w.kind === "week" && w.week).map((w) => w!.week!)
    const lo = Math.min(...nums), hi = Math.max(...nums)
    return (lo === hi ? "Week " + lo : "Weeks " + lo + " – " + hi) + " · " + first.term.name
}

/* ── the week ── */

export type Entry =
    | { kind: "class"; key: string; slot: ClassSlot }
    | { kind: "item"; key: string; inst: Instance }

export interface Day {
    date: string
    dow: string
    day: number
    mon: string
    isToday: boolean
    info: DayInfo | null
    entries: Entry[]
}

export interface ViewInput {
    items: Item[]
    courses: Course[]
    filters: Filters
    schedule: Schedule
    anchor: string
    today: string
    cal: SchoolCal
}

export interface Week { days: Day[]; count: number; any: boolean }

/**
 * The week holding the anchor, Monday to Sunday. Each day's classes and items are one
 * list in time order, as the tab allows. While searching, empty days are left out.
 */
export function weekDays({ items, courses, filters, schedule, anchor, today, cal }: ViewInput): Week {
    const start = monday(parse(anchor)), from = iso(start), to = iso(addDays(start, 6))
    const list = schedule === "classes" ? [] : instances(items, courses, filters, from, to)
    const slots = schedule === "deadlines" ? new Map<number, ClassSlot[]>() : byWeekday(classes(courses, filters))
    const days: Day[] = []
    let any = false
    for (let i = 0; i < 7; i++) {
        const d = addDays(start, i), date = iso(d)
        const wd = classWeekday(cal, date) as number | null
        const timed: { at: string; entry: Entry }[] = [
            ...(wd === null ? [] : runningOn(slots.get(wd), cal, date)).map((slot) => ({ at: slot.mtg.start, entry: { kind: "class" as const, key: "c" + keyOf(slot.course) + slot.mtg.id, slot } })),
            ...list.filter((x) => x.date === date).map((inst) => ({ at: timeOf(inst.item), entry: { kind: "item" as const, key: "i" + keyOf(inst.item), inst } })),
        ]
        /* a stable sort: at the same time, classes before items */
        const entries = timed.sort((a, b) => cmp(a.at, b.at)).map((x) => x.entry)
        if (!entries.length && filters.search) continue
        any = any || entries.length > 0
        days.push({ date, dow: DOW[d.getDay()], day: d.getDate(), mon: MON[d.getMonth()].slice(0, 3), isToday: date === today, info: infoOf(cal, date), entries })
    }
    return { days, count: list.length, any }
}

/** The weekly office hours that pass the course filter and search, Monday first. */
export function officeHours(items: Item[], courses: Course[], f: Filters): Item[] {
    const byId = courseMap(courses)
    return items
        .filter((it) => it.type === "office" && (f.course === "all" || courseKeyOf(it) === f.course) && matchSearch(it, byId, f.search))
        .sort((a, b) => ((a.weekday ?? 0) + 6) % 7 - ((b.weekday ?? 0) + 6) % 7 || (a.start < b.start ? -1 : 1))
}

export const TASKS_SHOWN = 9

/** Tasks for the side panel: open ones first, then by date; the first nine, and the open count. */
export function tasks(items: Item[], courses: Course[], f: Filters): { shown: Item[]; open: number; total: number } {
    const byId = courseMap(courses)
    const all = items
        .filter((it) => it.type === "task" && (f.course === "all" || courseKeyOf(it) === f.course) && matchSearch(it, byId, f.search))
        .sort((a, b) => (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1) || (a.date < b.date ? -1 : 1))
    return { shown: all.slice(0, TASKS_SHOWN), open: all.filter(isOpen).length, total: all.length }
}

/* ── the month ── */

export const PER_CELL = 4

export type Chip = { kind: "due"; key: string; inst: Instance } | { kind: "class"; key: string; slot: ClassSlot }

export interface Cell {
    date: string
    day: number
    dow: string
    out: boolean
    isToday: boolean
    info: DayInfo | null
    chips: Chip[]
    more: number
    due: number
    classes: number
    off: number
}

export interface Month { title: string; range: string; classCount: number; cells: Cell[] }

export const MONTH_TITLE: Record<Schedule, string> = { all: "Classes and deadlines", deadlines: "Deadlines", classes: "Class schedule" }

/**
 * Six weeks from the Monday on or before the 1st. Deadlines first, then classes, as the
 * tab allows; four chips a cell, the last becoming "+N more". Weekly items and office
 * hours never go on the grid: they would fill every week.
 */
export function monthCells({ items, courses, filters, schedule, anchor, today, cal }: ViewInput): Month {
    const a = parse(anchor), first = new Date(a.getFullYear(), a.getMonth(), 1), start = monday(first)
    const all = classes(courses, filters), slots = byWeekday(all)
    const byDate = new Map<string, Instance[]>()
    if (schedule !== "classes") {
        for (const x of instances(items, courses, filters, iso(start), iso(addDays(start, 41)))) {
            if (x.item.recur === "weekly" || x.item.type === "office") continue
            byDate.set(x.date, [...(byDate.get(x.date) || []), x])
        }
    }
    const cells: Cell[] = []
    for (let i = 0; i < 42; i++) {
        const d = addDays(start, i), date = iso(d), info = infoOf(cal, date)
        const wd = classWeekday(cal, date) as number | null
        const due = byDate.get(date) || []
        const cls = schedule === "deadlines" || wd === null ? [] : runningOn(slots.get(wd), cal, date)
        const chips: Chip[] = [
            ...due.map((inst) => ({ kind: "due" as const, key: "i" + keyOf(inst.item), inst })),
            ...cls.map((slot) => ({ kind: "class" as const, key: "c" + keyOf(slot.course) + slot.mtg.id, slot })),
        ]
        const shown = chips.length > PER_CELL ? PER_CELL - 1 : chips.length
        const off = schedule !== "deadlines" && info && ["off", "break", "exams"].includes(info.kind) ? runningOn(slots.get(d.getDay()), cal, date).length : 0
        cells.push({
            date, day: d.getDate(), dow: DOW[d.getDay()], out: d.getMonth() !== a.getMonth(), isToday: date === today, info,
            chips: chips.slice(0, shown), more: chips.length - shown, due: due.length, classes: cls.length, off,
        })
    }
    const rows = [0, 1, 2, 3, 4, 5].map((w) => iso(addDays(start, 7 * w)))
    return { title: MONTH_TITLE[schedule], range: weekRange(cal, rows), classCount: all.length, cells }
}

/** A month cell's name for a screen reader: "Wed 2026-09-23, Study break, 2 due, 3 classes". */
export function cellLabel(c: Cell): string {
    const info = c.info
    const note = info && info.kind !== "class" ? ", " + (info.kind === "swap" ? "follows " + DOW[info.follows ?? 0] : info.label) : ""
    return c.dow + " " + c.date + note + (c.due ? ", " + c.due + " due" : "") + (c.classes ? ", " + c.classes + " class" + (c.classes === 1 ? "" : "es") : "")
}

export interface TimetableDay { weekday: number; dow: string; hours: number; slots: ClassSlot[] }

/**
 * The weekly timetable, Monday to Saturday, and Sunday only if a class lands there. With a
 * calendar it holds the anchor's semester (the current one between semesters) and all-year courses.
 */
export function timetable(courses: Course[], f: Filters, cal: SchoolCal = null, anchor = ""): TimetableDay[] {
    const term = cal ? dayInfo(cal, anchor).term ?? currentTerm(cal, anchor) : null
    const slots = byWeekday(classes(courses.filter((c) => inTerm(cal, c.term, term)), f))
    return [1, 2, 3, 4, 5, 6, 0]
        .filter((w) => (w !== 0 && w !== 6) || (slots.get(w) || []).length)
        .map((w) => {
            const list = [...(slots.get(w) || [])].sort((x, y) => cmp(x.mtg.start, y.mtg.start))
            const hours = list.reduce((s, x) => s + dur(x.mtg.start, x.mtg.end), 0)
            return { weekday: w, dow: DOW[w], hours: Math.round(hours * 10) / 10, slots: list }
        })
}

/* ── the table ── */

/**
 * The items that pass the course, the search, the type chips and the status chips, sorted
 * by a column; items without a course sort last by course.
 */
export function tableRows(items: Item[], courses: Course[], f: TableFilters, sort: { key: SortKey; dir: 1 | -1 }): Item[] {
    const byId = courseMap(courses)
    const value = (it: Item): string => {
        switch (sort.key) {
            case "title": return it.title.toLowerCase()
            case "type": return it.type
            case "course": { const key = courseKeyOf(it); return (key && byId.get(key)?.name) || "zz" }
            case "status": return statusLabel(it)
            default: return it.date
        }
    }
    return items.filter((it) => typeOn(f, it.type) && passShow(it, f.show) && passFilters(it, f, byId)).sort((a, b) => cmp(value(a), value(b)) * sort.dir)
}

/**
 * Each type chip's count: its open items, and weekly ones that are always on the board,
 * in the course picked. The search, the status and the other chips leave it alone.
 */
export function typeCounts(items: Item[], course: string): Record<string, number> {
    const n: Record<string, number> = {}
    for (const it of items) {
        if (course !== "all" && courseKeyOf(it) !== course) continue
        if (it.recur === "weekly" || isOpen(it)) n[it.type] = (n[it.type] || 0) + 1
    }
    return n
}

/* ── the stat tiles ── */

export interface Prep { done: number; total: number; days: number; pace: number; hot: boolean }

export interface Stats {
    nextExam: Item | null
    daysTo: number | null
    prep: Prep | null
    openAssignments: number
    dueThisWeek: number
    overdue: number
    study: { minutes: number; goal: number; streak: number }
}

/** The tiles' numbers. They ignore the filters: they are about the whole of your work. */
export function stats(items: Item[], sessions: StudySession[], studyPrefs: unknown, today: string): Stats {
    const from = iso(monday(parse(today))), to = iso(addDays(parse(from), 6))
    let nextExam: Item | null = null, openAssignments = 0, dueThisWeek = 0, overdue = 0
    for (const it of items) {
        /* the soonest open exam or quiz; on the same day, the earlier start */
        if (isTest(it.type) && isOpen(it) && diffDays(today, it.date) >= 0
            && (!nextExam || it.date + (it.start || "~") < nextExam.date + (nextExam.start || "~"))) nextExam = it
        if (it.type === "assignment" && isOpen(it)) {
            openAssignments++
            if (it.date >= from && it.date <= to) dueThisWeek++
        }
        if (isOverdue(it)) overdue++
    }
    const p = normalizePrefs(studyPrefs), byDay = minutesByDay(sessions) as Map<string, number>
    return {
        nextExam,
        daysTo: nextExam ? diffDays(today, nextExam.date) : null,
        prep: nextExam ? prepPace(nextExam, today) : null,
        openAssignments, dueThisWeek, overdue,
        study: { minutes: byDay.get(today) || 0, goal: p.goal, streak: streak(byDay, today, p).current },
    }
}

/** The quote showing, wrapped when quotes were deleted; null when there are none. */
export function quoteAt(quotes: Quote[], ix: number): { quote: Quote; ix: number } | null {
    if (!quotes.length) return null
    const i = ix >= 0 && ix < quotes.length ? ix : 0
    return { quote: quotes[i], ix: i }
}

/* ── hooks: the selectors over the live data, redone after any change ── */

const filtersOf = (): Filters => ({ search: ui.search, course: ui.course })

/** The table's filters. A stat tile's list leaves out the course and the search, as the tile does. */
export const tableFiltersOf = (): TableFilters => {
    const tile = ui.listFrom === "tile"
    return { search: tile ? "" : ui.search, course: tile ? "all" : ui.course, types: { ...ui.types }, show: ui.show || "all" }
}

/**
 * The live input for the views. The `ui` object is changed in place, so the version the
 * bridge bumps on every redraw is part of the key; the collections are new arrays when
 * the store reloads. The Week and the Month (`calendar`) leave out what you hid with an eye
 * toggle (spec §9); All items does not.
 */
function useViewInput(calendar = false): ViewInput {
    const items = useItems(), courses = useCourses(), profile = useProfile()
    const version = useSyncExternalStore(subscribe, getVersion)
    return useMemo(
        () => {
            const shown = calendar ? onCalendar(items, courses, profile?.hiddenSources ?? []) : { items, courses }
            return { items: shown.items, courses: shown.courses, filters: filtersOf(), schedule: ui.schedule, anchor: ui.anchor, today: todayIso(), cal: schoolCal() }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the ui
        [items, courses, profile, version, calendar],
    )
}

export const useWeek = () => {
    const input = useViewInput(true)
    return useMemo(() => ({
        week: weekDays(input),
        officeHours: officeHours(input.items, input.courses, input.filters),
        tasks: tasks(input.items, input.courses, input.filters),
        empty: input.items.length === 0,
        schedule: input.schedule,
    }), [input])
}

export const useMonth = () => {
    const input = useViewInput(true)
    return useMemo(() => ({ month: monthCells(input), timetable: timetable(input.courses, input.filters, input.cal, input.anchor),schedule: input.schedule }), [input])
}

export const useTable = () => {
    const input = useViewInput()
    const sort = { key: ui.sort.key, dir: ui.sort.dir }
    return useMemo(() => {
        const f = tableFiltersOf()
        return {
            rows: tableRows(input.items, input.courses, f, sort),
            total: input.items.length,
            sort,
            filters: f,
            /* what the Overdue chip would show, and each type chip's open items */
            overdue: tableRows(input.items, input.courses, { ...f, show: "overdue" }, sort).length,
            perType: typeCounts(input.items, f.course),
        }
    },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sort is part of the ui, keyed by `input`
        [input])
}

export const useStats = () => {
    const items = useItems(), sessions = useStudySessions(), profile = useProfile(), quotes = useQuotes()
    const version = useSyncExternalStore(subscribe, getVersion)
    const numbers = useMemo(() => stats(items, sessions, profile?.studyPrefs, todayIso()),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` catches the day rolling over on a redraw
        [items, sessions, profile, version])
    return { ...numbers, quote: quoteAt(quotes, ui.quoteIx), quoteCount: quotes.length }
}
