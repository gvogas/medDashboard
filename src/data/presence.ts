// Presence (study together, spec §1): while a solo run goes, friends see you studying, with the
// class you picked and since when. A run that starts or resumes tells the server when it would
// end (it shows a little past that, so a pause or a slow tab does not hide you); one that stops
// takes it back. Rooms show you on their own (worker/rooms.js). Only while Show friends when I'm
// studying is on, which the server checks as well; and not while friends are switched off.

import { api } from "@/core/api"
import * as run from "./run"
import { friendsNow } from "./friends"
import { maintenanceState } from "./maintenance"

let shown = false
let wasPaused: boolean | null = null

const allowed = () => maintenanceState("friends") !== "blocked" && friendsNow().list?.settings.showStudying !== false

/** Watch this device's solo runs; `labelOf` names what one is logged against. Called once. */
export function watchPresence(labelOf: (courseId: string | null, itemId: string | null) => string) {
    run.onTick((s, event) => {
        if (event === "end" || !s) {
            wasPaused = null
            if (shown) { shown = false; api.presence.clear().catch(() => {}) }
            return
        }
        if (s.room) return
        /* on start, on a reload's first tick, and on resume */
        const start = event === "start" || wasPaused === null || (wasPaused && !s.paused)
        /* a run restored after a reload may have shown itself before it: its end clears that too */
        if (wasPaused === null && event !== "start") shown = true
        wasPaused = s.paused
        if (!start || s.paused || !allowed()) return
        shown = true
        const now = Date.now()
        api.presence.set({ courseLabel: labelOf(s.courseId, s.itemId), startedAt: s.startedAt, endsAt: now + s.leftInFlowMs }).catch(() => {})
    })
}
