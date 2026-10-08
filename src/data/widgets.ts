// Home-screen and Lock Screen widgets in the iPhone and Mac app (ios/App/TermWidget): the
// next exam, today's classes and what is due, and today's study. The app works it out here
// from what is on this device, the same way the Week view and the tiles do, and hands it to
// the widget extension through the native bridge (native/term-widgets). A widget redraws
// from that alone, offline. Widgets are a Pro feature (docs/MONETIZATION.md); without Pro the
// widget says so.

import { registerPlugin } from "@capacitor/core"
import { NATIVE } from "@/core/native"
import { data } from "@/core/store"
import { addDays, diffDays, iso, parse, today as todayIso } from "@/core/dates"
import { isOpen, isTest, tmeta } from "@/core/model"
import { schoolCal } from "@/data/query"
import { effectiveCourses, effectiveItems, onCalendar, sharedShown, courseKeyOf, keyOf } from "./effective"
import { stats, weekDays } from "./views"
import { THEMES } from "./themes"
import { hasPro } from "./plan"
import type { Course, Item } from "./types"

export interface WidgetData {
    v: 1
    /** ms; the widget shows how old it is when it has not heard from the app in a while */
    updatedAt: number
    /** the day this was worked out for; a widget on a later day counts its days from its own date */
    today: string
    pro: boolean
    accent: string
    nextExam: { title: string; course: string; type: string; date: string; start: string } | null
    /** today's classes, in time order */
    classes: { course: string; name: string; kind: string; start: string; end: string; room: string; color: string }[]
    /** open items due in the next seven days, soonest first, at most six */
    due: { title: string; course: string; type: string; date: string; start: string; color: string }[]
    study: { minutes: number; goal: number; streak: number }
}

const DUE_DAYS = 7, DUE_MAX = 6

/** What the widgets show. Pure, for the tests: everything it reads is passed in. */
export function widgetData({ items, courses, sessions, studyPrefs, cal, today, pro, accent, now }: {
    items: Item[]; courses: Course[]; sessions: Parameters<typeof stats>[1]; studyPrefs: unknown; cal: ReturnType<typeof schoolCal>
    today: string; pro: boolean; accent: string; now: number
}): WidgetData {
    const byKey = new Map(courses.map((c) => [keyOf(c), c]))
    const courseOf = (it: Item) => byKey.get(courseKeyOf(it) ?? "") ?? null
    const s = stats(items, sessions, studyPrefs, today)
    const day = weekDays({ items, courses, filters: { search: "", course: "all" }, schedule: "classes", anchor: today, today, cal }).days.find((d) => d.date === today)
    const until = iso(addDays(parse(today), DUE_DAYS))
    const due = items
        .filter((it) => isOpen(it) && !isTest(it.type) && !it.recur && it.date >= today && it.date <= until)
        .sort((a, b) => (a.date + (a.start || "~")).localeCompare(b.date + (b.start || "~")))
        .slice(0, DUE_MAX)
    return {
        v: 1, updatedAt: now, today, pro, accent,
        nextExam: s.nextExam && diffDays(today, s.nextExam.date) >= 0 ? {
            title: s.nextExam.title, course: courseOf(s.nextExam)?.code ?? "", type: tmeta(s.nextExam.type).label,
            date: s.nextExam.date, start: s.nextExam.start || "",
        } : null,
        classes: (day?.entries ?? []).flatMap((e) => e.kind === "class" ? [{
            course: e.slot.course.code, name: e.slot.course.name, kind: e.slot.mtg.kind, start: e.slot.mtg.start, end: e.slot.mtg.end,
            room: e.slot.mtg.room || "", color: e.slot.course.color,
        }] : []),
        due: due.map((it) => ({ title: it.title, course: courseOf(it)?.code ?? "", type: tmeta(it.type).label, date: it.date, start: it.start || "", color: courseOf(it)?.color ?? accent })),
        study: s.study,
    }
}

/* ── on the device ── */

interface TermWidgetsPlugin { update(o: { data: string }): Promise<void>; clear(): Promise<void> }
const bridge = NATIVE ? registerPlugin<TermWidgetsPlugin>("TermWidgets") : null
let timer: ReturnType<typeof setTimeout> | null = null
let last = ""

/** What the widgets show now, from the live store, as the Week view sees it. */
function current(): WidgetData {
    const hidden = sharedShown() ? data.profile?.hiddenSources ?? [] : []
    const { items, courses } = onCalendar(effectiveItems(), effectiveCourses(), hidden)
    const bg = (data.profile?.bg || "med") as keyof typeof THEMES
    return widgetData({
        items, courses, sessions: data.study_sessions, studyPrefs: data.profile?.studyPrefs, cal: schoolCal(),
        today: todayIso(), pro: hasPro(), accent: THEMES[bg]?.accent ?? THEMES.med.accent, now: Date.now(),
    })
}

/** After a change, a moment later: hand the widgets their data, if it changed. */
export function updateWidgetsSoon(): void {
    if (!bridge || !data.profile) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        timer = null
        const next = current()
        const json = JSON.stringify({ ...next, updatedAt: 0 })
        if (json === last) return
        last = json
        bridge.update({ data: JSON.stringify(next) }).catch(() => { last = "" })
    }, 1500)
}

/** Signed out or deleted: the widgets forget the account. */
export async function clearWidgets(): Promise<void> {
    if (!bridge) return
    if (timer) { clearTimeout(timer); timer = null }
    last = ""
    await bridge.clear().catch(() => {})
}
