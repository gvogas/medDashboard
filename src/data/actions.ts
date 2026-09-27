// What React components (and the legacy keyboard) do to the app. Each one changes the
// legacy state and redraws through the legacy code, so saving, the offline queue, sync
// and the drawers behave as before.

import * as store from "@/legacy/js/store.js"
import { data } from "@/legacy/js/store.js"
import * as sync from "@/legacy/js/sync.js"
import { typeList, typePrefsFrom, uid, TYPE_COLOURS, MAX_CUSTOM_TYPES } from "@/legacy/js/model.js"
import { typeOn } from "@/legacy/js/query.js"
import { addDays, iso, parse, today } from "@/legacy/js/dates.js"
import { render, renderView } from "@/legacy/js/views/render.js"
import { closeDrawer, setSide } from "@/legacy/js/views/drawer-base.js"
import { newItem as openNewItem } from "@/legacy/js/views/drawer-item.js"
import { openCourse as openCourseDrawer } from "@/legacy/js/views/drawer-course.js"
import { openSettings as openSettingsDrawer } from "@/legacy/js/views/drawer-settings.js"
import { ui } from "./ui"
import type { Item, ItemType } from "./types"

export { setView } from "@/legacy/js/study-controller.js"

/* ── the date and the view ── */

export function goToday() {
    ui.anchor = today()
    render()
}

/** A week back or on, or a month in the month view. */
export function step(dir: -1 | 1) {
    const a = parse(ui.anchor)
    ui.anchor = ui.view === "month" ? iso(new Date(a.getFullYear(), a.getMonth() + dir, 1)) : iso(addDays(a, 7 * dir))
    render()
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
/** Filter the views; they redraw once typing pauses, not on every key. */
export function setSearch(text: string) {
    ui.search = text
    clearTimeout(searchTimer)
    searchTimer = setTimeout(renderView, 120)
}

/* ── the sidebar's filters ── */

export const itemTypes = (): ItemType[] => typeList(ui.bg, data.items as Item[])

/**
 * Click a type. With every type showing, show only this one; if it is the only one
 * showing, show them all again; otherwise turn it on or off.
 */
export function toggleType(id: string) {
    const all = itemTypes().map((t) => t.id)
    const on = all.filter(typeOn).length
    if (typeOn(id) && on === all.length) all.forEach((t) => { ui.types[t] = t === id })
    else if (typeOn(id) && on === 1) all.forEach((t) => { ui.types[t] = true })
    else ui.types[id] = !typeOn(id)
    render()
}

export const isTypeOn = (id: string): boolean => typeOn(id)

export function setCourse(id: string) {
    ui.course = id
    render()
}

/* ── the type list's editor: every change saves the whole list to the profile ── */

async function saveTypes(list: ItemType[]) {
    await store.saveProfile({ types: typePrefsFrom(list) })
    render()
}

async function editType(id: string, change: (t: ItemType, list: ItemType[], i: number) => boolean | void) {
    const list = itemTypes(), i = list.findIndex((t) => t.id === id)
    if (i < 0 || change(list[i], list, i) === false) return
    await saveTypes(list)
}

export const TYPE_LABEL_MAX = 24
export const canAddType = () => itemTypes().filter((t) => t.custom).length < MAX_CUSTOM_TYPES
/** A colour no type uses yet, for the add form to start with. */
export const freeTypeColour = () => {
    const used = itemTypes().map((t) => t.color)
    return TYPE_COLOURS.find((c: string) => !used.includes(c)) || TYPE_COLOURS[0]
}
export const TYPE_PALETTE: readonly string[] = TYPE_COLOURS

export async function addType(label: string, color: string, kind: string) {
    const name = label.trim().slice(0, TYPE_LABEL_MAX)
    if (!name || !canAddType()) return
    const list = itemTypes()
    list.push({ id: "c-" + uid(), label: name, plural: name, color, kind, custom: true, hidden: false, hiddenSet: true })
    await saveTypes(list)
}

/** An empty name puts a built-in back to its own; a custom type cannot be left unnamed. */
export const renameType = (id: string, label: string) => editType(id, (t) => {
    const name = label.trim().slice(0, TYPE_LABEL_MAX)
    if (!name && t.custom) return false
    t.label = name
})

export const recolourType = (id: string) => editType(id, (t) => {
    t.color = TYPE_COLOURS[(TYPE_COLOURS.indexOf(t.color) + 1) % TYPE_COLOURS.length]
})

export const toggleTypeHidden = (id: string) => editType(id, (t) => {
    t.hidden = !t.hidden
    t.hiddenSet = true
})

/** Only a type of your own that no item uses. */
export const canDeleteType = (t: ItemType) => t.custom && !(data.items as Item[]).some((it) => it.type === t.id)
export const deleteType = (id: string) => editType(id, (t, list, i) => {
    if (!canDeleteType(t)) return false
    list.splice(i, 1)
})

/** Save a new order, given every id top to bottom. */
export async function reorderTypes(ids: string[]) {
    const list = itemTypes()
    list.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    await saveTypes(list)
}

/* ── drawers, the sidebar on phones, sync ── */

export const newItem = () => openNewItem(ui.anchor)
export const openCourse = (id: string | null) => openCourseDrawer(id)
/** Settings, opened at a field (as the coat's pencil does), or shut if it is open. */
export const openSettings = (focusId?: string) => openSettingsDrawer(focusId)
export const toggleSettings = () => (ui.settings ? closeDrawer() : openSettingsDrawer())
export const showSidebar = (open: boolean) => setSide(open)
export const syncNow = () => sync.syncNow()
