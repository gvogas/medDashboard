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
/* leave.ts's guards are the real ones; what else it imports is not needed here */
vi.mock("./marks", () => ({ ago: () => "" }))
vi.mock("./refs", () => ({ splitKey: () => ({}) }))

import { ApiError } from "@/core/api"

import {
    addTask, assigneeNames, canClaim, canEdit, canFinish, claim, leaveProject, link, linkable, makeProject, projectsShown, removeProject, setDone, tasksOf,
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
    })
    it("names who a task is with", () => {
        const s = space({ members: [{ userId: "u-x", name: "Alex", role: "editor" }] })
        expect(assigneeNames(task({ assignees: ["*"] }), s, "u-me")).toBe("Everyone")
        expect(assigneeNames(task({}), s, "u-me")).toBe("Nobody yet")
        expect(assigneeNames(task({ assignees: ["u-me", "u-x", "u-gone"] }), s, "u-me")).toBe("You, Alex, A former member")
    })
    it("shows projects to admins only (Decision 1)", () => {
        expect(projectsShown()).toBe(true)
        fake.data.profile = { id: "u-me", isAdmin: false }
        expect(projectsShown()).toBe(false)
        fake.data.profile = null
        expect(projectsShown()).toBe(false)
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
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ status: "done", completedAt: expect.any(Number) }))
        await setDone(task({ status: "done", completedAt: 5 }), false)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ status: "todo", completedAt: null }))
        await claim(task({}), "u-me", true)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ assignees: ["u-me"] }))
        await claim(task({ assignees: ["u-me", "u-x"] }), "u-me", false)
        expect(fake.saveShared).toHaveBeenLastCalledWith("shared_items", expect.objectContaining({ assignees: ["u-x"] }))
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
