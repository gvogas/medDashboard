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
/** Done or not done, for the whole team (spec §10); whoever completes it is named by the Worker. */
export const setDone = (t: SharedItem, done: boolean) => write({ ...t, status: done ? "done" : "todo", completedAt: done ? t.completedAt ?? Date.now() : null })
/** Take an unassigned task, or step off one. */
export const claim = (t: SharedItem, me: string, on: boolean) => write({ ...t, assignees: on ? [me] : t.assignees.filter((u) => u !== me) })
export const deleteTask = (t: SharedItem) => store.removeShared("shared_items", t.scope, t.id)

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
/** The owner deletes the project, typing its title; it leaves every member's device with their next sync. */
export async function removeProject(spaceId: string, confirm: string): Promise<void> {
    await api.spaces.deleteProject(spaceId, confirm)
    closeSheet()
    await sync.syncNow()
}
/** Leave the project: your tasks become unassigned and your notes there go. */
export async function leaveProject(spaceId: string): Promise<void> {
    await api.spaces.leave(spaceId, false)
    closeSheet()
    await sync.syncNow()
}
