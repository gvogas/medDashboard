// Study › Cards (spec §9): your decks and your classes' decks grouped by class, each group with
// what is due today and Review; a deck's editor (title, then its cards, front and back); and the
// screen: the front, Space or a tap to flip, then a check (right) or an X (wrong), keys 2 and 1. A card
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
    BACK_MAX, DECK_TITLE_MAX, FRONT_MAX, deckRef, deckStat, gradeCard, groups, newDeck, nextDue, openReview, putCard, removeCard, removeDeck, renameDeck,
    reviewCards, scheduleMap, showCards, useCardsScreen, useFlashcards, type AnyCard, type CardGroup, type DeckStat,
} from "@/data/cards"
import { diffDays, shortDate } from "@/core/dates"

const SMALL = "text-[12.5px] text-muted-foreground"
const ROW = "flex flex-wrap items-center gap-3 border-b border-line-2 py-2.5 last:border-b-0"
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

export function CardsCard() {
    const f = useFlashcards()
    const courses = useCourses()
    const screen = useCardsScreen()
    const list = useMemo(() => groups(f, courses), [f, courses])
    if (screen.mode === "deck") return <DeckEditor id={screen.id} />
    if (screen.mode === "review") return <Review group={screen.group} deck={screen.deck ?? null} list={list} />
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
    const f = useFlashcards()
    const states = useMemo(() => scheduleMap(f.states), [f.states])
    const own = courses.filter((c) => !c.archived)
    const add = async () => {
        if (!title.trim()) return
        try { await newDeck(title, group, me); setTitle("") } catch { setError("That deck couldn't be saved on this device.") }
    }
    return (
        <div className="grid gap-4">
            {/* the head of the tab: what is due and the way into a review, then a new deck, so making one never sits under a long list */}
            <Panel title="Flashcards" label="Flashcards" head={<HeadNote>{total ? `${plural(total, "card")} due today` : "Nothing due today"}</HeadNote>}>
                <div className="flex flex-wrap items-center gap-3 p-4">
                    <p className={cn(SMALL, "m-0 flex-1 basis-[260px]")}>
                        {list.length
                            ? "Review what's due each day. Cards you know come back less often; ones you miss come back tomorrow."
                            : "Make a deck for a class, add cards, and review what's due each day. Cards you know come back less often; ones you miss come back tomorrow."}
                    </p>
                    <Button variant="ghost" onClick={() => showCards({ mode: "generate", group: null })}>Make cards with AI</Button>
                    <Button variant="study" disabled={!total} onClick={() => openReview(null)}>{total ? `Review all ${total}` : "All caught up"}</Button>
                </div>
                <form aria-label="New deck" className="flex flex-wrap items-end gap-2 border-t border-line-2 bg-muted px-4 py-3" onSubmit={(e) => { e.preventDefault(); void add() }}>
                    <label className="grid min-w-[180px] flex-1 gap-1 text-[12.5px] text-ink-2">Title
                        <TextInput value={title} maxLength={DECK_TITLE_MAX} placeholder="A new deck, e.g. Pharmacology week 3" onChange={(e) => setTitle(e.target.value)} />
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
            {!list.length && (
                <div className="rounded-[var(--radius)] border border-dashed border-border px-5 py-7 text-center">
                    <b className="block text-[14px] text-foreground">No decks yet</b>
                    <p className={cn(SMALL, "mx-auto mt-1 mb-0 max-w-[440px]")}>Name a deck above and add cards by hand, or let Make cards with AI write them from your notes, slides or an exam's topics.</p>
                </div>
            )}
            <div className="stagger grid gap-4">
                {list.map((g) => (
                    <Panel key={g.key} label={g.name} title={<span className="flex items-center gap-2">{g.color && <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: g.color }} />}<span className="min-w-0">{g.name}</span></span>}
                        head={<span className="flex gap-2">
                            {g.key !== "none" && <Button variant="ghost" onClick={() => showCards({ mode: "generate", group: g.key })} aria-label={`Make cards with AI for ${g.name}`}>Make cards</Button>}
                            <Button variant="ghost" disabled={!g.due} onClick={() => openReview(g.key)}>{g.due ? `Review ${g.due}` : "Nothing due"}</Button>
                        </span>}>
                        <div className="px-4 py-1.5">
                            {g.decks.map((d) => {
                                const s = deckStat(g, d, states)
                                return (
                                    <div key={deckRef(d)} className={ROW}>
                                        <span className="flex min-w-[160px] flex-1 flex-col items-start gap-0.5">
                                            {d.scope
                                                ? <b className="text-[13.5px] text-foreground">{d.title}</b>
                                                : <button type="button" onClick={() => showCards({ mode: "deck", id: d.id })} aria-label={"Open " + d.title}
                                                    className="cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[13.5px] font-bold text-foreground hover:underline hover:underline-offset-2">{d.title}</button>}
                                            <span className={cn(SMALL, "flex flex-wrap items-center gap-x-1.5")}>
                                                <span>{plural(s.cards, "card")}</span>
                                                {s.due > 0 && <><span aria-hidden="true">·</span><span className="font-semibold text-[var(--study-ink)]">{s.due} due</span></>}
                                                {d.scope && <><span aria-hidden="true">·</span><span>shared with the class</span></>}
                                            </span>
                                        </span>
                                        {s.cards > 0 && <Mastery title={d.title} stat={s} />}
                                        {s.due > 0 && g.decks.length > 1 && <Button variant="ghost" onClick={() => openReview(g.key, deckRef(d))} aria-label={`Review ${d.title}, ${s.due} due`}>Review</Button>}
                                        {!d.scope && <Button variant="ghost" onClick={() => showCards({ mode: "deck", id: d.id })}>Edit</Button>}
                                    </div>
                                )
                            })}
                        </div>
                    </Panel>
                ))}
            </div>
        </div>
    )
}

/** How well a deck is known: one bar in three parts, new, being learned and known (an interval of three weeks or more). */
function Mastery({ title, stat }: { title: string; stat: DeckStat }) {
    const label = `${title}: ${stat.fresh} new, ${stat.learning} learning, ${stat.known} known`
    return (
        <span role="img" aria-label={label} title={`${stat.fresh} new · ${stat.learning} learning · ${stat.known} known`}
            className="flex h-1.5 w-[72px] flex-none gap-px overflow-hidden rounded-full bg-line-2 max-[520px]:w-12">
            {stat.known > 0 && <i style={{ flex: stat.known + " 1 0" }} className="grow-x bg-[var(--study)]" />}
            {stat.learning > 0 && <i style={{ flex: stat.learning + " 1 0" }} className="grow-x bg-[color-mix(in_srgb,var(--study)_45%,var(--panel-2))]" />}
            {stat.fresh > 0 && <i style={{ flex: stat.fresh + " 1 0" }} />}
        </span>
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

/* The two answers. The X is "again" (the card comes back once today); the check is "good". */
const ANSWERS: { grade: Grade; label: string; key: string }[] = [
    { grade: "again", label: "Wrong", key: "1" },
    { grade: "good", label: "Right", key: "2" },
]

type Tally = { right: number; wrong: number }

/* The face turns in each time it changes, unless the device asks for less motion. */
function useTurn(deps: unknown[]) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const el = ref.current
        if (!el || !el.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return
        el.animate([{ transform: "perspective(900px) rotateY(88deg)", opacity: 0.4 }, { transform: "perspective(900px) rotateY(0deg)", opacity: 1 }],
            { duration: 340, easing: "ease-out" })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
    return ref
}

function Score({ tally }: { tally: Tally }) {
    return (
        <span className="flex items-center gap-3 text-[13px] font-semibold tabular-nums">
            <span style={{ color: "var(--good)" }}>{tally.right} right</span>
            <span style={{ color: "var(--crit)" }}>{tally.wrong} wrong</span>
        </span>
    )
}

const ICON_PATH = { right: "M5 12.5l4.5 4.5L19 7.5", wrong: "M6.5 6.5l11 11M17.5 6.5l-11 11" }

function Review({ group, deck, list }: { group: string | null; deck: string | null; list: CardGroup[] }) {
    const f = useFlashcards()
    const today = todayIso()
    /* the queue is fixed when the review starts (every group's, one group's or one deck's); a card graded Again goes to the back once */
    const [order, setOrder] = useState<AnyCard[]>(() => reviewCards(list, group, deck))
    const [at, setAt] = useState(0)
    const [flipped, setFlipped] = useState(false)
    const [again, setAgain] = useState<Set<string>>(new Set())
    const [tally, setTally] = useState<Tally>({ right: 0, wrong: 0 })
    const box = useRef<HTMLDivElement>(null)
    const face = useTurn([at, flipped])
    useEffect(() => { box.current?.focus() }, [at])
    const card = order[at]
    const inGroup = group ? list.find((g) => g.key === group) : undefined
    const name = (deck && inGroup?.decks.find((d) => deckRef(d) === deck)?.title) || (group ? inGroup?.name ?? "Cards" : "All classes")
    /* an answer is being saved: a second key or click in that time (the save is a write and a reload) must not grade the card again and skip the next one */
    const saving = useRef(false)
    const answer = async (g: Grade) => {
        if (!card || !flipped || saving.current) return
        saving.current = true
        try {
            await gradeCard(card, g, f.states, today)
            if (g === "again" && !again.has(card.id)) { setOrder((o) => [...o, card]); setAgain((s) => new Set(s).add(card.id)) }
            setTally((t) => (g === "good" ? { ...t, right: t.right + 1 } : { ...t, wrong: t.wrong + 1 }))
            setFlipped(false)
            setAt((n) => n + 1)
        } finally { saving.current = false }
    }
    const keys = (e: KeyboardEvent) => {
        /* a focused Wrong/Right button keeps its own Space/Enter (its click answers the card) */
        if ((e.key === " " || e.key === "Enter") && (e.target as HTMLElement).hasAttribute("aria-keyshortcuts")) return
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped(true); return }
        const a = ANSWERS.find((x) => x.key === e.key)
        /* 1 and 2 do nothing until the answer shows, and never switch pages */
        if (a) { e.preventDefault(); if (flipped) void answer(a.grade) }
    }
    const done = () => showCards({ mode: "home" })
    if (!card) {
        /* when these cards come back: the soonest day any of them is due again */
        const next = order.length ? nextDue(order, scheduleMap(f.states), today) : null
        const gap = next ? diffDays(today, next.date) : 0
        /* a card got wrong comes back once, so it is in the queue twice: it is still one card reviewed */
        const reviewed = new Set(order.map((c) => c.id)).size
        return (
            <Panel title={name} label="Review">
                <div className="rise-in flex flex-col items-center gap-3 p-8 text-center">
                    {order.length > 0 && (
                        <span aria-hidden="true" className="pop-in grid size-12 place-items-center rounded-full bg-[var(--study-soft)] text-[var(--study-ink)]">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={ICON_PATH.right} /></svg>
                        </span>
                    )}
                    <b className="text-[16px] text-foreground">{order.length ? "All done for today" : "Nothing due right now"}</b>
                    <p className={cn(SMALL, "m-0")}>{order.length ? `You reviewed ${plural(reviewed, "card")}. They'll come back when they're due.` : "Add cards to a deck, or come back tomorrow."}</p>
                    {order.length > 0 && <Score tally={tally} />}
                    {next && <p className={cn(SMALL, "m-0")}>Next up: {plural(next.count, "card")} {gap === 1 ? "tomorrow" : "on " + shortDate(next.date)}.</p>}
                    <Button variant="study" onClick={done}>Back to decks</Button>
                </div>
            </Panel>
        )
    }
    return (
        <Panel title={name} label="Review" head={<><HeadNote>{at + 1} of {order.length}</HeadNote><Score tally={tally} /><Button variant="ghost" onClick={done}>Stop</Button></>}>
            {/* how far through the queue: the bar fills as cards are answered */}
            <span aria-hidden="true" className="block h-[3px] bg-line-2">
                <span className="block h-full origin-left bg-[var(--study)] transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${at / order.length})` }} />
            </span>
            <div ref={box} role="group" tabIndex={0} onKeyDown={keys} aria-label="Flashcard. Press Space to flip, then 2 if you were right or 1 if you were wrong"
                className="grid gap-5 p-5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]">
                <div className="mx-auto w-full max-w-[520px]" style={{ perspective: "900px" }}>
                    <button type="button" onClick={() => { if (!flipped) setFlipped(true) }} aria-label={flipped ? undefined : "Show the answer"}
                        className="block w-full cursor-pointer rounded-2xl border border-border bg-muted p-0 text-left font-[inherit] shadow-[0_14px_34px_-18px_rgba(0,0,0,0.5)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none">
                        <div ref={face} className="flex min-h-[260px] flex-col gap-4 p-7">
                            <span className="flex items-center justify-between text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                                <span>{flipped ? "Answer" : "Question"}</span>
                                <span>{name}</span>
                            </span>
                            {flipped ? (
                                <>
                                    <span className="text-center text-[14px] whitespace-pre-wrap text-ink-2">{card.front}</span>
                                    <span className="my-auto block border-t border-line-2 pt-4 text-center text-[20px] leading-snug font-semibold whitespace-pre-wrap text-foreground">{card.back}</span>
                                </>
                            ) : (
                                <span className="my-auto block text-center text-[20px] leading-snug font-semibold whitespace-pre-wrap text-foreground">{card.front}</span>
                            )}
                            <span className="text-center text-[12.5px] text-muted-foreground">{flipped ? "" : "Tap or press Space to show the answer"}</span>
                        </div>
                    </button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-5" role="group" aria-label="Did you know it?">
                    {ANSWERS.map(({ grade, label, key }) => {
                        const right = grade === "good"
                        return (
                            <button key={grade} type="button" disabled={!flipped} onClick={() => void answer(grade)} aria-keyshortcuts={key}
                                style={{ color: right ? "var(--good)" : "var(--crit)", borderColor: "currentColor" }}
                                className="flex min-w-[112px] flex-col items-center gap-1 rounded-xl border-2 bg-transparent px-5 py-3 font-semibold transition hover:bg-muted disabled:opacity-35">
                                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d={right ? ICON_PATH.right : ICON_PATH.wrong} />
                                </svg>
                                <span className="text-[13px]">{label} <span className="font-mono text-[11px] opacity-70">{key}</span></span>
                            </button>
                        )
                    })}
                </div>
            </div>
        </Panel>
    )
}
