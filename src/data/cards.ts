// Flashcards (Study Buddy, Stage 3; spec §5, §9 Study › Cards): your decks and your classes'
// decks grouped by class, what is due today, and grading a card. Scheduling is core/srs.ts and
// runs here in the browser, so review works offline; a grade saves your card_state and a
// card_reviews row as one change, which syncs like any other.

import { useSyncExternalStore } from "react"
import { data, deleteCard, deleteDeck, saveCard, saveDeck, saveReview } from "@/core/store"
import { subscribe } from "@/bridge"
import { today as todayIso } from "@/core/dates"
import { uid } from "@/core/model"
import { grade as regrade, queue as srsQueue, type Grade, type Schedule } from "@/core/srs"
import type { Card, CardReview, CardState, Deck, SharedCard, SharedDeck } from "@/core/types"
import { effectiveCourses, type EffectiveCourse } from "./effective"
import { createStore } from "@/lib/store"
import { setView } from "./study-controller"
import { setStudyTab } from "./study"

/** A deck as the Cards tab shows it: yours (scope null) or a class's. */
export type AnyDeck = (Deck & { scope?: undefined }) | SharedDeck
export type AnyCard = (Card & { scope?: undefined }) | SharedCard

/** Which group a deck is in: one of your courses, a class, or neither. */
export const groupOf = (d: AnyDeck): string =>
    d.scope ? "class:" + d.scope.slice(2) : d.classId ? "class:" + d.classId : d.courseId ? "course:" + d.courseId : "none"

export interface CardGroup { key: string; name: string; color: string | null; decks: AnyDeck[]; cards: AnyCard[]; due: number }

/* Read with `??`: a test's fake store may hold none of these. */
const NONE: never[] = []
const snapshot = () => ({
    decks: data.decks ?? NONE, cards: data.cards ?? NONE, states: data.card_state ?? NONE, reviews: data.card_reviews ?? NONE,
    sharedDecks: data.shared_decks ?? NONE, sharedCards: data.shared_cards ?? NONE,
})
let last: ReturnType<typeof snapshot> | null = null
/* the same object until a collection changes, so a component redraws only then */
const read = () => {
    const s = snapshot()
    if (!last || Object.keys(s).some((k) => s[k as keyof typeof s] !== last![k as keyof typeof s])) last = s
    return last
}
export const useFlashcards = () => useSyncExternalStore(subscribe, read)
export type Flashcards = ReturnType<typeof snapshot>

/** Schedules by card id. */
export const scheduleMap = (states: CardState[]): Map<string, Schedule> => new Map(states.map((s) => [s.id, s]))

/** The cards whose first review is today: new cards started today, which count against the day's 20. */
export function startedToday(reviews: CardReview[], today: string): Set<string> {
    const first = new Map<string, string>()
    for (const r of reviews) if (!first.has(r.cardRef) || r.day < first.get(r.cardRef)!) first.set(r.cardRef, r.day)
    return new Set([...first].filter(([, d]) => d === today).map(([id]) => id))
}

const courseName = (c: EffectiveCourse | undefined) => (c ? (c.code ? `${c.code} · ${c.name}` : c.name) || "Untitled course" : null)

/** Your decks and your classes' decks, grouped by course or class, each with what is due today. */
export function groups(f: Flashcards, courses: EffectiveCourse[] = effectiveCourses(), today = todayIso()): CardGroup[] {
    const decks: AnyDeck[] = [...f.decks, ...f.sharedDecks]
    const cards: AnyCard[] = [...f.cards, ...f.sharedCards]
    const states = scheduleMap(f.states)
    const started = startedToday(f.reviews, today)
    const map = new Map<string, CardGroup>()
    for (const d of decks) {
        const key = groupOf(d)
        let g = map.get(key)
        if (!g) {
            const course = key.startsWith("course:") ? courses.find((c) => !c.spaceId && c.id === key.slice(7))
                : key.startsWith("class:") ? courses.find((c) => c.spaceId === key.slice(6)) : undefined
            g = { key, name: courseName(course) ?? (key === "none" ? "No class" : "A class you left"), color: course?.color ?? null, decks: [], cards: [], due: 0 }
            map.set(key, g)
        }
        g.decks.push(d)
    }
    for (const g of map.values()) {
        const ids = new Set(g.decks.map((d) => d.id))
        g.cards = cards.filter((c) => ids.has(c.deckId) && (c.scope ?? null) === (g.decks.find((d) => d.id === c.deckId)?.scope ?? null))
        g.due = dueOf(g.cards, states, started, today)
    }
    return [...map.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name))
}

/* due cards and new cards up to the day's 20 less those already started today (per group, spec §5) */
function dueOf(cards: AnyCard[], states: Map<string, Schedule>, started: Set<string>, today: string): number {
    return reviewQueue(cards, states, started, today).length
}

/** Today's queue for some cards: due first (oldest first), then new ones in deck order. */
export function reviewQueue(cards: AnyCard[], states: Map<string, Schedule>, started: Set<string>, today: string): AnyCard[] {
    const startedHere = cards.filter((c) => started.has(c.id)).length
    return srsQueue(cards.map((c) => ({ ...c, createdAt: c.createdAt ?? 0 })), states, today, startedHere) as AnyCard[]
}

/** Every card due today across your groups: the Week chip and the badge's tired face. */
export const dueToday = (f: Flashcards, today = todayIso()): number => groups(f, [], today).reduce((n, g) => n + g.due, 0)
/** Whether you reviewed any card today. */
export const reviewedToday = (f: Flashcards, today = todayIso()): boolean => f.reviews.some((r) => r.day === today)

/** Grade a card on `today`: your new schedule and the review, saved as one change. */
export function gradeCard(card: AnyCard, g: Grade, states: CardState[], today = todayIso()) {
    const before = states.find((s) => s.id === card.id) ?? null
    const next = regrade(before, g, today)
    return saveReview({ ...(before ?? {}), id: card.id, ...next }, { id: uid(), cardRef: card.id, deckRef: card.deckId, day: today, grade: g, at: Date.now() })
}

/* ── editing your own decks and cards ── */
export const DECK_TITLE_MAX = 80
export const FRONT_MAX = 500
export const BACK_MAX = 1000

/** A new deck, filed under one of your courses or a class when given. */
export function newDeck(title: string, group: string, authorId: string): Promise<unknown> {
    const courseId = group.startsWith("course:") ? group.slice(7) : null
    const classId = group.startsWith("class:") ? group.slice(6) : null
    return saveDeck({ id: uid(), title: title.trim().slice(0, DECK_TITLE_MAX), courseId, classId, authorId })
}
export const renameDeck = (d: Deck, title: string) => saveDeck({ ...d, title: title.trim().slice(0, DECK_TITLE_MAX) })
export const removeDeck = (id: string) => deleteDeck(id)
export function putCard(deckId: string, front: string, back: string, authorId: string, card?: Card): Promise<unknown> {
    return saveCard({ ...(card ?? { id: uid(), source: "hand" as const }), deckId, authorId: card?.authorId ?? authorId, front: front.trim().slice(0, FRONT_MAX), back: back.trim().slice(0, BACK_MAX) })
}
export const removeCard = (id: string) => deleteCard(id)

/* ── which Cards screen is open: the list, a deck's editor, or a review ── */
export type CardsScreen = { mode: "home" } | { mode: "deck"; id: string } | { mode: "review"; group: string | null }
    | { mode: "generate"; group: string | null; topic?: string; text?: string; title?: string }
const screenStore = createStore<{ screen: CardsScreen }>({ screen: { mode: "home" } })
export const useCardsScreen = () => screenStore.use().screen
export const showCards = (screen: CardsScreen) => screenStore.set({ screen })
/** Open Study › Cards on a review: one group's cards, or every group's (null). The Week chip uses it. */
/** What Make cards from an exam starts with: its class, its title as the topic, its notes and prep topics as text. */
export function prepStart(it: { title: string; notes?: string; checklist?: { text: string }[] }, group: string | null) {
    const topics = (it.checklist || []).map((c) => c.text.trim()).filter(Boolean)
    const text = [it.notes?.trim() || "", topics.length ? "Topics to know: " + topics.join("; ") : ""].filter(Boolean).join("\n\n")
    return { group, topic: it.title.slice(0, 120), text, title: it.title }
}
/** Open Study › Cards on Make cards with AI, filled in: the class, and an exam's title or a lecture's notes. */
export function openGenerate(start: { group: string | null; topic?: string; text?: string; title?: string }) {
    showCards({ mode: "generate", ...start })
    setView("study")
    setStudyTab("cards")
}
export function openReview(group: string | null = null) {
    showCards({ mode: "review", group })
    setView("study")
    setStudyTab("cards")
}
