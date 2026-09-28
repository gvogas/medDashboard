import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

/* The rows are pure; loading, joining and leaving go through a fake API into a fake ui. */
const fake = vi.hoisted(() => ({
    ui: { lb: null as unknown, lbTab: "week" },
    api: { leaderboard: vi.fn(), leaderboardJoin: vi.fn() },
}))
vi.mock("@/core/store", () => ({ data: { study_sessions: [] }, subscribe: () => () => {} }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))
vi.mock("@/core/api", () => ({ api: fake.api }))

import { joinLeaderboard, lbHours, lbRows, lbStale, loadLeaderboard, setLbTab, weekStart, LOAD_ERROR, SAVE_ERROR } from "./leaderboard"
import type { Leaderboard, StudySession } from "./types"

/* Wednesday 23 September 2026, noon; the week counts from Monday 21 at 00:00. */
const NOW = new Date(2026, 8, 23, 12).getTime()
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => { fake.ui.lb = null; fake.ui.lbTab = "week"; vi.clearAllMocks(); vi.stubGlobal("navigator", { onLine: true }) })

const session = (y: number, m: number, d: number, minutes: number): StudySession =>
    ({ id: "s" + d + minutes, courseId: null, itemId: null, startedAt: new Date(y, m - 1, d, 9).getTime(), studyMinutes: minutes, roundsDone: 0, note: "", manual: false })
const lb = (): Leaderboard => ({
    joined: true,
    week: [{ name: "Ada", minutes: 120, me: false }, { name: "You", minutes: 0, me: true }, { name: "Ben", minutes: 120, me: false }, { name: "Cy", minutes: 0, me: false }],
    all: [{ name: "Ada", minutes: 6000, me: false }, { name: "You", minutes: 10, me: true }],
    at: NOW,
})

describe("the rows", () => {
    it("start the week on the viewer's Monday", () => {
        expect(weekStart(NOW)).toBe(new Date(2026, 8, 21).getTime())
    })

    it("take your row from this device, rank ties together, medal only above zero", () => {
        const sessions = [session(2026, 9, 22, 90), session(2026, 9, 20, 500)]
        const rows = lbRows(lb(), "week", sessions, NOW)
        expect(rows.map((r) => [r.name, r.minutes, r.rank, r.medal])).toEqual([
            ["Ada", 120, 1, 1], ["Ben", 120, 1, 1], ["You", 90, 3, 3], ["Cy", 0, 4, null],
        ])
        expect(rows.map((r) => r.width)).toEqual([100, 100, 75, 0])
        /* all-time counts every session on this device */
        expect(lbRows(lb(), "all", sessions, NOW).map((r) => [r.name, r.minutes, r.rank])).toEqual([["Ada", 6000, 1], ["You", 590, 2]])
    })

    it("leave zero rows unmedalled, even at the top", () => {
        const rows = lbRows({ joined: true, week: [{ name: "Ada", minutes: 0, me: false }, { name: "You", minutes: 0, me: true }], all: [] }, "week", [], NOW)
        expect(rows.map((r) => [r.rank, r.medal])).toEqual([[1, null], [1, null]])
    })

    it("are empty until loaded", () => {
        expect(lbRows(null, "week", [], NOW)).toEqual([])
        expect(lbRows({ loading: true }, "all", [], NOW)).toEqual([])
    })

    it("show hours to one decimal, whole from a hundred", () => {
        expect(lbHours(0)).toBe("0")
        expect(lbHours(95)).toBe("1.6")
        expect(lbHours(6000)).toBe("100")
        expect(lbHours(6100)).toBe("102")
    })
})

describe("loading", () => {
    it("asks for this week, keeps what came back, and is fresh for a minute", async () => {
        fake.api.leaderboard.mockResolvedValue({ joined: false, week: [], all: [] })
        expect(lbStale(NOW)).toBe(true)
        await loadLeaderboard()
        expect(fake.api.leaderboard).toHaveBeenCalledWith(new Date(2026, 8, 21).getTime())
        expect(fake.ui.lb).toEqual({ joined: false, week: [], all: [], at: NOW })
        expect(lbStale(NOW + 30_000)).toBe(false)
        expect(lbStale(NOW + 61_000)).toBe(true)
    })

    it("does not ask twice at once", async () => {
        let answer!: (v: unknown) => void
        fake.api.leaderboard.mockReturnValue(new Promise((r) => { answer = r }))
        const first = loadLeaderboard()
        expect(fake.ui.lb).toMatchObject({ loading: true })
        expect(lbStale(NOW + 120_000)).toBe(false)
        await loadLeaderboard()
        expect(fake.api.leaderboard).toHaveBeenCalledTimes(1)
        answer({ joined: true, week: [], all: [] })
        await first
        expect(fake.ui.lb).toMatchObject({ joined: true })
    })

    it("says so offline, and keeps what it had on another failure", async () => {
        vi.stubGlobal("navigator", { onLine: false })
        fake.api.leaderboard.mockRejectedValue(new Error("offline"))
        await loadLeaderboard()
        expect(fake.ui.lb).toEqual({ offline: true, at: NOW })

        vi.stubGlobal("navigator", { onLine: true })
        fake.ui.lb = lb()
        await loadLeaderboard()
        expect(fake.ui.lb).toMatchObject({ joined: true, loading: false, error: LOAD_ERROR })

        /* an answer of the wrong shape is a failure too */
        fake.ui.lb = null
        fake.api.leaderboard.mockResolvedValue({ joined: true, week: [{ name: "Ada", minutes: 1.5, me: false }], all: [] })
        await loadLeaderboard()
        expect(fake.ui.lb).toMatchObject({ error: LOAD_ERROR })
        expect((fake.ui.lb as Leaderboard).joined).toBeUndefined()
    })
})

describe("joining and leaving", () => {
    it("is busy until the change and the new totals are in", async () => {
        fake.ui.lb = { joined: false, week: [], all: [], at: NOW }
        fake.api.leaderboardJoin.mockResolvedValue(undefined)
        let answer!: (v: unknown) => void
        fake.api.leaderboard.mockReturnValue(new Promise((r) => { answer = r }))
        const done = joinLeaderboard(true)
        expect(fake.ui.lb).toMatchObject({ busy: true, error: null })
        await vi.waitFor(() => expect(fake.api.leaderboard).toHaveBeenCalled())
        expect(fake.ui.lb).toMatchObject({ busy: true, loading: true })
        answer(lb())
        expect(await done).toBe(true)
        expect(fake.api.leaderboardJoin).toHaveBeenCalledWith(true)
        expect(fake.ui.lb).toMatchObject({ joined: true })
        expect((fake.ui.lb as Leaderboard).busy).toBeUndefined()
    })

    it("stops being busy when the totals fail after a change", async () => {
        fake.ui.lb = lb()
        fake.api.leaderboardJoin.mockResolvedValue(undefined)
        fake.api.leaderboard.mockRejectedValue(new Error("500"))
        expect(await joinLeaderboard(false)).toBe(true)
        expect(fake.ui.lb).toMatchObject({ busy: false, error: LOAD_ERROR })
    })

    it("says when the change did not go through", async () => {
        fake.ui.lb = { joined: false, week: [], all: [], at: NOW }
        fake.api.leaderboardJoin.mockRejectedValue(new Error("offline"))
        expect(await joinLeaderboard(true)).toBe(false)
        expect(fake.ui.lb).toMatchObject({ joined: false, busy: false, error: SAVE_ERROR })
        expect(fake.api.leaderboard).not.toHaveBeenCalled()
    })

    it("switches between this week and all-time", () => {
        setLbTab("all")
        expect(fake.ui.lbTab).toBe("all")
    })
})
