import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Toaster } from "@/components/toaster"
import { toast, hideToast } from "@/legacy/js/views/toast.js"
import { stubMatchMedia } from "./test-media"

stubMatchMedia({ reducedMotion: false })

afterEach(() => {
    act(() => hideToast())
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

    it("uses the given label, shows a trusted badge, and dismisses with ✕", () => {
        render(<Toaster />)
        act(() => toast("Achievement unlocked: Early bird", { undo: () => {}, label: "See", badge: '<span class="md g-days">I</span>' }))
        expect(screen.getByRole("button", { name: "See" })).toBeTruthy()
        expect(document.querySelector(".md.g-days")?.textContent).toBe("I")
        expect(screen.getByRole("status").textContent).toContain("Early bird")
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
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
        expect(screen.queryByRole("status")).toBeNull()
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
})
