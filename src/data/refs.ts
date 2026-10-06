// Keys for what a study session, an achievement or a picker points at (spec §7): a course or
// item of yours by its id; a class's or a project's by '<scope>/<id>'. A session or an
// achievement names a shared row with its `spaceId`, so its keys are built from that. The
// study pickers, History, Today, the badges, and the session and achievement sheets work on
// keyed lists, in which every row's `id` (and an item's `courseId`) is its key: a class
// course and a personal course with the same id stay apart. A row with nothing shared about
// it is left as it is, and a list with none is returned itself.

import { data } from "@/core/store"
import { courseKeyOf, keyOf, type EffectiveCourse, type EffectiveItem } from "./effective"
import type { Achievement, Course, Item, StudySession } from "./types"

const SHARED_KEY = /^([cp]:[a-z0-9]{12})\/(.+)$/s
/** A shared row's key, '<scope>/<id>'. A personal id never looks like one (ids come from uid()). */
export const isSharedKey = (key: string | null | undefined): key is string => !!key && SHARED_KEY.test(key)
/** A key's scope, space and id; a personal key has neither scope nor space. */
export function splitKey(key: string): { scope: string | null; spaceId: string | null; id: string } {
    const m = SHARED_KEY.exec(key)
    return m ? { scope: m[1], spaceId: m[1].slice(2), id: m[2] } : { scope: null, spaceId: null, id: key }
}
/** A space's scope as this device knows it; a class's while the space is not here yet. */
export const scopeOfSpace = (spaceId: string): string => (data.spaces ?? []).find((s) => s.id === spaceId)?.scope ?? "c:" + spaceId
const refKey = (spaceId: string | null | undefined, id: string | null): string | null => (id && spaceId ? scopeOfSpace(spaceId) + "/" + id : id)
/** The key of the course a session or an achievement is on. */
export const courseRefKey = (r: { courseId: string | null; spaceId?: string | null }): string | null => refKey(r.spaceId, r.courseId)
/** The key of the item a session or an achievement is on. */
export const itemRefKey = (r: { itemId: string | null; spaceId?: string | null }): string | null => refKey(r.spaceId, r.itemId)
/** What a session or an achievement stores for the keys picked: the ids, and the space they are in. */
export function refOf(courseKey: string | null, itemKey: string | null): { courseId: string | null; itemId: string | null; spaceId: string | null } {
    const c = courseKey ? splitKey(courseKey) : null, i = itemKey ? splitKey(itemKey) : null
    return { courseId: c?.id ?? null, itemId: i?.id ?? null, spaceId: c?.spaceId ?? i?.spaceId ?? null }
}

/** The key of a class's course, from its space id. */
export function classCourseKey(spaceId: string): string | null {
    const c = (data.shared_courses ?? []).find((x) => x.scope === "c:" + spaceId)
    return c ? c.scope + "/" + c.id : null
}
/** The course key an item of yours is shown under: its course, or its class's course. */
export const itemCourseKey = (it: { courseId: string | null; classId?: string | null }): string | null =>
    (it.classId ? classCourseKey(it.classId) : it.courseId)
/** Where an item of yours goes for a course key picked: under a course of yours, or filed under a class (spec §5). */
export const placeCourse = (key: string | null): { courseId: string | null; classId: string | null } =>
    (isSharedKey(key) ? { courseId: null, classId: splitKey(key).spaceId } : { courseId: key || null, classId: null })

/* ── keyed lists, kept per list given, so a list stays the same list for useMemo ── */

function keyed<T>(cache: WeakMap<T[], T[]>, list: T[], shared: (r: T) => boolean, map: (r: T) => T): T[] {
    if (!list.some(shared)) return list
    let out = cache.get(list)
    if (!out) { out = list.map((r) => (shared(r) ? map(r) : r)); cache.set(list, out) }
    return out
}
const sessionsKeyed = new WeakMap<StudySession[], StudySession[]>()
const achievementsKeyed = new WeakMap<Achievement[], Achievement[]>()
const itemsKeyed = new WeakMap<Item[], Item[]>()
const coursesKeyed = new WeakMap<Course[], Course[]>()

export const keyedSessions = (list: StudySession[]): StudySession[] =>
    keyed(sessionsKeyed, list, (s) => !!s.spaceId, (s) => ({ ...s, courseId: courseRefKey(s), itemId: itemRefKey(s) }))
export const keyedAchievements = (list: Achievement[]): Achievement[] =>
    keyed(achievementsKeyed, list, (a) => !!a.spaceId, (a) => ({ ...a, courseId: courseRefKey(a), itemId: itemRefKey(a) }))
export const keyedItems = (list: EffectiveItem[]): Item[] =>
    keyed(itemsKeyed, list as Item[], (it) => (it as EffectiveItem).courseKey !== undefined, (it) => ({ ...it, id: keyOf(it), courseId: courseKeyOf(it) }))
export const keyedCourses = (list: EffectiveCourse[]): Course[] =>
    keyed(coursesKeyed, list as Course[], (c) => !!(c as EffectiveCourse).key, (c) => ({ ...c, id: keyOf(c) }))
