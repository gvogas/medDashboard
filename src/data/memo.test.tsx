import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"

const fake = vi.hoisted(() => ({
    data: { items: [] as unknown[], courses: [] as unknown[], quotes: [], study_sessions: [] as unknown[], profile: null as unknown, achievements: [] },
}))
vi.mock("@/core/store", () => ({ data: fake.data, subscribe: () => () => {}, conflicts: () => [] }))

import { notify } from "@/bridge"
import { ui } from "./ui"
import { useTable, useWeek } from "./views"
import { useLeaderboard } from "./leaderboard"
import { useUpNext } from "./next"

afterEach(() => { cleanup(); ui.search = ""; ui.show = "all"; ui.sort = { key: "date", dir: 1 }; ui.types = {}; ui.lb = null; ui.lbTab = "week" })

describe("hooks over the store and the ui", () => {
    it("keep their result when an unrelated part of the ui changes", () => {
        const week = renderHook(() => useWeek()), lb = renderHook(() => useLeaderboard())
        const was = [week.result.current, lb.result.current]
        act(() => { ui.focusMusic = !ui.focusMusic; notify() })
        expect(week.result.current).toBe(was[0])
        expect(lb.result.current).toBe(was[1])
    })

    it("redo the week when the search it reads changes, and the table for its own fields", () => {
        const week = renderHook(() => useWeek()), table = renderHook(() => useTable())
        const w = week.result.current, t = table.result.current
        act(() => { ui.show = "open"; notify() })
        expect(week.result.current).toBe(w)
        expect(table.result.current).not.toBe(t)
        expect(table.result.current.filters.show).toBe("open")
        const t2 = table.result.current
        act(() => { ui.sort = { key: "title", dir: -1 }; notify() })
        expect(table.result.current.sort).toEqual({ key: "title", dir: -1 })
        act(() => { ui.types = { exam: false }; notify() })
        expect(table.result.current.filters.types).toEqual({ exam: false })
        expect(table.result.current).not.toBe(t2)
        act(() => { ui.search = "x"; notify() })
        expect(week.result.current).not.toBe(w)
    })

    it("redo the leaderboard when its tab changes", () => {
        const lb = renderHook(() => useLeaderboard()), was = lb.result.current
        act(() => { ui.lbTab = "all"; notify() })
        expect(lb.result.current).not.toBe(was)
        expect(lb.result.current.tab).toBe("all")
    })

    it("keep Up next's rows across an unrelated redraw", () => {
        const next = renderHook(() => useUpNext()), was = next.result.current
        act(() => { ui.focusMusic = !ui.focusMusic; notify() })
        expect(next.result.current).toBe(was)
    })
})
