import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// The school calendar is a fake: Fall 2026 from Mon 7 Sep to Fri 11 Dec, 14 weeks.
const cal = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("@/data/query", () => ({ schoolCal: () => cal.value }))
vi.mock("@/data/spotify/player", () => ({ state: { loaded: false, connected: false, device: null } }))

import { viewHeading } from "./view-heading"

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 30, 12)) })
afterAll(() => { vi.useRealTimers() })

describe("the top bar's heading", () => {
    it("titles the week with its range, the day and the school week over it", () => {
        cal.value = { name: "School", terms: [{ name: "Fall 2026", start: "2026-09-07", end: "2026-12-11" }], days: [] }
        expect(viewHeading({ view: "week", anchor: "2026-09-29" })).toEqual({
            title: "28 Sep – 4 Oct",
            sub: "Tuesday 29 September · Fall 2026, week 4 of 14",
        })
        cal.value = null
        expect(viewHeading({ view: "week", anchor: "2026-09-29" }).sub).toBe("Tuesday 29 September")
        expect(viewHeading({ view: "week", anchor: "2027-01-12" }).sub).toBe("Tuesday 12 January 2027")   // another year says so
    })

    it("titles the month with its name and year", () => {
        expect(viewHeading({ view: "month", anchor: "2026-10-14" })).toEqual({ title: "October 2026", sub: "" })
    })
})
