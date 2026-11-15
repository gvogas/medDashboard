import "fake-indexeddb/auto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// The course sheet is a draft until Save, and the stored course can change while it is open:
// a sync brings another editor's change to a class, or settles this device's last upload.
// Save must put only what the person changed onto the course as it is stored now. On the real
// store (core/store.ts on fake-indexeddb); only the actions module, whose Delete the tests
// never press, is a fake.
vi.mock("@/data/actions", () => ({ deleteCourse: vi.fn(), setSchedule: vi.fn(), openCourse: vi.fn() }))

import * as store from "@/core/store"
import { changedFields } from "@/core/shared"
import { closeSheet, getSheet, openSheet } from "@/data/overlay"
import { CourseSheet } from "./course-sheet"

const profile = { id: "u-rebase-" + Math.random().toString(36).slice(2, 8), username: "rebase", revision: 1, coat: {} }

beforeAll(async () => { await store.open(profile) })
afterEach(() => { cleanup(); closeSheet() })
afterAll(async () => { await store.close() })

describe("the course sheet saves onto the course as it is stored now", () => {
    it("a course of yours: an edit made while its last save uploads goes out at the new revision", async () => {
        /* a new course, saved: it waits to upload at revision 0 */
        await store.saveCourse({ id: "bio1", code: "BIO", name: "Biology", meetings: [] })
        const [first] = await store.pending()
        expect(first.key).toBe("courses:bio1")
        expect(first.revision).toBe(0)

        /* the person opens the course again straight away (to add its classes) */
        openSheet({ kind: "course", id: "bio1" })
        render(<CourseSheet id="bio1" />)
        expect((screen.getByLabelText("Course name") as HTMLTextAreaElement).value).toBe("Biology")

        /* meanwhile sync uploads the first save: the server answers revision 7 */
        await act(async () => { await store.settleOperation(first, { ...first.body!, id: "bio1", revision: 7 }) })
        expect(store.course("bio1")!.revision).toBe(7)
        expect(await store.pending()).toEqual([])

        /* they finish the edit and press Save */
        fireEvent.change(screen.getByLabelText("Teacher"), { target: { value: "Dr. Alvarez" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save course" })) })
        await waitFor(() => expect(getSheet()).toBeNull())

        const [second] = await store.pending()
        expect(second.key).toBe("courses:bio1")
        expect((second.body as unknown as { instructor: string }).instructor).toBe("Dr. Alvarez")
        /* at revision 0 the Worker would answer 409, and the edit would land in Saved copies */
        expect(second.revision).toBe(7)
    })

    it("a class's course: Save names only the fields the person changed, so another editor's change stays", async () => {
        const scope = "c:abcdefghijkl", key = scope + "/web1"
        const mtg = (id: string, weekday: number) => ({ id, kind: "Lecture", weekday, start: "09:00", end: "10:00", room: "" })
        const row = { id: "web1", code: "WEB", name: "Web", color: "#E4749B", instructor: "", term: "", archived: false, target: null, meetings: [mtg("m1", 1)], revision: 3, updatedAt: 1, updatedBy: "other" }
        await store.applyPage({ changes: [{ scope, kind: "courses", row }], cursors: {} })

        openSheet({ kind: "course", id: key })
        render(<CourseSheet id={key} />)
        expect((screen.getByLabelText("Course name") as HTMLTextAreaElement).value).toBe("Web")

        /* another editor moves the class to Tuesday; a sync brings it while the sheet is open */
        await act(async () => { await store.applyPage({ changes: [{ scope, kind: "courses", row: { ...row, meetings: [mtg("m1", 2)], revision: 4, updatedAt: 2 } }], cursors: {} }) })
        expect(store.data.shared_courses[0].meetings[0].weekday).toBe(2)

        /* this person only names the teacher, and saves */
        fireEvent.change(screen.getByLabelText("Teacher"), { target: { value: "Dr. Alvarez" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save course" })) })
        await waitFor(() => expect(getSheet()).toBeNull())

        const op = (await store.pending()).find((o) => o.key === "shared_courses:" + scope + ":web1")!
        expect(op).toBeTruthy()
        /* what sync sends as `changed`: {field: value before}. Naming meetings too would put Monday back for everyone */
        expect(Object.keys(changedFields("shared_courses", scope, op.body!, op.base))).toEqual(["instructor"])
        expect(store.data.shared_courses[0].meetings[0].weekday).toBe(2)
        expect(store.data.shared_courses[0].instructor).toBe("Dr. Alvarez")
    })

    it("a change the person did make still wins over the stored value", async () => {
        const scope = "c:abcdefghijkm", key = scope + "/web2"
        const mtg = (id: string, weekday: number) => ({ id, kind: "Lecture", weekday, start: "09:00", end: "10:00", room: "" })
        const row = { id: "web2", code: "WEB", name: "Web two", color: "#E4749B", instructor: "", term: "", archived: false, target: null, meetings: [mtg("m1", 1)], revision: 3, updatedAt: 1, updatedBy: "other" }
        await store.applyPage({ changes: [{ scope, kind: "courses", row }], cursors: {} })
        openSheet({ kind: "course", id: key })
        render(<CourseSheet id={key} />)
        fireEvent.change(screen.getByLabelText("Day"), { target: { value: "3" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save course" })) })
        await waitFor(() => expect(getSheet()).toBeNull())
        const saved = store.data.shared_courses.find((c) => c.id === "web2")!
        expect(saved.meetings[0].weekday).toBe(3)
        const op = (await store.pending()).find((o) => o.key === "shared_courses:" + scope + ":web2")!
        expect(Object.keys(changedFields("shared_courses", scope, op.body!, op.base))).toEqual(["meetings"])
    })
})
