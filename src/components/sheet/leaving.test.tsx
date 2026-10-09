import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The class sheet's Stage 5 controls (leave, archive, delete, the removed list, Remove in
// Members) with the store, the API, sync, the overlay and the toast as fakes, as in classes.test.tsx.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
        removed_items: [] as unknown[],
    },
    api: {
        spaces: {
            create: vi.fn(), get: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), setRole: vi.fn(), transfer: vi.fn(), makeCode: vi.fn(), dropCode: vi.fn(),
            leave: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), archive: vi.fn(async () => undefined),
            del: vi.fn(async () => undefined), keep: vi.fn(async () => undefined), share: vi.fn(async () => undefined),
        },
        invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
        join: vi.fn(),
    },
    store: { deleteMark: vi.fn(async () => undefined), restoreShared: vi.fn(async () => undefined) },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, ...fake.store }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("@/data/overlay", () => fake.overlay)
vi.mock("@/data/toast", () => ({ toast: fake.toast }))

import { ApiError } from "@/core/api"
import { ClassSheet } from "./class-sheet"

const SID = "sp0000000001", SCOPE = "c:" + SID
const space = (role = "owner") => ({
    id: SID, scope: SCOPE, kind: "class", role, name: "Web Services", archived: false, parent: null, revision: 9,
    members: [{ userId: "u-me", name: "George", role: "owner" }, { userId: "u-sam", name: "Sam", role: "member" }],
})
const course = { scope: SCOPE, id: "web", code: "CS 446", name: "Web Services", color: "#17B3AE", instructor: "Dr. Okafor", term: "Fall 2026", archived: false, target: null, meetings: [] }
const details = (role = "owner") => ({
    id: SID, scope: SCOPE, kind: "class", role, archived: false,
    members: [{ userId: "u-me", username: "george", name: "George", role: "owner", joinedAt: 1 }, { userId: "u-sam", username: "sam", name: "Sam", role: "member", joinedAt: 2 }],
    invites: [],
    code: null,
})
const pref = { id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 }
const removed = (id: string, title: string) => ({ scope: SCOPE, id, type: "lab", title, courseId: "web", date: "2026-10-09", updatedBy: "u-sam", deletedAt: 5 })
const mark = (itemId: string, patch: Record<string, unknown> = {}) => ({
    id: SID + ":" + itemId, spaceId: SID, itemId, status: "todo", grade: null, weight: null, notes: "", checklist: [], completedAt: null, hidden: false, ...patch,
})

beforeEach(() => {
    Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [], marks: [], space_prefs: [], removed_items: [] })
    fake.syncNow.mockImplementation(async () => true)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("leaving a class", () => {
    beforeEach(() => { fake.data.shared_courses = [course]; fake.data.space_prefs = [pref] })

    it("a member leaves, keeping a copy unless they untick it", async () => {
        fake.data.spaces = [space("member")]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.queryByRole("button", { name: "Archive the class" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Leave the class…" }))
        const keep = screen.getByRole<HTMLInputElement>("checkbox", { name: /Keep a copy/ })
        expect(keep.checked).toBe(true)
        fireEvent.click(keep)
        fireEvent.click(screen.getByRole("button", { name: "Leave Web Services" }))
        await waitFor(() => expect(fake.api.spaces.leave).toHaveBeenCalledWith(SID, false))
        expect(fake.toast).toHaveBeenCalledWith("You left Web Services.")
    })

    it("says why when leaving fails", async () => {
        fake.data.spaces = [space("editor")]
        fake.api.spaces.leave.mockRejectedValueOnce(new ApiError(403, { error: "owner" }))
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Leave the class…" }))
        fireEvent.click(screen.getByRole("button", { name: "Leave Web Services" }))
        expect(await screen.findByText(/the owner can't leave/)).toBeTruthy()
    })

    it("the owner archives, and is told to hand on before leaving; delete waits until they are alone", async () => {
        fake.data.spaces = [space("owner")]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.queryByRole("button", { name: "Leave the class…" })).toBeNull()
        expect(screen.getByText(/Hand the class on in Members to leave it/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Delete the class…" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Archive the class" }))
        await waitFor(() => expect(fake.api.spaces.archive).toHaveBeenCalledWith(SID, true))
    })

    it("an archived class says so, and its owner unarchives it", async () => {
        fake.data.spaces = [{ ...space("owner"), archived: true, members: [{ userId: "u-me", name: "George", role: "owner" }] }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/Archived: read-only for everyone/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Archive the class" })).toBeNull()
        expect(screen.queryByText(/Archiving makes it read-only/)).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Unarchive" }))
        await waitFor(() => expect(fake.api.spaces.archive).toHaveBeenCalledWith(SID, false))
    })

    it("a member sees the archived banner without Unarchive", () => {
        fake.data.spaces = [{ ...space("member"), archived: true }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/Archived: read-only for everyone/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull()
    })

    it("the owner alone deletes it, with a copy by default", async () => {
        fake.data.spaces = [{ ...space("owner"), members: [{ userId: "u-me", name: "George", role: "owner" }] }]
        render(<ClassSheet spaceId={SID} tab="details" />)
        fireEvent.click(screen.getByRole("button", { name: "Delete the class…" }))
        expect(screen.getByRole<HTMLInputElement>("checkbox", { name: /Keep a copy/ }).checked).toBe(true)
        fireEvent.click(screen.getByRole("button", { name: "Delete Web Services" }))
        await waitFor(() => expect(fake.api.spaces.del).toHaveBeenCalledWith(SID, true))
    })

    it("lists removed items: Keep and Dismiss for yours, Restore for editors", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.removed_items = [removed("a1", "Lab 3")]
        fake.data.marks = [mark("a1", { grade: 80 })]
        render(<ClassSheet spaceId={SID} tab="details" />)
        const list = screen.getByRole("list", { name: "Removed from the class" })
        expect(within(list).getByText(/by Sam/)).toBeTruthy()
        fireEvent.click(within(list).getByRole("button", { name: "Restore Lab 3" }))
        await waitFor(() => expect(fake.store.restoreShared).toHaveBeenCalledWith(SCOPE, "a1"))
        fireEvent.click(within(list).getByRole("button", { name: "Keep Lab 3 as mine" }))
        await waitFor(() => expect(fake.api.spaces.keep).toHaveBeenCalledWith(SID, "a1"))
        fireEvent.click(within(list).getByRole("button", { name: "Dismiss Lab 3" }))
        await waitFor(() => expect(fake.store.deleteMark).toHaveBeenCalledWith(SID + ":a1"))
    })

    it("Keep and Dismiss in the list leave the class sheet open, and a second click waits for the first", async () => {
        fake.data.spaces = [space("member")]
        fake.data.removed_items = [removed("a1", "Lab 3")]
        fake.data.marks = [mark("a1", { grade: 80 })]
        let done = () => {}
        fake.api.spaces.keep.mockImplementationOnce(() => new Promise<undefined>((r) => { done = () => r(undefined) }))
        render(<ClassSheet spaceId={SID} tab="details" />)
        const list = within(screen.getByRole("list", { name: "Removed from the class" }))
        const keep = list.getByRole("button", { name: "Keep Lab 3 as mine" })
        fireEvent.click(keep)
        fireEvent.click(keep)
        expect(fake.api.spaces.keep).toHaveBeenCalledTimes(1)
        expect(list.getByRole<HTMLButtonElement>("button", { name: "Dismiss Lab 3" }).disabled).toBe(true)
        done()
        await waitFor(() => expect((keep as HTMLButtonElement).disabled).toBe(false))
        fireEvent.click(list.getByRole("button", { name: "Dismiss Lab 3" }))
        await waitFor(() => expect(fake.store.deleteMark).toHaveBeenCalledWith(SID + ":a1"))
        expect(fake.overlay.closeSheet).not.toHaveBeenCalled()
    })

    it("a member sees only the removed items they hold something on, hidden or not, and no Restore", () => {
        fake.data.spaces = [space("member")]
        fake.data.removed_items = [removed("a1", "Lab 3"), removed("a2", "Lab 4"), removed("a3", "Lab 5"), removed("a4", "Lab 6")]
        fake.data.marks = [mark("a1", { notes: "mine" }), mark("a2"), mark("a3", { grade: 90, hidden: true })]
        render(<ClassSheet spaceId={SID} tab="details" />)
        const list = within(screen.getByRole("list", { name: "Removed from the class" }))
        expect(list.getAllByRole("listitem").map((li) => li.firstChild?.firstChild?.textContent)).toEqual(["Lab 3", "Lab 5"])
        expect(list.queryByRole("button", { name: "Restore Lab 3" })).toBeNull()
        expect(list.getByRole("button", { name: "Keep Lab 5 as mine" })).toBeTruthy()
    })

    it("shows no removed list when nothing of yours was removed", () => {
        fake.data.spaces = [space("member")]
        fake.data.removed_items = [removed("a1", "Lab 3")]
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.queryByRole("list", { name: "Removed from the class" })).toBeNull()
    })
})

describe("removing a member", () => {
    it("the owner removes someone after a confirm", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.api.spaces.get.mockResolvedValue(details("owner"))
        render(<ClassSheet spaceId={SID} tab="members" />)
        expect(await screen.findByRole("button", { name: "Remove Sam" })).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Remove George" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Remove Sam" }))
        expect(screen.getByText(/They keep a copy of the class/)).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Remove Sam from the class" }))
        await waitFor(() => expect(fake.api.spaces.remove).toHaveBeenCalledWith(SID, "u-sam"))
        await waitFor(() => expect(fake.api.spaces.get).toHaveBeenCalledTimes(2))
    })

    it("a second click on Remove waits for the first", async () => {
        fake.data.spaces = [space("owner")]
        fake.data.shared_courses = [course]
        fake.api.spaces.get.mockResolvedValue(details("owner"))
        let done = () => {}
        fake.api.spaces.remove.mockImplementationOnce(() => new Promise<undefined>((r) => { done = () => r(undefined) }))
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.click(await screen.findByRole("button", { name: "Remove Sam" }))
        const confirm = screen.getByRole("button", { name: "Remove Sam from the class" })
        fireEvent.click(confirm)
        fireEvent.click(confirm)
        expect(fake.api.spaces.remove).toHaveBeenCalledTimes(1)
        done()
        await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Sam from the class" })).toBeNull())
    })

    it("a member removes nobody", async () => {
        fake.data.spaces = [space("member")]
        fake.data.shared_courses = [course]
        fake.api.spaces.get.mockResolvedValue(details("member"))
        render(<ClassSheet spaceId={SID} tab="members" />)
        expect(await screen.findByText("Sam")).toBeTruthy()
        expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull()
    })
})
