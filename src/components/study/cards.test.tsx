import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

// Study › Cards (Study Buddy, Stage 3): groups with what's due, a deck's editor, the review
// screen (flip with Space, check = right, X = wrong, a wrong card comes back once), the Week chip and the
// badge's tired face. The store is a fake: each save replaces its array and notifies.
const fake = vi.hoisted(() => ({
    data: { decks: [] as any[], cards: [] as any[], card_state: [] as any[], card_reviews: [] as any[], shared_decks: [] as any[], shared_cards: [] as any[] },
    view: vi.fn(), tab: vi.fn(),
    delay: 0,          /* how long a review's save takes, in ms: the real one is an IndexedDB write and a reload */
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
        saveReview: async (state: any, review: any) => { if (fake.delay) await new Promise((r) => setTimeout(r, fake.delay)); put("card_state", state); put("card_reviews", review); notify() },
        deleteCard: async (id: string) => { del("cards", (r) => r.id === id); del("card_state", (r) => r.id === id); notify() },
        deleteDeck: async (id: string) => { const ids = fake.data.cards.filter((c) => c.deckId === id).map((c) => c.id); del("decks", (r) => r.id === id); del("cards", (r) => ids.includes(r.id)); notify() },
    }
})
vi.mock("@/data/store", () => ({ useCourses: () => [{ id: "pharm", code: "PHARM", name: "Pharmacology", color: "#4F74D9", archived: false }], useProfile: () => ({ id: "u-me" }) }))
vi.mock("@/data/effective", () => ({ effectiveCourses: () => [] }))
/* showStudyPage is how a review opens Study (data/cards.ts): recorded with the views asked for */
vi.mock("@/data/study-controller", () => ({ setView: fake.view, showStudyPage: () => fake.view("study") }))
vi.mock("@/data/study", () => ({ setStudyTab: fake.tab }))
vi.mock("@/core/dates", async (orig) => ({ ...(await orig<object>()), today: () => "2026-11-02" }))

import { CardsCard } from "./cards"
import { CardsChip } from "@/components/views/week"
import { showCards } from "@/data/cards"

const deck = (id: string, over = {}) => ({ id, title: "Beta blockers", courseId: "pharm", classId: null, authorId: "u-me", ...over })
const card = (id: string, deckId = "d1", over = {}) => ({ id, deckId, front: "Front " + id, back: "Back " + id, source: "hand", authorId: "u-me", createdAt: Number(id.slice(1)), ...over })

beforeEach(() => {
    for (const k of Object.keys(fake.data) as (keyof typeof fake.data)[]) fake.data[k] = []
    fake.delay = 0
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

    it("reviews with the keyboard: Space flips, 2 = right, 1 = wrong; a wrong card comes back once, and the tally counts", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Review all 2" }))
        const box = screen.getByLabelText("Flashcard. Press Space to flip, then 2 if you were right or 1 if you were wrong")
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
        await act(async () => { fireEvent.keyDown(box, { key: "2" }) })     /* Right on k2 */
        expect(fake.data.card_state.find((s) => s.id === "k2")).toMatchObject({ interval: 1, reps: 1 })
        expect(screen.getByText("Front k1")).toBeTruthy()
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "1" }) })     /* Again a second time: not requeued */
        expect(screen.getByText("All done for today")).toBeTruthy()
        expect(fake.data.card_reviews.map((r) => [r.cardRef, r.grade, r.day, r.deckRef])).toEqual([
            ["k1", "again", "2026-11-02", "d1"], ["k2", "good", "2026-11-02", "d1"], ["k1", "again", "2026-11-02", "d1"],
        ])
        expect(screen.getByText("1 right")).toBeTruthy()
        expect(screen.getByText("2 wrong")).toBeTruthy()
    })

    it("answers with the buttons: click to flip, Space on a focused Right stays the button's own, and the tally counts", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Review all 2" }))
        fireEvent.click(screen.getByRole("button", { name: "Show the answer" }))
        expect(screen.getByText("Back k1")).toBeTruthy()
        /* a focused answer button keeps its own Space/Enter, so its click can answer the card */
        expect(fireEvent.keyDown(screen.getByRole("button", { name: /Right/ }), { key: " " })).toBe(true)
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Right/ })) })
        expect(fake.data.card_reviews.map((r) => r.grade)).toEqual(["good"])
        fireEvent.click(screen.getByRole("button", { name: "Show the answer" }))
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Wrong/ })) })
        expect(screen.getByText("1 right")).toBeTruthy()
        expect(screen.getByText("1 wrong")).toBeTruthy()
     })

    it("shows what is due in each deck, how well it is known, and reviews one deck on its own", async () => {
        fake.data.decks = [deck("d1"), deck("d2", { title: "Antibiotics" })]
        fake.data.cards = [card("k1"), card("k2"), card("k3", "d2"), card("k4", "d2")]
        fake.data.card_state = [{ id: "k4", due: "2026-12-01", interval: 30, ease: 2.5, reps: 4, lapses: 0 }]   /* known, not due */
        render(<CardsCard />)
        expect(screen.getByText("2 due")).toBeTruthy()                         /* Beta blockers: both new */
        expect(screen.getByRole("img", { name: "Antibiotics: 1 new, 0 learning, 1 known" })).toBeTruthy()
        fireEvent.click(screen.getByRole("button", { name: "Review Antibiotics, 1 due" }))
        expect(screen.getByText("1 of 1")).toBeTruthy()
        expect(screen.getByText("Front k3")).toBeTruthy()
        fireEvent.keyDown(screen.getByLabelText(/^Flashcard/), { key: " " })
        await act(async () => { fireEvent.keyDown(screen.getByLabelText(/^Flashcard/), { key: "2" }) })
        /* only that deck was reviewed, and the end says when cards come back */
        expect(fake.data.card_reviews.map((r) => r.cardRef)).toEqual(["k3"])
        expect(screen.getByText("All done for today")).toBeTruthy()
        expect(screen.getByText("Next up: 1 card tomorrow.")).toBeTruthy()
    })

    it("a second press while the answer is still saving does nothing: one review, and the next card shows", async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1"), card("k2"), card("k3")]
        fake.delay = 40
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Review all 3" }))
        const box = screen.getByLabelText(/^Flashcard/)
        fireEvent.keyDown(box, { key: " " })
        await act(async () => {
            fireEvent.keyDown(box, { key: "2" })
            await sleep(10)
            fireEvent.keyDown(box, { key: "2" })                              /* while the 40 ms save is under way */
            fireEvent.click(screen.getByRole("button", { name: /Right/ }))    /* and the button too */
            await sleep(120)
        })
        expect(fake.data.card_reviews.map((r) => r.cardRef)).toEqual(["k1"])
        expect(screen.getByText("2 of 3")).toBeTruthy()
        expect(screen.getByText("Front k2")).toBeTruthy()
        expect(screen.getByText("1 right")).toBeTruthy()
        /* Wrong twice in the window: one review, and the card is queued once more, not twice */
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "1" }); await sleep(10); fireEvent.keyDown(box, { key: "1" }); await sleep(120) })
        expect(fake.data.card_reviews.map((r) => [r.cardRef, r.grade])).toEqual([["k1", "good"], ["k2", "again"]])
        expect(screen.getByText("3 of 4")).toBeTruthy()
    })

    it("counts each card once at the end, however often it came back", async () => {
        fake.data.decks = [deck("d1")]
        fake.data.cards = [card("k1")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Review all 1" }))
        const box = screen.getByLabelText(/^Flashcard/)
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "1" }) })
        fireEvent.keyDown(box, { key: " " })
        await act(async () => { fireEvent.keyDown(box, { key: "2" }) })
        expect(screen.getByText("You reviewed 1 card. They'll come back when they're due.")).toBeTruthy()
    })

    it("lists a deck whose own course was deleted under No class, not as a class you left", () => {
        fake.data.decks = [deck("d1", { courseId: "gone" }), deck("d2", { courseId: null, classId: "abcdefghij12", title: "Old class deck" })]
        fake.data.cards = [card("k1")]
        render(<CardsCard />)
        expect(screen.getByRole("region", { name: "No class" })).toBeTruthy()
        expect(screen.getByRole("region", { name: "A class you left" })).toBeTruthy()      /* a class's deck keeps that name */
    })

    it("opens a deck from its name", () => {
        fake.data.decks = [deck("d1")]
        render(<CardsCard />)
        fireEvent.click(screen.getByRole("button", { name: "Open Beta blockers" }))
        expect(screen.getByRole("region", { name: "Edit deck" })).toBeTruthy()
    })

    it("with no decks yet, says how to start", () => {
        render(<CardsCard />)
        expect(screen.getByText("No decks yet")).toBeTruthy()
        expect(screen.getByRole("button", { name: "Add deck" })).toBeTruthy()
        expect(screen.getByRole("button", { name: "Make cards with AI" })).toBeTruthy()
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
