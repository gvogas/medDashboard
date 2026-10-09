// What every view reads: your own courses and items and, for an admin until Stage 6, your
// classes' and projects', with your layer on top (spec §7). A class course and a personal
// course may share an id, so a shared row carries `key` '<scope>/<id>' and items name their
// course by `courseKey`. A class course takes your prefs (colour, target, semester,
// archived); a class item your mark (status, grade, weight, checklist, notes, completion),
// and is left out when you hid it; an item of yours filed under a class shows under the
// class's course; and a class item an editor removed stays, marked, while your mark on it
// holds something. Otherwise a personal row is left as it is and its key is its id: with no
// shared row and nothing filed under a class these are the store's arrays themselves, so
// anyone without a class sees exactly what they saw before.

import { data } from "@/core/store"
import { meaningfulMark } from "@/core/shared"
import type { Course, Item, Mark, SharedCourse, SpacePref } from "./types"

/** Where a row comes from; a personal row has none. */
export type Source = "class" | "project"
export type EffectiveCourse = Course & { key?: string; scope?: string; source?: Source; spaceId?: string }
export type EffectiveItem = Item & {
    key?: string; scope?: string; source?: Source; courseKey?: string | null; spaceId?: string
    /** a shared item's: your mark on it, and the class's own weight and notes under yours */
    mark?: Mark | null; classWeight?: number | null; classNotes?: string
    /** a class item an editor removed, kept while your mark holds something (spec §13) */
    removed?: { by: string | null; at: number | null }
}

/** Shared rows are in the views, with marks and the split item card. */
export const SHARED_IN_VIEWS = true
/** Classes are for admins until Stage 6 opens them to everyone (spec §22); Stage 6 removes this. */
export const CLASSES_ADMIN_ONLY = true
/** Whether this person's views show their classes and projects. */
export const sharedShown = (): boolean => SHARED_IN_VIEWS && (!CLASSES_ADMIN_ONLY || !!data.profile?.isAdmin)

/** A row's key in the views: '<scope>/<id>' for a shared row, the id for your own. */
export const keyOf = (r: { id: string; key?: string }): string => r.key ?? r.id
/** The key of an item's course: a shared item's course is in its own scope; yours filed under a class, the class's. */
export const courseKeyOf = (it: EffectiveItem): string | null => (it.courseKey !== undefined ? it.courseKey : it.courseId)

const sourceOf = (scope: string): Source => (scope.startsWith("p:") ? "project" : "class")

/** What a merge reads besides the rows: your marks by id, your prefs by space id, each class's course key by space id. */
export interface Layer {
    marks?: ReadonlyMap<string, Mark>; prefs?: ReadonlyMap<string, SpacePref>; classCourse?: ReadonlyMap<string, string>
    /** class items an editor removed, as tombstones */
    removed?: (Item & { scope: string; updatedBy?: string | null; deletedAt?: number | null })[]
}

/** A mark holding anything of yours (spec §13): kept through a removal, copied on leaving. */
export const meaningful = (m: Mark): boolean => meaningfulMark(m as unknown as Record<string, unknown>)

export function mergeCourses(own: Course[], shared: (Course & { scope: string })[], show: boolean, layer: Layer = {}): EffectiveCourse[] {
    if (!show || !shared.length) return own
    return [...own, ...shared.map((c) => {
        const spaceId = c.scope.slice(2), p = layer.prefs?.get(spaceId)
        return {
            ...c, key: c.scope + "/" + c.id, source: sourceOf(c.scope), spaceId,
            ...(p ? { color: p.color, target: p.target, term: p.term, archived: p.archived } : {}),
        }
    })]
}

/* Your mark over a shared item: on a class's, your status, grade, weight, checklist, notes and
   completion; on a project's, only your notes (its status and checklist are the team's). */
function withMark(it: Item & { scope: string }, mark: Mark | null): EffectiveItem {
    const spaceId = it.scope.slice(2)
    const base: EffectiveItem = {
        ...it, key: it.scope + "/" + it.id, source: sourceOf(it.scope), spaceId,
        courseKey: it.courseId ? it.scope + "/" + it.courseId : null,
        mark, classWeight: it.weight, classNotes: it.notes, notes: mark?.notes ?? "",
    }
    if (it.scope.startsWith("p:")) return base
    return {
        ...base, status: mark?.status ?? "todo", grade: mark?.grade ?? null, weight: mark?.weight ?? it.weight,
        checklist: mark?.checklist ?? [], completedAt: mark?.completedAt ?? null,
    }
}

export function mergeItems(own: Item[], shared: (Item & { scope: string })[], show: boolean, layer: Layer = {}): EffectiveItem[] {
    const filed = show && own.some((it) => it.classId)
    if (!show || (!shared.length && !filed && !layer.removed?.length)) return own
    const mine: EffectiveItem[] = filed ? own.map((it) => (it.classId ? { ...it, courseKey: layer.classCourse?.get(it.classId) ?? null } : it)) : own
    const theirs: EffectiveItem[] = []
    for (const it of shared) {
        const mark = layer.marks?.get(it.scope.slice(2) + ":" + it.id) ?? null
        if (!mark?.hidden) theirs.push(withMark(it, mark))
    }
    for (const it of layer.removed ?? []) {
        const mark = layer.marks?.get(it.scope.slice(2) + ":" + it.id) ?? null
        if (mark && !mark.hidden && meaningful(mark)) theirs.push({ ...withMark(it, mark), removed: { by: it.updatedBy ?? null, at: it.deletedAt ?? null } })
    }
    /* removed items holding nothing of yours leave your own list itself */
    if (!theirs.length && !shared.length && !filed) return own
    return [...mine, ...theirs]
}

/* ── the live lists, memoised on the store's arrays (new after every reload), so each is a
   stable snapshot for useSyncExternalStore ── */

const NONE: never[] = []
const classCourses = (shared: SharedCourse[]) =>
    new Map(shared.filter((c) => c.scope.startsWith("c:")).map((c) => [c.scope.slice(2), c.scope + "/" + c.id]))

let courses = { own: null as unknown, shared: null as unknown, prefs: null as unknown, show: false, out: [] as EffectiveCourse[] }
let items = { own: null as unknown, shared: null as unknown, removed: null as unknown, marks: null as unknown, classes: null as unknown, show: false, out: [] as EffectiveItem[] }

export function effectiveCourses(): EffectiveCourse[] {
    const show = sharedShown(), prefs: SpacePref[] = data.space_prefs ?? NONE, shared = data.shared_courses ?? NONE
    if (courses.own !== data.courses || courses.shared !== shared || courses.prefs !== prefs || courses.show !== show) {
        courses = { own: data.courses, shared, prefs, show, out: mergeCourses(data.courses, shared, show, { prefs: new Map(prefs.map((p) => [p.spaceId, p])) }) }
    }
    return courses.out
}

export function effectiveItems(): EffectiveItem[] {
    const show = sharedShown(), marks: Mark[] = data.marks ?? NONE, shared = data.shared_items ?? NONE, classes = data.shared_courses ?? NONE
    const removed = data.removed_items ?? NONE
    if (items.own !== data.items || items.shared !== shared || items.removed !== removed || items.marks !== marks || items.classes !== classes || items.show !== show) {
        items = {
            own: data.items, shared, removed, marks, classes, show,
            out: mergeItems(data.items, shared, show, { marks: new Map(marks.map((m) => [m.id, m])), classCourse: classCourses(classes), removed }),
        }
    }
    return items.out
}

/* ── a row by its key ── */

let lookup = { courses: null as EffectiveCourse[] | null, items: null as EffectiveItem[] | null, c: new Map<string, EffectiveCourse>(), i: new Map<string, EffectiveItem>() }
function lookups() {
    const cs = effectiveCourses(), is = effectiveItems()
    if (lookup.courses !== cs) lookup = { ...lookup, courses: cs, c: new Map(cs.map((c) => [keyOf(c), c])) }
    if (lookup.items !== is) lookup = { ...lookup, items: is, i: new Map(is.map((it) => [keyOf(it), it])) }
    return lookup
}
/** A course in the views by its key: your own by its id, a class's by '<scope>/<id>'. */
export const courseByKey = (key: string | null | undefined): EffectiveCourse | null => (key ? lookups().c.get(key) ?? null : null)
/** An item in the views by its key. */
export const itemByKey = (key: string | null | undefined): EffectiveItem | null => (key ? lookups().i.get(key) ?? null : null)

/* ── the calendar's sources (spec §9): what an eye toggle hides ── */

export const courseSource = (c: EffectiveCourse): string => (c.spaceId ? "space:" + c.spaceId : "course:" + c.id)
export const itemSource = (it: EffectiveItem): string =>
    it.spaceId ? "space:" + it.spaceId : it.classId ? "space:" + it.classId : it.courseId ? "course:" + it.courseId : "personal"

/** What the Week and the Month show: the rows whose source you did not hide. With nothing hidden, the lists themselves. */
export function onCalendar<I extends EffectiveItem, C extends EffectiveCourse>(items: I[], courses: C[], hidden: readonly string[]): { items: I[]; courses: C[] } {
    if (!hidden.length) return { items, courses }
    const off = new Set(hidden)
    return { items: items.filter((it) => !off.has(itemSource(it))), courses: courses.filter((c) => !off.has(courseSource(c))) }
}
