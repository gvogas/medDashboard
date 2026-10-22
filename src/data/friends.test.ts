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

import { ApiError } from "@/core/api"
import { friendsNow, loadFriends, answerRequest, askFriend, resetFriends } from "./friends"

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
})
