// An outline imported into a class (spec §8 Imports, §15, §20). The plan's rows are matched
// against the class's own live items, one to one: New (ticked when dated), Changed (unticked,
// saying what it was) or Already there. Import writes the ticked rows as the class's: ordinary
// shared writes, which the Worker lets an owner or editor make. Or a new class made from the
// outline: nothing is made until Import, then the class, then its items.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { api } from "@/core/api"
import { normalizeItem } from "@/core/model"
import { DOW, shortDate, today } from "@/core/dates"
import { defaultTerm } from "@/core/school"
import { planOutline, type Outline, type Plan, type PlanItem, type PlanRow } from "@/core/importers/plan"
import type { Row } from "@/core/db"
import { schoolCal, termStart } from "./query"
import { download, freeColour, openClass } from "./classes"
import type { SharedCourse, SharedItem, Space } from "./types"

/** Where an outline goes: your courses (as before), a class you edit, or a class made from it. */
export type Target = { kind: "mine" } | { kind: "class"; spaceId: string } | { kind: "new-class" }

/** The classes an outline can go into: yours to edit, not archived. */
export const importTargets = (spaces: Space[] = data.spaces ?? []): Space[] =>
    spaces.filter((s) => s.kind === "class" && s.role !== "member" && !s.archived)

/* a title as matched: letters and digits of any script, case and punctuation aside */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
/* type and title, or "" for a title with nothing to match on */
const key = (x: { type: string; title: string }) => { const t = norm(x.title); return t ? x.type + "|" + t : "" }
/* the same occurrence: a recurring row by weekday and start (its date moves), else by date */
const sameWhen = (row: PlanRow, twin: SharedItem) =>
    row.recur ? twin.recur === row.recur && twin.weekday === row.weekday && twin.start === row.start : twin.date === row.date

/**
 * What the class's item said where the outline says otherwise, e.g. ["Tue 20 Oct", "15%"];
 * empty when nothing differs. A field the outline is silent on (no time, room or weight) is
 * no change.
 */
export function changes(row: PlanRow, twin: SharedItem): string[] {
    const was: string[] = []
    const day = (x: SharedItem) => x.recur ? DOW[x.weekday ?? 0] + "s" : x.date ? shortDate(x.date) : "no date"
    /* a one-off row keeps a recurring item's series (see changed()), so only its date can differ */
    if (row.recur ? twin.recur !== row.recur || twin.weekday !== row.weekday : !twin.recur && twin.date !== row.date) was.push(day(twin))
    if (row.start && (row.start !== twin.start || (!!row.end && row.end !== twin.end))) was.push(twin.start ? twin.start + (twin.end ? "–" + twin.end : "") : "no time")
    if (row.where && row.where !== twin.where) was.push(twin.where || "no room")
    if (row.weight != null && row.weight !== twin.weight) was.push(twin.weight != null ? twin.weight + "%" : "no weight")
    return was
}

/** The outline planned for your own courses, as the import has always done. */
export function planMine(outline: Outline): Plan {
    const plan = planOutline(outline, data, termStart() || "")
    const cal = schoolCal()
    for (const c of plan.courses) if (c.isNew) c.term = defaultTerm(cal, c.term || "", today())
    return { ...plan, outline }
}

/**
 * The outline planned against a class's course and items (null: a new class). Every row goes
 * under the class's one course; meetings it already has start unticked; each item is New,
 * Changed or Already there by type and normalised title, against the class's live items only
 * (a removed item is not there, whatever this device still holds of it). Each of the class's
 * items matches one row at most: rows on the same day first, then any left, in order.
 */
export function planForClass(outline: Outline, course: SharedCourse | null, items: SharedItem[]): Plan {
    const plan = planOutline(outline, { courses: [], items: [] }, termStart() || "")
    const pc = plan.courses[0]
    const id = course?.id ?? pc.id
    const meetings = plan.courses.flatMap((c) => c.meetings).map((m) => ({
        ...m, include: !course?.meetings.some((x) => x.weekday === m.weekday && x.start === m.start),
    }))
    plan.courses = [{
        ...pc, id, isNew: !course, meetings, keep: !course,
        ...(course ? { code: course.code, name: course.name, color: course.color } : {}),
    }]
    for (const it of plan.items) it.row.courseId = id
    const pool = course ? items.filter((x) => x.scope === course.scope && !x.deletedAt && key(x)) : []
    const twins = new Map<PlanItem, SharedItem>()
    for (const exact of [true, false]) for (const it of plan.items) {
        const k = key(it.row)
        if (!k || twins.has(it)) continue
        const at = pool.findIndex((x) => key(x) === k && (!exact || sameWhen(it.row, x)))
        if (at >= 0) twins.set(it, pool.splice(at, 1)[0])
    }
    for (const [it, twin] of twins) {
        it.match = twin.id
        it.include = false
        const was = changes(it.row, twin)
        if (was.length) { it.duplicate = false; it.was = was.join(" · ") }
        else it.duplicate = true
    }
    return { ...plan, outline }
}

/* A Changed row onto the item it matches: what the outline says, the rest as the class has it
   (its notes, status, assignees, and a time, room or weight the outline is silent on). A
   recurring item keeps its series unless the row recurs too. */
function changed(twin: SharedItem, it: PlanItem): SharedItem {
    const row = it.row
    const series = !twin.recur ? { recur: row.recur ?? null, weekday: row.recur ? row.weekday ?? null : null, date: row.date }
        : row.recur ? { recur: twin.recur, weekday: row.weekday ?? twin.weekday, date: row.weekday === twin.weekday ? twin.date : row.date }
        : { recur: twin.recur, weekday: twin.weekday, date: twin.date }
    const time = !row.start ? { start: twin.start, end: twin.end }
        : { start: row.start, end: row.end || (row.start === twin.start ? twin.end : "") }
    return { ...twin, ...series, ...time, where: row.where || twin.where, weight: row.weight ?? twin.weight }
}

const count = (k: number, one: string, many: string) => k + " " + (k === 1 ? one : many)
const list = (parts: string[]) => parts.length < 2 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]

/** Import the ticked rows into a class: meetings onto its course, New as its items, Changed onto the items they match. */
export async function commitToClass(plan: Plan, spaceId: string): Promise<string> {
    const scope = "c:" + spaceId
    const course = (data.shared_courses ?? []).find((c) => c.scope === scope)
    if (!course) throw new Error("the class isn't on this device yet")
    const add = plan.courses.flatMap((c) => c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m))
    const kept = [...course.meetings, ...add].slice(0, 12)
    const classes = kept.length - course.meetings.length
    if (classes > 0) await store.saveShared("shared_courses", { ...course, meetings: kept } as unknown as Row & { scope: string })
    let added = 0, updated = 0
    for (const it of plan.items) {
        if (!it.include || !it.row.date) continue
        /* data.shared_items holds live items only: one removed since the preview is added anew */
        const twin = it.match ? (data.shared_items ?? []).find((x) => x.scope === scope && x.id === it.match) : null
        if (twin) {
            await store.saveShared("shared_items", changed(twin, it) as unknown as Row & { scope: string })
            updated++
        } else {
            await store.saveShared("shared_items", { ...normalizeItem({ ...it.row, courseId: course.id }), scope, classId: null, status: "todo", grade: null, checklist: [], completedAt: null, notes: "" } as unknown as Row & { scope: string })
            added++
        }
    }
    const parts = [
        added ? "added " + count(added, "item", "items") : "",
        updated ? "updated " + count(updated, "item", "items") : "",
        classes > 0 ? "added " + count(classes, "class", "classes") : "",
    ].filter(Boolean)
    if (!parts.length) return `Nothing new for ${course.name}.`
    const said = list(parts)
    return said[0].toUpperCase() + said.slice(1) + ` to ${course.name}.`
}

/** A new class from the outline (spec §20): made on Import with the ticked meetings, then its ticked items written. Needs a connection. */
export async function commitNewClass(plan: Plan): Promise<string> {
    const pc = plan.courses[0]
    const meetings = pc.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
    const space = await api.spaces.create({ kind: "class", course: {
        code: pc.code, name: pc.name, color: freeColour([...data.courses, ...(data.space_prefs ?? [])]),
        instructor: pc.instructor || "", term: defaultTerm(schoolCal(), pc.term || "", today()), meetings,
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
