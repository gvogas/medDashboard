import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { Toaster } from "@/components/toaster"
import { toast, hideToast } from "@/data/toast"
import { stubMatchMedia } from "./test-media"

stubMatchMedia({ reducedMotion: false })

afterEach(() => {
    /* one hideToast takes one toast, and several can be up: clear them all */
    act(() => { for (let i = 0; i < 10; i++) hideToast() })
    cleanup()
    vi.useRealTimers()
})

describe("the toaster", () => {
    it("shows nothing until something is said", () => {
        const { container } = render(<Toaster />)
        expect(container.textContent).toBe("")
    })

    it("hides, then calls back, when Undo is pressed", () => {
        render(<Toaster />)
        // Hidden first: a toast the callback shows of its own stays up.
        const undo = vi.fn(() => toast("Restored"))
        act(() => toast("Lab deleted", { undo }))
        fireEvent.click(screen.getByRole("button", { name: "Undo" }))
        expect(undo).toHaveBeenCalledOnce()
        expect(screen.queryByText("Lab deleted")).toBeNull()
        expect(screen.getByText("Restored")).toBeTruthy()
    })

    it("uses the given label, shows the medal or the sticker, and dismisses with ✕", () => {
        render(<Toaster />)
        act(() => toast("Achievement unlocked: Early bird", { undo: () => {}, label: "See", badge: { group: "days", tier: "I" } }))
        expect(screen.getByRole("button", { name: "See" })).toBeTruthy()
        expect(screen.getByText("I").getAttribute("aria-hidden")).toBe("true")
        act(() => toast("Achievement unlocked: Mine", { badge: { sticker: "/s.png", group: "own", tier: "" } }))
        expect(document.querySelector('img[src="/s.png"]')).toBeTruthy()
        /* each toast's own row: its ✕ takes that toast down and no other */
        fireEvent.click(within(screen.getByText("Achievement unlocked: Mine").parentElement!).getByRole("button", { name: "Dismiss" }))
        expect(screen.queryByText("Achievement unlocked: Mine")).toBeNull()
        expect(screen.getByText("Achievement unlocked: Early bird")).toBeTruthy()
        fireEvent.click(within(screen.getByText("Achievement unlocked: Early bird").parentElement!).getByRole("button", { name: "Dismiss" }))
        expect(screen.queryByText(/Early bird/)).toBeNull()
    })

    it("has no action button without undo", () => {
        render(<Toaster />)
        act(() => toast("School calendar saved"))
        expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss"])
    })

    it("announces an error as an alert", () => {
        render(<Toaster />)
        act(() => toast("Sign-out failed.", { error: true }))
        expect(screen.getByRole("alert").textContent).toContain("Sign-out failed.")
        expect(screen.getByRole("status").textContent).toBe("")
    })

    it("replaces the old toast with a new one", () => {
        render(<Toaster />)
        act(() => toast("First"))
        act(() => toast("Second"))
        expect(screen.queryByText("First")).toBeNull()
        expect(screen.getAllByRole("status")).toHaveLength(1)
        expect(screen.getByText("Second")).toBeTruthy()
    })

    it("goes after its time, and a replacement gets a fresh timer", () => {
        vi.useFakeTimers()
        render(<Toaster />)
        act(() => toast("Short", { ms: 1000 }))
        act(() => { vi.advanceTimersByTime(800) })
        act(() => toast("Default"))
        act(() => { vi.advanceTimersByTime(5900) })
        expect(screen.getByText("Default")).toBeTruthy()
        act(() => { vi.advanceTimersByTime(200) })
        expect(screen.queryByText("Default")).toBeNull()
    })

    /* A click focuses the button it lands on. Its toast then leaves the screen with the focus inside
       it, and no blur ever reaches the card: the focus hold has to be let go with the toast, or the
       other Undo toasts stand still for good and the deletes they stand for are never made final. */
    it("lets the other Undo toasts run out after one's Undo is pressed with the focus on it", () => {
        vi.useFakeTimers()
        render(<Toaster />)
        const undoA = vi.fn(), goneB = vi.fn()
        act(() => { toast("A deleted", { undo: undoA }) })
        act(() => { toast("B deleted", { undo: () => {}, onGone: goneB }) })
        const undo = screen.getAllByRole("button", { name: "Undo" })
        act(() => { undo[0].focus() })
        act(() => { fireEvent.click(undo[0]) })
        expect(undoA).toHaveBeenCalledOnce()
        expect(screen.queryByText("A deleted")).toBeNull()
        expect(screen.getByText("B deleted")).toBeTruthy()
        act(() => { vi.advanceTimersByTime(7000) })
        expect(screen.queryByText("B deleted")).toBeNull()
        expect(goneB).toHaveBeenCalledOnce()
    })

    it("and after one is dismissed with ✕", () => {
        vi.useFakeTimers()
        render(<Toaster />)
        const goneB = vi.fn()
        act(() => { toast("A deleted", { undo: () => {} }) })
        act(() => { toast("B deleted", { undo: () => {}, onGone: goneB }) })
        const dismiss = screen.getAllByRole("button", { name: "Dismiss" })
        act(() => { dismiss[0].focus() })
        act(() => { fireEvent.click(dismiss[0]) })
        act(() => { vi.advanceTimersByTime(7000) })
        expect(goneB).toHaveBeenCalledOnce()
    })

    it("still holds the toasts while the focus stays on one that is not leaving", () => {
        vi.useFakeTimers()
        render(<Toaster />)
        const goneA = vi.fn(), goneB = vi.fn()
        act(() => { toast("A deleted", { undo: () => {}, onGone: goneA }) })
        act(() => { toast("B deleted", { undo: () => {}, onGone: goneB }) })
        act(() => { screen.getAllByRole("button", { name: "Undo" })[1].focus() })
        act(() => { vi.advanceTimersByTime(60_000) })
        expect(goneA).not.toHaveBeenCalled()
        expect(goneB).not.toHaveBeenCalled()
    })
})
