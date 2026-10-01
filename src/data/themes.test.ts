import { describe, expect, it } from "vitest"
import { BGS, GOALS, THEMES, goalFor, toBg } from "./themes"

describe("the themes", () => {
    it("names the third Quick start for each theme", () => {
        expect(BGS.map((bg) => THEMES[bg].preset)).toEqual(["Anki then read", "LeetCode then read", "Brief then outline", "Charts then sim", "Film then drills", "Problems then read"])
    })

    it("picks a Spotify search for the Music page per theme", () => {
        expect(BGS.map((bg) => THEMES[bg].music.name)).toEqual(["Night shift", "Deep work", "Library hours", "Cruising altitude", "Pre-game", "Workshop"])
        expect(BGS.map((bg) => THEMES[bg].music.word)).toEqual(["the night shift", "deep work", "library hours", "the cockpit", "game day", "the workshop"])
        expect(THEMES.med.music.query).toBe("night shift study")
        for (const bg of BGS) expect(THEMES[bg].music.query.trim().length).toBeGreaterThan(2)
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
