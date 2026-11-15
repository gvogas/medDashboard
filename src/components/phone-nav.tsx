// The phone's bottom bar: Week, Month, All items and Study one tap away, and More, which
// opens the sidebar (the other pages, the courses, Settings). Under 700px the sidebar is
// a drawer behind the menu button, so without this every change of page took two taps and
// the pages were out of sight. It is drawn only on a phone-width screen (a media query in
// script, so nothing here is in the page above 700px), inside .content: the sheet and the
// open sidebar make it inert with the page, and the focus screen hides it. The round New
// item button, the study dock and the toasts sit above it (--phone-nav, styles/shell.css).

import { useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { subscribe } from "@/bridge"
import { ui } from "@/data/ui"
import { setView } from "@/data/study-controller"
import { setSide } from "@/data/sidebar"
import type { View } from "@/data/types"
import { MORE_ICON, NAV_ICON } from "@/components/nav-icons"

const QUERY = "(max-width:700px)"
const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(QUERY) : null)
const watch = (redraw: () => void) => {
    const m = media()
    m?.addEventListener("change", redraw)
    return () => m?.removeEventListener("change", redraw)
}
/** Whether the screen is phone-width now; false where there is no matchMedia (the tests). */
export const usePhone = () => useSyncExternalStore(watch, () => !!media()?.matches, () => false)

const TABS: { id: View; label: string }[] = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "table", label: "Items" },
    { id: "study", label: "Study" },
]

const currentView = () => ui.view as View

const TAB = "relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent px-1 font-[inherit] text-[10.5px] font-medium outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"

export function PhoneNav() {
    const phone = usePhone()
    const view = useSyncExternalStore(subscribe, currentView)
    if (!phone) return null
    const at = TABS.findIndex((t) => t.id === view)
    return (
        <nav
            aria-label="Pages, quick"
            id="phoneNav"
            className="fixed inset-x-0 bottom-0 z-[3] flex h-[calc(56px+env(safe-area-inset-bottom,0px))] border-t border-border bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md"
        >
            {/* the mark over the current page slides to it: a fifth of the bar per step */}
            <span
                aria-hidden="true"
                style={{ transform: "translateX(" + Math.max(0, at) * 100 + "%)" }}
                className={cn(
                    "pointer-events-none absolute top-0 left-0 flex h-[3px] w-1/5 justify-center transition-[transform,opacity] duration-[260ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none",
                    at < 0 && "opacity-0",
                )}
            >
                <i className="block h-full w-8 rounded-b-full bg-primary" />
            </span>
            {TABS.map((t) => {
                const on = t.id === view
                return (
                    <button key={t.id} type="button" aria-current={on ? "page" : undefined} onClick={() => setView(t.id)}
                        className={cn(TAB, on ? "text-primary" : "text-muted-foreground")}>
                        {NAV_ICON[t.id]}
                        {t.label}
                    </button>
                )
            })}
            <button type="button" aria-controls="side" aria-haspopup="true" onClick={() => setSide(true)}
                className={cn(TAB, at < 0 ? "text-primary" : "text-muted-foreground")}>
                {MORE_ICON}
                More
            </button>
        </nav>
    )
}
