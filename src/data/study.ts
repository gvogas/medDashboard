// What the Study page shows: the three tiles, the History card's week, month and term, and
// the achievements, worked out from the logged sessions. core/history.ts and
// core/achievements.ts do the arithmetic; the selectors here shape it for the page. Pure:
// each takes the sessions, the prefs and today, so it can be tested on its own. The hooks
// and the History card's actions are at the end.

import { useMemo, useSyncExternalStore } from "react"
import { getVersion, notify, subscribe } from "@/bridge"
import { dayOf, heatRange, level, minutesByDay, month, streak, week } from "@/core/history"
import { achievements, nextUp, ownAchievements } from "@/core/achievements"
import { normalizePrefs } from "@/core/model"
import { termStart as currentTermStart } from "@/data/query"
import { addDays, dayMonth, iso, parse, shortDate, today as todayIso, DOW, MON } from "@/core/dates"
import { duration } from "@/lib/time"
import { useAchievements, useCourses, useItems, useProfile, useStudySessions } from "./store"
import { ui } from "./ui"
import type { Achievement, Badge, Course, HistTab, Item, SessionUndo, StudyPrefs, StudySession } from "./types"

/* A course split is [courseId, minutes] pairs, most first, with "" for no course. */
type Split = [string, number][]

const plural = (n: number, one: string) => n + " " + one + (n === 1 ? "" : "s")
const sum = (list: StudySession[]) => list.reduce((a, s) => a + s.studyMinutes, 0)
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10

/** Minutes studied for one item, over every session linked to it (the item sheet shows it). */
export const studiedFor = (sessions: StudySession[], itemId: string) =>
    sessions.reduce((a, s) => a + (s.itemId === itemId ? s.studyMinutes : 0), 0)

/** Sessions shown: every one but a delete that Undo can still take back. */
export const shownSessions = (sessions: StudySession[], undo: SessionUndo | null) =>
    undo ? sessions.filter((s) => s.id !== undo.session.id) : sessions

/** "14 – 20 Sep", or "28 Sep – 4 Oct" across two months. */
export const rangeLabel = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? String(parse(a).getDate()) : dayMonth(a)) + " – " + dayMonth(b)

/** Minutes per course, most first; "" for no course. */
function perCourse(sessions: StudySession[]): Split {
    const out = new Map<string, number>()
    for (const s of sessions) out.set(s.courseId || "", (out.get(s.courseId || "") || 0) + s.studyMinutes)
    return [...out].sort((a, b) => b[1] - a[1])
}

/** The sessions from the term's (or the heatmap's) first day through today. */
const inRange = (sessions: StudySession[], from: string, today: string) =>
    sessions.filter((s) => { const d = dayOf(s); return d >= from && d <= today })

/* ── the tiles ── */

export interface Tiles {
    streak: { days: number; sub: string }
    /* `sub` is "" with no goal: the tile offers to set one */
    today: { minutes: number; goal: number; sub: string }
    term: { label: string; minutes: number; sub: string }
}

/** The streak, today against the goal, and the term so far (the last 12 weeks with no term start). */
export function studyTiles(sessions: StudySession[], prefs: StudyPrefs, termStart: string | null, today: string): Tiles {
    const byDay = minutesByDay(sessions), st = streak(byDay, today, prefs), minutes = byDay.get(today) || 0
    const range = heatRange(termStart, today), term = inRange(sessions, range.from, today)
    const left = Math.max(0, prefs.goal - minutes)
    return {
        streak: {
            days: st.current,
            sub: "Longest " + st.longest + " · a day counts from " + prefs.dayMin + " min" + (st.today || !st.current ? "" : " · study today to keep it"),
        },
        today: { minutes, goal: prefs.goal, sub: prefs.goal ? (left ? left + " min to your daily goal" : "Daily goal reached") : "" },
        term: {
            label: range.since ? "This term" : "Last 12 weeks",
            minutes: sum(term),
            sub: plural(term.length, "session") + (range.since ? " since " + dayMonth(range.since) : ""),
        },
    }
}

/* ── History: the week ── */

export interface Bar { courseId: string; minutes: number; height: number }
export interface WeekDay { date: string; label: string; title: string; total: number; bars: Bar[]; future: boolean; isToday: boolean }
export interface WeekHist {
    offset: number
    range: string
    total: number
    /* "in 3 sessions · 20m more than the week before" */
    summary: string
    days: WeekDay[]
    /* the goal line's height, as a percent of the chart; null with no goal */
    goalLine: number | null
    perCourse: Split
    sessions: StudySession[]
}

/**
 * The week `offset` weeks from this one, Monday to Sunday: its total against the week
 * before, a bar a day split by course, the course bars and its sessions, newest first.
 * The chart is at least an hour tall, and tall enough for a quarter over the goal.
 */
export function weekOf(sessions: StudySession[], offset: number, today: string, goal = 0): WeekHist {
    const anchor = iso(addDays(parse(today), 7 * offset))
    const w = week(sessions, anchor), before = week(sessions, iso(addDays(parse(anchor), -7)))
    const max = Math.max(60, goal ? goal * 1.25 : 0, ...w.days.map((d) => d.total))
    const diff = w.total - before.total
    const compare = !before.total ? "" : " · " + (diff === 0 ? "same as" : duration(Math.abs(diff)) + (diff > 0 ? " more than" : " less than")) + " the week before"
    return {
        offset,
        range: rangeLabel(w.from, w.to),
        total: w.total,
        summary: "in " + plural(w.count, "session") + compare,
        days: w.days.map((d) => {
            const at = parse(d.date)
            return {
                date: d.date, label: DOW[at.getDay()] + " " + at.getDate(), title: shortDate(d.date) + " · " + duration(d.total), total: d.total,
                bars: d.byCourse.map(([courseId, minutes]) => ({ courseId, minutes, height: pct(minutes, max) })),
                future: d.date > today, isToday: d.date === today,
            }
        }),
        goalLine: goal ? pct(goal, max) : null,
        perCourse: w.perCourse,
        sessions: w.sessions,
    }
}

/* ── History: the month ── */

export interface MonthCell {
    date: string
    day: number
    future: boolean
    minutes: number
    split: Split
    /* 0 to 4: how strongly it is tinted */
    level: number
    isToday: boolean
    picked: boolean
    /* the goal was reached */
    met: boolean
    label: string
}

export interface PickedDay { date: string; isToday: boolean; label: string; total: number; sessions: StudySession[] }

export interface MonthHist {
    offset: number
    title: string
    /* blank cells before the 1st, Monday first */
    lead: number
    cells: MonthCell[]
    stats: { total: number; count: number; daysStudied: number; daysSoFar: number; average: number }
    picked: PickedDay | null
}

/**
 * The month `offset` months from this one as a calendar: each day's total, split by
 * course, tinted by how much, and whether the goal was met. The day picked is the one
 * chosen (`focusDay`) when it is in this month, else today, else the month's latest
 * day with study; with none, nothing is picked.
 */
export function monthOf(sessions: StudySession[], offset: number, focusDay: string | null, today: string, goal = 0): MonthHist {
    const now = parse(today), at = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const m = month(sessions, at.getFullYear(), at.getMonth())
    const first = iso(at), last = iso(new Date(at.getFullYear(), at.getMonth() + 1, 0)), ym = first.slice(0, 7)
    const byDate = new Map(m.groups.map((g) => [g.date, g]))
    const pick = focusDay && focusDay.startsWith(ym) ? focusDay : today.startsWith(ym) ? today : m.groups[0]?.date ?? null
    const daysSoFar = first > today ? 0 : parse(last < today ? last : today).getDate()

    const cells: MonthCell[] = []
    for (let d = 1; d <= parse(last).getDate(); d++) {
        const date = iso(new Date(at.getFullYear(), at.getMonth(), d)), g = byDate.get(date), minutes = g?.total || 0
        cells.push({
            date, day: d, future: date > today, minutes, split: g ? perCourse(g.sessions) : [], level: level(minutes, goal),
            isToday: date === today, picked: date === pick, met: !!goal && minutes >= goal,
            label: shortDate(date) + ", " + (minutes ? duration(minutes) : "no study"),
        })
    }
    const g = pick ? byDate.get(pick) : undefined
    return {
        offset,
        title: MON[at.getMonth()] + " " + at.getFullYear(),
        lead: (at.getDay() + 6) % 7,
        cells,
        stats: { total: m.total, count: m.count, daysStudied: m.daysStudied, daysSoFar, average: daysSoFar ? Math.round(m.total / daysSoFar) : 0 },
        picked: pick ? { date: pick, isToday: pick === today, label: shortDate(pick), total: g?.total || 0, sessions: g?.sessions || [] } : null,
    }
}

/* ── History: the term ── */

export interface HeatDay { date: string; future: boolean; minutes: number; level: number; isToday: boolean; picked: boolean; label: string }
export interface HeatWeek { monday: string; month: string; days: HeatDay[] }

export interface TermHist {
    /* "Term", or "Last 12 weeks" with no term start */
    title: string
    range: string
    weeks: HeatWeek[]
    perCourse: Split
    /* days in the range with any study */
    daysStudied: number
}

/**
 * The heatmap: a column a week from the Monday of the term start (or of twelve weeks
 * ago), a row a weekday, at least sixteen weeks. A column is labelled with the month
 * that starts in it, and the first with its own.
 */
export function termOf(sessions: StudySession[], prefs: StudyPrefs, termStart: string | null, today: string, focusDay: string | null = null): TermHist {
    const range = heatRange(termStart, today), start = parse(range.from), byDay = minutesByDay(sessions)
    const weeks: HeatWeek[] = []
    for (let w = 0; w < range.weeks; w++) {
        const mon = addDays(start, w * 7)
        const dates = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
        const firstOf = dates.find((d) => d.getDate() === 1)
        weeks.push({
            monday: iso(mon),
            month: (firstOf ? MON[firstOf.getMonth()] : w === 0 ? MON[mon.getMonth()] : "").slice(0, 3),
            days: dates.map((d) => {
                const date = iso(d), minutes = byDay.get(date) || 0
                return {
                    date, future: date > today, minutes, level: level(minutes, prefs.goal), isToday: date === today, picked: date === focusDay,
                    label: shortDate(date) + ", " + (minutes ? duration(minutes) : "no study"),
                }
            }),
        })
    }
    return {
        title: range.since ? "Term" : "Last 12 weeks",
        range: dayMonth(range.from) + " – " + dayMonth(range.to),
        weeks,
        perCourse: perCourse(inRange(sessions, range.from, today)),
        daysStudied: [...byDay].filter(([d, m]) => d >= range.from && d <= today && m > 0).length,
    }
}

/* ── achievements ── */

export interface Badges { builtIn: Badge[]; own: Badge[]; next: Badge[]; earned: number; total: number }

/** Every built-in badge and your own, the three closest to done, and how many are earned. */
export function badges(sessions: StudySession[], items: Item[], prefs: StudyPrefs, today: string, own: Achievement[], courses: Course[]): Badges {
    const builtIn = achievements(sessions, items, prefs, today) as Badge[]
    const mine = ownAchievements(own, sessions, items, courses) as Badge[]
    const all = [...builtIn, ...mine]
    return { builtIn, own: mine, next: nextUp(builtIn) as Badge[], earned: all.filter((b) => b.earned).length, total: all.length }
}

/* ── hooks: the selectors over the live data ── */

/**
 * The sessions shown, the prefs, the term start and today. The History card's state is
 * the `ui` object, changed in place, so the bridge's version is part of the key; it
 * also catches the day rolling over on a redraw.
 */
function useStudyInput() {
    const sessions = useStudySessions(), profile = useProfile()
    const version = useSyncExternalStore(subscribe, getVersion)
    return useMemo(() => ({
        sessions: shownSessions(sessions, ui.hist.undo),
        prefs: normalizePrefs(profile?.studyPrefs) as StudyPrefs,
        termStart: currentTermStart() as string | null,
        today: todayIso(),
        hist: { ...ui.hist },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the ui
    [sessions, profile, version])
}

export const useStudyTiles = () => {
    const input = useStudyInput()
    return useMemo(() => studyTiles(input.sessions, input.prefs, input.termStart, input.today), [input])
}

/** The History card: only the tab showing is worked out. */
export const useHistory = () => {
    const input = useStudyInput()
    return useMemo(() => {
        const { sessions, prefs, termStart, today, hist } = input
        return {
            tab: hist.tab,
            goal: prefs.goal,
            undo: hist.undo,
            week: hist.tab === "week" ? weekOf(sessions, hist.weekOffset, today, prefs.goal) : null,
            month: hist.tab === "month" ? monthOf(sessions, hist.monthOffset, hist.focusDay, today, prefs.goal) : null,
            term: hist.tab === "term" ? termOf(sessions, prefs, termStart, today, hist.focusDay) : null,
        }
    }, [input])
}

export const useBadges = () => {
    const input = useStudyInput(), items = useItems(), own = useAchievements(), courses = useCourses()
    return useMemo(() => badges(input.sessions, items, input.prefs, input.today, own, courses), [input, items, own, courses])
}

/* ── the History card's actions: each changes the ui and redraws ── */

/** Week, Month or Term; a day picked before is let go. The tab lasts the session. */
export function setHistTab(tab: HistTab) {
    ui.hist.tab = tab
    ui.hist.focusDay = null
    notify()
}

/** A week or month back (-1) or on (1), never past this one; 0 comes back to it. */
export function stepHist(dir: -1 | 0 | 1) {
    const h = ui.hist
    if (h.tab === "week") h.weekOffset = dir ? Math.min(0, h.weekOffset + dir) : 0
    else if (h.tab === "month") {
        h.monthOffset = dir ? Math.min(0, h.monthOffset + dir) : 0
        h.focusDay = null
    }
    notify()
}

/** A day on the month's calendar or the heatmap: the Month tab, on its month, with it picked. */
export function pickDay(date: string) {
    const d = parse(date), now = parse(todayIso())
    ui.hist.tab = "month"
    ui.hist.monthOffset = Math.min(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth())
    ui.hist.focusDay = date
    notify()
}

/** Undo: the deleted session comes back; it was only hidden while it waited. */
export function undoSessionDelete() {
    const u = ui.hist.undo
    if (!u) return
    clearTimeout(u.timer)
    ui.hist.undo = null
    notify()
}
