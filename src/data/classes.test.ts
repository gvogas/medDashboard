import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The class rules and calls, with the store, the API, sync, the sheet and the toast as fakes.
const fake = vi.hoisted(() => ({
    data: {
        profile: { id: "u-me", isAdmin: true } as Record<string, unknown> | null,
        courses: [] as { color: string }[],
        spaces: [] as { id: string }[],
        shared_courses: [] as { scope: string; id: string }[],
        space_prefs: [] as { id: string }[],
    },
    api: { invites: { accept: vi.fn(), decline: vi.fn() }, spaces: { create: vi.fn() }, join: vi.fn() },
    syncNow: vi.fn(async () => true),
    openSheet: vi.fn(),
    toast: vi.fn(),
    dropInvite: vi.fn(),
}))
vi.mock("@/core/store", () => ({ data: fake.data }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("./overlay", () => ({ openSheet: fake.openSheet }))
vi.mock("./toast", () => ({ toast: fake.toast }))
vi.mock("./inbox", () => ({ dropInvite: fake.dropInvite }))

import { ApiError } from "@/core/api"
import {
    accept, classFrom, convert, convertChoice, decline, download, formatCode, freeColour, joinLink, joinMessageFor, joinWithCode, makeBlank, messageFor,
} from "./classes"

const SID = "sp0000000001"
const summary = { id: SID, scope: "c:" + SID, kind: "class", name: "Databases", role: "owner", members: 1 }
const arrive = () => { fake.data.spaces = [{ id: SID }]; fake.data.shared_courses = [{ scope: "c:" + SID, id: "db" }]; fake.data.space_prefs = [{ id: SID }] }

beforeEach(() => {
    fake.data.profile = { id: "u-me", isAdmin: true }
    fake.data.courses = []
    fake.data.spaces = []
    fake.data.shared_courses = []
    fake.data.space_prefs = []
    fake.syncNow.mockImplementation(async () => true)
})
afterEach(() => { vi.clearAllMocks() })

describe("which items a class can take", () => {
    it("ticks all but tasks; lecture reviews and your own types stay yours", () => {
        expect(convertChoice({ id: "a1", type: "assignment" })).toEqual({ can: true, ticked: true, why: "" })
        expect(convertChoice({ id: "t1", type: "task" })).toEqual({ can: true, ticked: false, why: "" })
        expect(convertChoice({ id: "rvab12cd31", type: "task" })).toEqual({ can: false, ticked: false, why: "A lecture review: stays yours" })
        expect(convertChoice({ id: "c1", type: "c-viva" })).toEqual({ can: false, ticked: false, why: "Your own type: stays yours" })
    })
})

describe("words and small rules", () => {
    it("show a code in two halves, and its link", () => {
        expect(formatCode("7KQ2M9XD")).toBe("7KQ2 M9XD")
        expect(joinLink("7KQ2M9XD")).toBe(location.origin + "/#join=7KQ2M9XD")
    })

    it("pick the first colour none of your courses uses", () => {
        expect(freeColour([{ color: "#E4749B" }, { color: "#17B3AE" }])).toBe("#8B5CC7")
    })

    it("find the class you made from a course", () => {
        const s = { id: SID, scope: "c:" + SID, kind: "class", role: "owner" }
        const shared = [{ scope: "c:" + SID, id: "db" }]
        expect(classFrom("db", [s] as never, shared)).toBe(s)
        expect(classFrom("db", [{ ...s, role: "member" }] as never, shared)).toBeNull()
        expect(classFrom("other", [s] as never, shared)).toBeNull()
    })

    it("say what went wrong in words", () => {
        expect(messageFor(new ApiError(404, { error: "no_user" }), "gabriel")).toBe("No Term account named 'gabriel'.")
        expect(messageFor(new ApiError(409, { error: "member" }), "sam")).toBe("sam is already a member.")
        expect(messageFor(new ApiError(409, { error: "limit" }))).toMatch(/20 classes/)
        expect(messageFor(new ApiError(410, { error: "expired" }))).toBe("That has expired. Ask for a new code or invite.")
        expect(messageFor(new ApiError(400, { error: "invalid", field: "code" }))).toBe("A code is 8 characters.")
        expect(messageFor(new ApiError(429, { error: "rate_limited" }))).toBe("Too many tries. Wait a while, then try again.")
        expect(messageFor(new TypeError("Failed to fetch"))).toBe("You seem to be offline. This needs a connection.")
        /* a leave, removal, delete or keep that answered not found and was not done after all */
        expect(messageFor(new ApiError(404, { error: "changed" }))).toBe("That may already be done, or the class changed. Look again in a moment.")
        /* joining an archived class: the one joining can't unarchive it */
        expect(joinMessageFor(new ApiError(403, { error: "archived" }))).toBe("This class is archived: it can't take new members until its owner unarchives it.")
        expect(joinMessageFor(new ApiError(410, { error: "expired" }))).toBe("That has expired. Ask for a new code or invite.")
    })
})

describe("your invites", () => {
    /* fetching them is the inbox's now (inbox.test.ts) */
    it("leave the inbox once answered", async () => {
        fake.api.invites.accept.mockResolvedValueOnce(summary)
        expect(await accept(SID)).toEqual(summary)
        await decline("sp0000000002")
        fake.api.join.mockResolvedValueOnce({ ...summary, id: "sp0000000003" })
        await joinWithCode("7KQ2M9XD")
        expect(fake.dropInvite.mock.calls).toEqual([[SID], ["sp0000000002"], ["sp0000000003"]])
    })
})

describe("a class arriving", () => {
    it("syncs until the class and its course are here, a few times at most", async () => {
        let n = 0
        fake.syncNow.mockImplementation(async () => { if (++n === 2) arrive(); return true })
        expect(await download(SID)).toBe(true)
        expect(fake.syncNow).toHaveBeenCalledTimes(2)
        fake.data.spaces = []
        fake.syncNow.mockImplementation(async () => false)
        expect(await download(SID)).toBe(false)
        expect(fake.syncNow).toHaveBeenCalledTimes(6)
    })

    it("makes a blank class with a free colour, or one from a course, then opens its Members", async () => {
        fake.data.courses = [{ color: "#E4749B" }]
        fake.api.spaces.create.mockResolvedValue(summary)
        fake.syncNow.mockImplementation(async () => { arrive(); return true })
        await makeBlank("Operating Systems", "OS")
        expect(fake.api.spaces.create).toHaveBeenLastCalledWith({ kind: "class", course: { code: "OS", name: "Operating Systems", color: "#8B5CC7", instructor: "", term: "", meetings: [] } })
        expect(fake.openSheet).toHaveBeenLastCalledWith({ kind: "class", spaceId: SID, tab: "members" })
        await convert("db", ["a1"])
        expect(fake.api.spaces.create).toHaveBeenLastCalledWith({ kind: "class", convertCourseId: "db", items: ["a1"] })
        expect(fake.toast).toHaveBeenCalledWith("Databases is now a shared class. Your status, grades and notes moved with it.")
    })
})
