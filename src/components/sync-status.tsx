// The sync button: a dot and a word for the sync state; a click syncs now. It sits in
// the sidebar's foot. The words are said to screen readers by SyncAnnouncer, which <App>
// draws outside #app: on a narrow screen the closed sidebar is inert, and the sheet makes
// #app inert, and a live region in either would go unheard.

import { cn } from "@/lib/utils"
import { syncLabel, useSyncAnnouncement, useSyncStatus } from "@/data/sync"
import { syncNow } from "@/data/actions"
import type { SyncState } from "@/data/types"

export const DOT: Record<SyncState, string> = {
    idle: "bg-[var(--good)]",
    pending: "bg-[var(--warn)]",
    syncing: "bg-[var(--warn)]",
    offline: "bg-muted-foreground",
    error: "bg-destructive",
    "signed-out": "bg-destructive",
}

export function SyncStatus({ className }: { className?: string }) {
    const s = useSyncStatus()
    const title = s.message || (s.state === "offline" ? "Changes are kept on this device until you are back online" : "Sync now")
    return (
        <button
            type="button"
            title={title}
            onClick={syncNow}
            data-state={s.state}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-ink-2 hover:text-foreground max-[700px]:py-1.5",
                className,
            )}
        >
            <i aria-hidden="true" className={cn("size-[7px] rounded-full", DOT[s.state])} />
            {syncLabel(s)}
        </button>
    )
}

/** The sync state in words, as it changes, for screen readers. */
export function SyncAnnouncer() {
    const said = useSyncAnnouncement()
    return <span className="sr-only" role="status">{said}</span>
}

/** The states worth a dot on the menu button when the sidebar is out of sight. */
export const syncTrouble = (state: SyncState) => state === "error" || state === "signed-out" || state === "offline"
