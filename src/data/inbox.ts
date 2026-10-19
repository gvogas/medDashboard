// The inbox (spec §12): your invites and what others did in your classes and projects that
// concerns you. The unread count arrives with each sync; the list is fetched when the inbox
// opens and kept in IndexedDB's meta store, so it still reads offline. Nothing is pushed.

import { useSyncExternalStore } from "react"
import { api, ApiError } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { dayMonth } from "@/core/dates"
import { itemByKey } from "./effective"
import { openItem } from "./actions"
import { openClass } from "./classes"
import { openProject } from "./projects"
import { openSheet } from "./overlay"
import { maintenanceState } from "./maintenance"
import type { ActivityRow, Inbox } from "./types"

let unread = 0
let box: Inbox | null = null
let offline = false
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export const useUnread = () => useSyncExternalStore(subscribe, () => unread)
export const useInbox = () => useSyncExternalStore(subscribe, () => box)
export const useInboxOffline = () => useSyncExternalStore(subscribe, () => offline)

/* the list as it now stands, for offline reading; a failed write only leaves the older copy */
const keep = (b: Inbox) => { void Promise.resolve().then(() => store.meta.set("inbox", b)).catch(() => {}) }

/** The count sync brought (core/sync.ts onUnread). */
export function setUnread(n: number): void { if (n !== unread) { unread = n; emit() } }

export const openInbox = () => openSheet({ kind: "inbox" })

/**
 * Fetch the inbox; offline, the copy kept from last time. Not signed out, nor while classes are
 * switched off for you. Resolves with how far it was read when it came (null when not fetched),
 * so the sheet knows which rows were new before markSeen moves the marker.
 */
export async function refreshInbox(): Promise<number | null> {
    if (!data.profile || maintenanceState("classes") === "blocked") return null
    /* this call's own answer: another refresh may replace `box` while this one awaits */
    let mine: Inbox
    try {
        mine = box = await api.inbox.get()
        offline = false
        try { await store.meta.set("inbox", mine) } catch { /* not kept: the list still shows */ }
    } catch {
        offline = true
        if (!box) { try { box = (await store.meta.get("inbox")) as Inbox | null } catch { /* none kept */ } }
        mine = box ??= { invites: [], items: [], seen: 0 }
    }
    emit()
    return mine.seen
}

/** Everything in the list is read: the count falls to the invites still waiting. Not offline: the server would not hear. */
export async function markSeen(): Promise<void> {
    const top = box?.items[0]?.seq ?? 0
    if (!box || offline || top <= box.seen) return
    const before = box.seen, unreadBefore = unread
    box = { ...box, seen: top }
    setUnread(box.invites.filter((i) => !i.expired).length)
    keep(box)
    emit()
    try { await api.inbox.seen(top) } catch {
        /* offline: not read as far as the server knows, so the next open sends it again */
        if (box?.seen === top) { box = { ...box, seen: before }; keep(box); setUnread(unreadBefore); emit() }
        return
    }
    /* a pull already under way may bring the count from before: the next one replaces it */
    sync.syncNow().catch(() => {})
}

/** An invite answered (accepted, declined, or joined by code): it leaves the list and the count. */
export function dropInvite(spaceId: string): void {
    if (!box) return
    const had = box.invites.some((i) => i.spaceId === spaceId && !i.expired)
    box = { ...box, invites: box.invites.filter((i) => i.spaceId !== spaceId) }
    if (had) setUnread(Math.max(0, unread - 1))
    keep(box)
    emit()
}

/* ── words ── */

/* 'date|start|end': "18 Oct 09:00–10:30", "18 Oct 09:00", "18 Oct until 10:30", "18 Oct" */
const when = (v: string | null) => {
    const [date = "", start = "", end = ""] = (v ?? "").split("|")
    if (!date) return "no date"
    const time = start && end ? start + "–" + end : start || (end ? "until " + end : "")
    return dayMonth(date) + (time ? " " + time : "")
}
const pct = (v: string | null) => (v === null ? "none" : Number(v) + "%")
const role = (r: string | null) => (r === "editor" ? "an editor" : r === "owner" ? "the owner" : "a member")

/** What a row says (spec §12), for the inbox and the Activity tabs. `me` is your user id. */
export function describe(r: ActivityRow, me: string): string {
    const by = r.actor === me ? "You" : r.detail.by || "A former member"
    const title = r.detail.title || "this " + (r.verb.startsWith("task") ? "task" : "item")
    const whom = r.subjectUser === me ? "you" : r.detail.whom || "a former member"
    switch (r.verb) {
        case "item.created": {
            const t = r.detail.titles ?? []
            return r.n === 1 ? `${by} added ${t[0] ?? "an item"}` : `${by} added ${r.n} items: ${t.slice(0, 3).join(", ")}${r.n > 3 ? "…" : ""}`
        }
        case "item.deleted": return `${by} ${r.new === "1" ? "deleted" : "restored"} ${title}`
        case "item.date": return `${by} moved ${title}: ${when(r.old)} → ${when(r.new)}`
        case "item.weight": return `${by} changed ${title}'s weight: ${pct(r.old)} → ${pct(r.new)}`
        case "item.title": return `${by} renamed ${r.old} to ${r.new}`
        case "course.meetings": return `${by} changed the class times`
        case "course.instructor": return `${by} changed the instructor: ${r.old || "none"} → ${r.new || "none"}`
        case "task.assigned":
            if (r.new === "*") return `${by} gave ${title} to everyone`
            if (r.actor === r.subjectUser) return `${by} took ${title}`
            return r.about ? `${by} assigned you ${title}` : `${by} assigned ${title} to ${whom}`
        case "task.unassigned": return `${by} took everyone off ${title}`
        case "task.status": return `${by} ${r.new === "done" ? "completed" : "reopened"} ${title}`
        case "member.joined": return `${by} joined`
        case "member.left": return `${by} left`
        case "member.removed": return r.about ? `${by} removed you from ${r.space}` : `${by} removed ${whom}`
        case "member.role": return `${by} made ${whom} ${role(r.new)}`
        case "space.archived": return `${by} ${r.new === "1" ? "archived" : "unarchived"} ${r.space}`
        case "space.linked": return r.new === null ? `${by} unlinked ${r.space} from its assignment` : `${by} linked ${r.space} to ${r.detail.assignment || "an assignment"}`
        case "space.transferred": return r.about ? `${by} made you the owner of ${r.space}` : `${by} handed ${r.space} to ${whom}`
        case "space.deleted": return `${by} deleted ${r.space}`
        default: return `${by} changed ${r.space}`
    }
}

/* what a row opens: its item while it is on this device (a project's tasks are not in the views
   until Stage 9), else its space's sheet, else nothing. `here` is the space whose sheet is already open (its Activity tab):
   opening that again would go nowhere. */
function target(r: ActivityRow, here = ""): (() => void) | null {
    const key = (r.kind === "project" ? "p:" : "c:") + r.spaceId + "/" + r.subject
    if (r.subject && itemByKey(key)) return () => openItem(key)
    if (r.spaceId === here || !data.spaces.some((s) => s.id === r.spaceId)) return null
    if (r.kind === "project") return () => openProject(r.spaceId)
    if (r.kind === "class") return () => openClass(r.spaceId)
    return null
}
/** Whether openRow would open anything for this row, seen from the sheet of space `here` if any. */
export const openable = (r: ActivityRow, here?: string): boolean => target(r, here) !== null
/** Open what a row is about: its item while it is on this device, else its space. */
export function openRow(r: ActivityRow, here?: string): void { target(r, here)?.() }

/**
 * A page of a space's Activity tab; null when the server could not be reached (offline, a
 * timeout: anything that is not an answer, as classes.ts messageFor reads it). An answer that
 * is an error (404, 429, 500…) is thrown, for the tab to say what it was.
 */
export async function loadActivity(spaceId: string, before?: number): Promise<{ items: ActivityRow[]; more: boolean } | null> {
    try { return await api.spaces.activity(spaceId, before) } catch (e) {
        if (e instanceof ApiError) throw e
        return null
    }
}
