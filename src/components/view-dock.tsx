// The view switcher in the top bar: Week, Month, Table, Spotify, Study.
// The view is the UI state's (ui.view); this reads it through the bridge and changes it
// with setView, the same call the 1–5 keys make.

import { useSyncExternalStore, type ReactNode } from "react"
import { MagneticDock, type DockItemData } from "@/components/ui/magnetic-dock"
import { subscribe, getStudyBadge } from "@/bridge"
import { ui } from "@/data/ui"
import { setView } from "@/data/study-controller"

type View = "week" | "month" | "table" | "spotify" | "study"

const svg = (children: ReactNode) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
        {children}
    </svg>
)

export const VIEWS: { id: View; label: string; shortcut: string; icon: ReactNode }[] = [
    { id: "week", label: "Week", shortcut: "1", icon: svg(<><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 10v10M15 10v10" /></>) },
    { id: "month", label: "Month", shortcut: "2", icon: svg(<><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17h.01M12 17h.01" strokeWidth="2.6" /></>) },
    { id: "table", label: "Table", shortcut: "3", icon: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></>) },
    { id: "spotify", label: "Spotify", shortcut: "4", icon: svg(<><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>) },
    { id: "study", label: "Study", shortcut: "5", icon: svg(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></>) },
]

const currentView = () => ui.view as View

export function ViewDock() {
    const view = useSyncExternalStore(subscribe, currentView)
    const badge = useSyncExternalStore(subscribe, getStudyBadge)

    const items: DockItemData[] = VIEWS.map((v) => ({
        id: v.id,
        label: v.label,
        shortcut: v.shortcut,
        icon: v.icon,
        isActive: v.id === view,
        badge: v.id === "study" ? badge : null,
        onClick: () => setView(v.id),
    }))

    return (
        <MagneticDock
            items={items}
            aria-label="Views"
            position="top"
            variant="tray"
            iconSize={28}
            maxScale={1.25}
            magneticDistance={70}
        />
    )
}
