import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

const fake = vi.hoisted(() => {
    class ApiError extends Error {
        status: number; body: unknown
        constructor(status: number, body: unknown) { super("HTTP " + status); this.status = status; this.body = body }
    }
    return { ApiError, ui: { importNote: null as unknown, outlineBusy: false } }
})
vi.mock("@/core/api", () => ({ ApiError: fake.ApiError }))
vi.mock("@/core/pdftext", () => ({ pdfText: vi.fn(async () => "the text") }))
vi.mock("@/legacy/js/state.js", () => ({ ui: fake.ui }))

import { closeKeys, keysOpen, openKeys } from "@/data/keys"
import { readWithAi } from "@/data/ai-read"
import { closeSheet, openSheet } from "@/data/overlay"
import { Overlays } from "./overlays"

beforeEach(() => {
    document.body.innerHTML = '<div id="app"><button id="opener">Open</button></div><div id="sheet"><div role="dialog" tabindex="-1" id="panel"></div></div><div id="overlays"></div>'
    render(<Overlays />, { container: document.getElementById("overlays")! })
})
afterEach(() => { act(() => closeKeys()); cleanup(); vi.useRealTimers() })

const app = () => document.getElementById("app")!

describe("the shortcuts panel", () => {
    it("opens over an inert page with focus on ✕, and gives focus back on close", () => {
        document.getElementById("opener")!.focus()
        act(() => openKeys())
        const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" })
        expect(dialog.textContent).toContain("Previous / next week or month")
        expect(dialog.textContent).toContain("Shortcuts are off while you type in a field.")
        expect(app().inert).toBe(true)
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }))

        fireEvent.click(screen.getByRole("button", { name: "Close" }))
        expect(keysOpen()).toBe(false)
        expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()
        expect(app().inert).toBe(false)
        expect(document.activeElement?.id).toBe("opener")
    })

    it("closes on a click outside the card, not inside it", () => {
        act(() => openKeys())
        fireEvent.click(screen.getByText("Search"))
        expect(keysOpen()).toBe(true)
        fireEvent.click(screen.getByRole("dialog", { name: "Keyboard shortcuts" }).parentElement!)
        expect(keysOpen()).toBe(false)
    })
})

describe("the busy card", () => {
    const file = (name = "outline.docx") => new File(["x"], name, { type: "application/octet-stream" })
    const read = (call: () => Promise<unknown>, done = vi.fn(), refresh = vi.fn()) =>
        readWithAi(file(), { what: "outline", stage: "Reading the dates and grades with AI…", flag: "outlineBusy", note: "importNote", errors: {}, call, done, refresh })

    it("shows while the file is read, counts the seconds, and gives focus back to the sheet", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
        let answer!: (v: unknown) => void
        const done = vi.fn()
        openSheet({ kind: "course", id: null })   /* the file was picked in the sheet */
        document.getElementById("panel")!.focus()
        let reading!: Promise<void>
        await act(async () => { reading = read(() => new Promise((r) => { answer = r }), done) })

        const card = screen.getByRole("alertdialog", { name: "Uploading your course" })
        expect(card.textContent).toContain("outline.docx")
        expect(card.textContent).toContain("Reading the dates and grades with AI…")
        expect(fake.ui.outlineBusy).toBe(true)
        expect(app().inert).toBe(true)
        expect(document.getElementById("sheet")!.inert).toBe(true)
        expect(document.activeElement).toBe(card)
        act(() => { vi.advanceTimersByTime(3000) })
        expect(card.textContent).toContain("3s")

        await act(async () => { answer({ ok: 1 }); await reading })
        expect(done).toHaveBeenCalledWith({ ok: 1 })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(fake.ui.outlineBusy).toBe(false)
        expect(document.getElementById("sheet")!.inert).toBe(false)
        expect(document.activeElement?.id).toBe("panel")
        closeSheet()
    })

    it("puts what went wrong in the note", async () => {
        const refresh = vi.fn()
        await act(() => read(async () => { throw new fake.ApiError(429, { error: "outline_limit" }) }, vi.fn(), refresh))
        expect(fake.ui.importNote).toEqual({ text: "That is the limit of 10 AI reads for today (outlines and calendars). Try again tomorrow.", error: true })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(refresh).toHaveBeenCalled()

        await act(() => read(async () => { throw new TypeError("Failed to fetch") }))
        expect(fake.ui.importNote).toEqual({ text: "You seem to be offline. Reading outlines needs a connection.", error: true })

        await act(() => readWithAi(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"), {
            what: "outline", stage: "", flag: "outlineBusy", note: "importNote", errors: {}, call: vi.fn(), done: vi.fn(), refresh: vi.fn(),
        }))
        expect(fake.ui.importNote).toEqual({ text: "That file is over 5 MB.", error: true })
    })
})
