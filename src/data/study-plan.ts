// The Study plan card over the live data: today's target and the days after it
// (core/study-today.ts), ticking a topic off from the card, and sending an exam to the
// timer. The day's target is kept on this browser only (it is a view of the plan, not
// data): another device makes its own from the same plan, and a topic ticked anywhere is
// done everywhere, because the tick itself is the exam's checklist, which syncs.

import { useEffect, useMemo } from "react"
import { today as todayIso } from "@/core/dates"
import { normalizePrefs } from "@/core/model"
import { planView, type PlanView, type Target } from "@/core/study-today"
import { notify } from "@/bridge"
import { courseKeyOf, effectiveItems, itemByKey } from "./effective"
import { isSharedKey } from "./refs"
import { editNow } from "./item-edit"
import { editMark } from "./marks"
import { useItems, useMarks, useProfile, useSharedCourses, useSharedItems } from "./store"
import { pickCourse, pickItem } from "./study-timer"

const KEY = "rounds.plan.today"

/** The target kept for `today`, or null on a new day (or with nothing kept). */
export function readTarget(today: string): Target | null {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || "null") as { date?: string; target?: Target } | null
        if (!v || v.date !== today || !v.target || typeof v.target !== "object") return null
        const out: Target = {}
        for (const [k, list] of Object.entries(v.target)) if (Array.isArray(list)) out[k] = list.filter((t) => typeof t === "string")
        return out
    } catch { return null }
}
function writeTarget(today: string, target: Target) {
    try { localStorage.setItem(KEY, JSON.stringify({ date: today, target })) } catch { /* private window: the target is made again next time */ }
}

/** The plan as the card shows it, following the items, your marks and your rest days. */
export function usePlanView(): PlanView {
    /* subscribed so the card follows changes; effectiveItems() is memoised on these arrays */
    const items = useItems(), shared = useSharedItems(), marks = useMarks(), courses = useSharedCourses()
    const studyPrefs = useProfile()?.studyPrefs
    const today = todayIso()
    const rest = useMemo(() => normalizePrefs(studyPrefs).rest, [studyPrefs])
    const view = useMemo(() => planView(effectiveItems(), today, rest, readTarget(today)), [today, rest, items, shared, marks, courses])
    const kept = JSON.stringify(view.target)
    /* kept after the draw, so the next one reads the same target back */
    useEffect(() => { writeTarget(today, JSON.parse(kept) as Target) }, [today, kept])
    return view
}

/**
 * Tick a topic on an exam's checklist off, or back on, by its text: the first step with
 * that text in the other state. A class exam's checklist is yours, in your mark.
 */
export async function tickTopic(examKey: string, topic: string, done: boolean) {
    const it = itemByKey(examKey)
    if (!it) return
    const list = it.checklist || []
    const at = list.findIndex((s) => s.text.trim() === topic && !!s.done !== done)
    if (at < 0) return
    const checklist = list.map((s, i) => (i === at ? { ...s, done } : s))
    if (isSharedKey(examKey)) await editMark(examKey, { checklist })
    else await editNow(it.id, { checklist })
    notify()
}

/** Point the timer at an exam: its course and the exam itself as what the next run is logged against. False when it has no course. */
export function studyExam(examKey: string): boolean {
    const it = itemByKey(examKey)
    const course = it ? courseKeyOf(it) : null
    if (!it || !course) return false
    pickCourse(course)
    pickItem(examKey)
    return true
}
