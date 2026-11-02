// The pages, in the sidebar: Week, Month, All items, Study, Music, Buddy while gameplay is on, and Admin for admins. The view is the UI
// state's (ui.view); this reads it through the bridge and changes it with setView, the
// same call the 1–5 keys make. It replaces the dock that sat in the top bar. On a narrow
// screen, where the sidebar slides over the page, picking a page closes it.

import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { subscribe, subscribeStudyBadge, getStudyBadge } from "@/bridge"
import { ui } from "@/data/ui"
import { setView } from "@/data/study-controller"
import { useFriends } from "@/data/friends"
import { setSide, sideOpen } from "@/data/sidebar"
import { useProfile } from "@/data/store"
import type { View } from "@/data/types"
import { activeBuddy, useBuddy } from "@/data/buddy"
import { useMaintenance } from "@/data/maintenance"

export const PAGES: { id: View; label: string; shortcut: string }[] = [
    { id: "week", label: "Week", shortcut: "1" },
    { id: "month", label: "Month", shortcut: "2" },
    { id: "table", label: "All items", shortcut: "3" },
    { id: "study", label: "Study", shortcut: "4" },
    { id: "spotify", label: "Music", shortcut: "5" },
]

/* Only while gameplay is on (Settings › Study › Gameplay). */
const BUDDY = { id: "buddy" as View, label: "Buddy", shortcut: "6" }
/* Only for admins, and without a number key. */
const ADMIN = { id: "admin" as View, label: "Admin", shortcut: "" }

const currentView = () => ui.view as View

export function SideNav() {
    const view = useSyncExternalStore(subscribe, currentView)
    const badge = useSyncExternalStore(subscribeStudyBadge, getStudyBadge)
    /* a friend studying now, as the last friends list said */
    const friendLive = !!useFriends().list?.friends.some((f) => f.live)
    const admin = !!useProfile()?.isAdmin
    /* both hooks every render: a short-circuit here would change the hook order once the buddy loads */
    const buddy = activeBuddy(useBuddy())
    const buddyBlocked = useMaintenance("buddy") === "blocked"
    const buddyOn = !!buddy && !buddyBlocked
    return (
        <nav aria-label="Pages" className="flex flex-col gap-0.5">
            {[...PAGES, ...(buddyOn ? [BUDDY] : []), ...(admin ? [ADMIN] : [])].map((p) => {
                const on = p.id === view
                return (
                    <button
                        key={p.id}
                        type="button"
                        aria-current={on ? "page" : undefined}
                        title={p.shortcut ? p.label + " (" + p.shortcut + ")" : p.label}
                        aria-keyshortcuts={p.shortcut || undefined}
                        onClick={() => { setView(p.id); if (sideOpen()) setSide(false) }}
                        className={cn(
                            "flex h-8 cursor-pointer items-center justify-between rounded-[6px] border-0 px-2.5 text-left text-[14px]",
                            on ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--line)]" : "bg-transparent text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground",
                        )}
                    >
                        {p.label}
                        {p.id === "study" && badge && <span className="font-mono text-[11.5px] text-accent-foreground">{badge}</span>}
                        {p.id === "study" && !badge && friendLive && <span title="A friend is studying now" className="size-[7px] rounded-full bg-[var(--study)]"><span className="sr-only">, a friend is studying now</span></span>}
                    </button>
                )
            })}
        </nav>
    )
}
