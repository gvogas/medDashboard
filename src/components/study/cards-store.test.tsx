import "fake-indexeddb/auto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

// Flashcards on the real store (core/store.ts on IndexedDB, here fake-indexeddb), with the real
// page-wide keyboard handler (data/keyboard.ts) listening on the document as boot.ts installs it.
// The other Cards tests swap the store for a fake and leave the handler out, which is how the
// 1/2/3 shortcut clash got past them. Every save is counted: a review writes exactly one
// card_state and one card_reviews row per grade, and nothing else.
const views = vi.hoisted(() => ({ calls: [] as string[] }))
const ui = vi.hoisted(() => ({ view: "study", focus: false, studyTab: "cards" }))
vi.mock("@/data/ui", async () => (await import("@/data/fake-ui")).fakeUi(ui))
vi.mock("@/data/study-controller", () => ({ setView: (v: string) => { views.calls.push(v); ui.view = v } }))
vi.mock("@/data/study", () => ({ setStudyTab: vi.fn() }))
vi.mock("@/data/actions", () => ({ newItem: vi.fn(), goToday: vi.fn(), step: vi.fn() }))
vi.mock("@/data/study-timer", () => ({ escapeFocus: vi.fn() }))
vi.mock("@/data/sidebar", () => ({ setSide: vi.fn(), sideOpen: () => false }))
vi.mock("@/data/ai-read", () => ({ getBusy: () => null }))
vi.mock("@/core/api", () => ({ api: { studyAi: { status: async () => ({ providers: [], left: 0, perUser: 3, extraLeft: 0, globalOpen: true }) } }, ApiError: class extends Error {} }))

import * as store from "@/core/store"
import { onKeydown } from "@/data/keyboard"
import { showApp } from "@/data/signin"
import { showCards } from "@/data/cards"
import { CardsCard } from "./cards"

const profile = { id: "u-int-" + Math.random().toString(36).slice(2, 8), username: "int", revision: 1, coat: {} }
const kinds = async () => (await store.pending()).map((op) => op.key.split(":")[0]).sort()

beforeAll(async () => {
    showApp()
    document.addEventListener("keydown", onKeydown)
    await store.open(profile)
})
afterEach(() => { cleanup(); views.calls = [] })
afterAll(async () => { document.removeEventListener("keydown", onKeydown); await store.close() })

describe("flashcards on the real store, with the page's shortcuts on", () => {
    it("saves a deck and cards made in the editor, queued to upload", async () => {
        showCards({ mode: "home" })
        render(<CardsCard />)
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Antibiotics" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add deck" })) })
        fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
        for (const [f, b] of [["Penicillin target?", "Cell wall"], ["Vancomycin route for C. diff?", "Oral"]]) {
            fireEvent.change(screen.getByLabelText("Front", { selector: "#front-new" }), { target: { value: f } })
            fireEvent.change(screen.getByLabelText("Back", { selector: "#back-new" }), { target: { value: b } })
            const n = store.data.cards.length
            fireEvent.click(screen.getByRole("button", { name: "Add card" }))
            await waitFor(() => expect(store.data.cards.length).toBe(n + 1))
        }
        expect(store.data.decks.map((d) => d.title)).toEqual(["Antibiotics"])
        expect(store.data.cards.map((c) => [c.front, c.source, c.authorId])).toEqual(expect.arrayContaining([["Penicillin target?", "hand", profile.id], ["Vancomycin route for C. diff?", "hand", profile.id]]))
        expect(await kinds()).toEqual(["cards", "cards", "decks"])
    })

    it("clears the new-card form at once, so typing the next card while the last one saves loses nothing", async () => {
        showCards({ mode: "home" })
        render(<CardsCard />)
        fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
        const front = () => screen.getByLabelText("Front", { selector: "#front-new" }) as HTMLTextAreaElement
        const back = () => screen.getByLabelText("Back", { selector: "#back-new" }) as HTMLTextAreaElement
        const n = store.data.cards.length
        fireEvent.change(front(), { target: { value: "Fast one?" } }); fireEvent.change(back(), { target: { value: "Yes" } })
        fireEvent.click(screen.getByRole("button", { name: "Add card" }))
        /* before the save has finished, the next card is typed */
        fireEvent.change(front(), { target: { value: "Fast two?" } }); fireEvent.change(back(), { target: { value: "Also" } })
        await waitFor(() => expect(store.data.cards.length).toBe(n + 1))
        await act(async () => {})
        expect([front().value, back().value]).toEqual(["Fast two?", "Also"])
        fireEvent.click(screen.getByRole("button", { name: "Add card" }))
        await waitFor(() => expect(store.data.cards.length).toBe(n + 2))
        for (const f of ["Fast one?", "Fast two?"]) await act(async () => { await store.deleteCard(store.data.cards.find((c) => c.front === f)!.id) })
    })

    it("grades with 1 (wrong) and 2 (right) without switching pages, and saves exactly one schedule and one review per grade", async () => {
        showCards({ mode: "home" })
        render(<CardsCard />)
        fireEvent.click(await screen.findByRole("button", { name: "Review all 2" }))
        const box = screen.getByRole("group", { name: "Flashcard. Press Space to flip, then 2 if you were right or 1 if you were wrong" })
        const before = { reviews: store.data.card_reviews.length, states: store.data.card_state.length }
        await act(async () => { fireEvent.keyDown(box, { key: "2" }) })          /* not flipped: no grade, and no page change */
        expect(store.data.card_reviews.length).toBe(before.reviews)
        await act(async () => { fireEvent.keyDown(box, { key: " " }) })
        const grade = async (key: string, n: number) => {
            await act(async () => { fireEvent.keyDown(box, { key: " " }) })
            fireEvent.keyDown(box, { key })
            await waitFor(() => expect(store.data.card_reviews.length).toBe(before.reviews + n))
        }
        await grade("1", 1)                                                      /* wrong: the card goes to the back */
        await grade("2", 2)                                                      /* right */
        await grade("2", 3)
        expect(await screen.findByText("All done for today")).toBeTruthy()
        expect(views.calls).toEqual(["study"])                                   /* Review all opened Study; 1 and 2 never reached the page's shortcuts */
        expect(ui.view).toBe("study")
        expect(store.data.card_reviews.map((r) => r.grade).sort()).toEqual(["again", "good", "good"])
        expect(store.data.card_state.length).toBe(2)
        expect((await kinds()).filter((k) => k.startsWith("card_"))).toEqual(["card_reviews", "card_reviews", "card_reviews", "card_state", "card_state"])
    })

    it("keeps everything after the store is closed and opened again, as a reload does", async () => {
        await store.close()
        await store.open(profile)
        expect(store.data.decks.length).toBe(1)
        expect(store.data.cards.length).toBe(2)
        expect(store.data.card_reviews.length).toBe(3)
        expect(store.data.card_state.every((s) => s.reps >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.due))).toBe(true)
    })

    it("saves pasted AI cards into a new deck on the real store, marked as pasted", async () => {
        showCards({ mode: "generate", group: null, topic: "Antivirals", title: "Antivirals" })
        render(<CardsCard />)
        fireEvent.click(await screen.findByRole("tab", { name: "Use your own AI" }))
        fireEvent.change(screen.getByLabelText("The chat's answer"), { target: { value: '{"cards":[{"front":"Acyclovir target?","back":"Viral DNA polymerase"},{"front":"Oseltamivir target?","back":"Neuraminidase"}]}' } })
        fireEvent.click(screen.getByRole("button", { name: "Read the answer" }))
        const cards = store.data.cards.length, decks = store.data.decks.length
        fireEvent.click(screen.getByRole("button", { name: "Save 2 cards" }))
        await waitFor(() => expect(store.data.cards.length).toBe(cards + 2))
        expect(store.data.decks.length).toBe(decks + 1)
        const deck = store.data.decks.find((d) => d.title === "Antivirals")!
        expect(store.data.cards.filter((c) => c.deckId === deck.id).map((c) => [c.source, c.authorId])).toEqual([["paste", profile.id], ["paste", profile.id]])
        expect(await screen.findByText("Flashcards")).toBeTruthy()             /* back on the list */
    })

    it("away from the review, the same key still switches pages (the shortcut is not broken)", async () => {
        const e = new KeyboardEvent("keydown", { key: "2", bubbles: true, cancelable: true })
        await act(async () => { document.body.dispatchEvent(e) })
        expect(views.calls).toEqual(["month"])
        ui.view = "study"
    })
})
