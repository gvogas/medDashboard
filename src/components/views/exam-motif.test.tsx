import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { BGS } from "@/data/themes"
import { ExamMotif, countdown } from "./exam-motif"

afterEach(cleanup)
const at = new Date(Date.now() + 90061000)      /* 25h 1m 1s away */

describe("the next-exam animation", () => {
    it("counts down in hours, minutes and seconds", () => {
        expect(countdown(90061000)).toBe("25:01:01")
        expect(countdown(-5)).toBe("00:00:00")
    })

    it.each(BGS)("%s draws its own motif, hidden from screen readers", (bg) => {
        const { container } = render(<ExamMotif bg={bg} at={at} steps="3 of 5 topics" />)
        const motif = container.querySelector("[data-motif]")!
        expect(motif.getAttribute("data-motif")).toBe(bg)
        expect(motif.getAttribute("aria-hidden")).toBe("true")
    })

    it("CS and Sports show the countdown; Law and Engineering the topics", () => {
        const text = (bg: typeof BGS[number]) => render(<ExamMotif bg={bg} at={at} steps="3 of 5 topics" />).container.textContent
        expect(text("cs")).toMatch(/countdown --next25:01:0\d/)
        expect(text("sports")).toMatch(/25:01:0\d to go/)
        expect(text("law")).toContain("3 of 5 topics")
        expect(text("eng")).toContain("3 of 5 topics")
    })
})
