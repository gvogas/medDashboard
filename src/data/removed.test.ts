import { afterEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me", isAdmin: true }, items: [], courses: [], shared_items: [], removed_items: [] as unknown[], shared_courses: [], marks: [] as unknown[], space_prefs: [], spaces: [] as unknown[] },
    api: { spaces: { leave: vi.fn(async () => undefined), keep: vi.fn(async () => undefined), share: vi.fn(async () => ({ shared: 1 })), del: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) } },
    store: { deleteMark: vi.fn(async () => undefined), restoreShared: vi.fn(async () => undefined), pendingCount: vi.fn(() => 0) },
    syncNow: vi.fn(async () => true),
    closeSheet: vi.fn(), toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, ...fake.store }))
vi.mock("@/core/api", () => ({
    api: fake.api,
    ApiError: class extends Error { status: number; body: unknown; constructor(status: number, body: unknown) { super(); this.status = status; this.body = body } },
}))
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => ({ closeSheet: fake.closeSheet, openSheet: vi.fn() }))
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { normalizeItem } from "@/core/model"
import { meaningful, mergeItems } from "./effective"
import { ApiError } from "@/core/api"
import { canShareItem, deleteClass, dismissItem, keepItem, leaveClass, removeMember, removedLine, restoreItem, shareItem } from "./leave"
import { leftClass } from "./refs"
import type { Mark } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
const row = { ...normalizeItem({ id: "a1", type: "lab", title: "Lab 3", date: "2026-10-09", courseId: "web" }), scope: WEB, updatedBy: "u-alex", assignees: [], completedBy: null, deletedAt: 1000 }
const mark = (over: Partial<Mark> = {}) => ({ id: SID + ":a1", spaceId: SID, itemId: "a1", status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...over }) as Mark
afterEach(() => vi.clearAllMocks())

describe("removed class items", () => {
    it("stay in the views while your mark holds something, marked removed", () => {
        expect(meaningful(mark())).toBe(false)
        expect(meaningful(mark({ grade: 80 }))).toBe(true)
        const out = mergeItems([], [], { marks: new Map([[SID + ":a1", mark({ grade: 80 })]]), removed: [row] })
        expect(out.map((it) => [it.key, it.grade, it.removed])).toEqual([[WEB + "/a1", 80, { by: "u-alex", at: 1000 }]])
        expect(mergeItems([], [], { marks: new Map([[SID + ":a1", mark({ hidden: true, grade: 80 })]]), removed: [row] })).toEqual([])
        expect(mergeItems([], [], { marks: new Map(), removed: [row] })).toEqual([])
        /* a tombstone holding nothing of yours leaves your own list as it is, the same array */
        const own = [normalizeItem({ id: "b1", type: "lab", title: "Mine", date: "2026-10-09" })]
        expect(mergeItems(own, [], { marks: new Map(), removed: [row] })).toBe(own)
    })

    it("say who removed them, and from where", () => {
        const space = { members: [{ userId: "u-alex", name: "Alex", role: "editor" }] }
        expect(removedLine(row, space, "Web Services", "u-me", 1000 + 2 * 3600e3)).toBe("Removed from Web Services by Alex · 2h ago")
        expect(removedLine({ ...row, updatedBy: "u-me" }, space, "Web Services", "u-me", 1000)).toBe("Removed from Web Services by you · just now")
    })

    it("Keep, Dismiss and Restore call the server or the store, then sync", async () => {
        await keepItem(WEB + "/a1")
        expect(fake.api.spaces.keep).toHaveBeenCalledWith(SID, "a1")
        await dismissItem(WEB + "/a1")
        expect(fake.store.deleteMark).toHaveBeenCalledWith(SID + ":a1")
        await restoreItem(WEB + "/a1")
        expect(fake.store.restoreShared).toHaveBeenCalledWith(WEB, "a1")
        expect(fake.syncNow).toHaveBeenCalled()
    })
})

describe("leaving", () => {
    it("syncs first, leaves, closes the sheet and says where the copy is", async () => {
        await leaveClass(SID, true, "Web Services")
        expect(fake.syncNow.mock.invocationCallOrder[0]).toBeLessThan(fake.api.spaces.leave.mock.invocationCallOrder[0])
        expect(fake.api.spaces.leave).toHaveBeenCalledWith(SID, true)
        expect(fake.closeSheet).toHaveBeenCalled()
        expect(fake.toast).toHaveBeenCalledWith("You left Web Services. Your copy is in your courses.")
    })

    it("syncs again first when an edit saved after the running sync began is still waiting", async () => {
        /* syncNow hands back a cycle already running, which may have uploaded before the edit was saved */
        for (const [call, server] of [[() => leaveClass(SID, true, "Web Services"), fake.api.spaces.leave],
            [() => deleteClass(SID, true, "Web Services"), fake.api.spaces.del], [() => shareItem("x1", SID, "Web Services"), fake.api.spaces.share]] as const) {
            vi.clearAllMocks()
            fake.store.pendingCount.mockReturnValueOnce(1)
            await call()
            expect(fake.syncNow.mock.invocationCallOrder[1]).toBeLessThan(server.mock.invocationCallOrder[0])
            expect(fake.syncNow).toHaveBeenCalledTimes(3)
        }
        /* nothing waiting: one sync before the call, as before */
        vi.clearAllMocks()
        await leaveClass(SID, true, "Web Services")
        expect(fake.syncNow).toHaveBeenCalledTimes(2)
        /* still waiting after the second (offline, refused): it goes ahead; an edit refused later lands in Saved copies */
        vi.clearAllMocks()
        fake.store.pendingCount.mockReturnValue(1)
        await leaveClass(SID, true, "Web Services")
        expect(fake.syncNow).toHaveBeenCalledTimes(3)
        expect(fake.api.spaces.leave).toHaveBeenCalled()
        fake.store.pendingCount.mockReturnValue(0)
    })

    it("a call answered not found is done when a sync shows it done (a retry after a lost answer), else says the class changed", async () => {
        const notFound = () => new ApiError(404, { error: "not_found" })
        const space = { id: SID, scope: WEB, kind: "class", members: [{ userId: "u-sam", name: "Sam", role: "member" }] }
        /* gone from this device after the sync: done, as if it had answered */
        fake.data.spaces = []
        fake.data.marks = []
        fake.api.spaces.leave.mockRejectedValueOnce(notFound())
        await leaveClass(SID, true, "Web Services")
        expect(fake.toast).toHaveBeenCalledWith("You left Web Services. Your copy is in your courses.")
        fake.api.spaces.del.mockRejectedValueOnce(notFound())
        await deleteClass(SID, false, "Web Services")
        expect(fake.toast).toHaveBeenCalledWith("Web Services is deleted.")
        fake.api.spaces.keep.mockRejectedValueOnce(notFound())
        await keepItem(WEB + "/a1")
        fake.data.spaces = [{ ...space, members: [] }]
        fake.api.spaces.remove.mockRejectedValueOnce(notFound())
        await removeMember(SID, "u-sam")
        /* still here after the sync: not done */
        vi.clearAllMocks()
        fake.data.spaces = [space]
        fake.data.marks = [mark({ grade: 80 })]
        const changed = { status: 404, body: { error: "changed" } }
        fake.api.spaces.leave.mockRejectedValueOnce(notFound())
        await expect(leaveClass(SID, true, "Web Services")).rejects.toMatchObject(changed)
        fake.api.spaces.keep.mockRejectedValueOnce(notFound())
        await expect(keepItem(WEB + "/a1")).rejects.toMatchObject(changed)
        fake.api.spaces.remove.mockRejectedValueOnce(notFound())
        await expect(removeMember(SID, "u-sam")).rejects.toMatchObject(changed)
        expect(fake.closeSheet).not.toHaveBeenCalled()
        expect(fake.toast).not.toHaveBeenCalled()
        /* any other refusal is as it came */
        fake.api.spaces.leave.mockRejectedValueOnce(new ApiError(403, { error: "owner" }))
        await expect(leaveClass(SID, true, "Web Services")).rejects.toMatchObject({ body: { error: "owner" } })
        fake.data.spaces = []
        fake.data.marks = []
    })

    it("knows a class you left, and what you may share", () => {
        fake.data.spaces = []
        expect(leftClass(WEB + "/web")).toBe(true)
        expect(leftClass("web")).toBe(false)
        const space = { id: SID, kind: "class" as const, role: "editor" as const, archived: false }
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, space)).toBe(true)
        expect(canShareItem({ id: "x1", type: "c-essay", classId: SID }, space)).toBe(false)
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, { ...space, role: "member" })).toBe(false)
        expect(canShareItem({ id: "x1", type: "lab", classId: SID }, { ...space, archived: true })).toBe(false)
    })
})
