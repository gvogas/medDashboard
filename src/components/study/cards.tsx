// Study › Cards (spec §9): your decks and your classes' decks grouped by class, each group with
// what is due today and Review; a deck's editor (title, then its cards, front and back); and the
// review screen: the front, Space or a tap to flip, then Again / Good / Easy (keys 1, 2, 3). A card
// graded Again comes back once at the end of today's queue. Everything is saved on this device
// first and syncs (data/cards.ts), so it all works offline.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { Panel, HeadNote } from "@/components/views/bits"
import { Button, Note, Select, TextArea, TextInput } from "@/components/sheet/fields"
import { today as todayIso } from "@/core/dates"
import type { Grade } from "@/core/srs"
import type { Card } from "@/core/types"
import { useCourses, useProfile } from "@/data/store"
import { GenerateCards } from "./generate"
import {
    BACK_MAX, DECK_TITLE_MAX, FRONT_MAX, gradeCard, groups, newDeck, openReview, putCard, removeCard, removeDeck, renameDeck,
    reviewQueue, scheduleMap, showCards, startedToday, useCardsScreen, useFlashcards, type AnyCard, type CardGroup,
} from "@/data/cards"

const SMALL = "text-[12.5px] text-muted-foreground"
const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

export function CardsCard() {
    const f = useFlashcards()
    const courses = useCourses()
    const screen = useCardsScreen()
    const list = useMemo(() => groups(f, courses), [f, courses])
    if (screen.mode === "deck") return <DeckEditor id={screen.id} />
    if (screen.mode === "review") return <Review group={screen.group} list={list} />
    if (screen.mode === "generate") return <GenerateCards start={screen} />
    return <CardsHome list={list} />
}

function CardsHome({ list }: { list: CardGroup[] }) {
    const me = useProfile()?.id ?? ""
    const courses = useCourses()
    const [title, setTitle] = useState("")
    const [group, setGroup] = useState("none")
    const [error, setError] = useState("")
    const total = list.reduce((n, g) => n + g.due, 0)
    const own = courses.filter((c) => !c.archived)
    const add = async () => {
        if (!title.trim()) return
        try { await newDeck(title, group, me); setTitle("") } catch { setError("That deck couldn't be saved on this device.") }
    }
    return (
        <div className="grid gap-4">
            <Panel title="Flashcards" label="Flashcards" head={<HeadNote>{total ? `${plural(total, "card")} due today` : "Nothing due today"}</HeadNote>}>
                <div className="flex flex-wrap items-center gap-3 p-4">
                    <p className={cn(SMALL, "m-0 flex-1 basis-[260px]")}>Make a deck for a class, add cards, and review what's due each day. Cards you know come back less often; ones you miss come back tomorrow.</p>
                    <Button variant="ghost" onClick={() => showCards({ mode: "generate", group: null })}>Make cards with AI</Button>
                    <Button variant="study" disabled={!total} onClick={() => openReview(null)}>{total ? `Review all ${total}` : "All caught up"}</Button>
                </div>
            </Panel>
            {list.map((g) => (
                <Panel key={g.key} label={g.name} title={<span className="flex items-center gap-2">{g.color && <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: g.color }} />}{g.name}</span>}
                    head={<span className="flex gap-2">
                        {g.key !== "none" && <Button variant="ghost" onClick={() => showCards({ mode: "generate", group: g.key })} aria-label={`Make cards with AI for ${g.name}`}>Make cards</Button>}
                        <Button variant="ghost" disabled={!g.due} onClick={() => openReview(g.key)}>{g.due ? `Review ${g.due}` : "Nothing due"}</Button>
                    </span>}>
                    <div className="px-4 py-1.5">
                        {g.decks.map((d) => {
                            const n = g.cards.filter((c) => c.deckId === d.id && (c.scope ?? null) === (d.scope ?? null)).length
                            return (
                                <div key={(d.scope ?? "") + d.id} className={ROW}>
                                    <span className="flex min-w-[160px] flex-1 flex-col">
                                        <b className="text-[13.5px] text-foreground">{d.title}</b>
                                        <span className={SMALL}>{plural(n, "card")}{d.scope ? " · shared with the class" : ""}</span>
                                    </span>
                                    {!d.scope && <Button variant="ghost" onClick={() => showCards({ mode: "deck", id: d.id })}>Edit</Button>}
                                </div>
                            )
                        })}
                    </div>
                </Panel>
            ))}
            <Panel title="New deck" label="New deck">
                <form className="flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); void add() }}>
                    <label className="grid min-w-[180px] flex-1 gap-1 text-[12.5px] text-ink-2">Title
                        <TextInput value={title} maxLength={DECK_TITLE_MAX} placeholder="e.g. Pharmacology week 3" onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <label className="grid min-w-[160px] gap-1 text-[12.5px] text-ink-2">Class
                        <Select value={group} onChange={(e) => setGroup(e.target.value)}>
                            <option value="none">No class</option>
                            {own.map((c) => <option key={c.key ?? c.id} value={c.spaceId ? "class:" + c.spaceId : "course:" + c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>)}
                        </Select>
                    </label>
                    <Button variant="study" type="submit" disabled={!title.trim()}>Add deck</Button>
                </form>
                {error && <div className="px-4 pb-4"><Note tone="bad">{error}</Note></div>}
            </Panel>
        </div>
    )
}

function CardForm({ card, onSave, onCancel }: { card?: Card; onSave: (front: string, back: string) => Promise<void>; onCancel?: () => void }) {
    const [front, setFront] = useState(card?.front ?? "")
    const [back, setBack] = useState(card?.back ?? "")
    const ok = front.trim() && back.trim()
    const id = card?.id ?? "new"
    return (
        <form className="grid gap-2 py-2.5" onSubmit={async (e) => {
            e.preventDefault()
            if (!ok) return
            /* a new card's fields clear at once, not when the save ends: the next card may already be being typed */
            const [f, b] = [front, back]
            if (!card) { setFront(""); setBack("") }
            await onSave(f, b)
        }}>
            <label htmlFor={`front-${id}`} className="text-[12.5px] text-ink-2">Front</label>
            <TextArea id={`front-${id}`} rows={2} value={front} maxLength={FRONT_MAX} onChange={(e) => setFront(e.target.value)} />
            <label htmlFor={`back-${id}`} className="text-[12.5px] text-ink-2">Back</label>
            <TextArea id={`back-${id}`} rows={2} value={back} maxLength={BACK_MAX} onChange={(e) => setBack(e.target.value)} />
            <span className="flex gap-2">
                <Button variant="study" type="submit" disabled={!ok}>{card ? "Save card" : "Add card"}</Button>
                {onCancel && <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>}
            </span>
        </form>
    )
}

function DeckEditor({ id }: { id: string }) {
    const f = useFlashcards()
    const me = useProfile()?.id ?? ""
    const deck = f.decks.find((d) => d.id === id)
    const cards = f.cards.filter((c) => c.deckId === id).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    const [title, setTitle] = useState(deck?.title ?? "")
    const [editing, setEditing] = useState<string | null>(null)
    const [confirm, setConfirm] = useState(false)
    if (!deck) return <Panel title="Deck" label="Deck"><div className="flex flex-col items-start gap-3 p-4"><Note>That deck is gone.</Note><Button variant="ghost" onClick={() => showCards({ mode: "home" })}>Back to decks</Button></div></Panel>
    return (
        <Panel title={deck.title} label="Edit deck" head={<Button variant="ghost" onClick={() => showCards({ mode: "home" })}>Done</Button>}>
            <div className="grid gap-3 p-4">
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim() && title.trim() !== deck.title) void renameDeck(deck, title) }}>
                    <label className="grid flex-1 gap-1 text-[12.5px] text-ink-2">Title
                        <TextInput value={title} maxLength={DECK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
                    </label>
                    <Button variant="ghost" type="submit" disabled={!title.trim() || title.trim() === deck.title}>Rename</Button>
                </form>
                <h3 className="m-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{plural(cards.length, "card")}</h3>
                <div>
                    {cards.map((c) => editing === c.id
                        ? <CardForm key={c.id} card={c} onSave={async (fr, bk) => { await putCard(id, fr, bk, me, c); setEditing(null) }} onCancel={() => setEditing(null)} />
                        : (
                            <div key={c.id} className={ROW}>
                                <span className="flex min-w-[160px] flex-1 flex-col">
                                    <b className="text-[13.5px] whitespace-pre-wrap text-foreground">{c.front}</b>
                                    <span className={cn(SMALL, "whitespace-pre-wrap")}>{c.back}</span>
                                </span>
                                <Button variant="ghost" onClick={() => setEditing(c.id)} aria-label={`Edit card: ${c.front}`}>Edit</Button>
                                <Button variant="ghost" onClick={() => void removeCard(c.id)} aria-label={`Delete card: ${c.front}`}>Delete</Button>
                            </div>
                        ))}
                </div>
                <h3 className="m-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Add a card</h3>
                <CardForm onSave={async (fr, bk) => { await putCard(id, fr, bk, me) }} />
                <div className="flex flex-wrap items-center gap-2 border-t border-line-2 pt-3">
                    {confirm
                        ? <><span className={SMALL}>Delete this deck and its {plural(cards.length, "card")}?</span>
                            <Button variant="danger" onClick={() => { void removeDeck(id); showCards({ mode: "home" }) }}>Delete deck</Button>
                            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button></>
                        : <Button variant="ghost" onClick={() => setConfirm(true)}>Delete deck…</Button>}
                </div>
            </div>
        </Panel>
    )
}

const GRADES: [Grade, string, string][] = [["again", "Again", "1"], ["good", "Good", "2"], ["easy", "Easy", "3"]]

function Review({ group, list }: { group: string | null; list: CardGroup[] }) {
    const f = useFlashcards()
    const today = todayIso()
    /* the queue is fixed when the review starts; a card graded Again goes to the back once */
    const [order, setOrder] = useState<AnyCard[]>(() => {
        const states = scheduleMap(f.states), started = startedToday(f.reviews, today)
        return (group ? list.filter((g) => g.key === group) : list).flatMap((g) => reviewQueue(g.cards, states, started, today))
    })
    const [at, setAt] = useState(0)
    const [flipped, setFlipped] = useState(false)
    const [again, setAgain] = useState<Set<string>>(new Set())
    const box = useRef<HTMLDivElement>(null)
    useEffect(() => { box.current?.focus() }, [at])
    const card = order[at]
    const name = group ? list.find((g) => g.key === group)?.name ?? "Cards" : "All classes"
    const answer = async (g: Grade) => {
        if (!card || !flipped) return
        await gradeCard(card, g, f.states, today)
        if (g === "again" && !again.has(card.id)) { setOrder((o) => [...o, card]); setAgain((s) => new Set(s).add(card.id)) }
        setFlipped(false)
        setAt((n) => n + 1)
    }
    const keys = (e: KeyboardEvent) => {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped(true); return }
        const g = GRADES.find(([, , k]) => k === e.key)
        /* 1, 2 and 3 are the review's while it has focus, flipped or not: before the answer shows they do nothing, never switch pages */
        if (g) { e.preventDefault(); if (flipped) void answer(g[0]) }
    }
    const done = () => showCards({ mode: "home" })
    if (!card) return (
        <Panel title={name} label="Review">
            <div className="flex flex-col items-center gap-3 p-8 text-center">
                <b className="text-[16px] text-foreground">{order.length ? "All done for today" : "Nothing due right now"}</b>
                <p className={cn(SMALL, "m-0")}>{order.length ? `You reviewed ${plural(order.length, "card")}. They'll come back when they're due.` : "Add cards to a deck, or come back tomorrow."}</p>
                <Button variant="study" onClick={done}>Back to decks</Button>
            </div>
        </Panel>
    )
    return (
        <Panel title={name} label="Review" head={<><HeadNote>{at + 1} of {order.length}</HeadNote><Button variant="ghost" onClick={done}>Stop</Button></>}>
            <div ref={box} role="group" tabIndex={0} onKeyDown={keys} aria-label="Card, press Space to flip, then 1, 2 or 3"
                className="grid gap-4 p-5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]">
                <button type="button" onClick={() => setFlipped(true)} aria-label={flipped ? undefined : "Show the answer"}
                    className="flex min-h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-border bg-muted p-6 text-center font-[inherit]">
                    <span className="text-[18px] font-semibold whitespace-pre-wrap text-foreground">{card.front}</span>
                    {flipped
                        ? <span className="border-t border-line-2 pt-3 text-[15px] whitespace-pre-wrap text-ink-2">{card.back}</span>
                        : <span className={SMALL}>Tap or press Space to show the answer</span>}
                </button>
                <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="How well did you know it?">
                    {GRADES.map(([g, label, key]) => (
                        <Button key={g} variant={g === "good" ? "study" : "ghost"} disabled={!flipped} onClick={() => void answer(g)} aria-keyshortcuts={key}>
                            {label} <span className="ml-1 font-mono text-[11px] opacity-70">{key}</span>
                        </Button>
                    ))}
                </div>
            </div>
        </Panel>
    )
}
