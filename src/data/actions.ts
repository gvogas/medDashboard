// What React components (and the legacy keyboard) do to the app. Each one changes the
// legacy state and redraws through the legacy code, so saving, the offline queue, sync
// and the drawers behave as before.

import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { isOpen, normalizeItem, typeList, typePrefsFrom, uid, TYPE_COLOURS, MAX_CUSTOM_TYPES, ACHIEVEMENT_LIMIT } from "@/core/model"
import { typeOn } from "@/legacy/js/query.js"
import { addDays, iso, parse, today } from "@/core/dates"
import { render, renderView } from "@/legacy/js/views/render.js"
import { setSide } from "./sidebar"
import { openKeys } from "./keys"
import { api } from "@/core/api"
import { toast } from "./toast"
import { applyCoat, TAB_OF, type SettingsTab } from "./settings"
import { rememberUi } from "@/legacy/js/state.js"
import { launch as fireworks } from "@/legacy/js/fireworks.js"
import { notify } from "@/bridge"
import { deleteLater, deleteWithUndo, setView } from "@/legacy/js/study-controller.js"
import { celebrate, chainReview, setStatus, touch } from "./item-edit"
import { closeSheet, getSheet, openSheet, replaceSheet } from "./overlay"
import { newSession, sessionDraft } from "./session-edit"
import { achievementDraft, newAchievement } from "./achievement-edit"
import { ui } from "./ui"
import type { Achievement, Course, Item, ItemType, Schedule, SortKey, StudySession } from "./types"

export { setView }

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

/** A new item in the sheet, on a day (the week shown, by default), in the course shown. */
export function newItemOn(date: string, type = "assignment") {
    openSheet({ kind: "new-item", draft: normalizeItem({ id: uid(), type, title: "", courseId: ui.course === "all" ? null : ui.course, date, status: "todo" }) as Item })
}
export const newItem = () => newItemOn(ui.anchor)
export const openItem = (id: string) => openSheet({ kind: "item", id })

/** Delete now; the toast's Undo brings it back for a few seconds. */
export async function deleteItem(id: string) {
    const it = store.item(id) as Item | null
    if (!it) return
    closeSheet()
    await deleteLater("items", id, "“" + (it.title.trim() || "Item") + "”", () => store.deleteItem(id))
}
/** A course in the sheet; null for a new one. */
export const openCourse = (id: string | null) => openSheet({ kind: "course", id })

/** Delete now, with Undo; its items lose their course. The course filter goes back to All if it was this one. */
export async function deleteCourse(id: string) {
    const c = store.course(id) as Course | null
    if (!c) return
    if (ui.course === id) ui.course = "all"
    closeSheet()
    await deleteLater("courses", id, c.code || c.name || "Course", () => store.deleteCourse(id))
}

/* ── study sessions and achievements ── */

/** A session to edit by id, or a new one (on `courseId` when given) to log by hand. */
export function openSession(id: string | null, courseId?: string | null) {
    const s = id ? (data.study_sessions as StudySession[]).find((x) => x.id === id) : null
    if (id && !s) return
    openSheet({ kind: "session", draft: s ? sessionDraft(s) : newSession(courseId) })
}

/** Delete now; the Study view's Undo brings it back for a few seconds. */
export function deleteSession(id: string) {
    closeSheet()
    deleteWithUndo(id)
}

/** An achievement to edit by id, or a new one while there is room for it. */
export function openAchievement(id: string | null) {
    const list = data.achievements as Achievement[]
    const a = id ? list.find((x) => x.id === id) : null
    if (id && !a) return
    if (!a && list.length >= ACHIEVEMENT_LIMIT) { toast("You have " + ACHIEVEMENT_LIMIT + " achievements, the most there can be."); return }
    openSheet({ kind: "achievement", draft: a ? achievementDraft(a) : newAchievement(data.courses as Course[]) })
}

/** Delete now, with the toast's Undo. */
export async function deleteAchievement(id: string) {
    const a = (data.achievements as Achievement[]).find((x) => x.id === id)
    if (!a) return
    closeSheet()
    await deleteLater("achievements", id, "“" + (a.name.trim() || "Achievement") + "”", () => store.deleteAchievement(id))
}

/* ── Settings ── */

/** Settings, opened at a field or group (as the coat's pencil does), on the tab it lives on. */
export function openSettings(focus?: string) {
    const tab = (focus && TAB_OF[focus]) || ui.settingsTab || "you"
    ui.settingsTab = tab
    openSheet({ kind: "settings", tab, focus: focus ?? null })
}
/** The gear: Settings, or shut if it is open. */
export const toggleSettings = () => (getSheet()?.kind === "settings" ? closeSheet() : openSettings())

export function setSettingsTab(tab: SettingsTab) {
    ui.settingsTab = tab
    replaceSheet({ kind: "settings", tab, focus: null })
}

/** A quote added, and shown on the tile at once. */
export async function addQuote(text: string, source: string) {
    const t = text.trim().replace(/^[“"']|[”"']$/g, "")
    if (!t) return false
    await store.saveQuote({ id: uid(), text: t, source: source.trim() })
    ui.quoteIx = data.quotes.length - 1
    notify()
    return true
}
export async function removeQuote(id: string) {
    await store.deleteQuote(id)
    if (ui.quoteIx >= data.quotes.length) ui.quoteIx = 0
    notify()
}

/** The coat's name, line or colour; the colour tints the sidebar at once. */
export async function saveCoat(patch: { name?: string; role?: string; color?: string }) {
    await store.saveProfile({ coat: patch })
    if (patch.color) applyCoat(store.data.profile)
    notify()
}

/** Everything on this device, the unsynced edits and the saved copies, as a file. */
export async function exportData() {
    await store.reload()
    const blob = new Blob([JSON.stringify({ ...store.data, pending: await store.pending(), conflicts: store.conflicts }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob), link = document.createElement("a")
    link.href = url
    link.download = "rounds-backup.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A saved copy: restore the edit to try it again, or discard it. */
export async function resolveConflict(id: string, restore: boolean) {
    try { await store.resolveConflict(id, restore) } catch (error) { toast((error as Error).message, { error: true, ms: 8000 }) }
    notify()
}

export async function disconnectSpotify() {
    try { await api.spotifyDisconnect() } catch { toast("Spotify could not be disconnected. Try again when you are online.", { error: true, ms: 8000 }); return }
    location.reload()
}

/** Sign out; with unsynced edits or saved copies the first press asks (in Settings), `force` erases them. */
/* session.js is loaded by main.js; imported here only when needed, it keeps this module
   free of the boot code (and light to test) */
export const signOut = async (opts: { everywhere?: boolean; force?: boolean } = {}) => (await import("@/legacy/js/session.js")).signOut(opts)
export function keepSignedIn() { ui.signoutAsk = null; notify() }

export function showShortcuts() { closeSheet(); openKeys() }

export const showSidebar = (open: boolean) => setSide(open)
export const syncNow = () => sync.syncNow()

/* ── the views ── */

/** Everything, the deadlines or the classes, on the week and month; remembered. */
export function setSchedule(tab: Schedule) {
    ui.schedule = tab
    rememberUi()
    notify()
}

/** A month cell: that day's week. */
export function goToDay(date: string) {
    ui.anchor = date
    ui.view = "week"
    rememberUi()
    render()
}

/** Sort the table by a column; the same column again flips the order. */
export function sortTable(key: SortKey) {
    if (ui.sort.key === key) ui.sort.dir = ui.sort.dir === 1 ? -1 : 1
    else ui.sort = { key, dir: 1 }
    notify()
}

/** Tick a task off or back on. Finishing one celebrates from `from` and books its next review. */
export async function toggleTask(id: string, from?: Element) {
    const it = store.item(id) as Item | null
    if (!it) return
    const finishing = isOpen(it)
    if (finishing && from) celebrate(from)
    setStatus(it, finishing ? "done" : "todo")
    await touch(it)
    await chainReview(it)
    render()
}

/** A task for today, in the course being shown. */
export async function quickAddTask(title: string) {
    const text = title.trim()
    if (!text) return
    await store.saveItem(normalizeItem({ id: uid(), type: "task", title: text, courseId: ui.course === "all" ? null : ui.course, date: today(), status: "todo" }))
    render()
}

/**
 * The quote tile: the next quote, with fireworks from `from` when clicked. With fewer
 * than two there is nothing to turn to, so a click opens Settings at the quote field.
 * Returns whether it turned.
 */
export function nextQuote(from?: Element): boolean {
    if (from) {
        const r = from.getBoundingClientRect()
        fireworks(r.left + r.width / 2, r.top + 4)
    }
    const n = (data.quotes as unknown[]).length
    if (n < 2) {
        if (from) openSettings("qText")
        return false
    }
    ui.quoteIx = (ui.quoteIx + 1) % n
    notify()
    return true
}

export const openStudy = () => setView("study")
