import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

// Study › Cards (Study Buddy, Stage 3): groups with what's due, a deck's editor, the review
// screen (flip with Space, grade with 1/2/3, Again comes back once), the Week chip and the
// badge's tired face. The store is a fake: each save replaces its array and notifies.
const fake = vi.hoisted(() => ({
    data: { decks: [] as any[], cards: [] as any[], card_state: [] as any[], card_reviews: [] as any[], shared_decks: [] as any[], shared_cards: [] as any[] },
    view: vi.fn(), tab: vi.fn(),
}))
vi.mock("@/core/store", async () => {
    const { notify } = await import("@/bridge")
    const put = (kind: keyof typeof fake.data, row: any) => {
        const r = { createdAt: Date.now(), revision: 0, ...row }
        fake.data[kind] = [...fake.data[kind].filter((x) => x.id !== r.id), r]
    }
    const del = (kind: keyof typeof fake.data, test: (r: any) => boolean) => { fake.data[kind] = fake.data[kind].filter((r) => !test(r)) }
    return {
        data: fake.data,
        saveDeck: async (row: any) => { put("decks", row); notify() },
        saveCard: async (row: any) => { put("cards", row); notify() },
        saveReview: async (state: any, review: any) => { put("card_state", state); put("card_reviews", review); notify() },
        deleteCard: async (id: string) => { del("cards", (r) => r.id === id); del("card_state", (r) => r.id === id); notify() },
        deleteDeck: async (id: string) => { const ids = fake.data.cards.filter((c) => c.deckId === id).map((c) => c.id); del("decks", (r) => r.id === id); del("cards", (r) => ids.includes(r.id)); notify() },
    }
})
vi.mock("@/data/store", () => ({ useCourses: () => [{ id: "pharm", code: "PHARM", name: "Pharmacology", color: "#4F74D9", archived: false }], useProfile: () => ({ id: "u-me" }) }))
vi.mock("@/data/effective", () => ({ effectiveCourses: () => [] }))
vi.mock("@/data/study-controller", () => ({ setView: fake.view }))
vi.mock("@/data/study", () => ({ setStudyTab: fake.tab }))
vi.mock("@/core/dates", async (orig) => ({ ...(await orig<object>()), today: () => "2026-11-02" }))

import { CardsCard } from "./cards"
import { CardsChip } from "@/components/views/week"
import { showCards } from "@/data/cards"

const deck = (id: string, over = {}) => ({ id, title: "Beta blockers", courseId: "pharm", classId: null, authorId: "u-me", ...over })
const card = (id: string, deckId = "d1", over = {}) => ({ id, deckId, front: "Front " + id, back: "Back " + id, source: "hand", authorId: "u-me", createdAt: Number(id.slice(1)), ...over })

beforeEach(() => {
    for (const k of Object.keys(fake.data) as (keyof typeof fake.data)[]) fake.data[k] = []
    showCards({ mode: "home" })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("Study › Cards", () => {
    it("groups decks by class with what's due, and adds a deck", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2"), card("k3")]
        fake.data.card_state = [{ id: "k3", due: "2026-12-01", interval: 30, ease: 2.5, reps: 3, lapses: 0 }]   /* not due */
        render(<CardsCard />)
        expect(screen.getByRole("region", { name: "PHARM · Pharmacology" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Review 2" })).toBeTruthy()
        expect(screen.getByText("3 cards")).toBeTruthy()
        fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Antibiotics " } })
        fireEvent.change(screen.getByLabelText("Class"), { target: { value: "course:pharm" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add deck" })) })
        expect(fake.data.decks.map((d) => [d.title, d.courseId, d.authorId])).toContainEqual(["Antibiotics", "pharm", "u-me"])
    })

    it("edits a deck: adds, edits and deletes cards", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Edit" }))
        fireEvent.change(screen.getByLabelText("Front", { selector: "#front-new" }), { target: { value: "Propranolol class?" } })
        fireEvent.change(screen.getByLabelText("Back", { selector: "#back-new" }), { target: { value: "Non-selective beta blocker" } })
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add card" })) })
        expect(fake.data.cards.map((c) => c.front)).toContain("Propranolol class?")
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete card: Front k1" })) })
        expect(fake.data.cards.map((c) => c.id)).not.toContain("k1")
    })

    it("reviews with the keyboard: Space flips, 1/2/3 grade; Again comes back once at the end", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Review all 2" }))
        const box = screen.getByLabelText("Card, press Space to flip, then 1, 2 or 3")
        expect(screen.getByText("1 of 2")).toBeTruthy()
        expect(screen.queryByText("Back k1")).toBeNull()
        fireEvent.keyDown(box, { key: "1" })                                  /* not flipped yet: nothing */
        expect(fake.data.card_reviews).toHaveLength(0)
        fireEvent.keyDown(box, { key: " " })
        expect(screen.getByText("Back k1")).toBeTruthy()
        await act(async () => { fireEvent.keyDown(box, { key: "1" }) })     /* Again */
        expect(fake.data.card_state.find((s) => s.id === "k1")).toMatchObject({ interval: 1, lapses: 1, due: "2026-11-03" })
        expect(screen.getByText("2 of 3")).toBeTruthy()                       /* k1 went to the back */
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "3" }) })     /* Easy on k2 */
        expect(fake.data.card_state.find((s) => s.id === "k2")).toMatchObject({ interval: 4, reps: 1 })
        expect(screen.getByText("Front k1")).toBeTruthy()
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "1" }) })     /* Again a second time: not requeued */
        expect(screen.getByText("All done for today")).toBeTruthy()
        expect(fake.data.card_reviews.map((r) => [r.cardRef, r.grade, r.day, r.deckRef])).toEqual([
            ["k1", "again", "2026-11-02", "d1"], ["k2", "easy", "2026-11-02", "d1"], ["k1", "again", "2026-11-02", "d1"],
        ])
    })

    it("a class's shared deck shows, reviews, and has no Edit", () => {
        fake.data.shared_decks = [{ ...deck("sd1", { courseId: null }), scope: "c:abcdefghij12" }]
        fake.data.shared_cards = [{ ...card("k9", "sd1"), scope: "c:abcdefghij12" }]
        render(<CardsCard />)
        expect(screen.getByText(/shared with the class/)).toBeTruthy()
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
        expect(screen.getByRole("button", { name: "Review 1" })).toBeTruthy()
    })
})

describe("the Week chip", () => {
    it("shows the cards due today and opens the review", () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2")]
        render(<CardsChip />)
        fireEvent.click(screen.getByRole("button", { name: "2 cards due" }))
        expect(fake.view).toHaveBeenCalledWith("study")
        expect(fake.tab).toHaveBeenCalledWith("cards")
    })

    it("is hidden with nothing due", () => {
        expect(render(<CardsChip />).container.textContent).toBe("")
    })
})
