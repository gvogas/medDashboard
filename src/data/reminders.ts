// Deadline and exam reminders in the iPhone and Mac apps: local notifications the phone
// shows by itself, worked out here from what is on this device, so nothing is sent to a
// server and they fire offline. On in Settings → Reminders, which asks iOS's permission.
//
// When: an exam or quiz the evening two days before and the morning of; anything else that
// is due the evening before and on the day (three hours before its time, or 9:00). Only open
// items, only the next 30 days, and at most 60, under iOS's 64 pending notifications.

import { NATIVE } from "@/core/native"
import { tmeta } from "@/core/model"
import { courseByKey, courseKeyOf, effectiveItems, type EffectiveItem } from "./effective"
import type { EffectiveCourse } from "./effective"

export interface Reminder { id: number; at: Date; title: string; body: string }

const TESTS = new Set(["exam", "quiz"])
const SKIP = new Set(["office", "tutoring"])     /* times on the calendar, not things due */
const HORIZON_DAYS = 30
const MAX = 60
const KEY = "rounds.reminders"

const at = (date: string, hhmm: string, dayShift = 0): Date => {
    const [y, m, d] = date.split("-").map(Number)
    const [h, min] = hhmm.split(":").map(Number)
    return new Date(y, m - 1, d + dayShift, h, min)
}
const minus = (hhmm: string, hours: number): string => {
    const [h, m] = hhmm.split(":").map(Number)
    const t = Math.max(0, h * 60 + m - hours * 60)
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

/* A notification id must be a 32-bit integer: a hash of the item's key and which reminder it is. */
function idOf(key: string, which: number): number {
    let h = 2166136261
    for (const ch of key + "#" + which) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    return (h >>> 1) || 1
}

/** The reminders for these items, soonest first. Pure, for the tests. */
export function plan(items: readonly EffectiveItem[], courseOf: (it: EffectiveItem) => EffectiveCourse | null, now = new Date()): Reminder[] {
    const until = new Date(now.getTime() + HORIZON_DAYS * 86400000)
    const out: Reminder[] = []
    for (const it of items) {
        if (it.status !== "todo" || it.recur || SKIP.has(it.type) || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) continue
        const code = courseOf(it)?.code
        const name = (code ? code + " · " : "") + it.title
        const label = tmeta(it.type).label
        const key = it.key ?? it.id
        const when = it.start ? " at " + it.start : ""
        const pairs: [Date, string, string][] = TESTS.has(it.type)
            ? [[at(it.date, "18:00", -2), label + " in two days", name + when],
               [at(it.date, "07:30"), label + " today", name + when]]
            : [[at(it.date, "18:00", -1), "Due tomorrow", name + when],
               [at(it.date, it.start ? minus(it.start, 3) : "09:00"), "Due today", name + when]]
        pairs.forEach(([time, title, body], which) => {
            if (time > now && time < until) out.push({ id: idOf(key, which), at: time, title, body })
        })
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX)
}

/* ── on the device ── */

export const remindersOn = (): boolean => { try { return NATIVE && localStorage.getItem(KEY) === "on" } catch { return false } }

const plugin = () => import("@capacitor/local-notifications").then((m) => m.LocalNotifications)
let timer: ReturnType<typeof setTimeout> | null = null

/** Turn reminders on (asking iOS first) or off. True when they are on afterwards. */
export async function setReminders(on: boolean): Promise<boolean> {
    if (!NATIVE) return false
    const ln = await plugin()
    if (on) {
        const { display } = await ln.requestPermissions()
        if (display !== "granted") return false
    }
    try { localStorage.setItem(KEY, on ? "on" : "off") } catch {}
    await reschedule()
    return on
}

/** Replace the pending reminders with the ones for what is on the device now. */
export async function reschedule(): Promise<void> {
    if (!NATIVE) return
    const ln = await plugin()
    /* every pending notification is one of these, from this run or an earlier one */
    const { notifications: pending } = await ln.getPending()
    if (pending.length) await ln.cancel({ notifications: pending.map((n) => ({ id: n.id })) })
    if (!remindersOn()) return
    const list = plan(effectiveItems(), (it) => courseByKey(courseKeyOf(it)))
    if (!list.length) return
    await ln.schedule({ notifications: list.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true } })) })
}

/** After a change, a moment later: a burst of edits schedules once. */
export function rescheduleSoon(): void {
    if (!NATIVE || !remindersOn()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void reschedule().catch(() => {}) }, 2000)
}

/** Signed out or deleted: nothing of this account is left to fire on the device. */
export async function stopReminders(): Promise<void> {
    if (!NATIVE) return
    if (timer) { clearTimeout(timer); timer = null }
    const ln = await plugin()
    const { notifications: pending } = await ln.getPending()
    if (pending.length) await ln.cancel({ notifications: pending.map((n) => ({ id: n.id })) })
}
