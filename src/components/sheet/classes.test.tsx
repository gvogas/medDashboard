import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

// The class sheets with the store, the API, sync, the overlay and the toast as fakes; the
// hooks over the store (data/store.ts) and the class rules (data/classes.ts) are the real ones.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as unknown[], items: [] as unknown[], quotes: [] as unknown[], study_sessions: [] as unknown[], achievements: [] as unknown[],
        spaces: [] as unknown[], shared_courses: [] as unknown[], shared_items: [] as unknown[], marks: [] as unknown[], space_prefs: [] as unknown[],
    },
    api: {
        spaces: { create: vi.fn(), get: vi.fn(), invite: vi.fn(), revokeInvite: vi.fn(), setRole: vi.fn(), transfer: vi.fn(), makeCode: vi.fn(), dropCode: vi.fn(), school: vi.fn() },
        invites: { list: vi.fn(), accept: vi.fn(), decline: vi.fn() },
        join: vi.fn(),
    },
    store: { saveProfile: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(fake.data.profile!, patch) }) },
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
import { NewClassSheet } from "./new-class-sheet"
import { ConvertSheet } from "./convert-sheet"
import { ShareCourse } from "./share-course"
import { JoinSheet } from "./join-sheet"
import { InvitesSheet } from "./invites-sheet"

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
const summary = { id: SID, scope: SCOPE, kind: "class" as const, name: "Web Services", role: "member" as const, members: 3 }
const pref = { id: SID, spaceId: SID, color: "#17B3AE", target: null, term: "", archived: false, revision: 2 }

beforeEach(() => {
    Object.assign(fake.data, { profile: { id: "u-me", isAdmin: true }, courses: [], items: [], spaces: [], shared_courses: [], shared_items: [], marks: [], space_prefs: [] })
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

describe("a new shared class", () => {
    it("makes a blank one with a colour you do not use, waits for it, then opens its Members", async () => {
        fake.data.courses = [{ id: "c1", name: "Anatomy", color: "#E4749B", archived: false }]
        fake.api.spaces.create.mockResolvedValue({ ...summary, role: "owner", name: "Operating Systems" })
        fake.syncNow.mockImplementation(async () => { fake.data.spaces = [space()]; fake.data.shared_courses = [course]; fake.data.space_prefs = [pref]; return true })
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        expect(screen.getByText("Give it a name and a code.")).toBeTruthy()
        fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Operating Systems" } })
        fireEvent.change(screen.getByRole("textbox", { name: "Code" }), { target: { value: "OS" } })
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "members" }))
        expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "class", course: { code: "OS", name: "Operating Systems", color: "#8B5CC7", instructor: "", term: "", meetings: [] } })
        expect(fake.syncNow).toHaveBeenCalledTimes(1)
    })

    it("goes on to the item picker for a course of yours", () => {
        fake.data.courses = [{ id: "db", name: "Databases", color: "#4F74D9", archived: false }, { id: "old", name: "Old", color: "#7D8A99", archived: true }]
        render(<NewClassSheet />)
        fireEvent.click(screen.getByRole("radio", { name: /Convert a course you have/ }))
        const select = screen.getByRole("combobox", { name: "Course" })
        expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Databases"])
        fireEvent.click(screen.getByRole("button", { name: "Continue" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "convert", courseId: "db" })
    })

    it("gives the maintenance page to someone who is not an admin while classes are off, and an admin the bar", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<NewClassSheet />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Continue" })).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<NewClassSheet />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy()
    })
})

describe("converting a course", () => {
    beforeEach(() => {
        fake.data.courses = [{ id: "db", name: "Databases", color: "#4F74D9", archived: false }]
        fake.data.items = [
            { id: "a1", type: "assignment", title: "Project", courseId: "db", date: "2026-10-15", grade: 91, links: [{ label: "Spec", url: "https://example.com" }] },
            { id: "t1", type: "task", title: "Read chapter 3", courseId: "db", date: "2026-10-02", grade: null, links: [] },
            { id: "c1", type: "c-viva", title: "Viva", courseId: "db", date: "2026-10-20", grade: null, links: [] },
            { id: "rvab12cd31", type: "task", title: "Review 1/4", courseId: "db", date: "2026-10-03", grade: null, links: [] },
            { id: "z1", type: "quiz", title: "Elsewhere", courseId: "other", date: "2026-10-03", grade: null, links: [] },
        ]
    })

    it("ticks all but tasks; lecture reviews and your own types stay yours; warns about links", async () => {
        fake.api.spaces.create.mockResolvedValue({ ...summary, role: "owner", name: "Databases" })
        render(<ConvertSheet courseId="db" />)
        const box = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement
        expect(box(/^Project/).checked).toBe(true)
        expect(box(/^Read chapter 3/).checked).toBe(false)
        expect(box(/^Viva/).disabled).toBe(true)
        expect(box(/^Review 1\/4/).disabled).toBe(true)
        expect(screen.queryByRole("checkbox", { name: /Elsewhere/ })).toBeNull()
        expect(screen.getByText("Links on ticked items become visible to the class.")).toBeTruthy()
        fireEvent.click(box(/^Read chapter 3/))
        fireEvent.click(screen.getByRole("button", { name: "Create class" }))
        await waitFor(() => expect(fake.api.spaces.create).toHaveBeenCalledWith({ kind: "class", convertCourseId: "db", items: ["t1", "a1"] }))
        await waitFor(() => expect(fake.toast).toHaveBeenCalled())
    })

    it("says why it failed and lets you try again", async () => {
        fake.api.spaces.create.mockRejectedValue(new ApiError(409, { error: "limit" }))
        render(<ConvertSheet courseId="db" />)
        fireEvent.click(screen.getByRole("button", { name: "Create class" }))
        expect(await screen.findByText(/20 classes/)).toBeTruthy()
        expect((screen.getByRole("button", { name: "Create class" }) as HTMLButtonElement).disabled).toBe(false)
    })

    it("gives the maintenance page to someone who is not an admin while classes are off, and an admin the bar", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<ConvertSheet courseId="db" />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByRole("checkbox")).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<ConvertSheet courseId="db" />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(screen.getByRole("button", { name: "Create class" })).toBeTruthy()
    })
})

describe("Share this course, in the course sheet", () => {
    it("offers Convert, or opens the class already made from the course", () => {
        render(<ShareCourse courseId="db" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Convert to shared class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "convert", courseId: "db" })
        cleanup()
        fake.data.spaces = [{ ...space(), name: "Databases" }]
        fake.data.shared_courses = [{ ...course, id: "db" }]
        render(<ShareCourse courseId="db" dirty={false} />)
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        expect(fake.overlay.openSheet).toHaveBeenLastCalledWith({ kind: "class", spaceId: SID, tab: "details" })
    })

    it("waits for the course's changes to be saved", () => {
        render(<ShareCourse courseId="db" dirty />)
        expect((screen.getByRole("button", { name: "Convert to shared class" }) as HTMLButtonElement).disabled).toBe(true)
        expect(screen.getByText("Save your changes first.")).toBeTruthy()
    })

    it("shows nothing to someone who is not an admin, also while classes are off", () => {
        fake.data.profile = { id: "u-me", isAdmin: false }
        const first = render(<ShareCourse courseId="db" dirty={false} />)
        expect(first.container.textContent).toBe("")
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        const again = render(<ShareCourse courseId="db" dirty={false} />)
        expect(again.container.textContent).toBe("")
    })
})

describe("joining with a code", () => {
    beforeEach(() => { fake.api.spaces.get.mockResolvedValue(details("member")) })

    it("checks the code, joins, shows the class downloading, then says you are in", async () => {
        fake.api.join.mockResolvedValue(summary)
        let arrive = () => {}
        fake.syncNow.mockImplementation(() => new Promise<boolean>((done) => {
            arrive = () => { fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; fake.data.space_prefs = [pref]; done(true) }
        }))
        render(<JoinSheet code="" space={null} />)
        const box = screen.getByRole("textbox", { name: "Join code" })
        fireEvent.change(box, { target: { value: "7kq2" } })
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(screen.getByText("A code is 8 characters.")).toBeTruthy()
        expect(fake.api.join).not.toHaveBeenCalled()
        fireEvent.change(box, { target: { value: "7kq2 m9xd" } })
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(await screen.findByText("Downloading Web Services…")).toBeTruthy()
        expect(fake.api.join).toHaveBeenCalledWith("7kq2 m9xd")
        await act(async () => arrive())
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        expect(screen.getByText("3 members · you joined as a member.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" })
    })

    it("starts from a link's code, and says why a code fails", async () => {
        fake.api.join.mockRejectedValue(new ApiError(410, { error: "expired" }))
        render(<JoinSheet code="7KQ2M9XD" space={null} />)
        expect((screen.getByRole("textbox", { name: "Join code" }) as HTMLInputElement).value).toBe("7KQ2M9XD")
        fireEvent.click(screen.getByRole("button", { name: "Join" }))
        expect(await screen.findByText("That has expired. Ask for a new code or invite.")).toBeTruthy()
    })

    it("follows a class joined from an invite straight to its download", async () => {
        fake.syncNow.mockImplementation(async () => { fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; fake.data.space_prefs = [pref]; return true })
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        expect(screen.queryByText(/hasn't finished downloading/)).toBeNull()
    })

    const CAL = { name: "Northfield", terms: [{ name: "Fall 2026", start: "2026-09-08", end: "2026-12-18" }], days: [] }
    const joined = () => { fake.data.spaces = [space("member")]; fake.data.shared_courses = [course]; fake.data.space_prefs = [pref] }

    it("offers the class's school calendar to someone with none, and saves it as theirs", async () => {
        fake.api.spaces.get.mockResolvedValue({ ...details("member"), schoolCalendar: CAL })
        joined()
        render(<JoinSheet code="" space={summary} />)
        expect(screen.queryByRole("combobox", { name: "Your semester" })).toBeNull()
        fireEvent.click(await screen.findByRole("button", { name: "Use the class's school calendar" }))
        await waitFor(() => expect(fake.store.saveProfile).toHaveBeenCalledWith({ schoolCalendar: CAL }))
        expect(fake.api.spaces.get).toHaveBeenCalledWith(SID)
        expect(((await screen.findByRole("combobox", { name: "Your semester" })) as HTMLSelectElement).value).toBe("Fall 2026")
        expect(screen.queryByRole("button", { name: "Use the class's school calendar" })).toBeNull()
    })

    it("says so when taking the class's school calendar fails, and offers it again", async () => {
        fake.api.spaces.get.mockResolvedValue({ ...details("member"), schoolCalendar: CAL })
        fake.store.saveProfile.mockRejectedValueOnce(new Error("disk"))
        joined()
        render(<JoinSheet code="" space={summary} />)
        fireEvent.click(await screen.findByRole("button", { name: "Use the class's school calendar" }))
        expect(await screen.findByText("The school calendar didn't save. Try again.")).toBeTruthy()
        expect((screen.getByRole("button", { name: "Use the class's school calendar" }) as HTMLButtonElement).disabled).toBe(false)
        expect(screen.queryByRole("combobox", { name: "Your semester" })).toBeNull()
    })

    it("offers nothing when the class can't be asked, and the joined screen still works", async () => {
        fake.api.spaces.get.mockRejectedValue(new ApiError(503, { error: "offline" }))
        joined()
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        await waitFor(() => expect(fake.api.spaces.get).toHaveBeenCalledWith(SID))
        expect(screen.queryByRole("button", { name: "Use the class's school calendar" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Open the class" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "class", spaceId: SID, tab: "details" }))
    })

    it("keeps a school calendar that arrived while the offer was up", async () => {
        fake.api.spaces.get.mockResolvedValue({ ...details("member"), schoolCalendar: CAL })
        joined()
        render(<JoinSheet code="" space={summary} />)
        const use = await screen.findByRole("button", { name: "Use the class's school calendar" })
        const mine = { name: "Mine", terms: [{ name: "Fall 2026", start: "2026-09-01", end: "2026-12-20" }], days: [] }
        fake.data.profile = { id: "u-me", isAdmin: true, schoolCalendar: mine }
        fireEvent.click(use)
        expect(((await screen.findByRole("combobox", { name: "Your semester" })) as HTMLSelectElement).value).toBe("Fall 2026")
        expect(fake.store.saveProfile).not.toHaveBeenCalled()
    })

    it("offers nothing when the class has no school calendar", async () => {
        fake.api.spaces.get.mockResolvedValue({ ...details("member"), schoolCalendar: null })
        joined()
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByText("You're in Web Services")).toBeTruthy()
        await waitFor(() => expect(fake.api.spaces.get).toHaveBeenCalled())
        expect(screen.queryByRole("button", { name: "Use the class's school calendar" })).toBeNull()
    })

    it("offers nothing to someone who has a school calendar", async () => {
        fake.data.profile = { id: "u-me", isAdmin: true, schoolCalendar: CAL }
        joined()
        render(<JoinSheet code="" space={summary} />)
        expect(await screen.findByRole("combobox", { name: "Your semester" })).toBeTruthy()
        expect(fake.api.spaces.get).not.toHaveBeenCalled()
        expect(screen.queryByRole("button", { name: "Use the class's school calendar" })).toBeNull()
    })

    it("gives the maintenance page to someone who is not an admin while classes are off, and an admin the bar", () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<JoinSheet code="7KQ2M9XD" space={null} />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByRole("textbox", { name: "Join code" })).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<JoinSheet code="7KQ2M9XD" space={null} />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(screen.getByRole("textbox", { name: "Join code" })).toBeTruthy()
    })
})

describe("invites to you", () => {
    const inv = (spaceId: string, over: Record<string, unknown> = {}) => ({
        spaceId, kind: "class", name: "Web Services", role: "member", from: "Gabriel",
        createdAt: Date.UTC(2026, 9, 1, 12), expiresAt: Date.UTC(2026, 9, 31), expired: false, ...over,
    })

    it("are listed with who sent each; Decline drops one, Accept follows the class as it downloads", async () => {
        fake.api.invites.list.mockResolvedValue({ invites: [inv(SID), inv("sp0000000002", { name: "Databases" }), inv("sp0000000003", { name: "Old class", expired: true })] })
        fake.api.invites.accept.mockResolvedValue(summary)
        render(<InvitesSheet />)
        await screen.findByText("Databases")
        const row = (name: string) => within(screen.getByText(name).closest("li") as HTMLElement)
        expect(row("Web Services").getByText("Gabriel")).toBeTruthy()
        expect(row("Old class").getByText("This invite has expired. Ask for a new one.")).toBeTruthy()
        expect(row("Old class").queryByRole("button")).toBeNull()
        fireEvent.click(row("Databases").getByRole("button", { name: "Decline the invite to Databases" }))
        await waitFor(() => expect(screen.queryByText("Databases")).toBeNull())
        expect(fake.api.invites.decline).toHaveBeenCalledWith("sp0000000002")
        fireEvent.click(row("Web Services").getByRole("button", { name: "Accept the invite to Web Services" }))
        await waitFor(() => expect(fake.overlay.openSheet).toHaveBeenCalledWith({ kind: "join", code: "", space: summary }))
    })

    it("say so when there are none", async () => {
        render(<InvitesSheet />)
        expect(await screen.findByText("Nothing new.")).toBeTruthy()
    })

    it("give the maintenance page to someone who is not an admin while classes are off, and an admin the bar", async () => {
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        render(<InvitesSheet />)
        expect(screen.getByRole("heading", { name: /being worked on/ })).toBeTruthy()
        expect(screen.queryByText("Nothing new.")).toBeNull()
        cleanup()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        render(<InvitesSheet />)
        expect(screen.getByText(/only admins see this/)).toBeTruthy()
        expect(await screen.findByText("Nothing new.")).toBeTruthy()
    })
})
