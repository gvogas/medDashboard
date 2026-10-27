import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// Joining, merging, the class sheet's Details and the class's shared details, with the store,
// the API, sync, the overlay and the toast as fakes; the effective lists, the class and merge
// rules and the marks are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown>,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    store: { saveSpacePref: vi.fn(async () => {}), saveMark: vi.fn(async () => {}), saveShared: vi.fn(async () => {}), saveCourse: vi.fn(async () => {}) },
    api: { spaces: { absorb: vi.fn(async () => ({ paired: 1, filed: 1 })), get: vi.fn(async () => ({ schoolCalendar: null })) }, invites: { list: vi.fn(async () => ({ invites: [] })) }, join: vi.fn() },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn(), onRequestClose: vi.fn(), beforeSheetClose: new Set<() => void>() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, ...fake.store, subscribe: () => () => {} }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow, status: { state: "idle", pending: 0, message: "" }, onStatus: () => {} }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ TOAST_MS: 6000, TOAST_LONG_MS: 8000, toast: fake.toast }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn(), deleteLater: vi.fn(), deleteWithUndo: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn() }))
vi.mock("@/data/actions", () => ({ deleteCourse: vi.fn(), openCourse: vi.fn() }))

import { JoinSheet } from "./join-sheet"
import { MergeSheet } from "./merge-sheet"
import { ClassSheet } from "./class-sheet"
import { CourseSheet } from "./course-sheet"
import { ShareCourse } from "./share-course"

const SID = "sp0000000001", WEB = "c:" + SID
const space = (role = "member") => ({
    id: SID, scope: WEB, kind: "class", role, archived: false, name: "Web Services", parent: null, revision: 3,
    members: [{ userId: "u-me", name: "George", role }, { userId: "u-gab", name: "Gabriel", role: "owner" }],
})
const course = { scope: WEB, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "Dr. Okafor", term: "", archived: false, target: null, meetings: [], updatedBy: null }
const pref = () => ({ id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 })
const summary = { id: SID, scope: WEB, kind: "class" as const, name: "Web Services", role: "member" as const, members: 2 }

beforeEach(() => {
    Object.assign(fake.data, { courses: [], items: [], spaces: [space()], shared_courses: [course], shared_items: [], marks: [], space_prefs: [pref()] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("joining: your colour and semester", () => {
    it("saves your colour, then opens the class", async () => {
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Coral" }))
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" }))
        expect(fake.store.saveSpacePref).toHaveBeenCalledWith(expect.objectContaining({ id: SID, color: "#F08A6C" }))
    })

    it("goes on to the merge sheet when a course of yours matches the class", async () => {
        fake.data.courses = [{ id: "mine", code: "CS446", name: "My web course", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<JoinSheet code="" space={summary} />)
        fireEvent.click(await screen.findByRole("button", { name: "Merge my course" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "mine", fromCourse: false }))
        expect(fake.store.saveSpacePref).not.toHaveBeenCalled()
    })
})

describe("the merge sheet", () => {
    beforeEach(() => {
        fake.data.courses = [{ id: "mydb", code: "CS 446", name: "Web (mine)", color: "#B8457E", archived: false, meetings: [], term: "" }]
        fake.data.items = [
            { id: "x1", type: "quiz", title: "Quiz 1", courseId: "mydb", date: "2026-10-01", status: "graded", grade: 88, weight: 10, notes: "", checklist: [], links: [] },
            { id: "x2", type: "exam", title: "Midterm", courseId: "mydb", date: "2026-10-14", status: "todo", grade: null, weight: 30, notes: "", checklist: [], links: [] },
            { id: "x3", type: "c-viva", title: "Viva", courseId: "mydb", date: "2026-10-20", status: "todo", grade: null, weight: null, notes: "", checklist: [], links: [] },
        ]
        fake.data.shared_items = [
            { scope: WEB, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", status: "todo", grade: null, weight: 10, notes: "", checklist: [], links: [] },
            { scope: WEB, id: "e1", type: "exam", title: "Midterm", courseId: "web", date: "2026-10-15", status: "todo", grade: null, weight: 30, notes: "", checklist: [], links: [] },
        ]
    })

    it("pairs, lets you undo a pair, and merges what is left paired", async () => {
        render(<MergeSheet spaceId={SID} courseId="mydb" fromCourse={false} />)
        expect(within(screen.getByRole("list", { name: "Pairs" })).getAllByRole("listitem")).toHaveLength(2)
        expect(within(screen.getByRole("list", { name: "Stay yours" })).getByText(/^Viva/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Not the same item: Midterm" }))
        expect(within(screen.getByRole("list", { name: "Stay yours" })).getByText(/^Midterm/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Merge" }))
        await waitFor(() => expect(fake.api.spaces.absorb).toHaveBeenCalledWith(SID, { courseId: "mydb", pairs: [["x1", "q1"]], fromCourse: false }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" }))
    })

    it("Skip closes it and merges nothing", () => {
        render(<MergeSheet spaceId={SID} courseId="mydb" fromCourse={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Skip" }))
        expect(fake.overlay.closeSheet).toHaveBeenCalled()
        expect(fake.api.spaces.absorb).not.toHaveBeenCalled()
    })
})

describe("the class sheet's Details", () => {
    beforeEach(() => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_items = [
            { scope: WEB, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", status: "todo", grade: null, weight: 20, notes: "", checklist: [], links: [] },
            { scope: WEB, id: "h1", type: "quiz", title: "Pop quiz", courseId: "web", date: "2026-10-02", status: "todo", grade: null, weight: 10, notes: "", checklist: [], links: [] },
        ]
        fake.data.marks = [
            { id: SID + ":a1", spaceId: SID, itemId: "a1", status: "graded", grade: 80, weight: null, notes: "", checklist: [], completedAt: 1, hidden: false },
            { id: SID + ":h1", spaceId: SID, itemId: "h1", status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: true },
        ]
    })

    it("shows your colour, your grade so far, and what you hid, to show again", async () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByRole("heading", { name: /^Your grade so far/ })).toBeTruthy()
        expect(within(screen.getByRole("list", { name: "Class items" })).queryByText("Pop quiz")).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Royal blue" }))
        await waitFor(() => expect(fake.store.saveSpacePref).toHaveBeenCalledWith(expect.objectContaining({ id: SID, color: "#4F74D9" })))
        fireEvent.click(screen.getByRole("button", { name: "Show Pop quiz again" }))
        await waitFor(() => expect(fake.store.saveMark).toHaveBeenCalledWith(expect.objectContaining({ id: SID + ":h1", hidden: false })))
    })

    it("opens an item in its card, and the class's details for its owner", () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "REST API Project" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "item", id: WEB + "/a1" })
        fireEvent.click(screen.getByRole("button", { name: "Edit class details" }))
        expect(fake.overlay.openSheet).toHaveBeenLastCalledWith({ kind: "course", id: WEB + "/web" })
    })

    it("offers to merge a course of yours like the class", () => {
        fake.data.courses = [{ id: "web", code: "CS 446", name: "Web (my copy)", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Merge…" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "web", fromCourse: true })
    })
})

describe("the class's details in the course sheet", () => {
    it("are its shared facts, saved for everyone; no grades, archive or delete", async () => {
        fake.data.spaces = [space("editor")]
        render(<CourseSheet id={WEB + "/web"} />)
        expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
        expect(screen.queryByText(/hidden from the sidebar/)).toBeNull()
        fireEvent.change(screen.getByRole("textbox", { name: "Teacher" }), { target: { value: "Dr. Lin" } })
        fireEvent.click(screen.getByRole("button", { name: "Save course" }))
        await waitFor(() => expect(fake.store.saveShared).toHaveBeenCalledWith("shared_courses", expect.objectContaining({ scope: WEB, id: "web", instructor: "Dr. Lin", target: null, archived: false })))
        expect(fake.store.saveCourse).not.toHaveBeenCalled()
    })
})

describe("Share this course, with a class like it", () => {
    it("offers merging the course into the class", () => {
        fake.data.spaces = [space("owner")]
        fake.data.courses = [{ id: "web", code: "CS 446", name: "Web", color: "#B8457E", archived: false, meetings: [], term: "" }]
        render(<ShareCourse courseId="web" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Merge into the class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "merge", spaceId: SID, courseId: "web", fromCourse: true })
    })
})
