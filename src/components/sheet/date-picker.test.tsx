import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { monthDays, pickedLabel, weekOf } from "./date-picker"

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 23, 12)) })   /* Wed 23 Sep 2026 */
afterAll(() => { vi.useRealTimers() })
afterEach(() => cleanup())

describe("the date picker's days", () => {
    it("lays out a week Monday first", () => {
        expect(weekOf("2026-09-23")).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"])
        expect(weekOf("2026-09-27")[0]).toBe("2026-09-21")   /* a Sunday is the week's last day */
        expect(weekOf("2026-09-28")[0]).toBe("2026-09-28")
    })

    it("lays out a month in whole weeks, Monday first", () => {
        const sep = monthDays(2026, 8)   /* 1 Sep is a Tuesday, 30 Sep a Wednesday */
        expect(sep.length).toBe(35)
        expect(sep[0]).toBe("2026-08-31")
        expect(sep.at(-1)).toBe("2026-10-04")
        const feb = monthDays(2027, 1)   /* 1 Feb 2027 is a Monday, 28 Feb a Sunday */
        expect(feb.length).toBe(28)
        expect([feb[0], feb.at(-1)]).toEqual(["2027-02-01", "2027-02-28"])
        const oct = monthDays(2026, 9)   /* crosses the end of summer time */
        expect([oct[0], oct.at(-1), oct.length]).toEqual(["2026-09-28", "2026-11-01", 35])
    })

    it("names the chosen day, today and tomorrow said so", () => {
        expect(pickedLabel("2026-09-23")).toBe("Wed 23 Sep · today")
        expect(pickedLabel("2026-09-24")).toBe("Thu 24 Sep · tomorrow")
        expect(pickedLabel("2026-10-02")).toBe("Fri 2 Oct")
    })
})
