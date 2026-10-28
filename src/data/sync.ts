// Sync status for React. core/sync.ts changes one status object in place and its
// onStatus has no unsubscribe, so one listener here copies it and wakes the hooks.

import { useSyncExternalStore } from "react"
import * as sync from "@/core/sync"
import { notify, subscribe } from "@/bridge"
import type { SyncState, SyncStatus } from "./types"
import { HOLD_TEXT, changesWaiting } from "@/core/sync-text"
import { toast } from "./toast"

export const SYNC_LABELS: Record<SyncState, string> = {
    idle: "Synced",
    pending: "Saving…",
    syncing: "Syncing…",
    offline: "Offline",
    error: "Sync problem",
    "signed-out": "Signed out",
}

/** The sync status as the hooks see it; `conflicts` counts saved copies waiting for a decision. */
type Shown = SyncStatus & { conflicts?: number }
const copy = (s: Shown): Shown => ({ state: s.state, pending: s.pending, message: s.message, conflicts: s.conflicts ?? 0 })
const isTrouble = (s: SyncStatus) => s.state === "offline" || s.state === "error" || s.state === "signed-out"

let status: Shown = copy(sync.status as Shown)
let troubled = false
let announcement = ""

/* A screen reader hears trouble starting and its end, not every save. */
function announce(s: SyncStatus) {
    const bad = isTrouble(s)
    if (bad === troubled && !bad) return
    announcement = bad ? SYNC_LABELS[s.state] + (s.message ? ". " + s.message : "") : "Synced again"
    troubled = bad
}

/* The refusal a toast has named: core makes a new object for each cycle's first refused edit. */
let named: object | null = null
sync.onStatus((s: SyncStatus) => {
    const refusal = (s as SyncStatus & { refusal?: { reason: string } }).refusal
    if (refusal && refusal !== named) { named = refusal; toast(refusal.reason + " Review it in Settings.", { error: true }) }
    status = copy(s)
    announce(status)
    notify()
})

/** "Offline · 3 changes waiting" when edits wait on this device; saved copies and a
    maintenance hold get words of their own. */
export function syncLabel(s: Shown): string {
    if (s.conflicts) return "Review saved changes"
    if (s.state === "pending" && s.message === HOLD_TEXT) return "Waiting for shared edits"
    if (s.state === "offline" && s.pending) return "Offline · " + changesWaiting(s.pending)
    return SYNC_LABELS[s.state]
}

export const useSyncStatus = () => useSyncExternalStore(subscribe, () => status)
export const useSyncAnnouncement = () => useSyncExternalStore(subscribe, () => announcement)
