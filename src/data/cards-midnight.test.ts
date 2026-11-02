import { afterEach, describe, expect, it, vi } from "vitest"
import { dueToday, reviewedToday, startedToday } from "./cards"

// Due counts across midnight (spec §10 Stage 3: "due counts correct across midnight"). The
// browser counts in its own local day (core/dates today()), so the clock is moved over local
// midnight and the same rows are counted again.
vi.mock("@/core/store", () => ({ data: {}, saveDeck: vi.fn(), saveCard: vi.fn(), saveReview: vi.fn(), deleteCard: vi.fn(), deleteDeck: vi.fn() }))
vi.mock("@/data/study-controller", () => ({ setView: vi.fn() }))
vi.mock("@/data/study", () => ({ setStudyTab: vi.fn() }))
vi.mock("./effective", () => ({ effectiveCourses: () => [] }))

const deck = { id: "d1", title: "D", courseId: null, classId: null, authorId: "u" }
const card = (i: number) => ({ id: "k" + String(i).padStart(2, "0"), deckId: "d1", front: "Q" + i, back: "A", source: "hand" as const, authorId: "u", createdAt: i })
const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min)
afterEach(() => { vi.useRealTimers() })

describe("flashcards across midnight", () => {
    it("a card due tomorrow joins today's count once the local day turns", () => {
        const f = { decks: [deck], cards: [card(1)], states: [{ id: "k01", due: "2026-11-03", interval: 1, ease: 2.5, reps: 1, lapses: 0 }], reviews: [], sharedDecks: [], sharedCards: [] }
        vi.useFakeTimers()
        vi.setSystemTime(local(2026, 11, 2, 23, 59))
        expect(dueToday(f)).toBe(0)
        vi.setSystemTime(local(2026, 11, 3, 0, 1))
        expect(dueToday(f)).toBe(1)
    })

    it("the 20 new cards a day start again at midnight, and yesterday's reviews no longer count as today's", () => {
        const cards = Array.from({ length: 45 }, (_, i) => card(i))
        /* 20 new cards were started on the 2nd: each has a schedule now, due on the 3rd */
        const started = cards.slice(0, 20)
        const reviews = started.map((c, i) => ({ id: "r" + i, cardRef: c.id, deckRef: "d1", day: "2026-11-02", grade: "good" as const, at: 1 }))
        const states = started.map((c) => ({ id: c.id, due: "2026-11-03", interval: 1, ease: 2.5, reps: 1, lapses: 0 }))
        const f = { decks: [deck], cards, states, reviews, sharedDecks: [], sharedCards: [] }
        vi.useFakeTimers()
        vi.setSystemTime(local(2026, 11, 2, 23, 30))
        expect(startedToday(reviews, "2026-11-02").size).toBe(20)
        expect(dueToday(f)).toBe(0)                    /* the day's 20 new are spent, none due yet */
        expect(reviewedToday(f)).toBe(true)
        vi.setSystemTime(local(2026, 11, 3, 0, 30))
        expect(dueToday(f)).toBe(20 + 20)              /* yesterday's 20 are due, and 20 more new */
        expect(reviewedToday(f)).toBe(false)
    })
})
