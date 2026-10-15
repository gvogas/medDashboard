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
    syncNow: vi.fn(async () => true),
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    meta: { get: async (k: string) => fake.meta.get(k), set: async (k: string, v: unknown) => { fake.meta.set(k, v) } },
}))
vi.mock("@/core/api", () => ({ api: fake.api }))
vi.mock("@/core/sync", () => ({ syncNow: fake.syncNow }))
vi.mock("./effective", () => ({ itemByKey: (k: string) => fake.items.get(k) ?? null }))
vi.mock("./actions", () => ({ openItem: fake.openItem }))
vi.mock("./classes", () => ({ openClass: fake.openClass }))
vi.mock("./overlay", () => ({ openSheet: fake.openSheet }))

import { renderHook } from "@testing-library/react"
import type { ActivityRow, Inbox, Invite } from "./types"

const row = (o: Partial<ActivityRow>): ActivityRow => ({
    seq: 1, spaceId: "abcdefabcdef", space: "Web Services", kind: "class", verb: "item.created", subject: "", actor: "u-alex", subjectUser: "",
    about: false, old: null, new: null, detail: { by: "Alex" }, n: 1, at: 0, ...o,
})
const invite = (spaceId: string, o: Partial<Invite> = {}): Invite => ({
    spaceId, kind: "class", name: "Web Services", role: "member", from: "Gabriel", createdAt: 0, expiresAt: 9e15, expired: false, ...o,
})
/* a fresh module for each test: its list and count start empty, whatever ran before */
let m: typeof import("./inbox")
const say = (r: ActivityRow, me: string) => m.describe(r, me)
const read = () => renderHook(() => ({ box: m.useInbox(), unread: m.useUnread(), invites: m.useInbox()?.invites ?? [], offline: m.useInboxOffline() })).result.current
/* the copy kept for offline, once the fire-and-forget write has landed */
const kept = async () => { await new Promise((r) => setTimeout(r)); return fake.meta.get("inbox") as Inbox | undefined }

beforeEach(async () => {
    vi.resetModules()
    m = await import("./inbox")
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
        expect(say(row({ verb: "item.date", old: "2026-10-18|09:00|10:00", new: "2026-10-18|09:00|10:30", detail: { by: "Alex", title: "Lab" } }), "u-me"))
            .toBe("Alex moved Lab: 18 Oct 09:00–10:00 → 18 Oct 09:00–10:30")
        expect(say(row({ verb: "item.date", old: "2026-10-18||", new: "2026-10-18||23:59", detail: { by: "Alex", title: "Lab" } }), "u-me"))
            .toBe("Alex moved Lab: 18 Oct → 18 Oct until 23:59")
        expect(say(row({ verb: "task.unassigned", old: '["u-sam"]', new: "[]", detail: { by: "Alex", title: "Endpoint" } }), "u-me")).toBe("Alex took everyone off Endpoint")
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
        await m.refreshInbox()
        expect(read().box).toEqual(box)
        expect(fake.meta.get("inbox")).toEqual(box)
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("offline"))
        await m.refreshInbox()
        expect(read().box).toEqual(box)
        expect(read().offline).toBe(true)
        expect(fake.api.inbox.get).toHaveBeenCalledTimes(2)
    })

    it("opened offline on a cold start, reads the copy kept last time; with none, an empty inbox", async () => {
        const box: Inbox = { invites: [], items: [row({ seq: 5 })], seen: 5 }
        fake.meta.set("inbox", box)
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("offline"))
        expect(read().box).toBeNull()
        await m.refreshInbox()
        expect(read()).toMatchObject({ box, offline: true })
        vi.resetModules()
        m = await import("./inbox")
        fake.meta.clear()
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("offline"))
        await m.refreshInbox()
        expect(read().box).toEqual({ invites: [], items: [], seen: 0 })
    })

    it("is not fetched signed out, nor while classes are switched off for you; it is for an admin", async () => {
        fake.data.profile = null
        await m.refreshInbox()
        fake.data.profile = { id: "u-me", isAdmin: false, maintenance: { features: ["classes"], message: "" } }
        await m.refreshInbox()
        expect(fake.api.inbox.get).not.toHaveBeenCalled()
        fake.data.profile = { id: "u-me", isAdmin: true, maintenance: { features: ["classes"], message: "" } }
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [], items: [], seen: 0 })
        await m.refreshInbox()
        expect(fake.api.inbox.get).toHaveBeenCalledTimes(1)
    })

    it("marks everything read up to its newest row: the count falls to the invites waiting", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [invite("sp0000000001"), invite("sp0000000002", { expired: true })], items: [row({ seq: 9 }), row({ seq: 4 })], seen: 2 })
        await m.refreshInbox()
        m.setUnread(5)
        await m.markSeen()
        expect(fake.api.inbox.seen).toHaveBeenCalledWith(9)
        expect(read().unread).toBe(1)
        expect(read().box?.seen).toBe(9)
        expect((await kept())?.seen).toBe(9)
        /* the server has it: a new pull replaces any count fetched before it */
        expect(fake.syncNow).toHaveBeenCalledTimes(1)
        await m.markSeen()
        expect(fake.api.inbox.seen).toHaveBeenCalledTimes(1)
    })

    it("offline, marking read goes back on this device, so the next open sends it again", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [], items: [row({ seq: 9 })], seen: 2 })
        expect(await m.refreshInbox()).toBe(2)
        m.setUnread(3)
        fake.api.inbox.seen.mockRejectedValueOnce(new TypeError("offline"))
        await m.markSeen()
        expect(read().box?.seen).toBe(2)
        /* and the count with it: still unread */
        expect(read().unread).toBe(3)
        expect((await kept())?.seen).toBe(2)
        expect(fake.syncNow).not.toHaveBeenCalled()
        await m.markSeen()
        expect(fake.api.inbox.seen).toHaveBeenCalledTimes(2)
        expect(read().box?.seen).toBe(9)
    })

    it("does not mark read on an offline open: the copy kept stays unread, and so does the count", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [], items: [row({ seq: 9 })], seen: 2 })
        await m.refreshInbox()
        fake.api.inbox.get.mockRejectedValueOnce(new TypeError("offline"))
        expect(await m.refreshInbox()).toBe(2)
        m.setUnread(4)
        await m.markSeen()
        expect(fake.api.inbox.seen).not.toHaveBeenCalled()
        expect(read()).toMatchObject({ unread: 4, offline: true })
        expect(read().box?.seen).toBe(2)
    })

    it("drops an answered invite, and one from the count", async () => {
        fake.api.inbox.get.mockResolvedValueOnce({ invites: [invite("sp0000000001"), invite("sp0000000002")], items: [], seen: 0 })
        await m.refreshInbox()
        m.setUnread(2)
        m.dropInvite("sp0000000001")
        expect(read().invites.map((i) => i.spaceId)).toEqual(["sp0000000002"])
        expect(read().unread).toBe(1)
        expect((await kept())?.invites.map((i) => i.spaceId)).toEqual(["sp0000000002"])
    })
})

describe("opening a row", () => {
    it("opens the item while it is here, else the class, else nothing", () => {
        fake.items.set("c:abcdefabcdef/a1", { id: "a1" })
        m.openRow(row({ subject: "a1" }))
        expect(fake.openItem).toHaveBeenCalledWith("c:abcdefabcdef/a1")
        expect(m.openable(row({ subject: "a1" }))).toBe(true)
        m.openRow(row({ subject: "gone" }))
        expect(fake.openClass).not.toHaveBeenCalled()
        expect(m.openable(row({ subject: "gone" }))).toBe(false)
        expect(m.openable(row({ kind: "project", spaceId: "abcdefabcdef", subject: "gone" }))).toBe(false)
        fake.data.spaces = [{ id: "abcdefabcdef" }]
        expect(m.openable(row({ subject: "gone" }))).toBe(true)
        m.openRow(row({ subject: "gone" }))
        expect(fake.openClass).toHaveBeenCalledWith("abcdefabcdef")
        m.openInbox()
        expect(fake.openSheet).toHaveBeenCalledWith({ kind: "inbox" })
    })

    it("loads a page of a class's activity; offline, null", async () => {
        fake.api.spaces.activity.mockResolvedValueOnce({ items: [], more: false })
        expect(await m.loadActivity("abcdefabcdef", 40)).toEqual({ items: [], more: false })
        expect(fake.api.spaces.activity).toHaveBeenCalledWith("abcdefabcdef", 40)
        fake.api.spaces.activity.mockRejectedValueOnce(new TypeError("offline"))
        expect(await m.loadActivity("abcdefabcdef")).toBeNull()
    })
})
