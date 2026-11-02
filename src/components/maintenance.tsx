// Maintenance mode's two faces (data/maintenance.ts). The maintenance page, in place of a
// page or of Import with AI that the admins have switched off: the serif heading, their
// message (or ours), and a way to a page that still works. And for an admin, who keeps
// using it, a slim bar over it saying only admins see it.

import { useId } from "react"
import { cn } from "@/lib/utils"
import { setView } from "@/data/actions"
import { customMessage, inMaintenance, useMaintenanceMessage, type Feature } from "@/data/maintenance"
import type { View } from "@/data/types"
import { Button } from "@/components/sheet/fields"

/* What each switch is called in a sentence; the whole app is Term. */
const NAMES: Record<Feature, string> = {
    app: "Term", week: "Week", month: "Month", table: "All items", study: "Study", spotify: "Music",
    import: "Import with AI", classes: "Shared classes & projects", friends: "Friends", buddy: "Buddy", studyai: "AI for study",
}
/* The pages, in the sidebar's order (side-nav.tsx). */
const PAGES = ["week", "month", "table", "study", "spotify"] as const

/** The heading: "Week is being worked on"; the whole app is "Term is being worked on". */
export const maintenanceTitle = (feature: Feature) =>
    NAMES[inMaintenance("app") ? "app" : feature] + (feature === "classes" && !inMaintenance("app") ? " are" : " is") + " being worked on"

/** In place of a page (in #views) or a sheet's content, for everyone but admins. */
export function MaintenancePage({ feature, inSheet = false }: { feature: Feature; inSheet?: boolean }) {
    const id = useId()
    const message = useMaintenanceMessage()
    /* the first page that still works, other than this one */
    const elsewhere = PAGES.find((p) => p !== feature && !inMaintenance(p))
    return (
        <section aria-labelledby={id} className={cn("mx-auto grid max-w-[480px] justify-items-center gap-3 text-center", inSheet ? "px-2 py-8" : "px-5 py-16 max-[700px]:py-10")}>
            <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
                <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5a2.1 2.1 0 0 0 3 3l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.6-.4-.4-2.6z" />
                </svg>
            </span>
            <h2 id={id} className={cn("m-0 font-serif font-medium leading-[1.15] tracking-[-.015em] text-foreground", inSheet ? "text-[24px]" : "text-[30px] max-[700px]:text-[24px]")}>
                {maintenanceTitle(feature)}
            </h2>
            <p className="m-0 whitespace-pre-wrap text-[14px] leading-normal text-ink-2">{message}</p>
            {customMessage() && <p className="m-0 text-[12.5px] text-muted-foreground">Your data is safe and keeps syncing.</p>}
            {!inSheet && elsewhere && (
                <Button variant="ghost" className="mt-2" onClick={() => setView(elsewhere as View)}>Go to {NAMES[elsewhere]}</Button>
            )}
        </section>
    )
}

/** Over a page or a sheet that is in maintenance, for an admin using it anyway. */
export function MaintenanceBar({ className }: { className?: string }) {
    return (
        <div role="status" className={cn("mb-3 flex items-center gap-2 rounded-[var(--radius)] border border-[var(--warn-line)] bg-[var(--warn-bg)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--warn-ink)]", className)}>
            <i aria-hidden="true" className="size-1.5 flex-none rounded-full bg-[var(--warn-ink)]" />
            In maintenance — only admins see this
        </div>
    )
}
