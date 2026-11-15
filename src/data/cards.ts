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
import { showStudyPage } from "./study-controller"
import { setStudyTab } from "./study"

/** A deck as the Cards tab shows it: yours (scope null) or a class's. */
export type AnyDeck = (Deck & { scope?: undefined }) | SharedDeck
export type AnyCard = (Card & { scope?: undefined }) | SharedCard

/** Which group a deck is in: one of your courses, a class, or neither. */
export const groupOf = (d: AnyDeck): string =>
    d.scope ? "class:" + d.scope.slice(2) : d.classId ? "class:" + d.classId : d.courseId ? "course:" + d.courseId : "none"

/** `queue` is today's review for the group, in order; `due` is how many it holds. */
export interface CardGroup { key: string; name: string; color: string | null; decks: AnyDeck[]; cards: AnyCard[]; due: number; queue: AnyCard[] }

/** A deck within its group: yours and a class's can share an id, so the scope is part of it. */
export const deckRef = (d: { id: string; scope?: string | null }): string => (d.scope ?? "") + "/" + d.id
const cardDeckRef = (c: AnyCard): string => (c.scope ?? "") + "/" + c.deckId

/** A card whose interval has reached this many days counts as known. */
export const KNOWN_DAYS = 21
export interface DeckStat { cards: number; due: number; fresh: number; learning: number; known: number }
/** One deck's numbers: its cards, how many are in today's review, and how many are new, being learned and known. */
export function deckStat(g: CardGroup, d: AnyDeck, states: Map<string, Schedule>): DeckStat {
    const ref = deckRef(d)
    const out: DeckStat = { cards: 0, due: g.queue.filter((c) => cardDeckRef(c) === ref).length, fresh: 0, learning: 0, known: 0 }
    for (const c of g.cards) {
        if (cardDeckRef(c) !== ref) continue
        out.cards++
        const s = states.get(c.id)
        if (!s) out.fresh++
        else if (s.interval >= KNOWN_DAYS) out.known++
        else out.learning++
    }
    return out
}

/** Today's review: every group's queue, one group's, or one deck's within its group. */
export function reviewCards(list: CardGroup[], group: string | null, deck?: string | null): AnyCard[] {
    const cards = (group ? list.filter((g) => g.key === group) : list).flatMap((g) => g.queue)
    return deck ? cards.filter((c) => cardDeckRef(c) === deck) : cards
}

/** When the soonest of these cards comes back after today, and how many do that day; null when none are scheduled. */
export function nextDue(cards: AnyCard[], states: Map<string, Schedule>, today: string): { date: string; count: number } | null {
    const later = cards.map((c) => states.get(c.id)?.due).filter((d): d is string => !!d && d > today).sort()
    return later.length ? { date: later[0], count: later.filter((d) => d === later[0]).length } : null
}

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
            /* only a class can be left: a deck keeps the id of a course of your own after you delete the course, and then it has no class */
            g = { key, name: courseName(course) ?? (key.startsWith("class:") ? "A class you left" : "No class"), color: course?.color ?? null, decks: [], cards: [], due: 0, queue: [] }
            map.set(key, g)
        }
        g.decks.push(d)
    }
    for (const g of map.values()) {
        /* deck id to its scope: one lookup per card, not a search of the group's decks */
        const scopes = new Map<string, string | null>()
        for (const d of g.decks) if (!scopes.has(d.id)) scopes.set(d.id, d.scope ?? null)
        g.cards = cards.filter((c) => scopes.has(c.deckId) && (c.scope ?? null) === scopes.get(c.deckId))
        /* due cards and new cards up to the day's 20 less those already started today (per group, spec §5) */
        g.queue = reviewQueue(g.cards, states, started, today)
        g.due = g.queue.length
    }
    return [...map.values()].sort((a, b) => b.due - a.due || a.name.localeCompare(b.name))
}

/** Today's queue for some cards: due first (oldest first), then new ones in deck order. */
export function reviewQueue(cards: AnyCard[], states: Map<string, Schedule>, started: Set<string>, today: string): AnyCard[] {
    const startedHere = cards.filter((c) => started.has(c.id)).length
    return srsQueue(cards.map((c) => ({ ...c, createdAt: c.createdAt ?? 0 })), states, today, startedHere) as AnyCard[]
}

/** Every card due today across your groups: the Week chip and the badge's tired face. */
export function dueToday(f: Flashcards, today = todayIso()): number {
    /* the badge and the Week ask on every render: the snapshot keeps its identity until a collection changes */
    if (dueMemo?.f === f && dueMemo.today === today) return dueMemo.n
    const n = groups(f, [], today).reduce((sum, g) => sum + g.due, 0)
    dueMemo = { f, today, n }
    return n
}
let dueMemo: { f: Flashcards; today: string; n: number } | null = null
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
export type CardsScreen = { mode: "home" } | { mode: "deck"; id: string } | { mode: "review"; group: string | null; deck?: string | null }
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
    showStudyPage()
    setStudyTab("cards")
}
export function openReview(group: string | null = null, deck: string | null = null) {
    showCards({ mode: "review", group, deck })
    showStudyPage()
    setStudyTab("cards")
}
