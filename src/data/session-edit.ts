// A study session to log by hand or put right: time away from the timer (the library,
// Anki on a phone), or a logged one changed. Either way it counts toward the streak and
// the goal. The draft lives in the sheet's state (overlay.ts) until it is saved.

import * as store from "@/core/store"
import { uid } from "@/core/model"
import { iso, shortDate, today } from "@/core/dates"
import { minutesByDay, streak } from "@/core/history"
import { duration } from "@/lib/time"
import { notify } from "@/bridge"
import { parseTime } from "@/lib/time"
import { effectiveCourses } from "./effective"
import { closeSheet } from "./overlay"
import { courseRefKey, itemRefKey, keyedCourses, refOf } from "./refs"
import { ui } from "./ui"
import type { StudyPrefs, StudySession } from "./types"

export interface SessionDraft {
    isNew: boolean
    /** the stored session, whose other fields (rounds, the manual flag) saving keeps */
    base: StudySession | null
    id: string
    date: string
    time: string
    minutes: number
    courseId: string | null
    itemId: string | null
    note: string
}

/** The quick lengths under How long, in minutes. */
export const QUICK = [15, 25, 30, 45, 60, 90]
export const MAX_MINUTES = 720

const pad = (n: number) => String(n).padStart(2, "0")
const clock = (d: Date) => pad(d.getHours()) + ":" + pad(d.getMinutes())

/** A new session for the last half hour, on `courseId`, else the timer's course, else the first live one. */
export function newSession(courseId?: string | null, now = new Date()): SessionDraft {
    const start = new Date(now.getTime() - 30 * 60_000)
    const live = keyedCourses(effectiveCourses()).find((c) => !c.archived)
    return {
        isNew: true, base: null, id: uid(), date: iso(start), time: clock(start), minutes: 30,
        courseId: courseId || ui.study?.courseId || live?.id || null, itemId: null, note: "",
    }
}

export function sessionDraft(s: StudySession): SessionDraft {
    const start = new Date(s.startedAt)
    return {
        isNew: false, base: structuredClone(s), id: s.id, date: iso(start), time: clock(start), minutes: s.studyMinutes,
        courseId: courseRefKey(s), itemId: itemRefKey(s), note: s.note || "",
    }
}

/** When the typed day and time say the session started, in ms. */
export function startedAtOf(d: Pick<SessionDraft, "date" | "time">): number {
    const [y, m, day] = d.date.split("-").map(Number)
    const [h, min] = (parseTime(d.time) || "09:00").split(":").map(Number)
    return new Date(y, m - 1, day, h, min).getTime()
}

/** 1 to 720 whole minutes, a day up to today, and a start time. */
export const validSession = (d: SessionDraft, now = today()) =>
    Number.isInteger(d.minutes) && d.minutes >= 1 && d.minutes <= MAX_MINUTES
    && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date <= now && !!parseTime(d.time)

/** What saving would do to that day, the goal and the streak, in a line. */
export function impact(d: SessionDraft, sessions: StudySession[], prefs: StudyPrefs, now = today()): string {
    if (!validSession(d, now)) return d.date > now ? "Pick a day up to today." : "Enter a day, a start time and 1 to 720 minutes."
    const before: Map<string, number> = minutesByDay(sessions.filter((s) => s.id !== d.id))
    const after = new Map(before)
    const day = (after.get(d.date) || 0) + d.minutes
    after.set(d.date, day)
    const st = streak(after, now, prefs), was = streak(before, now, prefs)
    const parts = [d.date === now && prefs.goal
        ? "Today goes to " + duration(day) + " of " + duration(prefs.goal) + "."
        : shortDate(d.date) + " goes to " + duration(day) + "."]
    if (st.current > was.current) parts.push("Your streak goes to " + st.current + " day" + (st.current === 1 ? "" : "s") + ".")
    else if (st.current) parts.push("Your " + st.current + "-day streak is safe.")
    return parts.join(" ")
}

/** Save it, keeping what the stored session had besides (rounds, the manual flag), and close the sheet. */
export async function saveSession(d: SessionDraft) {
    if (!validSession(d)) return
    await store.saveStudySession({
        ...(d.base || { roundsDone: 0, manual: true }),
        id: d.id, ...refOf(d.courseId, d.itemId), note: d.note.trim(),
        startedAt: startedAtOf(d), studyMinutes: d.minutes,
    })
    closeSheet()
    notify()
}
