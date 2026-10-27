// Showing a view (the Study view during a run is its focus screen), study-session deletes
// that wait for Undo (item and course deletes wait the same way), the daily goal, and the
// celebrations. The Study page, the timer and the focus screen draw from study.ts and
// study-timer.ts.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { normalizePrefs } from "@/core/model"
import { today } from "@/core/dates"
import { minutesByDay, streak } from "@/core/history"
import { achievements, ownAchievements } from "@/core/achievements"
import { launch as fireworks } from "@/lib/fireworks"
import { notify } from "@/bridge"
import * as run from "./run"
import { openFocus } from "./study-timer"
import { toast, TOAST_LONG_MS, TOAST_MS } from "./toast"
import { ui, rememberUi } from "./ui"
import { effectiveCourses, effectiveItems, forAchievements } from "./effective"
import { keyedAchievements, keyedCourses, keyedItems, keyedSessions } from "./refs"
import type { StudyPrefs, View } from "./types"

/** Show a view: the side nav and the 1–5 keys. Study while a run is going opens its focus screen. */
export function setView(view: View) {
    if (view === "study" && run.active()) { openFocus(); return }
    ui.view = view; ui.listFrom = null; rememberUi(); notify()   /* a stat tile's list ends with the page */
}

/* ── the history: deletes that can be undone, the goal ── */

/* A delete waits six seconds so Undo (the History card's, undoSessionDelete in
   study.ts) can take it back; the session is only hidden meanwhile. Another
   delete, or leaving the page, makes the waiting one final. */
const UNDO_MS = TOAST_MS
export function deleteWithUndo(id: string) {
    const session = data.study_sessions.find((x) => x.id === id)
    if (!session) return
    commitUndo()
    ui.hist.undo = { session, timer: setTimeout(commitUndo, UNDO_MS) }
    notify()
}
export function commitUndo(): Promise<void> {
    const u = ui.hist.undo
    if (!u) return Promise.resolve()
    clearTimeout(u.timer)
    ui.hist.undo = null
    /* a failed save already shows its own toast */
    return store.deleteStudySession(u.session.id).then(() => { if (ui.view === "study") notify() }, () => {})
}

/* An item or course delete waits the same six seconds, the row hidden from every view
   meanwhile, so the toast's Undo only has to show it again. */
let doomed: { key: string; commit: () => Promise<unknown>; timer: ReturnType<typeof setTimeout> } | null = null
export async function deleteLater(kind: string, id: string, what: string, commit: () => Promise<unknown>) {
    /* a failed save already shows its own toast; it must not stop this delete */
    const settle = () => finishDelete().catch(() => {})
    await settle()
    const key = kind + ":" + id
    doomed = { key, commit, timer: setTimeout(settle, UNDO_MS) }
    await store.hide(key)
    notify()
    toast(what + " deleted", { undo: undoLater, ms: UNDO_MS })
}
export async function finishDelete() {
    const d = doomed
    if (!d) return
    doomed = null
    clearTimeout(d.timer)
    try { await d.commit() } finally { await store.hide(d.key, false) }
}
async function undoLater() {
    const d = doomed
    if (!d) return
    doomed = null
    clearTimeout(d.timer)
    await store.hide(d.key, false)
    notify()
}

const studyPrefs = (): StudyPrefs => normalizePrefs(data.profile?.studyPrefs)
export async function savePrefs(patch: Partial<StudyPrefs>) {
    await store.saveProfile({ studyPrefs: { ...studyPrefs(), ...patch } })
    notify()
}

/* Fireworks when today's study crosses the goal, or the streak reaches a milestone,
   through something done on this device. The first look only records where it stands. */
let seen: { day: string; mins: number; days: number } | null = null
export function celebrateStudy() {
    const p = studyPrefs(), now = today(), byDay = minutesByDay(data.study_sessions)
    const mins = byDay.get(now) || 0, days = streak(byDay, now, p).current
    const was = seen
    seen = { day: now, mins, days }
    if (!was || was.day !== now || !p.celebrate) return
    const goal = p.goal && was.mins < p.goal && mins >= p.goal
    const milestone = days > was.days && [7, 30, 100, 365].includes(days)
    if (goal || milestone) fireworks(window.innerWidth / 2, window.innerHeight * 0.7, { rockets: milestone ? 6 : 4 })
}

/* A toast, and fireworks when celebrations are on, for each achievement newly earned.
   The first look, and anything synced from elsewhere, only records what is earned. */
let earned: Set<string> | null = null
export function celebrateAchievements({ quiet = false }: { quiet?: boolean } = {}) {
    /* class items count by your mark (spec §8), a project row only when you completed it, in key space like the Study page */
    const sessions = keyedSessions(data.study_sessions), items = keyedItems(forAchievements(effectiveItems(), data.profile?.id ?? ""))
    const list = [...achievements(sessions, items, studyPrefs(), today()),
        ...ownAchievements(keyedAchievements(data.achievements), sessions, items, keyedCourses(effectiveCourses()))]
    const was = earned
    earned = new Set(list.filter((b) => b.earned).map((b) => b.id))
    if (!was || quiet) return
    const fresh = list.filter((b) => b.earned && !was.has(b.id))
    if (!fresh.length) return
    const b = fresh[0], more = fresh.length - 1
    toast("Achievement unlocked: " + b.name + (more ? " and " + more + " more" : ""), {
        badge: { sticker: b.sticker, group: b.group, tier: b.tier },
        label: "See", undo: () => showAchievement(b.id), ms: TOAST_LONG_MS,
    })
    if (studyPrefs().celebrate) fireworks(window.innerWidth / 2, window.innerHeight * 0.7, { rockets: 5 })
}

/** An achievement toast's See: the Study page's Achievements tab, the medal brought into view with a pop. */
export function showAchievement(id: string) {
    if (ui.view !== "study" || ui.studyTab !== "achievements") {
        ui.view = "study"
        ui.studyTab = "achievements"
        rememberUi()
        notify()
    }
    /* the tab is drawn by the next frame when it was not showing */
    requestAnimationFrame(() => {
        const el = document.getElementById("ach-" + id)
        if (!el) return
        el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
        el.classList.remove("pop")
        void el.offsetWidth
        el.classList.add("pop")
    })
}
