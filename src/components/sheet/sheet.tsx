// The sheet: a floating Texture panel on the right for an item, a course, Settings, an
// import, a class schedule, the Import with AI card, the school calendar, a study session,
// an achievement, a shared class, or the inbox, over the blurred scrim
// (<App>'s, shared with the phone sidebar). What it shows comes from
// src/data/overlay.ts, which also makes the page behind inert while it is open. Escape
// and the scrim close it, or ask first when the course has unsaved changes.

import { Suspense, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { tmeta } from "@/core/model"
import { refind } from "@/lib/dom"
import { requestCloseSheet, takeOpener, useSheet, type SheetState } from "@/data/overlay"
import { lazyNamed } from "@/lib/lazy"
import * as store from "@/core/store"
import { itemByKey } from "@/data/effective"
import { isSharedKey } from "@/data/refs"
import type { Item } from "@/data/types"

/* Each sheet loads on first use (lib/lazy.ts), and all of them once the browser is idle. */
const ItemSheet = lazyNamed(() => import("./item-sheet"), "ItemSheet")
const CourseSheet = lazyNamed(() => import("./course-sheet"), "CourseSheet")
const SettingsSheet = lazyNamed(() => import("./settings-sheet"), "SettingsSheet")
const ImportSheet = lazyNamed(() => import("./import-sheet"), "ImportSheet")
const ScheduleSheet = lazyNamed(() => import("./schedule-sheet"), "ScheduleSheet")
const AiSheet = lazyNamed(() => import("./ai-sheet"), "AiSheet")
const SchoolSheet = lazyNamed(() => import("./school-sheet"), "SchoolSheet")
const SessionSheet = lazyNamed(() => import("./session-sheet"), "SessionSheet")
const AchievementSheet = lazyNamed(() => import("./achievement-sheet"), "AchievementSheet")
/* the class sheets: not everyone has a class, so they download when first opened (lib/lazy.ts) */
const ClassSheet = lazyNamed(() => import("./class-sheet"), "ClassSheet", { idle: false })
const NewClassSheet = lazyNamed(() => import("./new-class-sheet"), "NewClassSheet", { idle: false })
const ConvertSheet = lazyNamed(() => import("./convert-sheet"), "ConvertSheet", { idle: false })
const JoinSheet = lazyNamed(() => import("./join-sheet"), "JoinSheet", { idle: false })
const InboxSheet = lazyNamed(() => import("./inbox-sheet"), "InboxSheet", { idle: false })
const MergeSheet = lazyNamed(() => import("./merge-sheet"), "MergeSheet", { idle: false })
/* a class's item, opened by its key: downloaded when first opened, as the class sheets are */
const ClassItemSheet = lazyNamed(() => import("./class-item-sheet"), "ClassItemSheet", { idle: false })

/** What the dialog is called: the item's type, "New assignment", "Course". */
export function sheetLabel(s: Exclude<SheetState, null>): string {
    if (s.kind === "course") return s.id ? (isSharedKey(s.id) ? "Class details" : "Course") : "New course"
    if (s.kind === "new-item") return "New " + tmeta(s.draft.type).label.toLowerCase()
    if (s.kind === "settings") return "Settings"
    if (s.kind === "import") return "Import"
    if (s.kind === "schedule") return "Class schedule"
    if (s.kind === "ai") return "Import with AI"
    if (s.kind === "school") return "School calendar"
    if (s.kind === "session") return s.draft.isNew ? "Log study" : "Edit session"
    if (s.kind === "achievement") return s.draft.isNew ? "New achievement" : "Edit achievement"
    if (s.kind === "class") return "Class"
    if (s.kind === "new-class") return "New shared class"
    if (s.kind === "convert") return "Convert to shared class"
    if (s.kind === "join") return "Join a class"
    if (s.kind === "inbox") return "Inbox"
    if (s.kind === "merge") return "Merge into the class"
    const it = (itemByKey(s.id) ?? store.item(s.id)) as Item | null
    return it ? tmeta(it.type).label : "Item"
}

export function Sheet() {
    const state = useSheet()
    const open = state !== null
    /* what it last showed stays drawn while it slides out */
    const [shown, setShown] = useState<SheetState>(state)
    const panel = useRef<HTMLDivElement>(null)
    if (state !== null && state !== shown) setShown(state)

    useLayoutEffect(() => {
        if (open) {
            /* a new one focuses its title (autoFocus); anything else, the sheet */
            requestAnimationFrame(() => { if (!panel.current?.contains(document.activeElement)) panel.current?.focus() })
        } else {
            /* back to what opened it, or its successor if a redraw replaced it */
            ;(refind(takeOpener()) as HTMLElement | null)?.focus()
        }
    }, [open, state?.kind, state?.kind === "item" || state?.kind === "course" ? state.id : state?.kind === "session" || state?.kind === "achievement" ? state.draft.id : null])

    /* the item card is wider, with a smaller radius (spec §7); the other sheets keep theirs */
    const card = shown?.kind === "item" || shown?.kind === "new-item"

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
                "fixed top-2.5 right-2.5 bottom-2.5 z-50 flex max-w-[calc(100%-20px)] flex-col overflow-hidden border border-border outline-none",
                card ? "w-[460px] rounded-2xl" : "w-[420px] rounded-[20px]",
                "bg-[linear-gradient(var(--panel),color-mix(in_srgb,var(--panel-2)_60%,var(--panel)))] shadow-[var(--lift),0_0_0_1px_var(--rim-hi),inset_0_1px_0_var(--rim-hi)]",
                "transition-transform duration-[320ms] ease-[cubic-bezier(.2,.9,.3,1)] motion-reduce:transition-none",
                "max-[700px]:top-0 max-[700px]:right-0 max-[700px]:bottom-0 max-[700px]:w-[min(460px,calc(100%-12px))] max-[700px]:max-w-none max-[700px]:rounded-l-[20px] max-[700px]:rounded-r-none max-[700px]:border-r-0",
                open ? "translate-x-0" : "translate-x-[calc(100%+80px)]",
            )}
        >
            <Suspense fallback={null}>
                {shown?.kind === "item" && (isSharedKey(shown.id)
                    ? <ClassItemSheet key={shown.id} itemKey={shown.id} />
                    : <ItemSheet key={shown.id} id={shown.id} />)}
                {shown?.kind === "new-item" && <ItemSheet key={shown.draft.id} draft={shown.draft} />}
                {shown?.kind === "course" && <CourseSheet key={shown.id ?? "new"} id={shown.id} />}
                {shown?.kind === "settings" && <SettingsSheet tab={shown.tab} focus={shown.focus} />}
                {shown?.kind === "import" && <ImportSheet key={shown.name} plan={shown.plan} name={shown.name} target={shown.target} />}
                {shown?.kind === "ai" && <AiSheet />}
                {shown?.kind === "schedule" && <ScheduleSheet key={shown.name} plan={shown.plan} name={shown.name} />}
                {shown?.kind === "school" && <SchoolSheet draft={shown.draft} />}
                {shown?.kind === "session" && <SessionSheet key={shown.draft.id} draft={shown.draft} />}
                {shown?.kind === "achievement" && <AchievementSheet key={shown.draft.id} draft={shown.draft} />}
                {shown?.kind === "class" && <ClassSheet key={shown.spaceId} spaceId={shown.spaceId} tab={shown.tab} />}
                {shown?.kind === "new-class" && <NewClassSheet />}
                {shown?.kind === "convert" && <ConvertSheet key={shown.courseId} courseId={shown.courseId} />}
                {shown?.kind === "join" && <JoinSheet key={shown.space?.id ?? "code:" + shown.code} code={shown.code} space={shown.space} />}
                {shown?.kind === "inbox" && <InboxSheet />}
                {shown?.kind === "merge" && <MergeSheet key={shown.spaceId + shown.courseId} spaceId={shown.spaceId} courseId={shown.courseId} fromCourse={shown.fromCourse} />}
            </Suspense>
        </div>
    )
}
