// Redraws a sync brings in (held while someone types or clicks), and the spaced reviews
// a pull may bring due. The sync status itself is in sync.ts, for the top bar and Settings.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { normalizeItem, normalizePrefs } from "@/core/model"
import { today } from "@/core/dates"
import { readSetting, writeSetting, dueReviews, effectiveSetting, legacyReviews } from "@/core/reviews"
import { isTyping } from "@/lib/dom"
import { notify } from "@/bridge"
import { effectiveCourses, effectiveItems } from "./effective"
import { schoolCal } from "./query"

/* A redraw replaces every field, so one arriving from a sync while someone types would
   lose their text. Hold it until they leave the field, and until any click has landed:
   redrawing between press and release would swap the button out from under the pointer. */
let heldRefresh = false, pointerDown = false
export function refreshAfterSync() {
    if (isTyping(document.activeElement) || pointerDown) { heldRefresh = true; return }
    heldRefresh = false
    notify()
}
export const runHeldRefresh = () => setTimeout(() => { if (heldRefresh) refreshAfterSync() })
export function pointerPressed() { pointerDown = true }
export function pointerReleased() { pointerDown = false; runHeldRefresh() }

/* ═════════ spaced review ═════════ */
/* After a pull, so this device already holds any review another device created:
   creating the same id twice would come back as a conflict. The pull on focus also
   covers the day rolling over. */
let reviewing = false
export async function runReviews() {
    if (reviewing || !data.profile) return
    reviewing = true
    try {
        const account = data.profile.id, local = readSetting(account), prefs = normalizePrefs(data.profile.studyPrefs)
        /* a setting from before it synced moves up once, from the browser that had it on */
        const moved = legacyReviews(prefs.reviews, local, today())
        if (moved) await store.saveProfile({ studyPrefs: { ...prefs, reviews: moved } })
        const setting = moved ? local : effectiveSetting(prefs.reviews ?? null, local)
        const { rows, through } = dueReviews(setting, effectiveCourses(), effectiveItems(), today(), schoolCal())
        if (rows.length) await store.saveRows(rows.map((row) => ({ kind: "items" as const, row: normalizeItem(row) })))
        if (through !== local.through || setting.on !== local.on) writeSetting(account, { on: setting.on, through })
    } finally { reviewing = false }
}
