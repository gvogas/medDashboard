import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { notify } from "@/bridge"
import { PhoneNav } from "@/components/phone-nav"

// The phone's bottom bar: drawn only on a phone-width screen, four pages and More.
const ui = vi.hoisted(() => ({ view: "week" }))
const setView = vi.hoisted(() => vi.fn())
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView }))
const side = vi.hoisted(() => ({ setSide: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: side.setSide }))

/* a screen `width` px wide, as matchMedia("(max-width:700px)") sees it */
const screenOf = (width: number) => {
    window.matchMedia = ((query: string) => ({
        matches: query.includes("700px") && width <= 700, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })) as typeof window.matchMedia
}
const current = () => screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page").map((b) => b.textContent)

afterEach(() => {
    cleanup()
    setView.mockClear()
    side.setSide.mockClear()
    ui.view = "week"
    // @ts-expect-error jsdom has no matchMedia of its own: take the stub away again
    delete window.matchMedia
})

describe("the phone's bottom bar", () => {
    it("is not drawn on a wide screen, or where the screen's width cannot be asked", () => {
        expect(render(<PhoneNav />).container.textContent).toBe("")
        cleanup()
        screenOf(1280)
        expect(render(<PhoneNav />).container.textContent).toBe("")
    })

    it("lists Week, Month, Items, Study and More on a phone, the current page marked", () => {
        screenOf(390)
        render(<PhoneNav />)
        expect(screen.getByRole("navigation", { name: "Pages, quick" })).toBeTruthy()
        expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Week", "Month", "Items", "Study", "More"])
        expect(current()).toEqual(["Week"])
        ui.view = "study"
        act(() => notify())
        expect(current()).toEqual(["Study"])
    })

    it("shows a page in one tap, and marks none of the four on a page that is behind More", () => {
        screenOf(390)
        render(<PhoneNav />)
        fireEvent.click(screen.getByRole("button", { name: "Items" }))
        expect(setView).toHaveBeenCalledWith("table")
        expect(side.setSide).not.toHaveBeenCalled()
        ui.view = "spotify"
        act(() => notify())
        expect(current()).toEqual([])
    })

    it("More opens the sidebar", () => {
        screenOf(390)
        render(<PhoneNav />)
        fireEvent.click(screen.getByRole("button", { name: "More" }))
        expect(side.setSide).toHaveBeenCalledWith(true)
        expect(setView).not.toHaveBeenCalled()
    })
})
