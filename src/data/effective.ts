// What every view reads: your own courses and items and, once Stage 4 shows them with your
// marks, your classes' and projects' (spec §7). A class course and a personal course may
// share an id, so a shared row carries `key` '<scope>/<id>' and items name their course by
// `courseKey`. A personal row is left as it is and its key is its id: with no shared row
// shown these are today's arrays themselves, so every view shows exactly what it did.

import { data } from "@/core/store"
import type { Course, Item } from "./types"

/** Where a row comes from; a personal row has none. */
export type Source = "class" | "project"
export type EffectiveCourse = Course & { key?: string; scope?: string; source?: Source }
export type EffectiveItem = Item & { key?: string; scope?: string; source?: Source; courseKey?: string | null }

/** Shared rows join the views in Stage 4, with marks and the split item card: until then an
    edit to one shown here would go through the personal save path. */
export const SHARED_IN_VIEWS = false

/** A row's key in the views: '<scope>/<id>' for a shared row, the id for your own. */
export const keyOf = (r: { id: string; key?: string }): string => r.key ?? r.id
/** The key of an item's course: a shared item's course is in its own scope. */
export const courseKeyOf = (it: EffectiveItem): string | null => (it.courseKey !== undefined ? it.courseKey : it.courseId)

const sourceOf = (scope: string): Source => (scope.startsWith("p:") ? "project" : "class")

export function mergeCourses(own: Course[], shared: (Course & { scope: string })[], show: boolean): EffectiveCourse[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((c) => ({ ...c, key: c.scope + "/" + c.id, source: sourceOf(c.scope) }))]
}

export function mergeItems(own: Item[], shared: (Item & { scope: string })[], show: boolean): EffectiveItem[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((it) => ({ ...it, key: it.scope + "/" + it.id, source: sourceOf(it.scope), courseKey: it.courseId ? it.scope + "/" + it.courseId : null }))]
}

/* Memoised on the store's arrays, which are new after every reload, so each is a stable
   snapshot for useSyncExternalStore. */
let courses: { own: unknown; shared: unknown; out: EffectiveCourse[] } = { own: null, shared: null, out: [] }
let items: { own: unknown; shared: unknown; out: EffectiveItem[] } = { own: null, shared: null, out: [] }

export function effectiveCourses(): EffectiveCourse[] {
    if (courses.own !== data.courses || courses.shared !== data.shared_courses) {
        courses = { own: data.courses, shared: data.shared_courses, out: mergeCourses(data.courses, data.shared_courses, SHARED_IN_VIEWS) }
    }
    return courses.out
}

export function effectiveItems(): EffectiveItem[] {
    if (items.own !== data.items || items.shared !== data.shared_items) {
        items = { own: data.items, shared: data.shared_items, out: mergeItems(data.items, data.shared_items, SHARED_IN_VIEWS) }
    }
    return items.out
}
