// Team projects on this device (spec §10, §15), for admins until Stage 10: making one, its
// tasks (add, edit, assign, claim, complete, delete), linking it to a class assignment,
// leaving and deleting it. Its rows arrive and leave by sync like a class's, and its tasks
// are written with store.saveShared, so pending edits, field merge and Saved copies work as
// for any shared row. The Week and the other views show projects from Stage 9.

import { api } from "@/core/api"
import * as store from "@/core/store"
import { data } from "@/core/store"
import * as sync from "@/core/sync"
import { uid } from "@/core/model"
import { download } from "./classes"
import { once, spaceGone, uploadFirst } from "./leave"
import { closeSheet, openSheet } from "./overlay"
import { toast } from "./toast"
import type { ParentRef, SharedItem, Space } from "./types"

/** Projects are for admins until Stage 10 (Stage 8 plan, Decision 1). */
export const PROJECTS_ADMIN_ONLY = true
export const projectsShown = (): boolean => !PROJECTS_ADMIN_ONLY || !!data.profile?.isAdmin
/** The most live tasks a project holds (spec §3); the Worker refuses the 201st too. */
export const TASK_LIMIT = 200

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
    if (tasksOf(spaceId).length >= TASK_LIMIT) { toast("A project holds 200 tasks at most."); return false }
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
 *  and here too until it syncs, so achievements count it at once. */
export const setDone = (t: SharedItem, done: boolean) => write({
    ...t, status: done ? "done" : "todo", completedAt: done ? t.completedAt ?? Date.now() : null, completedBy: done ? data.profile?.id ?? null : null,
})
/** Take an unassigned task, or step off one. */
export const claim = (t: SharedItem, me: string, on: boolean) => write({ ...t, assignees: on ? [me] : t.assignees.filter((u) => u !== me) })
export const deleteTask = (t: SharedItem) => store.removeShared("shared_items", t.scope, t.id)

/** What ticking a team task does (Stage 9 plan, Decision 4): {done} to set, or {why} not. */
export function teamTaskTick(s: Space | null | undefined, t: SharedItem, me: string): { done: boolean } | { why: string } {
    if (!s) return { why: "This project isn't on this device any more." }
    if (s.archived) return { why: "This project is archived, so it is read-only." }
    if (!canFinish(s, t, me)) return { why: "Only its assignees and the project's editors can complete this task." }
    return { done: t.status !== "done" }
}
/** Tick a team task from a view by its key, '<scope>/<id>'. */
export async function toggleTeamTask(key: string): Promise<void> {
    const at = key.indexOf("/"), scope = key.slice(0, at), id = key.slice(at + 1)
    const t = data.shared_items.find((i) => i.scope === scope && i.id === id && !i.deletedAt)
    if (!t) return
    const r = teamTaskTick(data.spaces.find((s) => s.scope === scope), t, data.profile?.id ?? "")
    if ("why" in r) { toast(r.why); return }
    await setDone(t, r.done)
}

/** Who a task is with, in words: "Everyone", names, or "Nobody yet". */
export function assigneeNames(t: SharedItem, s: Space | null | undefined, me: string): string {
    if (t.assignees.includes("*")) return "Everyone"
    if (!t.assignees.length) return "Nobody yet"
    return t.assignees.map((u) => (u === me ? "You" : s?.members.find((m) => m.userId === u)?.name ?? "A former member")).join(", ")
}

/* ── the project itself ── */

/** Class assignments, labs and projects you can see, to link a project to (spec §10). */
export function linkable(items: SharedItem[] = data.shared_items, spaces: { scope: string; name: string }[] = data.spaces): { space: string; item: string; label: string; date: string }[] {
    const names = new Map(spaces.filter((s) => s.scope.startsWith("c:")).map((s) => [s.scope, s.name]))
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
