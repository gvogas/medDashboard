// Your layer on a class's item, and the class's own row, edited from the item card (spec §4,
// §15). Your status, grade, weight, checklist, notes and "not mine" go into your mark,
// '<space id>:<item id>', made on first touch; the class's facts into its shared row (its
// owner and editors). Text saves once typing pauses, as for your own items (item-edit.ts).

import { useSyncExternalStore } from "react"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { isOpen } from "@/core/model"
import type { Row } from "@/core/db"
import { celebrate, TYPING_MS } from "./item-edit"
import { itemByKey } from "./effective"
import { splitKey } from "./refs"
import type { Item, Mark, SharedCourse, SharedItem, Space } from "./types"

/** Your mark's id for a shared item's key ('c:<space>/<item>' → '<space>:<item>'). */
export const markIdOf = (key: string): string => { const k = splitKey(key); return k.spaceId + ":" + k.id }
/** Your mark on the item with this key, if you have touched it. */
export const markFor = (key: string): Mark | null => (data.marks ?? []).find((m) => m.id === markIdOf(key)) ?? null

/* ── typing: one row's text waits for the pause ── */

let version = 0
const listeners = new Set<() => void>()
const bump = () => { version++; for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
/** Redraws while text is waiting to save, and when it has. */
export const useTyping = () => useSyncExternalStore(subscribe, () => version)

function typist<T>(save: (key: string, patch: Partial<T>) => Promise<unknown>) {
    let held: { key: string; patch: Partial<T>; timer: ReturnType<typeof setTimeout> } | null = null
    const flush = async () => {
        const h = held
        held = null
        if (!h) return
        clearTimeout(h.timer)
        try { await save(h.key, h.patch) }
        catch (e) {
            /* not saved: it waits for the next flush, unless newer typing took its place */
            const now = held as typeof h | null   /* typing may have come in while the save ran */
            if (!now) held = { ...h, timer: undefined as unknown as ReturnType<typeof setTimeout> }
            else if (now.key === h.key) now.patch = { ...h.patch, ...now.patch }
            throw e
        }
        finally { bump() }
    }
    return {
        type(key: string, patch: Partial<T>) {
            if (held && held.key !== key) void flush()
            clearTimeout(held?.timer)
            held = { key, patch: { ...(held?.key === key ? held.patch : {}), ...patch }, timer: setTimeout(() => void flush(), TYPING_MS) }
            bump()
        },
        /** What waits for `key`, taken off: the save about to happen carries it. */
        take(key: string): Partial<T> {
            if (held?.key !== key) return {}
            const p = held.patch
            clearTimeout(held.timer)
            held = null
            return p
        },
        peek: (key: string): Partial<T> => (held?.key === key ? held.patch : {}),
        flush,
    }
}

async function saveMark(key: string, patch: Partial<Mark>) {
    const k = splitKey(key), held = markFor(key)
    await store.saveMark({ ...(held ?? { id: k.spaceId + ":" + k.id, spaceId: k.spaceId!, itemId: k.id }), ...patch })
}
async function saveRow(key: string, patch: Partial<SharedItem>) {
    const k = splitKey(key), row = (data.shared_items ?? []).find((it) => it.scope === k.scope && it.id === k.id)
    if (!row) return
    await store.saveShared("shared_items", { ...row, ...patch } as unknown as Row & { scope: string })
}
const markTyping = typist<Mark>(saveMark)
const rowTyping = typist<SharedItem>(saveRow)

/** Your mark, saved now, with any of its text still waiting. */
export const editMark = (key: string, patch: Partial<Mark>) => saveMark(key, { ...markTyping.take(key), ...patch })
/** Text in your mark (notes, a step): saved once typing pauses. */
export const typeMark = (key: string, patch: Partial<Mark>) => markTyping.type(key, patch)
/** The class's row, saved now (owner and editors), with any of its text still waiting. */
export const editRow = (key: string, patch: Partial<SharedItem>) => saveRow(key, { ...rowTyping.take(key), ...patch })
/** Text in the class's row (title, room, class notes): saved once typing pauses. */
export const typeRow = (key: string, patch: Partial<SharedItem>) => rowTyping.type(key, patch)
/** What is typed but not saved yet, to show over the stored row. */
export const pendingMark = (key: string): Partial<Mark> => markTyping.peek(key)
export const pendingRow = (key: string): Partial<SharedItem> => rowTyping.peek(key)
/** Save whatever is waiting: the card is closing. */
export const flushTyping = async () => { await Promise.all([markTyping.flush(), rowTyping.flush()]) }

/** A status on your mark, with when it was finished (kept if it already was). */
export const markStatus = (mark: Pick<Mark, "completedAt"> | null, status: string): Pick<Mark, "status" | "completedAt"> =>
    ({ status, completedAt: status === "todo" ? null : mark?.completedAt || Date.now() })

/** Tick a class's task off or back on from the board, in your mark. */
export async function toggleClassTask(key: string, from?: Element) {
    const it = itemByKey(key)
    if (!it) return
    const finishing = isOpen(it)
    if (finishing && from) celebrate(from)
    await editMark(key, markStatus(markFor(key), finishing ? "done" : "todo"))
}

/** Hiding means "not mine" (spec §15): asked first when the mark holds a grade. */
export const hideAsks = (mark: Pick<Mark, "grade" | "status"> | null): boolean => mark?.grade != null || mark?.status === "graded"
export const setHidden = (key: string, hidden: boolean) => editMark(key, { hidden })

/** Your hidden items in a class, for its sheet's Show again. */
export function hiddenIn(scope: string, items: SharedItem[] = data.shared_items ?? [], marks: Mark[] = data.marks ?? []): SharedItem[] {
    const off = new Set(marks.filter((m) => m.hidden).map((m) => m.id))
    return items.filter((it) => it.scope === scope && off.has(scope.slice(2) + ":" + it.id))
}

/* ── a new item with a class picked ── */

/** Whether a new item can go into the class itself: you are its owner or an editor, it is not archived, and the type is built in (the c: CHECK). */
export function canAddToClass(row: { type: string; classId?: string | null }): boolean {
    const space = row.classId ? (data.spaces ?? []).find((s) => s.id === row.classId) : null
    return !!space && space.kind === "class" && space.role !== "member" && !space.archived && !row.type.startsWith("c-")
}

/** A new item an owner or editor adds to a class (spec §20): the class's row under its one course, with nothing of yours on it. */
export async function addToClass(row: Item) {
    const scope = "c:" + row.classId, course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    if (!course) { await store.saveItem(row); return }
    await store.saveShared("shared_items", {
        ...row, scope, courseId: course.id, classId: null, status: "todo", grade: null, checklist: [], completedAt: null,
    } as unknown as Row & { scope: string })
}

/* ── who changed it ── */

/** "2h ago": roughly how long since a write. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
    if (!ms) return ""
    const s = Math.max(0, Math.round((now - ms) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return m + " min ago"
    const h = Math.round(m / 60)
    if (h < 24) return h + "h ago"
    const d = Math.round(h / 24)
    return d === 1 ? "yesterday" : d + " days ago"
}

/** "Edited by Alex · 2h ago" for a shared row: "you" for your own write, "a former member" for an account gone (spec §4). */
export function editedBy(row: Pick<SharedItem | SharedCourse, "updatedBy" | "updatedAt">, space: Pick<Space, "members"> | null, me: string | undefined, now = Date.now()): string {
    if (!row.updatedBy) return ""
    const who = row.updatedBy === me ? "you" : space?.members.find((m) => m.userId === row.updatedBy)?.name ?? "a former member"
    const when = ago(row.updatedAt, now)
    return "Edited by " + who + (when ? " · " + when : "")
}
