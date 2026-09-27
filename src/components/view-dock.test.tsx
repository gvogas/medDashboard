import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify, setStudyBadge } from "@/bridge"
import { ViewDock } from "@/components/view-dock"
import { stubMatchMedia } from "./test-media"

// The legacy app is not booted here: the dock only needs the view and setView.
const ui = vi.hoisted(() => ({ view: "week" }))
const setView = vi.hoisted(() => vi.fn())
vi.mock("@/legacy/js/state.js", () => ({ ui }))
vi.mock("@/legacy/js/study-controller.js", () => ({ setView }))

stubMatchMedia({ reducedMotion: false })

const pressed = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("aria-label"))

afterEach(() => {
    cleanup()
    setView.mockClear()
    setStudyBadge(null)
    ui.view = "week"
})

describe("the view dock", () => {
    it("shows the five views, the current one pressed", () => {
        render(<ViewDock />)
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Week", "Month", "Table", "Spotify", "Study"])
        expect(pressed()).toEqual(["Week"])
        expect(screen.getByRole("group", { name: "Views" })).toBeTruthy()
    })

    it("follows the view when the legacy code re-renders", () => {
        render(<ViewDock />)
        ui.view = "table"
        act(() => notify())
        expect(pressed()).toEqual(["Table"])
    })

    it("asks for a view when an icon is clicked", () => {
        render(<ViewDock />)
        fireEvent.click(screen.getByRole("button", { name: "Spotify" }))
        expect(setView).toHaveBeenCalledWith("spotify")
    })

    it("carries a running study timer as a badge on Study", async () => {
        render(<ViewDock />)
        expect(document.querySelector("[data-dock-badge]")).toBeNull()
        act(() => setStudyBadge("24:13"))
        const study = screen.getByRole("button", { name: "Study" })
        expect(study.querySelector("[data-dock-badge]")?.textContent).toBe("24:13")
        act(() => setStudyBadge(null))
        await vi.waitFor(() => expect(document.querySelector("[data-dock-badge]")).toBeNull())
    })

    it("shows the label and shortcut on hover", () => {
        render(<ViewDock />)
        const month = screen.getByRole("button", { name: "Month" })
        fireEvent.mouseEnter(month)
        expect(month.textContent).toBe("Month2")
    })

    it("magnifies the icons near the pointer", async () => {
        render(<ViewDock />)
        fireEvent.mouseMove(screen.getByRole("group", { name: "Views" }), { clientX: 0, clientY: 0 })
        await vi.waitFor(() => expect(parseFloat(screen.getByRole("button", { name: "Week" }).style.width)).toBeGreaterThan(28))
    })
})
