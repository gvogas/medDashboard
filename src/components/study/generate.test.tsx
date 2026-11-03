import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// Make cards with AI (Study Buddy, Stage 4): Use your own AI (copy the prompt, paste the
// answer, read "N of M", save with source 'paste'), Generate here (a preview, the cap offering
// Use your own AI), the file rules, and what the switch does.
const fake = vi.hoisted(() => ({
    status: { providers: ["workers"], left: 2, perUser: 3, extraLeft: 2, globalOpen: true } as any,
    cards: vi.fn(),
    saved: { decks: [] as any[], cards: [] as any[] },
    maintenance: null as null | "blocked",
}))
vi.mock("@/core/api", () => ({
    api: { studyAi: { status: async () => fake.status, cards: fake.cards } },
    ApiError: class extends Error { status: number; body: any; constructor(status: number, body: any) { super(body?.error); this.status = status; this.body = body } },
}))
vi.mock("@/core/store", () => ({
    data: { decks: [], cards: [], card_state: [], card_reviews: [], shared_decks: [], shared_cards: [] },
    saveDeck: async (r: any) => { fake.saved.decks.push(r) }, saveCard: async (r: any) => { fake.saved.cards.push(r) },
    saveReview: vi.fn(), deleteCard: vi.fn(), deleteDeck: vi.fn(),
}))
vi.mock("@/data/store", () => ({
    useCourses: () => [{ id: "pharm", code: "PHARM", name: "Pharmacology", color: "#4F74D9", archived: false }],
    useItems: () => [{ id: "x1", type: "exam", title: "Midterm", date: "2026-11-10", courseId: "pharm", notes: "Chapters 3-5", checklist: [] }],
    useProfile: () => ({ id: "u-me" }),
}))
vi.mock("@/data/maintenance", () => ({ useMaintenance: () => fake.maintenance, maintenanceState: () => fake.maintenance }))
vi.mock("@/data/effective", () => ({ effectiveCourses: () => [] }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn() }))
vi.mock("@/data/study", () => ({ setStudyTab: vi.fn() }))

import { GenerateCards } from "./generate"
import { ApiError } from "@/core/api"
import { readStudyFile, FILE_ERRORS } from "@/data/study-ai"

beforeEach(() => {
    fake.saved = { decks: [], cards: [] }
    fake.maintenance = null
    fake.status = { providers: ["workers"], left: 2, perUser: 3, extraLeft: 2, globalOpen: true }
    try { localStorage.clear() } catch {}
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

const show = async (start = { group: "course:pharm" as string | null, topic: "Midterm", title: "Midterm" }) => {
    render(<GenerateCards start={start} />); await act(async () => {})
}

describe("Use your own AI", () => {
    it("copies the prompt, reads a pasted answer with 'N of M', and saves the cards as pasted", async () => {
        const write = vi.fn(async () => {})
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: write } })
        await show()
        fireEvent.click(screen.getByRole("tab", { name: "Use your own AI" }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy prompt" })) })
        const prompt = (write.mock.calls[0] as unknown as string[])[0]
        expect(prompt).toContain("exactly 15 flashcards")
        expect(prompt).toContain("Class: PHARM · Pharmacology")           /* the class's own items */
        expect(prompt).toContain("Midterm (2026-11-10)")
        expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
        fireEvent.change(screen.getByLabelText("The chat's answer"), { target: { value: 'Sure!\n```json\n{"cards":[{"front":"A","back":"1"},{"front":"B","back":"2"},{"front":"","back":"x"}]}\n```' } })
        fireEvent.click(screen.getByRole("button", { name: "Read the answer" }))
        expect(screen.getByText("2 of 3 cards could be read.")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Drop card 2" }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save 1 cards" })) })
        expect(fake.saved.decks).toEqual([expect.objectContaining({ title: "Midterm", courseId: "pharm", authorId: "u-me" })])
        expect(fake.saved.cards).toEqual([expect.objectContaining({ front: "A", back: "1", source: "paste", deckId: fake.saved.decks[0].id })])
    })

    it("shows the prompt to select when copying is refused, and says when an answer had no cards", async () => {
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async () => { throw new Error("denied") } } })
        await show()
        fireEvent.click(screen.getByRole("tab", { name: "Use your own AI" }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy prompt" })) })
        expect((screen.getByLabelText(/select the prompt and copy it yourself/) as HTMLTextAreaElement).value).toContain("Answer with only the JSON.")
        fireEvent.change(screen.getByLabelText("The chat's answer"), { target: { value: "I can't help with that." } })
        fireEvent.click(screen.getByRole("button", { name: "Read the answer" }))
        expect(screen.getByText(/had no cards in it/)).toBeTruthy()
    })

    it("works with the free uses spent and with the switch off", async () => {
        fake.status = { ...fake.status, left: 0 }
        fake.maintenance = "blocked"
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async () => {} } })
        await show()
        expect(screen.getByText(/switched off for a moment/)).toBeTruthy()
        expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true)
        fireEvent.click(screen.getByRole("tab", { name: "Use your own AI" }))
        expect((screen.getByRole("button", { name: "Copy prompt" }) as HTMLButtonElement).disabled).toBe(false)
    })
})

describe("Generate here", () => {
    it("shows the uses left, previews what came back and saves the cards as ai", async () => {
        fake.cards.mockResolvedValue({ cards: [{ front: "Q1", back: "A1" }], provider: "workers", left: 1 })
        await show()
        expect(screen.getByText(/2 of 3 free generations left today/)).toBeTruthy()
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate" })) })
        await waitFor(() => expect(screen.getByRole("button", { name: "Save 1 cards" })).toBeTruthy())
        expect(fake.cards).toHaveBeenCalledWith(expect.objectContaining({ count: 15, level: "exam", sources: expect.objectContaining({ topic: "Midterm" }) }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save 1 cards" })) })
        expect(fake.saved.cards[0]).toMatchObject({ front: "Q1", source: "ai" })
    })

    it("offers Use your own AI when the day's uses are spent", async () => {
        fake.cards.mockRejectedValue(new ApiError(429, { error: "study_ai_cap", paste: true }))
        await show({ group: null, topic: "Antibiotics", title: "Antibiotics" })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate" })) })
        expect(await screen.findByText(/Use your own AI has no limit/)).toBeTruthy()
    })

    it("says the server's model timeout took too long, and that the use came back", async () => {
        fake.cards.mockRejectedValue(new ApiError(504, { error: "ai_timeout" }))
        await show({ group: null, topic: "Antibiotics", title: "Antibiotics" })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate" })) })
        expect(await screen.findByText(/took too long, so this use is given back/)).toBeTruthy()
        expect(screen.queryByText(/needs a connection/)).toBeNull()
    })

    it("says a slow generation took too long, not that there is no connection", async () => {
        fake.cards.mockRejectedValue(new DOMException("The request timed out. Try again.", "TimeoutError"))
        await show({ group: null, topic: "Antibiotics", title: "Antibiotics" })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Generate" })) })
        expect(await screen.findByText(/took too long/)).toBeTruthy()
        expect(screen.queryByText(/needs a connection/)).toBeNull()
    })
})

describe("files", () => {
    it("reads text files and refuses Word files and big files", async () => {
        const txt = new File(["Beta blockers end in -olol"], "notes.txt", { type: "text/plain" })
        expect(await readStudyFile(txt)).toEqual({ text: "Beta blockers end in -olol" })
        const doc = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], "old.doc", { type: "application/msword" })
        expect(await readStudyFile(doc)).toEqual({ error: FILE_ERRORS.kind })
        const big = new File(["x"], "big.pdf")
        Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 })
        expect(await readStudyFile(big)).toEqual({ error: FILE_ERRORS.size })
    })
})
