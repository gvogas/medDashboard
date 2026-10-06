// Merging a course of yours into a class (spec §11, §13): the merge sheet pairs your items
// with the class's (identical ids first, then the same type and title on the nearest date;
// unsure pairs are left apart), and the Worker's absorb batch moves your layer onto the
// class's items. Lecture reviews and items of your own types are never paired: they stay
// yours, filed under the class. Skipping stores nothing: while a course of yours matches a
// class, the class sheet and the course sheet offer the merge again.

import { api } from "@/core/api"
import * as sync from "@/core/sync"
import { data } from "@/core/store"
import { REVIEW_ID } from "@/core/shared"
import { diffDays } from "@/core/dates"
import { openSheet } from "./overlay"
import { openClass } from "./classes"
import { toast } from "./toast"
import type { Course, Item, SharedCourse } from "./types"

type Dated = Pick<Item, "id" | "type" | "title" | "date">

/** A title as the pairing compares it: lower case, letters and digits. */
export const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const pairable = (it: Dated) => !it.type.startsWith("c-") && !(it.type === "task" && REVIEW_ID.test(it.id))
const same = (a: Dated, b: Dated) => a.type === b.type && normTitle(a.title) === normTitle(b.title)
const far = (a: Dated, b: Dated) => Math.abs(diffDays(a.date, b.date))
/* the one nearest by date; null when there is none, or two are as near (unsure) */
function nearest<T extends Dated>(from: Dated, list: T[]): T | null {
    if (!list.length) return null
    const d = Math.min(...list.map((x) => far(from, x)))
    const at = list.filter((x) => far(from, x) === d)
    return at.length === 1 ? at[0] : null
}

/** [your item's id, the class's item's id] pairs, and your items left apart (spec §11). */
export function pairItems(mine: Dated[], shared: Dated[]): { pairs: [string, string][]; apart: string[] } {
    const pairs: [string, string][] = [], usedMine = new Set<string>(), usedShared = new Set<string>()
    const live = mine.filter(pairable), ids = new Set(shared.map((s) => s.id))
    for (const it of live) if (ids.has(it.id)) { pairs.push([it.id, it.id]); usedMine.add(it.id); usedShared.add(it.id) }
    for (const it of live) {
        if (usedMine.has(it.id)) continue
        const s = nearest(it, shared.filter((x) => !usedShared.has(x.id) && same(it, x)))
        if (!s) continue
        /* only when yours is the nearest for theirs too: two of yours for one of theirs is unsure */
        const back = nearest(s, live.filter((m) => !usedMine.has(m.id) && same(m, s)))
        if (back?.id !== it.id) continue
        pairs.push([it.id, s.id]); usedMine.add(it.id); usedShared.add(s.id)
    }
    return { pairs, apart: mine.filter((it) => !usedMine.has(it.id)).map((it) => it.id) }
}

/** The course of yours that matches a class: one with the class course's id (a Stage 3 copy,
    a rejoin's copy), else the same code, else the same name. */
export function matchFor(spaceId: string, courses: Course[] = data.courses, shared: SharedCourse[] = data.shared_courses ?? []): Course | null {
    const cc = shared.find((c) => c.scope === "c:" + spaceId)
    if (!cc) return null
    const code = (s: string) => s.toLowerCase().replace(/\s+/g, "")
    return courses.find((c) => c.id === cc.id)
        ?? (cc.code ? courses.find((c) => code(c.code) === code(cc.code)) : undefined)
        ?? courses.find((c) => normTitle(c.name) === normTitle(cc.name))
        ?? null
}

/** The merge sheet for a course of yours and a class. `fromCourse`: opened from the class or the course rather than straight after joining, so your colour, semester and archive flag move too. */
export const openMerge = (spaceId: string, courseId: string, fromCourse: boolean) => openSheet({ kind: "merge", spaceId, courseId, fromCourse })

/** Merge (needs a connection): the Worker moves your layer and files the rest; the next sync brings it here. */
export async function mergeCourse(spaceId: string, courseId: string, pairs: [string, string][], fromCourse: boolean): Promise<void> {
    const { paired, filed } = await api.spaces.absorb(spaceId, { courseId, pairs, fromCourse })
    await sync.syncNow()
    const name = data.spaces.find((s) => s.id === spaceId)?.name || "the class"
    toast("Merged into " + name + ": " + paired + " paired, " + filed + " kept as yours, under the class.")
    openClass(spaceId)
}
