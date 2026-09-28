// What is on top of the page, and so what takes focus: the React sheet (item and course,
// components/sheet/), the legacy #drawer (Settings and the drawers not moved yet), and
// the overlays above both (the shortcuts panel, the busy card). While a sheet or drawer
// is open the page behind is inert, so Tab stays inside; one that is closed is inert
// itself. The legacy drawer (views/drawer-base.js) reports through here, so there is one
// answer while the two coexist. This module imports nothing from the legacy code.

import { useSyncExternalStore } from "react"
import type { Item } from "./types"

export type SheetState =
    | { kind: "item"; id: string }
    | { kind: "new-item"; draft: Item }
    | { kind: "course"; id: string | null }
    | null

let sheet: SheetState = null
let covers = 0
let legacyOpen = false
const listeners = new Set<() => void>()

const el = (id: string) => document.getElementById(id)

/** Which of the page, the drawer and the sheet take focus, from what is open. */
export function settle() {
    const app = el("app"), drawer = el("drawer"), host = el("sheet")
    if (drawer) drawer.inert = covers > 0 || !legacyOpen
    if (host) host.inert = covers > 0 || sheet === null
    if (app) app.inert = covers > 0 || legacyOpen || sheet !== null
    const scrim = el("scrim")
    if (scrim && sheet !== null) scrim.classList.add("on")
}

function emit() {
    settle()
    for (const fn of listeners) fn()
}

/** An overlay opens (`true`) or closes over the page, the drawer and the sheet. */
export function cover(on: boolean) {
    covers = Math.max(0, covers + (on ? 1 : -1))
    settle()
}

/* ── the legacy drawer ── */

let closeLegacy: () => void = () => {}
/** drawer-base.js: how to close the legacy drawer when the sheet opens. */
export function onLegacyClose(fn: () => void) { closeLegacy = fn }

/** drawer-base.js: the legacy drawer opened or closed. Opening it closes the sheet first. */
export function legacyDrawer(open: boolean) {
    if (open && sheet !== null) closeSheet()
    legacyOpen = open
    settle()
}

/* ── the React sheet ── */

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

/** Open the sheet on an item, a new item or a course, closing the legacy drawer. */
export function openSheet(next: Exclude<SheetState, null>) {
    if (legacyOpen) closeLegacy()
    for (const fn of beforeSheetClose) fn()
    sheet = next
    askClose = null
    emit()
}

/** A new item's draft, edited: it lives only here until it is saved. */
export function updateDraft(draft: Item) {
    if (sheet?.kind !== "new-item") return
    sheet = { kind: "new-item", draft }
    emit()
}

/** Close the sheet now, saving what is pending. */
export function closeSheet() {
    if (sheet === null) return
    for (const fn of beforeSheetClose) fn()
    sheet = null
    askClose = null
    const scrim = el("scrim")
    if (scrim && !legacyOpen && !el("side")?.classList.contains("on")) scrim.classList.remove("on")
    emit()
}

/** ✕, Escape or the scrim: the sheet closes, or asks first if it has to. */
export function requestCloseSheet() {
    if (askClose) askClose()
    else closeSheet()
}
