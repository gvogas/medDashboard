import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/* A store in memory (run.ts keeps the run in meta; sessions are saved) and the rooms API
   as a set of mocks. run.ts and core/timer.ts are the real engine. */
const fake = vi.hoisted(() => ({
    meta: new Map<string, unknown>(),
    sessions: [] as Record<string, unknown>[],
    data: { study_sessions: [] as Record<string, unknown>[], profile: { id: "me" } as Record<string, unknown> | null },
    rooms: {
        create: vi.fn(), get: vi.fn(), join: vi.fn(), leave: vi.fn(async () => null), clock: vi.fn(), invite: vi.fn(), label: vi.fn(),
    },
}))
vi.mock("@/core/store", () => ({
    data: fake.data,
    subscribe: () => () => {},
    meta: {
        get: async (key: string) => structuredClone(fake.meta.get(key) ?? null),
        set: async (key: string, value: unknown) => { fake.meta.set(key, structuredClone(value)) },
    },
    saveStudySession: async (s: Record<string, unknown>) => {
        fake.sessions.push(s)
        fake.data.study_sessions = [...fake.data.study_sessions.filter((x) => x.id !== s.id), { ...s, revision: 3 }]
    },
}))
vi.mock("@/core/api", async (orig) => ({ ...(await orig<typeof import("@/core/api")>()), api: { rooms: fake.rooms } }))

import * as run from "./run"
import { hostClock, joinRoom, leaveRoom, poll, resetRoom, roomNow, startRoom } from "./room"
import { currentToast, hideToast } from "./toast"
import { ApiError } from "@/core/api"
import type { RoomMember, RoomView } from "./types"

const MIN = 60_000
const T0 = 1_800_000_000_000
const FLOW = { steps: [["study", 25], ["break", 5]] as ["study" | "break", number][], rounds: 2 }
/* the server's clock runs 10 s ahead of this device's */
const SKEW = 10_000

const member = (userId: string, extra: Partial<RoomMember> = {}): RoomMember => ({
    userId, username: userId, name: userId.toUpperCase(), state: "in", joinedAt: T0 + SKEW, joinedStudyMs: 0, earlierMs: 0,
    leftAt: null, courseLabel: "", away: false, ...extra,
})
function view(extra: { members?: RoomMember[]; pausedAt?: number | null; endedAt?: number | null; hostId?: string; tag?: string } = {}): RoomView {
    return {
        room: {
            id: "room00000001", hostId: extra.hostId ?? "host", endedAt: extra.endedAt ?? null, feed: [],
            run: { flow: FLOW, startedAt: T0 + SKEW, pausedAt: extra.pausedAt ?? null, pausedMs: 0, skippedMs: 0, skippedStudyMs: 0 },
        },
        members: extra.members ?? [member("host"), member("me", { joinedAt: T0 + SKEW + 10 * MIN, joinedStudyMs: 10 * MIN })],
        tag: extra.tag ?? "1.0", now: Date.now() + SKEW,
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0 + 10 * MIN)
    fake.meta.clear(); fake.sessions.length = 0; fake.data.study_sessions = []
    Object.values(fake.rooms).forEach((f) => f.mockReset())
    fake.rooms.leave.mockResolvedValue(null)
})
afterEach(async () => {
    await run.stop()
    resetRoom()
    hideToast()
    vi.useRealTimers()
})

describe("a room run", () => {
    it("joins on the room's clock, moved onto this device's time", async () => {
        fake.rooms.join.mockResolvedValue(view())
        expect(await joinRoom("room00000001", "bio", null, "BIO")).toBe("")
        expect(fake.rooms.join).toHaveBeenCalledWith("room00000001", "BIO")
        const r = run.read()!
        expect(r.room).toMatchObject({ id: "room00000001", joinedAt: T0 + 10 * MIN, joinedStudyMs: 10 * MIN })
        expect(r.startedAt).toBe(T0)
        expect(r.studyMs).toBe(10 * MIN)
        expect(roomNow().view?.room.id).toBe("room00000001")
    })

    it("follows the host's pause on the next poll, and sends the tag back", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        fake.rooms.get.mockResolvedValue(view({ pausedAt: T0 + SKEW + 12 * MIN, tag: "2.0" }))
        vi.setSystemTime(T0 + 15 * MIN)
        await poll()
        expect(fake.rooms.get).toHaveBeenCalledWith("room00000001", "1.0")
        expect(run.read()).toMatchObject({ paused: true, studyMs: 12 * MIN })
        /* a 304: nothing changes */
        fake.rooms.get.mockResolvedValue(null)
        await poll()
        expect(run.read()?.paused).toBe(true)
    })

    it("drops a poll answer older than one already taken", async () => {
        fake.rooms.join.mockResolvedValue(view({ tag: "3.0" }))
        await joinRoom("room00000001", "bio", null, "BIO")
        fake.rooms.get.mockResolvedValue(view({ pausedAt: T0 + SKEW + 10 * MIN, tag: "2.0" }))
        await poll()
        expect(run.read()?.paused).toBe(false)
    })

    it("logs your minutes from when you joined as r-<room>, and tells the server on Leave", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        vi.setSystemTime(T0 + 30 * MIN)   /* 15 min study, then a 5 min break */
        await leaveRoom()
        expect(fake.sessions).toEqual([expect.objectContaining({ id: "r-room00000001", roomId: "room00000001", studyMinutes: 15, startedAt: T0 + 10 * MIN, courseId: "bio" })])
        expect(fake.rooms.leave).toHaveBeenCalledWith("room00000001")
        expect(run.active()).toBe(false)
    })

    it("ends with the room: the frozen record gives the minutes, and no leave is sent", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        fake.rooms.get.mockResolvedValue(view({ pausedAt: T0 + SKEW + 20 * MIN, endedAt: T0 + SKEW + 20 * MIN }))
        vi.setSystemTime(T0 + 40 * MIN)
        await poll()
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 10 })])
        expect(fake.rooms.leave).not.toHaveBeenCalled()
        expect(currentToast()?.text).toMatch(/HOST ended the session/)
    })

    it("logs what the server kept when it took you out after a while away", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        vi.setSystemTime(T0 + 24 * MIN)
        /* the server dates the leave to when you were last seen */
        fake.rooms.get.mockResolvedValue(view({ members: [member("host"), member("me", { state: "left", earlierMs: 3 * MIN, joinedStudyMs: 10 * MIN, leftAt: T0 + SKEW + 13 * MIN })] }))
        await poll()
        expect(fake.sessions).toEqual([expect.objectContaining({ studyMinutes: 3 })])
        expect(run.active()).toBe(false)
        expect(currentToast()?.text).toMatch(/after a while away/)
    })

    it("says only that you left when you left from another device", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        vi.setSystemTime(T0 + 14 * MIN)
        fake.rooms.get.mockResolvedValue(view({ members: [member("host"), member("me", { state: "left", earlierMs: 4 * MIN, joinedStudyMs: 10 * MIN, leftAt: T0 + SKEW + 14 * MIN })] }))
        await poll()
        expect(run.active()).toBe(false)
        expect(currentToast()?.text).toBe("You left the room. Your minutes are saved.")
    })

    it("keeps the run going when starting a room fails", async () => {
        await run.begin(FLOW, "bio", null)
        fake.rooms.create.mockRejectedValue(new ApiError(429, {}))
        expect(await startRoom(FLOW, "bio", null, "BIO", [])).toMatch(/a lot of rooms/)
        expect(run.active()).toBe(true)
        expect(fake.sessions).toEqual([])
    })

    it("writes the same session again with the total after a rejoin", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        vi.setSystemTime(T0 + 15 * MIN)
        await leaveRoom()
        vi.setSystemTime(T0 + 20 * MIN)
        fake.rooms.join.mockResolvedValue(view({ members: [member("host"), member("me", { joinedAt: T0 + SKEW + 10 * MIN, joinedStudyMs: 20 * MIN, earlierMs: 5 * MIN })] }))
        await joinRoom("room00000001", "bio", null, "BIO")
        vi.setSystemTime(T0 + 24 * MIN)
        await leaveRoom()
        expect(fake.sessions.map((s) => [s.id, s.studyMinutes])).toEqual([["r-room00000001", 5], ["r-room00000001", 9]])
        /* the second write keeps the row's revision, so it updates it */
        expect(fake.sessions[1]).toMatchObject({ revision: 3, startedAt: T0 + 10 * MIN })
    })
})

describe("the host's controls", () => {
    it("are refused here for someone who is not the host", async () => {
        fake.rooms.join.mockResolvedValue(view())
        await joinRoom("room00000001", "bio", null, "BIO")
        await hostClock("pause")
        expect(fake.rooms.clock).not.toHaveBeenCalled()
        expect(currentToast()?.text).toMatch(/Only the host/)
    })

    it("pause for everyone as the host", async () => {
        const started = view({ hostId: "me", members: [member("me")] })
        fake.rooms.create.mockResolvedValue(started)
        expect(await startRoom(FLOW, "bio", null, "BIO", ["pal"])).toBe("")
        expect(fake.rooms.create).toHaveBeenCalledWith(FLOW, "BIO", ["pal"])
        fake.rooms.clock.mockResolvedValue(view({ hostId: "me", members: [member("me")], pausedAt: T0 + SKEW + 10 * MIN }))
        await hostClock("pause")
        expect(fake.rooms.clock).toHaveBeenCalledWith("room00000001", "pause")
        expect(run.read()?.paused).toBe(true)
    })
})
