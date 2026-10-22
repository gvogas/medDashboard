import { beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({ api: { friends: { get: vi.fn(), search: vi.fn(), ask: vi.fn(), answer: vi.fn(), remove: vi.fn(), settings: vi.fn() } } }))
vi.mock("@/core/api", () => {
    class ApiError extends Error {
        status: number
        body: Record<string, unknown> | null
        constructor(status: number, body: Record<string, unknown> | null) { super(String(body?.error ?? status)); this.status = status; this.body = body }
    }
    return { api: fake.api, ApiError }
})
vi.mock("@/core/sync", () => ({ syncNow: vi.fn(() => Promise.resolve()) }))
vi.mock("./inbox", () => ({ dropFriendRequest: vi.fn() }))
vi.mock("./maintenance", () => ({ maintenanceState: vi.fn(() => "off") }))

import { ApiError } from "@/core/api"
import { dropFriendRequest } from "./inbox"
import { friendsNow, loadFriends, answerRequest, askFriend, removeFriend, saveFriendSettings, resetFriends } from "./friends"

const list = { friends: [], incoming: [{ userId: "u-b", username: "b", name: "Bea", at: 1 }], sent: [], settings: { findable: true, showStudying: true } }

beforeEach(() => { resetFriends(); vi.clearAllMocks(); fake.api.friends.get.mockResolvedValue(structuredClone(list)) })

describe("the friends store", () => {
    it("loads the list", async () => {
        await loadFriends()
        expect(friendsNow().list?.incoming[0].name).toBe("Bea")
    })

    it("moves an accepted request into friends without waiting for a reload", async () => {
        await loadFriends()
        fake.api.friends.answer.mockResolvedValue(null)
        fake.api.friends.get.mockReturnValue(new Promise(() => {}))   /* the reload never answers */
        await answerRequest("u-b", true)
        expect(friendsNow().list?.incoming).toEqual([])
        expect(friendsNow().list?.friends.map((f) => f.userId)).toEqual(["u-b"])
    })

    it("says what went wrong when a request fails", async () => {
        await loadFriends()
        fake.api.friends.ask.mockRejectedValue(new ApiError(404, { error: "no_user" }))
        expect(await askFriend("ghost")).toBe("Nobody has that username.")
    })

    it("keeps an accept when an older load answers after it", async () => {
        await loadFriends()
        let late!: (l: unknown) => void
        fake.api.friends.get.mockClear()
        fake.api.friends.get.mockReturnValueOnce(new Promise((r) => { late = r }))
        fake.api.friends.get.mockResolvedValue({ ...structuredClone(list), incoming: [], friends: [{ userId: "u-b", username: "b", name: "Bea", since: 2 }] })
        fake.api.friends.answer.mockResolvedValue(null)
        const slow = loadFriends()
        await answerRequest("u-b", true)
        late(structuredClone(list))
        await slow
        expect(friendsNow().list?.incoming).toEqual([])
        expect(friendsNow().list?.friends.map((f) => f.userId)).toEqual(["u-b"])
        expect(fake.api.friends.get).toHaveBeenCalledTimes(2)
    })

    it("treats a request that is already gone as answered", async () => {
        await loadFriends()
        fake.api.friends.answer.mockRejectedValue(new ApiError(404, { error: "not_found" }))
        fake.api.friends.get.mockReturnValue(new Promise(() => {}))
        expect(await answerRequest("u-b", true)).toBe("That request is no longer there.")
        expect(friendsNow().list?.incoming).toEqual([])
        expect(friendsNow().list?.friends).toEqual([])
        expect(dropFriendRequest).toHaveBeenCalledWith("u-b")
    })

    it("moves a request into friends when asking someone who already asked you", async () => {
        await loadFriends()
        fake.api.friends.ask.mockResolvedValue({ userId: "u-b", username: "b", name: "Bea", state: "friends" })
        fake.api.friends.get.mockReturnValue(new Promise(() => {}))
        expect(await askFriend("b")).toBe("")
        expect(friendsNow().list?.incoming).toEqual([])
        expect(friendsNow().list?.friends.map((f) => f.userId)).toEqual(["u-b"])
        expect(dropFriendRequest).toHaveBeenCalledWith("u-b")
    })

    it("removes a friend or a sent request", async () => {
        fake.api.friends.get.mockResolvedValue({ ...structuredClone(list), friends: [{ userId: "u-f", username: "f", name: "Fay", since: 1 }], sent: [{ userId: "u-s", username: "s", name: "Sam", at: 1 }] })
        await loadFriends()
        fake.api.friends.remove.mockResolvedValue(null)
        fake.api.friends.get.mockReturnValue(new Promise(() => {}))
        expect(await removeFriend("u-f")).toBe("")
        expect(await removeFriend("u-s")).toBe("")
        expect(friendsNow().list?.friends).toEqual([])
        expect(friendsNow().list?.sent).toEqual([])
    })

    it("puts the switches back when saving fails, unless a later change replaced them", async () => {
        await loadFriends()
        const off = { findable: false, showStudying: true }
        fake.api.friends.settings.mockRejectedValue(new ApiError(500, null))
        expect(await saveFriendSettings(off)).toBe("That did not go through. Try again.")
        expect(friendsNow().list?.settings).toEqual(list.settings)
        let fail!: (e: unknown) => void
        fake.api.friends.settings.mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
        const first = saveFriendSettings(off)
        const later = { findable: false, showStudying: false }
        fake.api.friends.settings.mockResolvedValueOnce(null)
        await saveFriendSettings(later)
        fail(new ApiError(500, null))
        await first
        expect(friendsNow().list?.settings).toEqual(later)
    })

    it("tells a failed load from being offline", async () => {
        const online = vi.spyOn(navigator, "onLine", "get")
        fake.api.friends.get.mockRejectedValue(new TypeError("x"))
        online.mockReturnValue(true)
        await loadFriends()
        expect(friendsNow()).toMatchObject({ offline: false, error: expect.stringContaining("Could not load") })
        online.mockReturnValue(false)
        await loadFriends()
        expect(friendsNow()).toMatchObject({ offline: true, error: "" })
        online.mockRestore()
    })
})
