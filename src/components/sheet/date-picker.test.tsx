import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { DatePicker, monthDays, pickedLabel, weekOf } from "./date-picker"

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

/* the picker as the card holds it: the date in state, every pick reported */
const picks: string[] = []
function Held({ start = "2026-09-23", busy = [] as string[] }) {
    const [date, setDate] = useState(start)
    return <DatePicker value={date} busy={new Set(busy)} onChange={(d) => { picks.push(d); setDate(d) }} />
}
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed")

describe("the date picker", () => {
    afterEach(() => { picks.length = 0 })

    it("shows the chosen week and picks a day in it", () => {
        render(<Held />)
        expect(screen.getByText("Wed 23 Sep · today")).toBeTruthy()
        const days = within(screen.getByRole("group", { name: "Days" })).getAllByRole("button")
        expect(days.map((b) => b.getAttribute("aria-label"))).toEqual(["Mon 21 Sep", "Tue 22 Sep", "Wed 23 Sep", "Thu 24 Sep", "Fri 25 Sep", "Sat 26 Sep", "Sun 27 Sep"])
        expect(pressed("Wed 23 Sep")).toBe("true")
        fireEvent.click(screen.getByRole("button", { name: "Fri 25 Sep" }))
        expect(picks).toEqual(["2026-09-25"])
        expect(pressed("Fri 25 Sep")).toBe("true")
        expect(screen.getByText("Fri 25 Sep")).toBeTruthy()
    })

    it("moves the day a week back or on with ‹ ›", () => {
        render(<Held />)
        fireEvent.click(screen.getByRole("button", { name: "Next week" }))
        expect(picks).toEqual(["2026-09-30"])
        expect(screen.getByRole("button", { name: "Mon 28 Sep" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
        fireEvent.click(screen.getByRole("button", { name: "Previous week" }))
        expect(picks.at(-1)).toBe("2026-09-16")
    })

    it("opens the month, moves through months, and goes back to Week on a pick", () => {
        render(<Held start="2026-10-02" />)
        const show = screen.getByRole("group", { name: "Show" })
        fireEvent.click(within(show).getByRole("button", { name: "Month" }))
        expect(screen.getByText("October 2026")).toBeTruthy()
        expect(screen.queryByRole("group", { name: "Days" })).toBeNull()
        const grid = screen.getByRole("group", { name: "October 2026" })
        expect(within(grid).getAllByRole("button").length).toBe(35)
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(screen.getByText("November 2026")).toBeTruthy()
        expect(picks).toEqual([])   /* moving the month picks nothing */
        fireEvent.click(screen.getByRole("button", { name: "Tue 10 Nov" }))
        expect(picks).toEqual(["2026-11-10"])
        expect(within(show).getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true")
        expect(screen.getByRole("group", { name: "Days" })).toBeTruthy()
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tue 10 Nov" }))
    })

    it("goes to today with Today, and rings today", () => {
        render(<Held start="2026-11-10" />)
        expect(screen.queryByRole("button", { name: "Wed 23 Sep" })).toBeNull()
        fireEvent.click(screen.getByRole("button", { name: "Today" }))
        expect(picks).toEqual(["2026-09-23"])
        expect(screen.getByRole("button", { name: "Wed 23 Sep" }).getAttribute("aria-current")).toBe("date")
        expect(screen.getByRole("button", { name: "Thu 24 Sep" }).getAttribute("aria-current")).toBeNull()
    })

    it("marks the days that already have something due", () => {
        render(<Held busy={["2026-09-25", "2026-10-14"]} />)
        expect(screen.getByRole("button", { name: "Fri 25 Sep, something due" })).toBeTruthy()
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        expect(screen.getByRole("button", { name: "Fri 25 Sep, something due" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(screen.getByRole("button", { name: "Wed 14 Oct, something due" })).toBeTruthy()
    })

    it("steps over a year end in Month, and rings today in the grid", () => {
        render(<Held start="2026-12-15" />)
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        fireEvent.click(screen.getByRole("button", { name: "Next month" }))
        expect(screen.getByText("January 2027")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Previous month" }))
        expect(screen.getByText("December 2026")).toBeTruthy()
        cleanup()
        render(<Held start="2026-09-10" />)
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        expect(screen.getByRole("button", { name: "Wed 23 Sep" }).getAttribute("aria-current")).toBe("date")
    })

    it("keeps the month in step when the date changes from outside", () => {
        const { rerender } = render(<DatePicker value="2026-09-10" busy={new Set()} onChange={() => {}} />)
        fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Month" }))
        rerender(<DatePicker value="2026-11-10" busy={new Set()} onChange={() => {}} />)
        expect(screen.getByText("November 2026")).toBeTruthy()
    })
})
