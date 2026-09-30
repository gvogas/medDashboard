// The pages, in the sidebar: Week, Month, All items, Study, Music. The view is the UI
// state's (ui.view); this reads it through the bridge and changes it with setView, the
// same call the 1–5 keys make. It replaces the dock that sat in the top bar. On a narrow
// screen, where the sidebar slides over the page, picking a page closes it.

import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { subscribe, getStudyBadge } from "@/bridge"
import { ui } from "@/data/ui"
import { setView } from "@/data/study-controller"
import { setSide, sideOpen } from "@/data/sidebar"

type View = "week" | "month" | "table" | "spotify" | "study"

export const PAGES: { id: View; label: string; shortcut: string }[] = [
    { id: "week", label: "Week", shortcut: "1" },
    { id: "month", label: "Month", shortcut: "2" },
    { id: "table", label: "All items", shortcut: "3" },
    { id: "study", label: "Study", shortcut: "4" },
    { id: "spotify", label: "Music", shortcut: "5" },
]

const currentView = () => ui.view as View

export function SideNav() {
    const view = useSyncExternalStore(subscribe, currentView)
    const badge = useSyncExternalStore(subscribe, getStudyBadge)
    return (
        <nav aria-label="Pages" className="flex flex-col gap-0.5">
            {PAGES.map((p) => {
                const on = p.id === view
                return (
                    <button
                        key={p.id}
                        type="button"
                        aria-current={on ? "page" : undefined}
                        title={p.label + " (" + p.shortcut + ")"}
                        aria-keyshortcuts={p.shortcut}
                        onClick={() => { setView(p.id); if (sideOpen()) setSide(false) }}
                        className={cn(
                            "flex h-8 cursor-pointer items-center justify-between rounded-[6px] border-0 px-2.5 text-left text-[14px]",
                            on ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--line)]" : "bg-transparent text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-foreground",
                        )}
                    >
                        {p.label}
                        {p.id === "study" && badge && <span className="font-mono text-[11.5px] text-accent-foreground">{badge}</span>}
                    </button>
                )
            })}
        </nav>
    )
}
