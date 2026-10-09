import { afterEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me", isAdmin: true }, items: [], courses: [], shared_items: [], removed_items: [] as unknown[], shared_courses: [], marks: [] as unknown[], space_prefs: [], spaces: [] as unknown[] },
    api: { spaces: { leave: vi.fn(async () => undefined), keep: vi.fn(async () => undefined), share: vi.fn(async () => ({ shared: 1 })) } },
    store: { deleteMark: vi.fn(async () => undefined), restoreShared: vi.fn(async () => undefined) },
    syncNow: vi.fn(async () => true),
    closeSheet: vi.fn(), toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, ...fake.store }))
vi.mock("@/core/api", () => ({ api: fake.api, ApiError: class extends Error {} }))
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => ({ closeSheet: fake.closeSheet, openSheet: vi.fn() }))
vi.mock("@/data/toast", () => ({ toast: fake.toast }))
vi.mock("@/data/query", () => ({ schoolCal: () => null }))

import { normalizeItem } from "@/core/model"
import { meaningful, mergeItems } from "./effective"
import { canShareItem, dismissItem, keepItem, leaveClass, removedLine, restoreItem } from "./leave"
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
        const out = mergeItems([], [], true, { marks: new Map([[SID + ":a1", mark({ grade: 80 })]]), removed: [row] })
        expect(out.map((it) => [it.key, it.grade, it.removed])).toEqual([[WEB + "/a1", 80, { by: "u-alex", at: 1000 }]])
        expect(mergeItems([], [], true, { marks: new Map([[SID + ":a1", mark({ hidden: true, grade: 80 })]]), removed: [row] })).toEqual([])
        expect(mergeItems([], [], true, { marks: new Map(), removed: [row] })).toEqual([])
        /* a tombstone holding nothing of yours leaves your own list as it is, the same array */
        const own = [normalizeItem({ id: "b1", type: "lab", title: "Mine", date: "2026-10-09" })]
        expect(mergeItems(own, [], true, { marks: new Map(), removed: [row] })).toBe(own)
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
