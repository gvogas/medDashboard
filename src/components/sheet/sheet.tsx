// The sheet: a floating Texture panel on the right for an item or a course, over the
// blurred scrim (index.html's, shared with the legacy drawer). What it shows comes from
// src/data/overlay.ts, which also makes the page behind inert while it is open. Escape
// and the scrim close it, or ask first when the course has unsaved changes.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/legacy/js/model.js"
import { refind } from "@/legacy/js/dom.js"
import { requestCloseSheet, useSheet, type SheetState } from "@/data/overlay"
import { ItemSheet } from "./item-sheet"
import { CourseSheet } from "./course-sheet"
import { SettingsSheet } from "./settings-sheet"
import { ImportSheet } from "./import-sheet"
import { SchoolSheet } from "./school-sheet"
import * as store from "@/legacy/js/store.js"
import type { Item } from "@/data/types"

/** What the dialog is called: the item's type, "New assignment", "Course". */
export function sheetLabel(s: Exclude<SheetState, null>): string {
    if (s.kind === "course") return s.id ? "Course" : "New course"
    if (s.kind === "new-item") return "New " + tmeta(s.draft.type).label.toLowerCase()
    if (s.kind === "settings") return "Settings"
    if (s.kind === "import") return "Import"
    if (s.kind === "school") return "School calendar"
    if (s.kind === "session") return s.draft.isNew ? "Log study" : "Edit session"
    if (s.kind === "achievement") return s.draft.isNew ? "New achievement" : "Edit achievement"
    const it = store.item(s.id) as Item | null
    return it ? tmeta(it.type).label : "Item"
}

export function Sheet() {
    const state = useSheet()
    const open = state !== null
    /* what it last showed stays drawn while it slides out */
    const [shown, setShown] = useState<SheetState>(state)
    const panel = useRef<HTMLDivElement>(null)
    const opener = useRef<Element | null>(null)
    if (state !== null && state !== shown) setShown(state)

    useLayoutEffect(() => {
        if (open) {
            if (!panel.current?.contains(document.activeElement)) opener.current = document.activeElement
            /* a new one focuses its title (autoFocus); anything else, the sheet */
            requestAnimationFrame(() => { if (!panel.current?.contains(document.activeElement)) panel.current?.focus() })
        } else if (opener.current) {
            /* back to what opened it, or its successor if a redraw replaced it */
            ;(refind(opener.current) as HTMLElement | null)?.focus()
            opener.current = null
        }
    }, [open, state?.kind, state?.kind === "item" ? state.id : state?.kind === "course" ? state.id : null])

    /* the scrim is index.html's; a click on it closes the sheet */
    useEffect(() => {
        const scrim = document.getElementById("scrim")
        if (!scrim || !open) return
        const close = (e: Event) => { e.stopImmediatePropagation(); requestCloseSheet() }
        scrim.addEventListener("click", close, true)
        return () => scrim.removeEventListener("click", close, true)
    }, [open])

    return (
        <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={shown ? sheetLabel(shown) : "Details"}
            tabIndex={-1}
            onKeyDown={(e) => {
                if (e.key !== "Escape" || e.defaultPrevented) return
                e.preventDefault()
                requestCloseSheet()
            }}
            onTransitionEnd={(e) => { if (e.target === e.currentTarget && !open) setShown(null) }}
            className={cn(
                "fixed top-2.5 right-2.5 bottom-2.5 z-50 flex w-[420px] max-w-[calc(100%-20px)] flex-col overflow-hidden rounded-[20px] border border-border outline-none",
                "bg-[linear-gradient(var(--panel),color-mix(in_srgb,var(--panel-2)_60%,var(--panel)))] shadow-[var(--lift),0_0_0_1px_var(--rim-hi),inset_0_1px_0_var(--rim-hi)]",
                "transition-transform duration-[320ms] ease-[cubic-bezier(.2,.9,.3,1)] motion-reduce:transition-none",
                "max-[700px]:top-0 max-[700px]:right-0 max-[700px]:bottom-0 max-[700px]:w-[min(420px,calc(100%-12px))] max-[700px]:max-w-none max-[700px]:rounded-l-[20px] max-[700px]:rounded-r-none max-[700px]:border-r-0",
                open ? "translate-x-0" : "translate-x-[calc(100%+80px)]",
            )}
        >
            {shown?.kind === "item" && <ItemSheet key={shown.id} id={shown.id} />}
            {shown?.kind === "new-item" && <ItemSheet key={shown.draft.id} draft={shown.draft} />}
            {shown?.kind === "course" && <CourseSheet key={shown.id ?? "new"} id={shown.id} />}
            {shown?.kind === "settings" && <SettingsSheet tab={shown.tab} focus={shown.focus} />}
            {shown?.kind === "import" && <ImportSheet key={shown.name} plan={shown.plan} name={shown.name} />}
            {shown?.kind === "school" && <SchoolSheet draft={shown.draft} />}
        </div>
    )
}
