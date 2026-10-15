// The inbox (spec §12): your invites and what others did in your classes and projects that
// concerns you. The unread count arrives with each sync; the list is fetched when the inbox
// opens and kept in IndexedDB's meta store, so it still reads offline. Nothing is pushed.

import { useSyncExternalStore } from "react"
import { api } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { dayMonth } from "@/core/dates"
import { itemByKey } from "./effective"
import { openItem } from "./actions"
import { openClass } from "./classes"
import { openSheet } from "./overlay"
import { maintenanceState } from "./maintenance"
import type { ActivityRow, Inbox, Invite } from "./types"

let unread = 0
let box: Inbox | null = null
let offline = false
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

const NONE: Invite[] = []
export const useUnread = () => useSyncExternalStore(subscribe, () => unread)
export const useInbox = () => useSyncExternalStore(subscribe, () => box)
export const useInboxOffline = () => useSyncExternalStore(subscribe, () => offline)
/** Your pending invites, as the inbox last fetched them. */
export const useInvites = (): Invite[] => useSyncExternalStore(subscribe, () => box?.invites ?? NONE)

/** The count sync brought (core/sync.ts onUnread). */
export function setUnread(n: number): void { if (n !== unread) { unread = n; emit() } }

export const openInbox = () => openSheet({ kind: "inbox" })

/** Fetch the inbox; offline, the copy kept from last time. Not signed out, nor while classes are switched off for you. */
export async function refreshInbox(): Promise<void> {
    if (!data.profile || maintenanceState("classes") === "blocked") return
    try {
        box = await api.inbox.get()
        offline = false
        try { await store.meta.set("inbox", box) } catch { /* not kept: the list still shows */ }
    } catch {
        offline = true
        if (!box) { try { box = (await store.meta.get("inbox")) as Inbox | null } catch { /* none kept */ } }
        box ??= { invites: [], items: [], seen: 0 }
    }
    emit()
}

/** Everything in the list is read: the count falls to the invites still waiting. */
export async function markSeen(): Promise<void> {
    const top = box?.items[0]?.seq ?? 0
    if (!box || top <= box.seen) return
    box = { ...box, seen: top }
    setUnread(box.invites.filter((i) => !i.expired).length)
    emit()
    try { await api.inbox.seen(top) } catch { /* offline: the next open sends it again */ }
}

/** An invite answered (accepted, declined, or joined by code): it leaves the list and the count. */
export function dropInvite(spaceId: string): void {
    if (!box) return
    const had = box.invites.some((i) => i.spaceId === spaceId && !i.expired)
    box = { ...box, invites: box.invites.filter((i) => i.spaceId !== spaceId) }
    if (had) setUnread(Math.max(0, unread - 1))
    emit()
}

/* ── words ── */

const when = (v: string | null) => {
    const [date = "", start = ""] = (v ?? "").split("|")
    return date ? dayMonth(date) + (start ? " " + start : "") : "no date"
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
        case "task.unassigned": return `${title} has nobody on it now`
        case "task.status": return `${by} ${r.new === "done" ? "completed" : "reopened"} ${title}`
        case "member.joined": return `${by} joined`
        case "member.left": return `${by} left`
        case "member.removed": return r.about ? `${by} removed you from ${r.space}` : `${by} removed ${whom}`
        case "member.role": return `${by} made ${whom} ${role(r.new)}`
        case "space.archived": return `${by} ${r.new === "1" ? "archived" : "unarchived"} ${r.space}`
        case "space.linked": return `${by} linked ${r.space} to ${r.detail.assignment || "an assignment"}`
        case "space.transferred": return r.about ? `${by} made you the owner of ${r.space}` : `${by} handed ${r.space} to ${whom}`
        case "space.deleted": return `${by} deleted ${r.space}`
        default: return `${by} changed ${r.space}`
    }
}

/** Open what a row is about: its item while it is on this device, else its space (a class's sheet; projects in Stage 9). */
export function openRow(r: ActivityRow): void {
    const key = (r.kind === "project" ? "p:" : "c:") + r.spaceId + "/" + r.subject
    if (r.subject && itemByKey(key)) { openItem(key); return }
    if (r.kind === "class" && data.spaces.some((s) => s.id === r.spaceId)) openClass(r.spaceId)
}

/** A page of a space's Activity tab; null offline. */
export async function loadActivity(spaceId: string, before?: number): Promise<{ items: ActivityRow[]; more: boolean } | null> {
    try { return await api.spaces.activity(spaceId, before) } catch { return null }
}
