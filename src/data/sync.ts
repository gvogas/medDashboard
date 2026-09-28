// Sync status for React. core/sync.ts changes one status object in place and its
// onStatus has no unsubscribe, so one listener here copies it and wakes the hooks.

import { useSyncExternalStore } from "react"
import * as sync from "@/core/sync"
import { notify, subscribe } from "@/bridge"
import type { SyncState, SyncStatus } from "./types"

export const SYNC_LABELS: Record<SyncState, string> = {
    idle: "Synced",
    pending: "Saving…",
    syncing: "Syncing…",
    offline: "Offline",
    error: "Sync problem",
    "signed-out": "Signed out",
}

const copy = (s: SyncStatus): SyncStatus => ({ state: s.state, pending: s.pending, message: s.message })
const isTrouble = (s: SyncStatus) => s.state === "offline" || s.state === "error" || s.state === "signed-out"

let status: SyncStatus = copy(sync.status as SyncStatus)
let troubled = false
let announcement = ""

/* A screen reader hears trouble starting and its end, not every save. */
function announce(s: SyncStatus) {
    const bad = isTrouble(s)
    if (bad === troubled && !bad) return
    announcement = bad ? SYNC_LABELS[s.state] + (s.message ? ". " + s.message : "") : "Synced again"
    troubled = bad
}

sync.onStatus((s: SyncStatus) => {
    status = copy(s)
    announce(status)
    notify()
})

/** "Offline · 3" when edits wait on this device. */
export function syncLabel(s: SyncStatus): string {
    return SYNC_LABELS[s.state] + (s.state === "offline" && s.pending ? " · " + s.pending : "")
}

export const useSyncStatus = () => useSyncExternalStore(subscribe, () => status)
export const useSyncAnnouncement = () => useSyncExternalStore(subscribe, () => announcement)
