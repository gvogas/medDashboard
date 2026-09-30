import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { BGS, THEMES } from "@/data/themes"
import { SidebarPicture } from "./index"
import { coatSize, nameParts } from "./names"

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
