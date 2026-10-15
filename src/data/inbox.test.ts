import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The inbox's data: the words for a row, the list fetched and kept for offline, the count.
// The store, the API and the sheets are fakes.
const fake = vi.hoisted(() => ({
    data: { profile: { id: "u-me" } as Record<string, unknown> | null, spaces: [] as { id: string }[] },
    meta: new Map<string, unknown>(),
    api: { inbox: { get: vi.fn(), seen: vi.fn(async () => null) }, spaces: { activity: vi.fn() } },
    items: new Map<string, unknown>(),
    openItem: vi.fn(),
    openClass: vi.fn(),
    openSheet: vi.fn(),
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    meta: { get: async (k: string) => fake.meta.get(k), set: async (k: string, v: unknown) => { fake.meta.set(k, v) } },
}))
vi.mock("@/core/api", () => ({ api: fake.api }))
vi.mock("./effective", () => ({ itemByKey: (k: string) => fake.items.get(k) ?? null }))
vi.mock("./actions", () => ({ openItem: fake.openItem }))
vi.mock("./classes", () => ({ openClass: fake.openClass }))
vi.mock("./overlay", () => ({ openSheet: fake.openSheet }))

import { describe as say, dropInvite, loadActivity, markSeen, openInbox, openRow, refreshInbox, setUnread, useInbox, useInvites, useUnread } from "./inbox"
import { renderHook } from "@testing-library/react"
import type { ActivityRow, Inbox, Invite } from "./types"

const row = (o: Partial<ActivityRow>): ActivityRow => ({
    seq: 1, spaceId: "abcdefabcdef", space: "Web Services", kind: "class", verb: "item.created", subject: "", actor: "u-alex", subjectUser: "",
    about: false, old: null, new: null, detail: { by: "Alex" }, n: 1, at: 0, ...o,
})
const invite = (spaceId: string, o: Partial<Invite> = {}): Invite => ({
    spaceId, kind: "class", name: "Web Services", role: "member", from: "Gabriel", createdAt: 0, expiresAt: 9e15, expired: false, ...o,
})
const read = () => renderHook(() => ({ box: useInbox(), unread: useUnread(), invites: useInvites() })).result.current

beforeEach(() => {
    fake.data.profile = { id: "u-me" }
    fake.data.spaces = []
    fake.meta.clear()
    fake.items.clear()
})
afterEach(() => { vi.clearAllMocks() })

describe("what an activity row says", () => {
    it("names creations, one or many", () => {
        expect(say(row({ detail: { by: "Alex", titles: ["Lab 3"] } }), "u-me")).toBe("Alex added Lab 3")
        expect(say(row({ n: 12, detail: { by: "Alex", titles: ["Lab 1", "Lab 2", "Lab 3", "Lab 4"] } }), "u-me")).toBe("Alex added 12 items: Lab 1, Lab 2, Lab 3…")
    })
    it("reads moves, renames, weights and removals", () => {
        expect(say(row({ verb: "item.date", old: "2026-10-15||", new: "2026-10-18|09:00|", detail: { by: "Alex", title: "REST API" } }), "u-me"))
            .toBe("Alex moved REST API: 15 Oct → 18 Oct 09:00")
        expect(say(row({ verb: "item.title", old: "Quiz", new: "Quiz 1", detail: { by: "Alex" } }), "u-me")).toBe("Alex renamed Quiz to Quiz 1")
        expect(say(row({ verb: "item.weight", old: "10.0", new: "15.0", detail: { by: "Alex", title: "Quiz" } }), "u-me")).toBe("Alex changed Quiz's weight: 10% → 15%")
        expect(say(row({ verb: "item.deleted", new: "1", detail: { by: "Alex", title: "Lab 3" } }), "u-me")).toBe("Alex deleted Lab 3")
        expect(say(row({ verb: "item.deleted", new: "0", detail: { by: "Alex", title: "Lab 3" } }), "u-me")).toBe("Alex restored Lab 3")
    })
    it("speaks to you about you, and calls you You", () => {
        expect(say(row({ verb: "member.role", about: true, subjectUser: "u-me", new: "editor", detail: { by: "Gabriel" } }), "u-me")).toBe("Gabriel made you an editor")
        expect(say(row({ verb: "member.removed", about: true, subjectUser: "u-me", detail: { by: "Gabriel" } }), "u-me")).toBe("Gabriel removed you from Web Services")
        expect(say(row({ verb: "task.assigned", about: true, subjectUser: "u-me", new: "u-me", detail: { by: "Gabriel", title: "Endpoint" } }), "u-me")).toBe("Gabriel assigned you Endpoint")
        expect(say(row({ verb: "member.joined", actor: "u-me", detail: { by: "Me" } }), "u-me")).toBe("You joined")
        expect(say(row({ verb: "task.status", new: "done", detail: {} }), "u-me")).toBe("A former member completed this task")
    })
})

describe("the inbox list", () => {
    it("is fetched and kept; offline, the kept copy is read and the inbox says so", async () => {
        const box: Inbox = { invites: [invite("sp0000000001")], items: [row({ seq: 7 })], seen: 3 }
        fake.api.inbox.get.mockResolvedValueOnce(box)
        await refreshInbox()
        expect(read().box).toEqual(box)
        expect(fake.meta.get("inbox")).toEqual(box)
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("offline"))
        await refreshInbox()
        expect(read().box).toEqual(box)
        expect(fake.api.inbox.get).toHaveBeenCalledTimes(2)
    })

    it("is not fetched signed out, nor while classes are switched off for you; it is for an admin", async () => {
        fake.data.profile = null
        await refreshInbox()
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        await refreshInbox()
        expect(fake.api.inbox.get).not.toHaveBeenCalled()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [], items: [], seen: 0 })
        await refreshInbox()
        expect(fake.api.inbox.get).toHaveBeenCalledTimes(1)
    })

    it("marks everything read up to its newest row: the count falls to the invites waiting", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [invite("sp0000000001"), invite("sp0000000002", { expired: true })], items: [row({ seq: 9 }), row({ seq: 4 })], seen: 2 })
        await refreshInbox()
        setUnread(5)
        await markSeen()
        expect(fake.api.inbox.seen).toHaveBeenCalledWith(9)
        expect(read().unread).toBe(1)
        expect(read().box?.seen).toBe(9)
        await markSeen()
        expect(fake.api.inbox.seen).toHaveBeenCalledTimes(1)
    })

    it("drops an answered invite, and one from the count", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [invite("sp0000000001"), invite("sp0000000002")], items: [], seen: 0 })
        await refreshInbox()
        setUnread(2)
        dropInvite("sp0000000001")
        expect(read().invites.map((i) => i.spaceId)).toEqual(["sp0000000002"])
        expect(read().unread).toBe(1)
    })
})

describe("opening a row", () => {
    it("opens the item while it is here, else the class, else nothing", () => {
        fake.items.set("c:abcdefabcdef/a1", { id: "a1" })
        openRow(row({ subject: "a1" }))
        expect(fake.openItem).toHaveBeenCalledWith("c:abcdefabcdef/a1")
        openRow(row({ subject: "gone" }))
        expect(fake.openClass).not.toHaveBeenCalled()
        fake.data.spaces = [{ id: "abcdefabcdef" }]
        openRow(row({ subject: "gone" }))
        expect(fake.openClass).toHaveBeenCalledWith("abcdefabcdef")
        openInbox()
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "inbox" })
    })

    it("loads a page of a class's activity; offline, null", async () => {
        fake.api.spaces.activity.mockResolvedValueOnce({ items: [], more: false })
        expect(await loadActivity("abcdefabcdef", 40)).toEqual({ items: [], more: false })
        expect(fake.api.spaces.activity).toHaveBeenCalledWith("abcdefabcdef", 40)
        fake.api.spaces.activity.mockRejectedValueOnce(new TypeError("offline"))
        expect(await loadActivity("abcdefabcdef")).toBeNull()
    })
})
