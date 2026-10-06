// What is on top of the page, and so what takes focus: the sheet (components/sheet/) and
// the overlays above it (the shortcuts panel, the reading card; components/overlays.tsx).
// While the sheet is open the page behind is inert, so Tab stays inside; closed, the sheet
// is inert itself. An overlay makes both inert. The scrim belongs to the sheet while it is
// open, and to the phone sidebar (sidebar.ts) otherwise. <App> draws all of that from
// useSheet() and useCovered().

import { useSyncExternalStore } from "react"
import type { Item, SpaceSummary } from "./types"
import type { SettingsTab } from "./settings"
import type { ImportPlan } from "./import-edit"
import type { SchoolDraft } from "./school-edit"
import type { SessionDraft } from "./session-edit"
import type { AchievementDraft } from "./achievement-edit"

/** The class sheet's tabs. */
export type ClassTab = "details" | "members"

export type SheetState =
    | { kind: "item"; id: string }
    | { kind: "new-item"; draft: Item }
    | { kind: "course"; id: string | null }
    | { kind: "settings"; tab: SettingsTab; focus: string | null }
    | { kind: "import"; plan: ImportPlan; name: string }
    | { kind: "schedule"; plan: ImportPlan; name: string }
    | { kind: "ai" }
    | { kind: "school"; draft: SchoolDraft }
    | { kind: "session"; draft: SessionDraft }
    | { kind: "achievement"; draft: AchievementDraft }
    | { kind: "class"; spaceId: string; tab: ClassTab }
    | { kind: "new-class" }
    | { kind: "convert"; courseId: string }
    | { kind: "join"; code: string; space: SpaceSummary | null }
    | { kind: "invites" }
    | null

let sheet: SheetState = null
/* what had focus when the sheet opened, for focus to go back to */
let opener: Element | null = null
let covers = 0
const listeners = new Set<() => void>()

function emit() {
    for (const fn of listeners) fn()
}

/** An overlay opens (`true`) or closes over the page and the sheet. */
export function cover(on: boolean) {
    covers = Math.max(0, covers + (on ? 1 : -1))
    emit()
}

/** An overlay is up: <App> makes the page and the sheet inert. */
export const useCovered = () => useSyncExternalStore(subscribe, () => covers > 0)

/* ── the sheet ── */

export const getSheet = () => sheet
export const useSheet = () => useSyncExternalStore(subscribe, getSheet)
export function subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
}

/** Run before the sheet closes or changes, e.g. to save what is still being typed. */
export const beforeSheetClose = new Set<() => void>()
/** The open sheet may ask first (a course with unsaved changes); it registers how. */
let askClose: (() => void) | null = null
export function onRequestClose(fn: (() => void) | null) { askClose = fn }

/** Open the sheet, saving what the one open before had pending. */
export function openSheet(next: Exclude<SheetState, null>) {
    for (const fn of beforeSheetClose) fn()
    if (sheet === null) opener = document.activeElement
    sheet = next
    askClose = null
    emit()
}

/** What had focus when the sheet opened, once: the sheet gives focus back to it on close. */
export function takeOpener(): Element | null {
    const o = opener
    opener = null
    return o
}

/** A new item's draft, edited: it lives only here until it is saved. */
export function updateDraft(draft: Item) {
    if (sheet?.kind !== "new-item") return
    replaceSheet({ kind: "new-item", draft })
}

/** The same sheet with new state (a tab, a draft), without the saving and closing that opening does. */
export function replaceSheet(next: Exclude<SheetState, null>) {
    if (sheet?.kind !== next.kind) return
    sheet = next
    emit()
}

/** Close the sheet now, saving what is pending. */
export function closeSheet() {
    if (sheet === null) return
    for (const fn of beforeSheetClose) fn()
    sheet = null
    askClose = null
    emit()
}

/** ✕, Escape or the scrim: the sheet closes, or asks first if it has to. */
export function requestCloseSheet() {
    if (askClose) askClose()
    else closeSheet()
}
