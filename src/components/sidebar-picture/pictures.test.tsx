import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { BGS, THEMES } from "@/data/themes"
import { SidebarPicture } from "./index"
import { coatSize, fitSize, nameParts } from "./names"

afterEach(cleanup)

describe("the sidebar pictures", () => {
    it.each(BGS)("%s: the name and the goal are text over the drawing", (bg) => {
        render(<SidebarPicture bg={bg} name="Alex Rivera" goal="Neurologist" username="alex" />)
        const pic = screen.getByRole("img")
        expect(pic.getAttribute("aria-label")).toBe(THEMES[bg].picture + ": Alex Rivera, headed for Neurologist")
        expect(pic.textContent).toMatch(/Alex Rivera|RIVERA|Rivera/)
        expect(pic.textContent).toContain("NEUROLOGIST")
        expect(pic.querySelector("svg text")).toBeNull()
    })

    it("the badge shows the username", () => {
        render(<SidebarPicture bg="cs" name="Alex Rivera" goal="Team lead" username="alex" />)
        expect(screen.getByRole("img").textContent).toContain("@alex")
    })
})

describe("names on the pictures", () => {
    it("splits a name into what each picture prints", () => {
        expect(nameParts("Alex Rivera")).toEqual({ first: "Alex", last: "Rivera", initials: "AR", capsShort: "A. RIVERA", capsLast: "RIVERA" })
        expect(nameParts("  Alex  ")).toEqual({ first: "Alex", last: "", initials: "A", capsShort: "ALEX", capsLast: "ALEX" })
    })

    it("fits the embroidered name to the pocket", () => {
        expect(coatSize("Alex Rivera")).toBe(12.5)
        expect(coatSize("Alexandra Montgomery-Riviera")).toBe(5)
    })
})

describe("long names and goals", () => {
    const sizes = (bg: (typeof BGS)[number], name: string, goal: string) => {
        const { container } = render(<SidebarPicture bg={bg} name={name} goal={goal} username="" />)
        const out = [...container.querySelectorAll<HTMLElement>("span[style*='font-size']")].map((e) => parseFloat(e.style.fontSize))
        cleanup()
        return out
    }

    it("fitSize keeps the base for short text and shrinks for long", () => {
        expect(fitSize("RIVERA", 58, 7.5, 0.6, 1)).toBe(7.5)
        expect(fitSize("CHIEF MEDICAL OFFICER!", 58, 6, 0.6, 0.5)).toBeLessThan(6)
        expect(fitSize("x".repeat(200), 58, 6, 0.6)).toBe(4)
    })

    it.each(BGS)("%s: a long name and goal get smaller type than a short one", (bg) => {
        const short = sizes(bg, "Alex Rivera", "Neurologist"), long = sizes(bg, "Alexandra Montgomery-Riviera", "Chief medical officer!")
        expect(short.length).toBeGreaterThanOrEqual(2)
        expect(long).toHaveLength(short.length)
        long.forEach((size, i) => expect(size).toBeLessThanOrEqual(short[i]))
        expect(long.some((size, i) => size < short[i])).toBe(true)
    })

    it.each(BGS)("%s: every word keeps a one-line height, so it sits where it was placed", (bg) => {
        const { container } = render(<SidebarPicture bg={bg} name="Alex Rivera" goal="Neurologist" username="alex" />)
        for (const tag of container.querySelectorAll("[role=img] > span")) expect(tag.className).toContain("leading-none")
    })

    it("an empty name leaves no dangling comma in the label", () => {
        render(<SidebarPicture bg="med" name="" goal="Neurologist" username="" />)
        expect(screen.getByRole("img").getAttribute("aria-label")).toBe(THEMES.med.picture + ": headed for Neurologist")
    })
})
