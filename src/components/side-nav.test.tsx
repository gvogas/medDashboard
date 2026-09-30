import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify, setStudyBadge } from "@/bridge"
import { SideNav } from "@/components/side-nav"

// The app is not booted here: the nav only needs the view and setView.
const ui = vi.hoisted(() => ({ view: "week" }))
const setView = vi.hoisted(() => vi.fn())
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))

const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent)

afterEach(() => {
    cleanup()
    setView.mockClear()
    setStudyBadge(null)
    ui.view = "week"
})

describe("the pages in the sidebar", () => {
    it("lists the five pages, the current one marked", () => {
        render(<SideNav />)
        expect(screen.getByRole("navigation", { name: "Pages" })).toBeTruthy()
        expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Week", "Month", "All items", "Study", "Music"])
        expect(current()).toEqual(["Week"])
    })

    it("follows the view after a notify()", () => {
        render(<SideNav />)
        ui.view = "spotify"
        act(() => notify())
        expect(current()).toEqual(["Music"])
    })

    it("asks for a page when one is clicked", () => {
        render(<SideNav />)
        fireEvent.click(screen.getByRole("button", { name: "All items" }))
        expect(setView).toHaveBeenCalledWith("table")
    })

    it("shows the running timer beside Study", () => {
        setStudyBadge("24:13")
        render(<SideNav />)
        expect(screen.getByRole("button", { name: /Study/ }).textContent).toBe("Study24:13")
    })
})
