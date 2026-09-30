import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SideFoot, QUOTE_EVERY_MS } from "@/components/side-foot"
import { stubMatchMedia } from "./test-media"

const toggleSettings = vi.hoisted(() => vi.fn())
const nextQuote = vi.hoisted(() => vi.fn())
vi.mock("@/data/actions", () => ({ toggleSettings, nextQuote, syncNow: vi.fn() }))
vi.mock("@/data/store", () => ({ useProfile: () => ({ displayName: "Alex Rivera", username: "alex" }) }))
vi.mock("@/data/sync", () => ({
    useSyncStatus: () => ({ state: "idle", message: "" }),
    useSyncAnnouncement: () => "",
    syncLabel: () => "Synced",
}))
const quote = vi.hoisted(() => ({ value: { ix: 0, quote: { text: "The good physician treats the disease.", source: "William Osler" } } as null | { ix: number; quote: { text: string; source: string } } }))
vi.mock("@/data/views", () => ({ useStats: () => ({ quote: quote.value, quoteCount: quote.value ? 2 : 0 }) }))

afterEach(() => { cleanup(); toggleSettings.mockClear(); nextQuote.mockClear(); vi.useRealTimers() })

describe("the sidebar's foot", () => {
    it("shows the quote and who said it; a click turns to the next", () => {
        render(<SideFoot />)
        expect(screen.getByText(/The good physician/)).toBeTruthy()
        expect(screen.getByText("William Osler")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: /The good physician/ }))
        expect(nextQuote).toHaveBeenCalled()
    })

    it("without a quote, points to Settings", () => {
        quote.value = null
        render(<SideFoot />)
        expect(screen.getByText("Add a quote in Settings")).toBeTruthy()
        quote.value = { ix: 0, quote: { text: "The good physician treats the disease.", source: "William Osler" } }
    })

    it("shows the name, the sync state and Settings", () => {
        render(<SideFoot />)
        expect(screen.getByText("Alex Rivera")).toBeTruthy()
        expect(screen.getByRole("button", { name: /Synced/ })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Settings" }))
        expect(toggleSettings).toHaveBeenCalled()
    })

    it("turns the quote by itself, but not while it is read or motion is reduced", () => {
        vi.useFakeTimers()
        stubMatchMedia({ reducedMotion: false })
        render(<SideFoot />)
        act(() => { vi.advanceTimersByTime(QUOTE_EVERY_MS) })
        expect(nextQuote).toHaveBeenCalledTimes(1)

        screen.getByRole("button", { name: /The good physician/ }).focus()
        act(() => { vi.advanceTimersByTime(QUOTE_EVERY_MS) })
        expect(nextQuote).toHaveBeenCalledTimes(1)
        ;(document.activeElement as HTMLElement).blur()

        stubMatchMedia({ reducedMotion: true })
        act(() => { vi.advanceTimersByTime(QUOTE_EVERY_MS) })
        expect(nextQuote).toHaveBeenCalledTimes(1)
        stubMatchMedia({ reducedMotion: false })
    })
})
