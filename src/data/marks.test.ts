import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true }, items: [] as unknown[], courses: [] as unknown[],
        shared_items: [] as unknown[], shared_courses: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[], spaces: [] as unknown[],
    },
    store: { saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), saveItem: vi.fn(async () => {}) },
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))

import { addToClass, ago, canAddToClass, editedBy, editMark, flushTyping, hiddenIn, hideAsks, markStatus, typeMark } from "./marks"
import type { Item } from "./types"

const SID = "abcdefghij12", WEB = "c:" + SID
beforeEach(() => {
    fake.data.spaces = [{ id: SID, scope: WEB, kind: "class", role: "editor", archived: false, members: [{ userId: "u-gab", name: "Gabriel", role: "owner" }] }]
    fake.data.shared_courses = [{ scope: WEB, id: "web" }]
    fake.data.shared_items = [{ scope: WEB, id: "a1", title: "REST API", courseId: "web" }, { scope: WEB, id: "h1", title: "Hidden", courseId: "web" }]
    fake.data.marks = [{ id: SID + ":h1", spaceId: SID, itemId: "h1", hidden: true, notes: "" }]
})
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe("your mark", () => {
    it("is made on first touch, with text still waiting saved along", async () => {
        vi.useFakeTimers()
        typeMark(WEB + "/a1", { notes: "Teams of 3" })
        await editMark(WEB + "/a1", { status: "done" })
        expect(fake.store.saveMark).toHaveBeenCalledWith({ id: SID + ":a1", spaceId: SID, itemId: "a1", notes: "Teams of 3", status: "done" })
        await vi.runAllTimersAsync()
        expect(fake.store.saveMark).toHaveBeenCalledTimes(1)
    })

    it("saves typing once it pauses, or when the card closes", async () => {
        vi.useFakeTimers()
        typeMark(WEB + "/h1", { notes: "a" })
        typeMark(WEB + "/h1", { notes: "ab" })
        expect(fake.store.saveMark).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(500)
        expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":h1", notes: "ab", hidden: true }))
        typeMark(WEB + "/h1", { notes: "abc" })
        await flushTyping()
        expect(fake.store.saveMark).toHaveBeenCalledTimes(2)
    })

    it("keeps when it was finished, and asks before hiding a grade", () => {
        expect(markStatus({ completedAt: 5 }, "done")).toEqual({ status: "done", completedAt: 5 })
        expect(markStatus({ completedAt: 5 }, "todo")).toEqual({ status: "todo", completedAt: null })
        expect(hideAsks({ grade: 87, status: "graded" })).toBe(true)
        expect(hideAsks({ grade: null, status: "graded" })).toBe(true)
        expect(hideAsks({ grade: null, status: "done" })).toBe(false)
        expect(hideAsks(null)).toBe(false)
    })

    it("lists what you hid in a class", () => {
        expect(hiddenIn(WEB).map((it) => it.id)).toEqual(["h1"])
    })
})

describe("who changed it", () => {
    it("is named, with how long ago", () => {
        const now = Date.UTC(2026, 9, 6, 12), space = { members: [{ userId: "u-gab", name: "Gabriel", role: "owner" }] }
        expect([ago(now - 30_000, now), ago(now - 5 * 60_000, now), ago(now - 2 * 3_600_000, now), ago(now - 26 * 3_600_000, now), ago(now - 3 * 86_400_000, now)])
            .toEqual(["just now", "5 min ago", "2h ago", "yesterday", "3 days ago"])
        expect(editedBy({ updatedBy: "u-gab", updatedAt: now - 2 * 3_600_000 }, space, "u-me", now)).toBe("Edited by Gabriel · 2h ago")
        expect(editedBy({ updatedBy: "u-me", updatedAt: now }, space, "u-me", now)).toBe("Edited by you · just now")
        expect(editedBy({ updatedBy: "u-gone", updatedAt: null }, space, "u-me", now)).toBe("Edited by a former member")
        expect(editedBy({ updatedBy: null, updatedAt: now }, space, "u-me", now)).toBe("")
    })
})

describe("a new item with a class picked", () => {
    it("can go into the class for its owner or an editor, built-in types only", () => {
        expect(canAddToClass({ type: "quiz", classId: SID })).toBe(true)
        expect(canAddToClass({ type: "c-viva", classId: SID })).toBe(false)
        expect(canAddToClass({ type: "quiz", classId: null })).toBe(false)
        ;(fake.data.spaces[0] as { role: string }).role = "member"
        expect(canAddToClass({ type: "quiz", classId: SID })).toBe(false)
    })

    it("becomes the class's row under its one course, with nothing of yours on it", async () => {
        await addToClass({ id: "n1", type: "quiz", title: "Quiz 2", courseId: null, classId: SID, status: "done", grade: 90, checklist: [{ id: "k", text: "x", done: true }], completedAt: 5 } as Item)
        expect(fake.store.saveShared).toHaveBeenCalledWith("shared_items", expect.objectContaining({
            scope: WEB, id: "n1", courseId: "web", classId: null, status: "todo", grade: null, checklist: [], completedAt: null,
        }))
    })
})
