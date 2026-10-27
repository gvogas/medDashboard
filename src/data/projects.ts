// Team projects on this device (spec §10, §15), for everyone since Stage 10: making one, its
// tasks (add, edit, assign, claim, complete, delete), linking it to a class assignment,
// leaving and deleting it. Its rows arrive and leave by sync like a class's, and its tasks
// are written with store.saveShared, so pending edits, field merge and Saved copies work as
// for any shared row. The Week and the other views show projects from Stage 9.

import { api } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { addDays, iso, parse } from "@/core/dates"
import { uid } from "@/core/model"
import { download } from "./classes"
import { celebrate } from "./item-edit"
import { once, spaceGone, uploadFirst } from "./leave"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"
import type { Course, Item, ParentRef, SharedItem, Space, SpacePref } from "./types"
import { TASK_LIMIT } from "@/core/shared"

/** The most live tasks a project holds (spec §3); the Worker refuses the 201st too. */

export type ProjectTab = "tasks" | "members" | "activity"
export const openProject = (spaceId: string, tab: ProjectTab = "tasks") => openSheet({ kind: "project", spaceId, tab })
export const openNewProject = (parent: ParentRef | null = null) => openSheet({ kind: "new-project", parent })

export const scopeOf = (spaceId: string) => "p:" + spaceId
/** The project's own item: its title, due date and description. */
export const projectItem = (spaceId: string, items: SharedItem[] = data.shared_items): SharedItem | null =>
    items.find((i) => i.scope === scopeOf(spaceId) && i.id === "project") ?? null
/** A project's live tasks, by date, then title. */
export const tasksOf = (spaceId: string, items: SharedItem[] = data.shared_items): SharedItem[] =>
    items.filter((i) => i.scope === scopeOf(spaceId) && i.type === "task" && !i.deletedAt)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))

/* ── who may do what (spec §5); the Worker checks the same ── */

export const canEdit = (s: Space | null | undefined): boolean => !!s && !s.archived && s.role !== "member"
const assignedTo = (t: SharedItem, me: string) => t.assignees.includes(me) || t.assignees.includes("*")
export const canFinish = (s: Space | null | undefined, t: SharedItem, me: string): boolean => !!s && !s.archived && (s.role !== "member" || assignedTo(t, me))
/** "claim" an unassigned task, "unclaim" one you are on, or null. */
export function canClaim(s: Space | null | undefined, t: SharedItem, me: string): "claim" | "unclaim" | null {
    if (!s || s.archived) return null
    if (!t.assignees.length) return "claim"
    return t.assignees.includes(me) ? "unclaim" : null
}

/* ── tasks ── */

const write = (t: SharedItem) => store.saveShared("shared_items", t as unknown as Parameters<typeof store.saveShared>[1])

/** A new task (editors): unassigned, not done. False when the project already holds 200. */
export async function addTask(spaceId: string, title: string, date: string): Promise<boolean> {
    if (tasksOf(spaceId).length >= TASK_LIMIT) { toast(`A project holds ${TASK_LIMIT} tasks at most.`); return false }
    await write({
        id: uid(), scope: scopeOf(spaceId), type: "task", title: title.trim() || "Untitled", courseId: null, date, start: "", end: "", where: "",
        status: "todo", grade: null, weight: null, notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "",
        completedAt: null, classId: null, updatedBy: null, assignees: [], completedBy: null, revision: 0,
    } as unknown as SharedItem)
    return true
}
/** An editor's change to a task: title, date, times, notes, assignees. */
export const saveTask = (t: SharedItem, patch: Partial<SharedItem>) => write({ ...t, ...patch })
/** Done or not done, for the whole team (spec §10); whoever completes it is named by the Worker,
 *  and here too until it syncs, so achievements count it at once. Done again keeps who finished it first. */
export function setDone(row: SharedItem, done: boolean) {
    const t = stored(row)
    return write({
        ...t, status: done ? "done" : "todo", completedAt: done ? t.completedAt ?? Date.now() : null,
        completedBy: done ? (t.completedAt != null ? t.completedBy : data.profile?.id ?? null) : null,
    })
}
/** Take an unassigned task, or step off one. */
export function claim(row: SharedItem, me: string, on: boolean) {
    const t = stored(row)
    return write({ ...t, assignees: on ? [me] : t.assignees.filter((u) => u !== me) })
}
/* the row as stored now, not as a view drew it: an edit just saved (a title, notes) is kept */
const stored = (t: SharedItem): SharedItem => (data.shared_items ?? []).find((x) => x.scope === t.scope && x.id === t.id && !x.deletedAt) ?? t
export const deleteTask = (t: SharedItem) => store.removeShared("shared_items", t.scope, t.id)

/** What ticking a team task does (Stage 9 plan, Decision 4): {done} to set, or {why} not. */
export function teamTaskTick(s: Space | null | undefined, t: SharedItem, me: string): { done: boolean } | { why: string } {
    if (!s) return { why: "This project isn't on this device any more." }
    if (s.archived) return { why: "This project is archived, so it is read-only." }
    if (!canFinish(s, t, me)) return { why: "Only its assignees and the project's editors can complete this task." }
    return { done: t.status !== "done" }
}
/** Tick a team task from a view by its key, '<scope>/<id>'; finishing it celebrates from `from`. */
export async function toggleTeamTask(key: string, from?: Element): Promise<void> {
    const at = key.indexOf("/"), scope = key.slice(0, at), id = key.slice(at + 1)
    const t = data.shared_items.find((i) => i.scope === scope && i.id === id && !i.deletedAt)
    if (!t) return
    const r = teamTaskTick(data.spaces.find((s) => s.scope === scope), t, data.profile?.id ?? "")
    if ("why" in r) { toast(r.why); return }
    if (r.done && from) celebrate(from)
    await setDone(t, r.done)
}

/** Who a task is with, in words: "Everyone", names, or "Nobody yet". */
export function assigneeNames(t: SharedItem, s: Space | null | undefined, me: string): string {
    if (t.assignees.includes("*")) return "Everyone"
    if (!t.assignees.length) return "Nobody yet"
    return t.assignees.map((u) => (u === me ? "You" : s?.members.find((m) => m.userId === u)?.name ?? "A former member")).join(", ")
}

/* ── progress, workload, the linked assignment (spec §10) ── */

/** Done over live tasks (spec §10): "12 / 18 · 67%". Pass tasksOf(id). */
export function progress(tasks: SharedItem[]): { done: number; total: number; label: string; frac: number } {
    const total = tasks.length, done = tasks.filter((t) => t.status === "done").length
    return { done, total, frac: total ? done / total : 0, label: total ? `${done} / ${total} · ${Math.round((done / total) * 100)}%` : "No tasks yet" }
}

/** Each member's open tasks dated today to 14 days ahead (spec §10); a task for everyone counts for each. */
export function workload(tasks: SharedItem[], members: string[], today: string): Map<string, number> {
    const end = iso(addDays(parse(today), 14))
    const out = new Map(members.map((m) => [m, 0]))
    for (const t of tasks) {
        if (t.status === "done" || !t.date || t.date < today || t.date > end) continue
        for (const m of members) if (assignedTo(t, m)) out.set(m, out.get(m)! + 1)
    }
    return out
}

export type Assignment = { state: "none" } | { state: "removed" } | { state: "same" | "drift"; label: string; date: string }
/**
 * The class assignment a project belongs to, as this person may see it (spec §10): nothing
 * unless they hold that class; "removed" when they do but the assignment is no longer live
 * on this device or the class is archived; else its label and date, and whether the project's
 * date has drifted from it. An undated assignment never drifts: there is no date to take.
 */
export function assignmentOf(s: Pick<Space, "parent">, project: Pick<SharedItem, "date">, items: SharedItem[] = data.shared_items,
    spaces: (Pick<Space, "id" | "name"> & Partial<Pick<Space, "archived">>)[] = data.spaces): Assignment {
    const p = s.parent
    const cls = p && spaces.find((x) => x.id === p.space)
    if (!p || !cls) return { state: "none" }
    const a = !cls.archived && items.find((i) => i.scope === "c:" + p.space && i.id === p.item && !i.deletedAt)
    if (!a) return { state: "removed" }
    return { state: !a.date || a.date === project.date ? "same" : "drift", label: cls.name + " · " + a.title, date: a.date }
}

/** Use this date (spec §10): the project's due date becomes the assignment's; an ordinary editor write. */
export const takeAssignmentDate = (project: SharedItem, date: string) => saveTask(project, { date })

/** A project's colour (spec §9): its linked class's, when you hold it, else your own for the project. */
export function projectColour(s: Pick<Space, "id" | "parent">, prefs: Pick<SpacePref, "spaceId" | "color">[] = data.space_prefs ?? [],
    spaces: Pick<Space, "id">[] = data.spaces): string | null {
    const cls = s.parent && spaces.some((x) => x.id === s.parent!.space) ? s.parent.space : null
    return (cls && prefs.find((p) => p.spaceId === cls)?.color) || prefs.find((p) => p.spaceId === s.id)?.color || null
}

/**
 * The study pickers' lists with your team projects in them (Stage 9 plan, Decision 1): a course
 * per project you are in, "Team · <name>", keyed by the project's own row, and your tasks
 * there (assigned to you or to everyone) as its items. A session on one stores the project's
 * own row as its course, in the project's space (refs.ts refOf). Takes keyed lists (refs.ts);
 * with no project, the lists themselves.
 */
export function withProjects<C extends Course, I extends Item & { assignees?: string[] }>(courses: C[], items: I[], me: string,
    spaces: Pick<Space, "id" | "scope" | "kind" | "name" | "archived" | "parent">[] = data.spaces ?? [],
    prefs: Pick<SpacePref, "spaceId" | "color">[] = data.space_prefs ?? []): { courses: C[]; items: I[] } {
    const projects = spaces.filter((s) => s.kind === "project")
    if (!projects.length) return { courses, items }
    const keys = new Map(projects.map((s) => [s.scope + "/", s.scope + "/project"]))
    const courseOf = (it: I) => {
        const at = it.id.indexOf("/"), key = at > 0 ? keys.get(it.id.slice(0, at + 1)) : undefined
        return key && it.type === "task" && ((it.assignees ?? []).includes(me) || (it.assignees ?? []).includes("*")) ? key : null
    }
    return {
        courses: [...courses, ...projects.map((s) => asCourse(s, prefs, spaces) as C)],
        items: items.map((it) => { const key = courseOf(it); return key ? { ...it, courseId: key } : it }),
    }
}
const asCourse = (s: Pick<Space, "id" | "scope" | "name" | "archived" | "parent">, prefs: Pick<SpacePref, "spaceId" | "color">[], spaces: Pick<Space, "id">[]): Course => ({
    id: s.scope + "/project", code: "Team", name: s.name, color: projectColour(s, prefs, spaces) ?? "#7D8A99",
    instructor: "", term: "", archived: s.archived, target: null, meetings: [],
})
/** A study course key that names a team project you are in (withProjects), as its course; else null. For History. */
export function projectCourse(key: string | null | undefined): Course | null {
    const s = key ? (data.spaces ?? []).find((x) => x.kind === "project" && x.scope + "/project" === key) : undefined
    return s ? asCourse(s, data.space_prefs ?? [], data.spaces) : null
}

/* ── the project itself ── */

/** Class assignments, labs and projects you can see, to link a project to (spec §10); not an
 *  archived class's, which assignmentOf reads as removed. */
export function linkable(items: SharedItem[] = data.shared_items, spaces: { scope: string; name: string; archived?: boolean }[] = data.spaces): { space: string; item: string; label: string; date: string }[] {
    const names = new Map(spaces.filter((s) => s.scope.startsWith("c:") && !s.archived).map((s) => [s.scope, s.name]))
    return items.filter((i) => names.has(i.scope) && !i.deletedAt && ["assignment", "lab", "project"].includes(i.type))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((i) => ({ space: i.scope.slice(2), item: i.id, label: names.get(i.scope) + " · " + i.title, date: i.date }))
}

/** Make a project; it downloads, then its sheet opens. */
export async function makeProject(title: string, date: string | null, parent: ParentRef | null): Promise<void> {
    const space = await api.spaces.create({ kind: "project", title, ...(date ? { date } : {}), ...(parent ? { parent } : {}) })
    await download(space.id)
    openProject(space.id)
}
/** The owner links the project to an assignment (its date follows) or unlinks it. */
export async function link(spaceId: string, parent: ParentRef | null): Promise<void> {
    await api.spaces.link(spaceId, parent)
    await sync.syncNow()
}
/* removeProject and leaveProject upload your edits first and take a repeat that answers not
   found, the project being gone here too, as done (leave.ts) */

/** The owner deletes the project, typing its title; it leaves every member's device with their next sync. */
export async function removeProject(spaceId: string, confirm: string): Promise<void> {
    await uploadFirst()
    await once(() => api.spaces.deleteProject(spaceId, confirm), spaceGone(spaceId))
    closeSheet()
    toast(`${confirm.trim()} is deleted.`)
    await sync.syncNow()
}
/** Leave the project: your tasks become unassigned and your notes there go. */
export async function leaveProject(spaceId: string): Promise<void> {
    await uploadFirst()
    await once(() => api.spaces.leave(spaceId, false), spaceGone(spaceId))
    closeSheet()
    await sync.syncNow()
}
