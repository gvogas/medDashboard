import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StrictMode } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { clockParts, FlipClock } from "./flip-clock"
import { stubMatchMedia } from "../test-media"

const MIN = 60_000
const cards = () => [...document.querySelectorAll<HTMLElement>(".fc-card")]
const digits = () => cards().map((c) => c.dataset.digit).join("")
const flipping = () => cards().map((c) => c.classList.contains("fc-flipping"))
const halves = (card: HTMLElement) => ["fc-top", "fc-bot", "fc-ftop", "fc-fbot"].map((h) => card.querySelector("." + h)!.textContent)

beforeEach(() => {
    stubMatchMedia({ reducedMotion: false })
    vi.useFakeTimers()
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe("the flip clock", () => {
    it("shows MM:SS rounded up to the second, and says it for screen readers", () => {
        render(<FlipClock ms={25 * MIN} running={false} size="big" />)
        expect(digits()).toBe("2500")
        const clock = screen.getByRole("timer")
        expect(clock.textContent).toContain("25 minutes 0 seconds left")
        expect(clock.className).toContain("fc-big")
        expect(clock.className).not.toContain("fc-running")
        cleanup()
        render(<FlipClock ms={61_001} running size="mini" className="extra" />)
        expect(digits()).toBe("0102")
        expect(screen.getByRole("timer").textContent).toContain("1 minutes 2 seconds left")
        expect(screen.getByRole("timer").className).toMatch(/fc-mini.*fc-running.*extra/)
    })

    it("works out its digits like the legacy clock", () => {
        expect(clockParts(0)).toEqual({ m: 0, s: 0, digits: "0000" })
        expect(clockParts(-1)).toEqual({ m: 0, s: 0, digits: "0000" })
        expect(clockParts(1)).toEqual({ m: 0, s: 1, digits: "0001" })
        expect(clockParts(180 * MIN)).toEqual({ m: 99, s: 0, digits: "9900" })
    })

    it("does not flip on its first draw", () => {
        render(<FlipClock ms={5 * MIN} running size="mid" />)
        expect(flipping()).toEqual([false, false, false, false])
        expect(halves(cards()[1])).toEqual(["5", "5", "5", "5"])
    })

    it("flips the cards whose digit changed: the old top falls, the new bottom lands", () => {
        const { rerender } = render(<FlipClock ms={25 * MIN} running size="big" />)
        rerender(<FlipClock ms={24 * MIN + 59_000} running size="big" />)
        expect(digits()).toBe("2459")
        expect(flipping()).toEqual([false, true, true, true])
        /* top: new, bottom: old until the new one lands, falling: old, landing: new */
        expect(halves(cards()[1])).toEqual(["4", "5", "5", "4"])
        act(() => { vi.advanceTimersByTime(499) })
        expect(flipping()).toEqual([false, true, true, true])
        act(() => { vi.advanceTimersByTime(1) })
        expect(flipping()).toEqual([false, false, false, false])
        expect(halves(cards()[1])).toEqual(["4", "4", "4", "4"])
    })

    it("starts a flip over when the digit changes again mid-flip", () => {
        const { rerender } = render(<FlipClock ms={10_000} running size="big" />)
        rerender(<FlipClock ms={9000} running size="big" />)
        const falling = cards()[3].querySelector(".fc-ftop")
        act(() => { vi.advanceTimersByTime(300) })
        rerender(<FlipClock ms={8000} running size="big" />)
        expect(cards()[3].querySelector(".fc-ftop")).not.toBe(falling)
        expect(halves(cards()[3])).toEqual(["8", "9", "9", "8"])
        act(() => { vi.advanceTimersByTime(300) })
        expect(flipping()[3]).toBe(true)
        act(() => { vi.advanceTimersByTime(200) })
        expect(flipping()[3]).toBe(false)
    })

    it("just changes the digits with reduced motion", () => {
        stubMatchMedia({ reducedMotion: true })
        const { rerender } = render(<FlipClock ms={25 * MIN} running size="big" />)
        rerender(<FlipClock ms={24 * MIN + 59_000} running size="big" />)
        expect(digits()).toBe("2459")
        expect(flipping()).toEqual([false, false, false, false])
        expect(halves(cards()[3])).toEqual(["9", "9", "9", "9"])
        expect(vi.getTimerCount()).toBe(0)
    })

    it("flips and settles under StrictMode, and leaves no timer behind when it goes", () => {
        const { rerender, unmount } = render(<StrictMode><FlipClock ms={25 * MIN} running size="big" /></StrictMode>)
        rerender(<StrictMode><FlipClock ms={24 * MIN + 59_000} running size="big" /></StrictMode>)
        expect(flipping()).toEqual([false, true, true, true])
        act(() => { vi.advanceTimersByTime(500) })
        expect(flipping()).toEqual([false, false, false, false])
        rerender(<StrictMode><FlipClock ms={24 * MIN + 58_000} running size="big" /></StrictMode>)
        expect(vi.getTimerCount()).toBe(1)
        unmount()
        expect(vi.getTimerCount()).toBe(0)
    })
})
