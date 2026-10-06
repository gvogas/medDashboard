import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The class sheets with the store, the API, sync, the overlay and the toast as fakes; the
// hooks over the store (data/store.ts) and the class rules (data/classes.ts) are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[],
    },
    api: {
        spaces: { create: vi.fn(), get: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), setRole: vi.fn(), transfer: vi.fn(), makeCode: vi.fn(), dropCode: vi.fn() },
        invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
        join: vi.fn(),
    },
    syncNow: vi.fn(async () => true),
    overlay: { openSheet: vi.fn(), replaceSheet: vi.fn(), closeSheet: vi.fn() },
    toast: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {} }))
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
    invites: role === "member" ? [] : [{ userId: "u-tay", username: "taylor", name: "Taylor", role: "member", status: "pending", createdAt: Date.UTC(2026, 9, 1, 12), expiresAt: Date.UTC(2026, 9, 31), invitedBy: "u-me" }],
    code: null,
})
const summary = { id: SID, scope: SCOPE, kind: "class", name: "Web Services", role: "member", members: 3 }

beforeEach(() => {
    Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [] })
    fake.syncNow.mockImplementation(async () => true)
    fake.api.invites.list.mockResolvedValue({ invites: [] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("the class sheet", () => {
    beforeEach(() => {
        fake.data.spaces = [space()]
        fake.data.shared_courses = [course]
        fake.data.shared_items = [
            { scope: SCOPE, id: "a1", type: "assignment", title: "REST API Project", courseId: "web", date: "2026-10-15", weight: 20 },
            { scope: SCOPE, id: "q1", type: "quiz", title: "Quiz 1", courseId: "web", date: "2026-10-01", weight: 10 },
            { scope: "c:sp0000000002", id: "x", type: "quiz", title: "Another class", courseId: "z", date: "2026-10-01", weight: 10 },
        ]
    })

    it("shows the class's facts and its items, read-only, and switches to Members", () => {
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByRole("heading", { name: "Web Services" })).toBeTruthy()
        expect(screen.getByText(/Shared/)).toBeTruthy()
        expect(screen.getByText("Dr. Okafor")).toBeTruthy()
        const list = within(screen.getByRole("list", { name: "Class items" }))
        expect(list.getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["Quiz 1", "REST API Project"])
        expect(screen.queryByText("Another class")).toBeNull()
        expect(screen.queryByRole("textbox")).toBeNull()
        fireEvent.click(screen.getByRole("tab", { name: "Members" }))
        expect(fake.overlay.replaceSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "members" })
    })

    it("says so when the class has not reached this device yet", () => {
        fake.data.spaces = []
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/isn't on this device yet/)).toBeTruthy()
    })

    it("gives the maintenance page to someone who is not an admin while classes are off, and an admin the bar", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByRole("list", { name: "Class items" })).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<ClassSheet spaceId={SID} tab="details" />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(screen.getByRole("list", { name: "Class items" })).toBeTruthy()
    })
})

describe("the Members tab", () => {
    beforeEach(() => { fake.data.spaces = [space()]; fake.data.shared_courses = [course] })

    it("invites by username, and says why when it cannot", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        render(<ClassSheet spaceId={SID} tab="members" />)
        const name = await screen.findByRole("textbox", { name: "Username" })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(screen.getByText("Type a username.")).toBeTruthy()
        fake.api.spaces.invite.mockRejectedValueOnce(new ApiError(404, { error: "no_user" }))
        fireEvent.change(name, { target: { value: "@Gabriel " } })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(await screen.findByText("No Term account named 'gabriel'.")).toBeTruthy()
        expect(fake.api.spaces.invite).toHaveBeenLastCalledWith(SID, "gabriel", "member")
        fake.api.spaces.invite.mockResolvedValueOnce({ userId: "u-mo", name: "Morgan", role: "member", status: "pending" })
        fireEvent.change(name, { target: { value: "morgan" } })
        fireEvent.click(screen.getByRole("button", { name: "Invite" }))
        expect(await screen.findByText(/Invited Morgan/)).toBeTruthy()
        expect(fake.api.spaces.get).toHaveBeenCalledTimes(2)
    })

    it("lets the owner withdraw an invite, change a role and make a join code", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        fake.api.spaces.makeCode.mockResolvedValue({ code: "7KQ2M9XD", expires: Date.now() + 1e9, usesLeft: 10 })
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.click(await screen.findByRole("button", { name: "Withdraw the invite to Taylor" }))
        await waitFor(() => expect(fake.api.spaces.revokeInvite).toHaveBeenCalledWith(SID, "u-tay"))
        fireEvent.change(screen.getByRole("combobox", { name: "Role for Sam" }), { target: { value: "editor" } })
        await waitFor(() => expect(fake.api.spaces.setRole).toHaveBeenCalledWith(SID, "u-sam", "editor"))
        fireEvent.click(screen.getByRole("button", { name: "Make a join code" }))
        expect(await screen.findByText("7KQ2 M9XD")).toBeTruthy()
        expect(screen.getByText(/#join=7KQ2M9XD$/)).toBeTruthy()
    })

    it("hands the class on after asking", async () => {
        fake.api.spaces.get.mockResolvedValue(details())
        render(<ClassSheet spaceId={SID} tab="members" />)
        fireEvent.change(await screen.findByRole("combobox", { name: "New owner" }), { target: { value: "u-sam" } })
        fireEvent.click(screen.getByRole("button", { name: "Make owner" }))
        expect(screen.getByText("Make Sam the owner? You become an editor.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Make Sam owner" }))
        await waitFor(() => expect(fake.api.spaces.transfer).toHaveBeenCalledWith(SID, "u-sam"))
    })

    it("shows a member who is in it and who to ask, with nothing to change", async () => {
        fake.data.spaces = [space("member")]
        fake.api.spaces.get.mockResolvedValue(details("member"))
        render(<ClassSheet spaceId={SID} tab="members" />)
        expect(await screen.findByText("Owners and editors invite people. Ask George for a join code.")).toBeTruthy()
        expect(screen.getByText("Sam")).toBeTruthy()
        expect(screen.queryByRole("textbox")).toBeNull()
        expect(screen.queryByRole("combobox")).toBeNull()
        expect(screen.queryByRole("button", { name: /join code/ })).toBeNull()
    })
})
