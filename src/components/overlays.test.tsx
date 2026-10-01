import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"

const fake = vi.hoisted(() => {
    class ApiError extends Error {
        status: number; body: unknown
        constructor(status: number, body: unknown) { super("HTTP " + status); this.status = status; this.body = body }
    }
    return { ApiError, ui: { importNote: null as unknown, outlineBusy: false, aiLeft: null as number | null }, api: { aiReads: vi.fn(async () => ({ left: 7, limit: 10 })) } }
})
vi.mock("@/core/api", () => ({ ApiError: fake.ApiError, api: fake.api }))
vi.mock("@/core/pdftext", () => ({ pdfText: vi.fn(async () => "the text") }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(fake.ui))

import { closeKeys, keysOpen, openKeys } from "@/data/keys"
import { readWithAi } from "@/data/ai-read"
import { closeSheet, openSheet } from "@/data/overlay"
import { Overlays } from "./overlays"
import { Page, SheetHost } from "./shell"

beforeEach(() => {
    /* the page, the sheet and the overlays as <App> draws them */
    render(<>
        <Page><button id="opener">Open</button></Page>
        <SheetHost><div role="dialog" tabIndex={-1} id="panel" /></SheetHost>
        <div id="overlays"><Overlays /></div>
    </>)
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
        expect(app().hasAttribute("inert")).toBe(true)
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }))

        fireEvent.click(screen.getByRole("button", { name: "Close" }))
        expect(keysOpen()).toBe(false)
        expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()
        expect(app().hasAttribute("inert")).toBe(false)
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

describe("the reading card", () => {
    const STEPS = ["Reading the document", "Finding dates and deadlines", "Matching it to your courses"] as const
    const file = (name = "outline.docx") => new File(["x"], name, { type: "application/octet-stream" })
    const read = (call: (body: Blob, signal: AbortSignal) => Promise<unknown>, done = vi.fn(), refresh = vi.fn(), prepare?: (f: File) => Promise<Blob>) =>
        readWithAi(file(), { what: "outline", title: "Reading your course outline", steps: STEPS, flag: "outlineBusy", note: "importNote", errors: {}, prepare, call, done, refresh })
    const step = (card: HTMLElement, label: string) => within(card).getByText(label, { selector: "li" })

    it("ticks the steps off, counts the seconds, gives focus back to the sheet, and asks the reads left", async () => {
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
        let answer!: (v: unknown) => void
        const done = vi.fn()
        act(() => openSheet({ kind: "course", id: null }))   /* the file was picked in the sheet */
        document.getElementById("panel")!.focus()
        let reading!: Promise<void>
        await act(async () => { reading = read(() => new Promise((r) => { answer = r }), done) })

        const card = screen.getByRole("alertdialog", { name: "Reading your course outline" })
        expect(card.textContent).toContain("outline.docx")
        expect(step(card, "Reading the document").textContent).toContain("(done)")
        expect(step(card, "Finding dates and deadlines").getAttribute("aria-current")).toBe("step")
        expect(step(card, "Matching it to your courses").getAttribute("aria-current")).toBeNull()
        expect(card.textContent).toContain("Usually under half a minute")
        expect(fake.ui.outlineBusy).toBe(true)
        expect(app().hasAttribute("inert")).toBe(true)
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(true)
        expect(document.activeElement).toBe(card)
        act(() => { vi.advanceTimersByTime(3000) })
        expect(card.textContent).toContain("3s")

        await act(async () => { answer({ ok: 1 }); await reading })
        expect(done).toHaveBeenCalledWith({ ok: 1 })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(fake.ui.outlineBusy).toBe(false)
        expect(document.getElementById("sheet")!.hasAttribute("inert")).toBe(false)
        expect(document.activeElement?.id).toBe("panel")
        expect(fake.api.aiReads).toHaveBeenCalled()
        expect(fake.ui.aiLeft).toBe(7)
        act(() => closeSheet())
    })

    it("stops on Cancel: the request is aborted, nothing opens, and it says so", async () => {
        let seen!: AbortSignal
        const done = vi.fn()
        let reading!: Promise<void>
        await act(async () => {
            reading = read((_, signal) => new Promise((_, reject) => { seen = signal; signal.addEventListener("abort", () => reject(signal.reason)) }), done)
        })
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
        await act(async () => { await reading })
        expect(seen.aborted).toBe(true)
        expect(done).not.toHaveBeenCalled()
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(fake.ui.importNote).toEqual({ text: "Stopped reading.", error: false })
    })

    it("stops on Escape too", async () => {
        let reading!: Promise<void>
        await act(async () => {
            reading = read((_, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))))
        })
        fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
        await act(async () => { await reading })
        expect(fake.ui.importNote).toEqual({ text: "Stopped reading.", error: false })
    })

    it("puts what went wrong in the note", async () => {
        const refresh = vi.fn()
        await act(() => read(async () => { throw new fake.ApiError(429, { error: "outline_limit" }) }, vi.fn(), refresh))
        expect(fake.ui.importNote).toEqual({ text: "That is the limit of 10 AI reads for today (outlines, timetables and calendars). Try again tomorrow.", error: true })
        expect(screen.queryByRole("alertdialog")).toBeNull()
        expect(refresh).toHaveBeenCalled()

        await act(() => read(async () => { throw new TypeError("Failed to fetch") }))
        expect(fake.ui.importNote).toEqual({ text: "You seem to be offline. Reading outlines needs a connection.", error: true })

        await act(() => read(vi.fn(), vi.fn(), vi.fn(), async () => { throw new Error("locked") }))
        expect(fake.ui.importNote).toEqual({ text: "That file could not be opened. Is it a damaged or locked PDF?", error: true })

        await act(() => read(vi.fn(), vi.fn(), vi.fn(), async () => { throw Object.assign(new Error("That picture could not be opened. Use a PNG or JPG screenshot."), { name: "FileError" }) }))
        expect(fake.ui.importNote).toEqual({ text: "That picture could not be opened. Use a PNG or JPG screenshot.", error: true })

        await act(() => readWithAi(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.pdf"), {
            what: "outline", title: "", steps: STEPS, flag: "outlineBusy", note: "importNote", errors: {}, call: vi.fn(), done: vi.fn(), refresh: vi.fn(),
        }))
        expect(fake.ui.importNote).toEqual({ text: "That file is over 5 MB.", error: true })
    })
})
