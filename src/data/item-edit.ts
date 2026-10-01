// Editing an item: what an edit to one field changes besides it, saving as you type, and
// the small shows when something is finished. From legacy views/drawer-item.js; the item
// sheet (components/sheet/item-sheet.tsx) is the only form now.

import { useSyncExternalStore } from "react"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { classRoom, isOpen, normalizeItem, shiftEnd, statusesFor } from "@/core/model"
import { dayMonth, diffDays, parse, today, DOW } from "@/core/dates"
import { repeatEnds, type SchoolCalendar, type Term } from "@/core/school"
import { nextReview } from "@/core/reviews"
import { launch as fireworks } from "@/lib/fireworks"
import { useItems } from "./store"
import type { Course, Item } from "./types"

/* ── what an edit changes ── */

/* Some items name themselves from the course: office hours after the teacher, exams,
   quizzes and tutorials after the class. */
export function autoTitleFor(type: string, c: Course | null | undefined): string {
    if (!c) return ""
    if (type === "office") return c.instructor ? c.instructor + " — office hours" : ""
    if (type === "exam") return c.name ? "Exam — " + c.name : ""
    if (type === "quiz") return c.name ? "Quiz — " + c.name : ""
    if (type === "tutoring") return c.name ? c.name + " — tutorial" : ""
    return ""
}

/** The title after the type or course changed: filled in, unless it was typed by hand. */
function autoTitle(it: Item, prevCourse: Course | null, course: Course | null): string {
    const next = autoTitleFor(it.type, course)
    if (!next) return it.title
    const wasAuto = ["office", "exam", "quiz", "tutoring"].some((t) => it.title === autoTitleFor(t, prevCourse) || it.title === autoTitleFor(t, course))
    return it.title.trim() && !wasAuto ? it.title : next
}

/** A status set, with when it was finished (kept if it already was). */
export const withStatus = (it: Item, status: string): Pick<Item, "status" | "completedAt"> =>
    ({ status, completedAt: status === "todo" ? null : it.completedAt || Date.now() })

export type ItemField = keyof Item

/** The types whose card offers Repeat. */
export const REPEATS = ["office", "tutoring", "lab"]
export const REPEAT_CHOICES = [["once", "Just once"], ["weekly", "Every week"]] as const

/** "the end of Fall 2026 · 18 Dec", or "the end of the school year · 22 Dec". */
export const untilLabel = (x: { end: string; term: Term | null }) =>
    "the end of " + (x.term ? x.term.name : "the school year") + " · " + dayMonth(x.end)

/**
 * An edit to one field and everything it brings along: the weekday follows the date on a
 * weekly item; a weekly item ends with its semester by default; the end follows the start;
 * the course or type fill in the title; a status the new type lacks goes back to its first;
 * an exam on a class day takes the class's room unless one was typed. Returns the fields
 * to save.
 */
export function deriveEdit(it: Item, field: ItemField, value: unknown, courseOf: (id: string | null) => Course | null, cal: SchoolCalendar | null = null): Partial<Item> {
    const patch: Partial<Item> = {}
    if (field === "recur") {
        const on = !!value
        /* switched on, it repeats until the end of the item's semester unless an end was set */
        const until = it.recurUntil || repeatEnds(cal, it.date)[0]?.end || null
        Object.assign(patch, { recur: on ? "weekly" : null, weekday: on ? parse(it.date).getDay() : null, recurUntil: on ? until : null })
    } else if (field === "weight") {
        const n = Number(value)
        patch.weight = value === "" || !(n > 0) ? null : Math.min(100, n)
    } else if (field === "grade") {
        patch.grade = value === "" ? null : Math.max(0, Math.min(100, Number(value)))
    } else if (field === "courseId") {
        patch.courseId = (value as string) || null
        patch.title = autoTitle(it, courseOf(it.courseId), courseOf(patch.courseId))
    } else if (field === "recurUntil") {
        patch.recurUntil = (value as string) || null
    } else if (field === "status") {
        Object.assign(patch, withStatus(it, value as string))
    } else if (field === "start") {
        patch.start = value as string
        if (patch.start && it.start) patch.end = shiftEnd(it.start, it.end, patch.start)
    } else if (field === "type") {
        patch.type = value as string
        patch.title = autoTitle({ ...it, type: patch.type }, courseOf(it.courseId), courseOf(it.courseId))
        if (!statusesFor(patch.type).some((x: string[]) => x[0] === it.status)) Object.assign(patch, withStatus(it, "todo"))
    } else {
        Object.assign(patch, { [field]: value })
        if (field === "date" && it.recur === "weekly") {
            patch.weekday = parse(value as string).getDay()
            /* an end the new date passes would be dropped, and the default end moves with the
               date; no end, or an end picked by hand that is still ahead, stays */
            const until = it.recurUntil
            if (until && (until < (value as string) || until === repeatEnds(cal, it.date)[0]?.end))
                patch.recurUntil = repeatEnds(cal, value as string)[0]?.end ?? null
        }
    }
    if (field === "date" || field === "courseId" || field === "type" || field === "start") {
        const next = { ...it, ...patch }
        const roomWas = classRoom(it, courseOf(it.courseId))
        if (!it.where || it.where === roomWas) patch.where = classRoom(next, courseOf(next.courseId))
    }
    return patch
}

/** "today", "in 3 days", "2 days ago", or "every Tue" for a weekly item. */
export function countdown(it: Item, now = today()): string {
    if (it.recur === "weekly") return "every " + DOW[it.weekday ?? 0]
    const dd = diffDays(now, it.date)
    if (dd === 0) return "today"
    if (dd === 1) return "tomorrow"
    return dd > 0 ? "in " + dd + " days" : -dd + " day" + (dd === -1 ? "" : "s") + " ago"
}

/** The days other open items fall on: the date picker's dots. */
export const busyDays = (items: Item[], except: string): Set<string> =>
    new Set(items.filter((x) => x.id !== except && isOpen(x)).map((x) => x.date))

/** A web link as the server takes it: https:// added, spaces after the host written out. null if not one. */
export function linkUrl(raw: string, isHttp: (u: string) => boolean): string | null {
    const url = raw.trim()
    if (!url) return null
    const typed = /^https?:\/\//i.test(url) ? url : "https://" + url
    const full = typed.replace(/^(https?:\/\/[^/?#]*)(.*)$/is, (_m, head: string, rest: string) => head + rest.replace(/\s/g, "%20"))
    return isHttp(full) ? full : null
}

/* ── saving ── */

/* Typing saves when it pauses, not on every key: each save rewrites the local database,
   reloads it and tells the other tabs. The typed value is held apart from the row, since
   a sync may reload the row meanwhile; leaving the field or the sheet saves at once. */
export const TYPING_MS = 400
let pending: { id: string; patch: Partial<Item>; timer: ReturnType<typeof setTimeout> } | null = null
let version = 0
const listeners = new Set<() => void>()
const emit = () => { version++; for (const fn of listeners) fn() }
const subscribePending = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** What is typed but not saved yet for an item. */
export const pendingFor = (id: string): Partial<Item> | null => (pending?.id === id ? pending.patch : null)

/** An item as the sheet shows it: stored, with what is still waiting to save on top. */
export function useItemView(id: string): Item | null {
    useItems()   /* redraw when the store reloads */
    useSyncExternalStore(subscribePending, () => version)
    const row = store.item(id) as Item | null
    return row ? { ...row, ...pendingFor(id) } : null
}

async function save(id: string, patch: Partial<Item>) {
    const row = store.item(id) as Item | null
    if (!row) return
    await store.saveItem(normalizeItem({ ...row, ...patch }))
}

/** Typing in a text field (title, notes, room, a step): saved once it pauses. */
export function typeInto(id: string, patch: Partial<Item>) {
    if (pending && pending.id !== id) void flush()
    clearTimeout(pending?.timer)
    pending = { id, patch: { ...(pending?.id === id ? pending.patch : {}), ...patch }, timer: setTimeout(() => void flush(), TYPING_MS) }
    emit()
}

/** Save what is waiting, now. */
export async function flush() {
    const p = pending
    pending = null
    if (!p) return
    clearTimeout(p.timer)
    try { await save(p.id, p.patch) } finally { emit() }
}

/** Any other edit: saved at once, after what is waiting (so the two do not undo each other). */
export async function editNow(id: string, patch: Partial<Item>) {
    const typed = pendingFor(id)
    if (pending) { clearTimeout(pending.timer); pending = null }
    await save(id, { ...typed, ...patch })
    emit()
}

/** Save a row changed in place (a task ticked on the board). */
export async function touch(it: Item) {
    const typed = pendingFor(it.id)
    if (typed) { Object.assign(it, typed); clearTimeout(pending!.timer); pending = null }
    else await flush()
    await store.saveItem(it)
}

/* ── finishing ── */

/** A small show from an element, for finishing something. */
export function celebrate(el: Element) {
    const r = el.getBoundingClientRect()
    fireworks(r.left + r.width / 2, r.top + r.height / 2, { rockets: 2 })
}

/** Set a status on a row in place, with when it was finished. */
export function setStatus(it: Item, status: string) {
    Object.assign(it, withStatus(it, status))
}

/** A review step just finished: book the next one. */
export async function chainReview(it: Item) {
    if (it.status !== "done") return
    const next = nextReview(it, today(), data.items)
    if (next) await store.saveItem(normalizeItem(next))
}
