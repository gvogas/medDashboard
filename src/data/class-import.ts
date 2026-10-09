// An outline imported into a class (spec §8 Imports, §15, §20). The plan's rows are matched
// against the class's own live items: New (ticked when dated), Changed (unticked, saying what
// it was) or Already there. Import writes the ticked rows as the class's: ordinary shared
// writes, which the Worker lets an owner or editor make. Or a new class made from the outline:
// nothing is made until Import, then the class, then its items.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { api } from "@/core/api"
import { normalizeItem } from "@/core/model"
import { shortDate, today } from "@/core/dates"
import { planOutline, type Outline } from "@/core/importers/plan"
import type { Row } from "@/core/db"
import { schoolCal, termStart } from "./query"
import { defaultTerm, type ImportPlan } from "./import-edit"
import { download, freeColour, openClass } from "./classes"
import type { SharedCourse, SharedItem, Space } from "./types"

/** Where an outline goes: your courses (as before), a class you edit, or a class made from it. */
export type Target = { kind: "mine" } | { kind: "class"; spaceId: string } | { kind: "new-class" }

/** The classes an outline can go into: yours to edit, not archived. */
export const importTargets = (spaces: Space[] = data.spaces ?? []): Space[] =>
    spaces.filter((s) => s.kind === "class" && s.role !== "member" && !s.archived)

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
/* what makes a matched row Changed */
const FACTS = ["date", "start", "end", "where", "weight"] as const

/** The outline planned for your own courses, as the import has always done. */
export function planMine(outline: Outline): ImportPlan {
    const plan = planOutline(outline, data, termStart() || "") as ImportPlan
    const cal = schoolCal()
    for (const c of plan.courses) if (c.isNew) c.term = defaultTerm(cal, c.term || "", today())
    return { ...plan, outline }
}

/**
 * The outline planned against a class's course and items (null: a new class). Every row goes
 * under the class's one course; meetings it already has start unticked; each item is New,
 * Changed or Already there by type and normalised title, against the class's live items only
 * (a removed item is not there, whatever this device still holds of it).
 */
export function planForClass(outline: Outline, course: SharedCourse | null, items: SharedItem[]): ImportPlan {
    const plan = planOutline(outline, { courses: [], items: [] }, termStart() || "") as ImportPlan
    const pc = plan.courses[0]
    const id = course?.id ?? pc.id
    const live = course ? items.filter((x) => x.scope === course.scope && !x.deletedAt) : []
    const meetings = plan.courses.flatMap((c) => c.meetings).map((m) => ({
        ...m, include: !course?.meetings.some((x) => x.weekday === m.weekday && x.start === m.start),
    }))
    plan.courses = [{
        ...pc, id, isNew: !course, meetings, keep: !course,
        ...(course ? { code: course.code, name: course.name, color: course.color } : {}),
    }]
    for (const it of plan.items) {
        it.row.courseId = id
        const twin = live.find((x) => x.type === it.row.type && norm(x.title) === norm(it.row.title))
        if (!twin) continue
        it.match = twin.id
        const differs = FACTS.some((f) => (f === "where" ? !!it.row.where && it.row.where !== twin.where : (twin[f] ?? null) !== (it.row[f] ?? null)))
        it.include = false
        if (differs) { it.duplicate = false; it.was = twin.date ? shortDate(twin.date) : "no date" }
        else it.duplicate = true
    }
    return { ...plan, outline }
}

/** Import the ticked rows into a class: meetings onto its course, New as its items, Changed onto the items they match. */
export async function commitToClass(plan: ImportPlan, spaceId: string): Promise<string> {
    const scope = "c:" + spaceId
    const course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    if (!course) throw new Error("the class isn't on this device yet")
    const add = plan.courses.flatMap((c) => c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m))
    if (add.length) await store.saveShared("shared_courses", { ...course, meetings: [...course.meetings, ...add].slice(0, 12) } as unknown as Row & { scope: string })
    let added = 0, changed = 0
    for (const it of plan.items) {
        if (!it.include || !it.row.date) continue
        const row = normalizeItem({ ...it.row, courseId: course.id })
        /* data.shared_items holds live items only: one removed since the preview is added anew */
        const twin = it.match ? (data.shared_items ?? []).find((x) => x.scope === scope && x.id === it.match) : null
        if (twin) {
            await store.saveShared("shared_items", { ...twin, date: row.date, start: row.start, end: row.end, where: row.where || twin.where, weight: row.weight, recur: row.recur, weekday: row.weekday } as unknown as Row & { scope: string })
            changed++
        } else {
            await store.saveShared("shared_items", { ...row, scope, classId: null, status: "todo", grade: null, checklist: [], completedAt: null, notes: "" } as unknown as Row & { scope: string })
            added++
        }
    }
    const n = (k: number, one: string, many: string) => k + " " + (k === 1 ? one : many)
    return `Added ${n(added, "item", "items")}, updated ${changed}, and added ${n(add.length, "class", "classes")} to ${course.name}.`
}

/** A new class from the outline (spec §20): made on Import with the ticked meetings, then its ticked items written. Needs a connection. */
export async function commitNewClass(plan: ImportPlan): Promise<string> {
    const pc = plan.courses[0]
    const meetings = pc.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
    const space = await api.spaces.create({ kind: "class", course: {
        code: pc.code, name: pc.name, color: freeColour([...data.courses, ...(data.space_prefs ?? [])]),
        instructor: pc.instructor || "", term: pc.term || "", meetings,
    } })
    if (!(await download(space.id))) return `${space.name} is made, but hasn't downloaded yet. Import the outline into it once it has.`
    const scope = space.scope, course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    let n = 0
    for (const it of plan.items) {
        if (!it.include || !it.row.date || !course) continue
        await store.saveShared("shared_items", { ...normalizeItem({ ...it.row, courseId: course.id }), scope, classId: null, status: "todo", grade: null, checklist: [], completedAt: null, notes: "" } as unknown as Row & { scope: string })
        n++
    }
    openClass(space.id, "members")
    return `Made ${space.name} with ${n} item${n === 1 ? "" : "s"}. Invite people from Members.`
}
