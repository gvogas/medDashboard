import { beforeEach, describe, expect, it, vi } from "vitest"

// A project's tasks and who may do what with them, with the store, the API, sync, the sheet and the toast as fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null, shared_items: [] as unknown[], spaces: [] as { id: string }[] },
    pending: 0,
    saveShared: vi.fn(async (_s: string, row: unknown) => row),
    removeShared: vi.fn(async () => {}),
    api: { spaces: { create: vi.fn(), link: vi.fn(async () => null), deleteProject: vi.fn(async () => null), leave: vi.fn(async () => null) } },
    syncNow: vi.fn(async () => true),
    download: vi.fn(async () => true),
    openSheet: vi.fn(),
    closeSheet: vi.fn(),
    toast: vi.fn(),
    celebrate: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveShared: fake.saveShared, removeShared: fake.removeShared, pendingCount: () => fake.pending }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("./classes", () => ({ download: fake.download }))
vi.mock("./overlay", () => ({ openSheet: fake.openSheet, closeSheet: fake.closeSheet }))
vi.mock("./toast", () => ({ toast: fake.toast }))
vi.mock("./item-edit", () => ({ celebrate: fake.celebrate }))
/* leave.ts's guards are the real ones; what else it imports is not needed here */
vi.mock("./marks", () => ({ ago: () => "" }))
vi.mock("./refs", () => ({ splitKey: () => ({}) }))

import { ApiError } from "@/core/api"

import {
    addTask, assigneeNames, assignmentOf, canClaim, canEdit, canFinish, claim, leaveProject, link, linkable, makeProject, progress, projectColour,
    removeProject, setDone, takeAssignmentDate, tasksOf, teamTaskTick, toggleTeamTask, withProjects, workload,
} from "./projects"
import type { SharedItem, Space } from "./types"

const space = (o: Partial<Space> = {}): Space => ({ id: "fire00000001", scope: "p:fire00000001", kind: "project", role: "member", archived: false, name: "Fire", parent: null, revision: 1, members: [], ...o })
const task = (o: Partial<SharedItem>): SharedItem => ({
    id: "t", scope: "p:fire00000001", type: "task", title: "T", courseId: null, date: "2026-10-20", start: "", end: "", where: "", status: "todo", grade: null, weight: null,
    notes: "", checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: "", completedAt: null, classId: null,
    updatedBy: null, assignees: [], completedBy: null, revision: 1, ...o,
} as SharedItem)

beforeEach(() => {
    vi.clearAllMocks()
    fake.data.profile = { id: "u-me", isAdmin: true }
    fake.data.shared_items = []
    fake.data.spaces = []
    fake.pending = 0
})

describe("who may do what with a task (spec §5)", () => {
    it("editors edit and finish anything; members finish their own or everyone's, and claim the unassigned", () => {
        const ed = space({ role: "editor" }), mem = space()
        expect(canEdit(ed)).toBe(true)
        expect(canEdit(mem)).toBe(false)
        expect(canFinish(ed, task({ assignees: ["u-x"] }), "u-me")).toBe(true)
        expect(canFinish(mem, task({ assignees: ["u-x"] }), "u-me")).toBe(false)
        expect(canFinish(mem, task({ assignees: ["u-me"] }), "u-me")).toBe(true)
        expect(canFinish(mem, task({ assignees: ["*"] }), "u-me")).toBe(true)
        expect(canClaim(mem, task({}), "u-me")).toBe("claim")
        expect(canClaim(mem, task({ assignees: ["u-me", "u-x"] }), "u-me")).toBe("unclaim")
        expect(canClaim(mem, task({ assignees: ["u-x"] }), "u-me")).toBe(null)
        expect(canFinish(space({ role: "owner", archived: true }), task({}), "u-me")).toBe(false)
    })
    it("lists live tasks by date, then title", () => {
        const items = [task({ id: "b", date: "2026-10-21", title: "B" }), task({ id: "a", date: "2026-10-21", title: "A" }), task({ id: "z", date: "2026-10-19" }),
            task({ id: "gone", deletedAt: 5 }), task({ id: "project", type: "project" }), task({ id: "other", scope: "p:other0000001" })]
        expect(tasksOf("fire00000001", items).map((t) => t.id)).toEqual(["z", "a", "b"])
    })
    it("offers the live assignments, labs and projects of your classes to link to", () => {
        const items = [
            task({ id: "a1", scope: "c:webs00000001", type: "assignment", title: "REST API", courseId: "web" }),
            task({ id: "q1", scope: "c:webs00000001", type: "quiz", title: "Quiz", courseId: "web" }),
            task({ id: "a2", scope: "c:webs00000001", type: "assignment", title: "Gone", courseId: "web", deletedAt: 3 }),
        ]
        expect(linkable(items, [{ scope: "c:webs00000001", name: "Web Services" }])).toEqual([
            { space: "webs00000001", item: "a1", label: "Web Services · REST API", date: "2026-10-20" },
        ])
        /* an archived class's assignments are not offered: the project would read as unlinked */
        expect(linkable(items, [{ scope: "c:webs00000001", name: "Web Services", archived: true }])).toEqual([])
    })
    it("names who a task is with", () => {
        const s = space({ members: [{ userId: "u-x", name: "Alex", role: "editor" }] })
        expect(assigneeNames(task({ assignees: ["*"] }), s, "u-me")).toBe("Everyone")
        expect(assigneeNames(task({}), s, "u-me")).toBe("Nobody yet")
        expect(assigneeNames(task({ assignees: ["u-me", "u-x", "u-gone"] }), s, "u-me")).toBe("You, Alex, A former member")
    })
})

describe("writing tasks", () => {
    it("adds an unassigned task in the project's scope, refusing the 201st", async () => {
        expect(await addTask("fire00000001", "  Draft  ", "2026-10-22")).toBe(true)
        expect(fake.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({
            scope: "p:fire00000001", type: "task", title: "Draft", date: "2026-10-22", assignees: [], status: "todo", revision: 0,
        }))
        fake.data.shared_items = Array.from({ length: 200 }, (_, i) => task({ id: "t" + i }))
        fake.saveShared.mockClear()
        expect(await addTask("fire00000001", "One more", "2026-10-22")).toBe(false)
        expect(fake.saveShared).not.toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("A project holds 200 tasks at most.")
    })
    it("completes and reopens, claims and unclaims", async () => {
        await setDone(task({}), true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ status: "done", completedAt: expect.any(Number), completedBy: "u-me" }))
        await setDone(task({ status: "done", completedAt: 5, completedBy: "u-me" }), false)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ status: "todo", completedAt: null, completedBy: null }))
        /* completing it again keeps whoever finished it first */
        await setDone(task({ status: "done", completedAt: 5, completedBy: "u-sam" }), true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ status: "done", completedAt: 5, completedBy: "u-sam" }))
        await claim(task({}), "u-me", true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ assignees: ["u-me"] }))
        await claim(task({ assignees: ["u-me", "u-x"] }), "u-me", false)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ assignees: ["u-x"] }))
    })
    it("ticks and claims over the stored row, not a stale one a view drew", async () => {
        const stale = task({ title: "Old title", notes: "" })
        fake.data.shared_items = [{ ...stale, title: "New title", notes: "Just typed", revision: 2 }]
        await setDone(stale, true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ title: "New title", notes: "Just typed", status: "done" }))
        await claim(stale, "u-me", true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ title: "New title", notes: "Just typed", assignees: ["u-me"] }))
    })
})

describe("the project itself", () => {
    it("makes one, downloads it and opens its sheet", async () => {
        fake.api.spaces.create.mockResolvedValueOnce({ id: "fire00000001" })
        await makeProject("Fire", null, { space: "webs00000001", item: "a1" })
        expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "project", title: "Fire", parent: { space: "webs00000001", item: "a1" } })
        expect(fake.download).toHaveBeenCalledWith("fire00000001")
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "project", spaceId: "fire00000001", tab: "tasks" })
        fake.api.spaces.create.mockResolvedValueOnce({ id: "fire00000002" })
        await makeProject("Water", "2026-11-01", null)
        expect(fake.api.spaces.create).toHaveBeenLastCalledWith({ kind: "project", title: "Water", date: "2026-11-01" })
    })
    it("links, then syncs", async () => {
        await link("fire00000001", null)
        expect(fake.api.spaces.link).toHaveBeenCalledWith("fire00000001", null)
        expect(fake.syncNow).toHaveBeenCalledTimes(1)
    })
    it("deletes and leaves after your edits upload, then syncs", async () => {
        fake.pending = 1
        await removeProject("fire00000001", "Fire")
        expect(fake.api.spaces.deleteProject).toHaveBeenCalledWith("fire00000001", "Fire")
        expect(fake.toast).toHaveBeenCalledWith("Fire is deleted.")
        /* two syncs while an edit waits, the call, then one more */
        expect(fake.syncNow).toHaveBeenCalledTimes(3)
        expect(fake.syncNow.mock.invocationCallOrder[1]).toBeLessThan(fake.api.spaces.deleteProject.mock.invocationCallOrder[0])
        fake.pending = 0
        await leaveProject("fire00000001")
        expect(fake.api.spaces.leave).toHaveBeenCalledWith("fire00000001", false)
        expect(fake.closeSheet).toHaveBeenCalledTimes(2)
        expect(fake.syncNow).toHaveBeenCalledTimes(5)
    })
    it("takes a repeat that answers not found as done once the project is gone here, else says it changed", async () => {
        fake.api.spaces.leave.mockRejectedValueOnce(new ApiError(404, { error: "not_found" }))
        await expect(leaveProject("fire00000001")).resolves.toBeUndefined()
        expect(fake.closeSheet).toHaveBeenCalledTimes(1)
        fake.api.spaces.deleteProject.mockRejectedValueOnce(new ApiError(404, { error: "not_found" }))
        await expect(removeProject("fire00000001", "Fire")).resolves.toBeUndefined()
        fake.data.spaces = [{ id: "fire00000001" }]
        fake.api.spaces.deleteProject.mockRejectedValueOnce(new ApiError(404, { error: "not_found" }))
        await expect(removeProject("fire00000001", "Fire")).rejects.toMatchObject({ status: 404, body: { error: "changed" } })
        fake.api.spaces.deleteProject.mockRejectedValueOnce(new ApiError(400, { error: "invalid", field: "confirm" }))
        await expect(removeProject("fire00000001", "Fir")).rejects.toMatchObject({ status: 400 })
        expect(fake.closeSheet).toHaveBeenCalledTimes(2)
    })
})

describe("ticking a team task from the Week (Stage 9 plan, Decision 4)", () => {
    it("completes or reopens what you may, and says why when you may not", () => {
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-me"] }), "u-me")).toEqual({ done: true })
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["*"] }), "u-me")).toEqual({ done: true })
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-me"], status: "done", completedAt: 5 }), "u-me")).toEqual({ done: false })
        expect(teamTaskTick(space({ role: "member" }), task({ assignees: ["u-sam"] }), "u-me")).toEqual({ why: "Only its assignees and the project's editors can complete this task." })
        expect(teamTaskTick(space({ role: "owner", archived: true }), task({}), "u-me")).toEqual({ why: "This project is archived, so it is read-only." })
        expect(teamTaskTick(null, task({}), "u-me")).toEqual({ why: "This project isn't on this device any more." })
    })
    it("sets the team's status by key, or toasts why not", async () => {
        fake.data.spaces = [space({ role: "member" })]
        fake.data.shared_items = [task({ id: "t1", assignees: ["u-me"] }), task({ id: "t2", assignees: ["u-sam"] })]
        await toggleTeamTask("p:fire00000001/t1")
        expect(fake.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({ id: "t1", status: "done" }))
        await toggleTeamTask("p:fire00000001/t2")
        expect(fake.saveShared).toHaveBeenCalledTimes(1)
        expect(fake.toast).toHaveBeenCalledWith("Only its assignees and the project's editors can complete this task.")
        await toggleTeamTask("p:fire00000001/gone")
        expect(fake.saveShared).toHaveBeenCalledTimes(1)
        expect(fake.toast).toHaveBeenCalledTimes(1)
    })
    it("celebrates from where it was ticked when the task becomes done, not when it reopens", async () => {
        fake.data.spaces = [space({ role: "member" })]
        fake.data.shared_items = [task({ id: "t1", assignees: ["u-me"] }), task({ id: "t2", assignees: ["u-me"], status: "done", completedAt: 5 })]
        const el = {} as Element
        await toggleTeamTask("p:fire00000001/t1", el)
        expect(fake.celebrate).toHaveBeenCalledWith(el)
        await toggleTeamTask("p:fire00000001/t2", el)
        expect(fake.celebrate).toHaveBeenCalledTimes(1)
    })
})

describe("progress, workload and the linked assignment (spec §10)", () => {
    it("counts done tasks over live ones", () => {
        expect(progress([task({ status: "done" }), task({}), task({ status: "done" })])).toEqual({ done: 2, total: 3, label: "2 / 3 · 67%", frac: 2 / 3 })
        expect(progress([])).toEqual({ done: 0, total: 0, label: "No tasks yet", frac: 0 })
    })
    it("counts each member's open tasks in the next 14 days, everyone's for each", () => {
        const ts = [task({ assignees: ["u-a"], date: "2026-10-10" }), task({ assignees: ["u-a", "u-b"], date: "2026-10-23" }), task({ assignees: ["*"], date: "2026-10-12" }),
            task({ assignees: ["u-a"], date: "2026-10-25" }), task({ assignees: ["u-a"], date: "2026-10-11", status: "done" }), task({ assignees: ["u-b"], date: "2026-10-09" }),
            task({ assignees: ["u-a"], date: "" })]
        expect(workload(ts, ["u-a", "u-b"], "2026-10-10")).toEqual(new Map([["u-a", 3], ["u-b", 2]]))
    })
    it("shows the assignment only to someone holding its class; flags drift and removal", () => {
        const s = space({ parent: { space: "webs00000001", item: "a1" } })
        const project = task({ id: "project", type: "project", date: "2026-10-15" })
        const a1 = task({ id: "a1", scope: "c:webs00000001", type: "assignment", title: "REST API Project", date: "2026-10-18" })
        const cls = { id: "webs00000001", name: "Web Services" }
        expect(assignmentOf(s, project, [a1], [cls])).toEqual({ state: "drift", label: "Web Services · REST API Project", date: "2026-10-18" })
        expect(assignmentOf(s, { ...project, date: "2026-10-18" }, [a1], [cls])).toMatchObject({ state: "same" })
        expect(assignmentOf(s, project, [], [cls])).toEqual({ state: "removed" })
        expect(assignmentOf(s, project, [{ ...a1, deletedAt: 5 } as SharedItem], [cls])).toEqual({ state: "removed" })
        expect(assignmentOf(s, project, [a1], [])).toEqual({ state: "none" })
        expect(assignmentOf(space(), project, [a1], [cls])).toEqual({ state: "none" })
    })
    it("never calls an undated assignment drift, and an archived class's assignment is removed", () => {
        const s = space({ parent: { space: "webs00000001", item: "a1" } })
        const project = task({ id: "project", type: "project", date: "2026-10-15" })
        const a1 = task({ id: "a1", scope: "c:webs00000001", type: "assignment", title: "REST API Project", date: "" })
        expect(assignmentOf(s, project, [a1], [{ id: "webs00000001", name: "Web Services" }])).toEqual({ state: "same", label: "Web Services · REST API Project", date: "" })
        expect(assignmentOf(s, project, [{ ...a1, date: "2026-10-18" }], [{ id: "webs00000001", name: "Web Services", archived: true }])).toEqual({ state: "removed" })
    })
    it("Use this date writes the assignment's date onto the project", async () => {
        const project = task({ id: "project", type: "project", date: "2026-10-15" })
        await takeAssignmentDate(project, "2026-10-18")
        expect(fake.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({ id: "project", date: "2026-10-18" }))
    })
    it("colours a project by its linked class when you hold it, else by your own pref", () => {
        const prefs = [{ spaceId: "webs00000001", color: "#e66" }, { spaceId: "fire00000001", color: "#36c" }] as Parameters<typeof projectColour>[1]
        expect(projectColour(space({ parent: { space: "webs00000001", item: "a1" } }), prefs, [{ id: "webs00000001" }])).toBe("#e66")
        expect(projectColour(space({ parent: { space: "gone00000001", item: "a1" } }), prefs)).toBe("#36c")
        expect(projectColour(space(), prefs)).toBe("#36c")
        expect(projectColour(space(), [])).toBeNull()
    })
    it("ignores the class's colour once you no longer hold the class", () => {
        const prefs = [{ spaceId: "webs00000001", color: "#e66" }, { spaceId: "fire00000001", color: "#36c" }] as Parameters<typeof projectColour>[1]
        const s = space({ parent: { space: "webs00000001", item: "a1" } })
        expect(projectColour(s, prefs, [])).toBe("#36c")
        expect(projectColour(s, prefs, [{ id: "webs00000001" }])).toBe("#e66")
    })
})

describe("team projects in the study pickers (Stage 9 plan, Decision 1)", () => {
    const P = "p:fire00000001"
    const course = { id: "bio", code: "BIO", name: "Biology", color: "#e66", instructor: "", term: "", archived: false, target: null, meetings: [] }
    it("gives each project you are in a course of your tasks there, keyed by the project's own row", () => {
        const lab = task({ id: "l1", scope: undefined, type: "lab", courseId: "bio" })
        const items = [lab, task({ id: P + "/t1", assignees: ["u-me"] }), task({ id: P + "/t2", assignees: ["*"] }), task({ id: P + "/t3", assignees: ["u-sam"] }),
            task({ id: P + "/project", type: "project", title: "Fire Response API" })]
        const out = withProjects([course], items, "u-me", [space({ name: "Fire Response API" }), space({ id: "webs00000001", scope: "c:webs00000001", kind: "class" })],
            [{ spaceId: "fire00000001", color: "#36c" }])
        expect(out.courses).toEqual([course, expect.objectContaining({ id: P + "/project", code: "Team", name: "Fire Response API", color: "#36c", archived: false })])
        expect(out.items.filter((i) => i.courseId === P + "/project").map((i) => i.id)).toEqual([P + "/t1", P + "/t2"])
        expect(out.items.find((i) => i.id === P + "/t3")?.courseId).toBeNull()
        expect(out.items[0]).toBe(lab)
    })
    it("leaves the lists themselves when you are in no project", () => {
        const courses = [course], items = [task({ id: "l1", courseId: "bio" })]
        const out = withProjects(courses, items, "u-me", [])
        expect(out.courses).toBe(courses)
        expect(out.items).toBe(items)
    })
})
