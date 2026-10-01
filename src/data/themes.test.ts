import { describe, expect, it } from "vitest"
import { BGS, GOALS, THEMES, goalFor, toBg } from "./themes"

describe("the themes", () => {
    it("names the third Quick start for each theme", () => {
        expect(BGS.map((bg) => THEMES[bg].preset)).toEqual(["Anki then read", "LeetCode then read", "Brief then outline", "Charts then sim", "Film then drills", "Problems then read"])
    })

    it("has six, each with its words and six goals", () => {
        expect(BGS).toEqual(["med", "cs", "law", "pilot", "sports", "eng"])
        for (const bg of BGS) {
            expect(THEMES[bg].label).toBeTruthy()
            expect(THEMES[bg].studyWord).toBeTruthy()
            expect(THEMES[bg].quote.text).toBeTruthy()
            expect(GOALS[bg]).toHaveLength(6)
            for (const g of GOALS[bg]) expect(g.length).toBeLessThanOrEqual(22)
        }
    })

    it("reads an unknown or missing id as Medicine", () => {
        expect(toBg("law")).toBe("law")
        expect(toBg("foo")).toBe("med")
        expect(toBg(undefined)).toBe("med")
    })

    it("uses the saved goal, or the theme's first", () => {
        expect(goalFor("med", "  Surgeon ")).toBe("Surgeon")
        expect(goalFor("pilot", "")).toBe("Captain")
    })
})
