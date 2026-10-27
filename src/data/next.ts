// Up next and crunch over the live data: what the Week's Up next panel and the crunch
// marks on the Week and the Month read. Like the stat tiles they leave the search and
// the course filter alone (they are about the whole of your work), but like the Week
// they leave out what you hid with an eye toggle, and of a project's rows keep only your
// tasks (forStats). A class item an editor removed is left out: it is yours to keep or
// dismiss, not to do.

import { useMemo, useSyncExternalStore } from "react"
import { getVersion, subscribe } from "@/bridge"
import { today as todayIso } from "@/core/dates"
import { upNext, NEXT_SHOWN, type NextRow } from "@/core/next"
import { crunches, crunchHint, type Crunch } from "@/core/workload"
import { useItems, useCourses, useProfile } from "./store"
import { courseByKey, courseKeyOf, effectiveItems, forStats, onCalendar, type EffectiveCourse, type EffectiveItem } from "./effective"
import { data } from "@/core/store"

/** Your rows as Up next and crunch see them. Pure, for the tests. */
export function workRows<I extends EffectiveItem, C extends EffectiveCourse>(items: I[], courses: C[], hidden: readonly string[], me: string): I[] {
    const shown = onCalendar(items, courses, hidden).items
    return forStats(shown, me).filter((it) => !it.removed)
}

/** An Up next row with its course, for the panel. */
export interface NextEntry extends NextRow<EffectiveItem> { course: EffectiveCourse | null }

/** The live rows; today catches the day rolling over on a redraw. */
function useWork(): { rows: EffectiveItem[]; today: string } {
    const items = useItems(), courses = useCourses(), profile = useProfile()
    useSyncExternalStore(subscribe, getVersion)
    const today = todayIso()
    return useMemo(() => ({ rows: workRows(items, courses, profile?.hiddenSources ?? [], profile?.id ?? ""), today }),
        [items, courses, profile, today])
}

/** The Up next panel's rows, best first. */
export function useUpNext(limit = NEXT_SHOWN): NextEntry[] {
    const { rows, today } = useWork()
    return useMemo(() => upNext(rows, today, limit).map((r) => ({ ...r, course: courseByKey(courseKeyOf(r.item)) })), [rows, today, limit])
}

/** The crunches touching [from, to]. */
export function useCrunches(from: string, to: string): Crunch[] {
    const { rows } = useWork()
    return useMemo(() => crunches(rows, from, to), [rows, from, to])
}

/**
 * The item sheet's hint while saving: a crunch the draft makes or adds to, else null.
 * Read once, at save, so it needs no hook.
 */
export function hintFor(draft: EffectiveItem): string | null {
    const profile = data.profile as { id?: string; hiddenSources?: string[] } | null
    return crunchHint(workRows(effectiveItems(), [], profile?.hiddenSources ?? [], profile?.id ?? ""), draft)
}
