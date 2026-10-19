import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The actions with the store, sync, the ui, the overlay, the class sheets and your marks as fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u1", isAdmin: true }, items: [] as unknown[], courses: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], removed_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[] },
    ui: { view: "week", search: "", types: {} as Record<string, boolean>, course: "all", anchor: "2026-10-06", bg: "med" },
    saveItem: vi.fn(async () => {}),
    openSheet: vi.fn(),
    openClass: vi.fn(),
    toggleClassTask: vi.fn(async () => {}),
}))
vi.mock("@/core/store", () => ({ data: fake.data, saveItem: fake.saveItem, subscribe: () => () => {}, item: () => null, course: () => null }))
vi.mock("@/core/sync", () => ({ status: { state: "idle", pending: 0, message: "" }, onStatus: () => {}, syncNow: vi.fn() }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn(), deleteLater: vi.fn(), deleteWithUndo: vi.fn() }))
vi.mock("@/data/overlay", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/data/overlay")>()), openSheet: fake.openSheet }))
vi.mock("@/data/classes", () => ({ openClass: fake.openClass, openJoin: vi.fn() }))
vi.mock("@/data/marks", () => ({ toggleClassTask: fake.toggleClassTask }))

import { newItemOn, openCourse, quickAddTask, toggleTask } from "./actions"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeEach(() => { fake.ui.course = "all" })
afterEach(() => { vi.clearAllMocks() })

describe("the views act on keys", () => {
    it("open a class's course as the class, and yours in the course sheet", () => {
        openCourse(WEB + "/web")
        expect(fake.openClass).toHaveBeenCalledWith(SID)
        openCourse("bio")
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "course", id: "bio" })
    })

    it("tick a class's task in your mark", async () => {
        await toggleTask(WEB + "/t1")
        expect(fake.toggleClassTask).toHaveBeenCalledWith(WEB + "/t1", undefined)
    })

    it("open a removed class task's card instead of ticking it: your layer on it is read-only", async () => {
        fake.data.removed_items = [{ scope: WEB, id: "t2", type: "task", title: "Read", courseId: "web", date: "2026-10-06", status: "todo", checklist: [], updatedBy: "u2", deletedAt: 5 }]
        fake.data.marks = [{ id: SID + ":t2", spaceId: SID, itemId: "t2", status: "done", grade: null, weight: null, notes: "", checklist: [], completedAt: 9, hidden: false }]
        await toggleTask(WEB + "/t2")
        expect(fake.toggleClassTask).not.toHaveBeenCalled()
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "item", id: WEB + "/t2" })
        fake.data.removed_items = []; fake.data.marks = []
    })

    it("file a new item under the class shown, or under your course", async () => {
        fake.ui.course = WEB + "/web"
        newItemOn("2026-10-06")
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "new-item", draft: expect.objectContaining({ courseId: null, classId: SID }) })
        await quickAddTask("Read ch. 4")
        expect(fake.saveItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Read ch. 4", courseId: null, classId: SID }))
        fake.ui.course = "bio"
        newItemOn("2026-10-06")
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "new-item", draft: expect.objectContaining({ courseId: "bio", classId: null }) })
    })
})
