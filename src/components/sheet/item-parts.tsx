// The item card's checklist (topics for an exam, with Fill topics from lectures) and links,
// shared by your own item's card and a class item's (whose checklist is yours, in your mark,
// and whose links are the class's).

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { httpUrl, isTest, uid } from "@/core/model"
import { CHECKLIST_MAX } from "@/core/shared"
import { flush, linkUrl } from "@/data/item-edit"
import { toast } from "@/data/toast"
import type { ChecklistEntry, Item } from "@/data/types"
import { Button, Meter, Note, RemoveButton, Section, CONTROL } from "./fields"

const MAX_LINKS = 20

export function Checklist({ item, onChange, fill, fillNote, autoFocus = false, onLeave = () => void flush() }: {
    item: Item; onChange: (list: ChecklistEntry[], typing: boolean) => void; fill: (() => void) | null; fillNote: string; autoFocus?: boolean; onLeave?: () => void
}) {
    const list = item.checklist || []
    const done = list.filter((s) => s.done).length
    const [adding, setAdding] = useState("")
    const replace = (id: string, change: Partial<ChecklistEntry>) => list.map((s) => (s.id === id ? { ...s, ...change } : s))
    /* Undo puts a removed step back where it was, in the list as it is by then */
    const latest = useRef({ list, onChange })
    latest.current = { list, onChange }
    const remove = (s: ChecklistEntry) => {
        const at = list.findIndex((x) => x.id === s.id)
        onChange(list.filter((x) => x.id !== s.id), false)
        toast("Step removed", {
            undo: () => {
                const { list: now, onChange: save } = latest.current
                if (now.some((x) => x.id === s.id) || now.length >= CHECKLIST_MAX) return
                save([...now.slice(0, at), s, ...now.slice(at)], false)
            },
        })
    }

    return (
        <Section title={isTest(item.type) ? "Topics" : "Checklist"} note={list.length ? done + " of " + list.length + " done" : undefined}>
            {fill && <Button variant="ghost" className="self-start" onClick={fill}>Fill topics from lectures</Button>}
            {fillNote && <Note>{fillNote}</Note>}
            {list.length > 0 && <Meter part={done / list.length} pink full={done === list.length} />}
            {list.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                    {list.map((s) => (
                        <li key={s.id} className="group flex items-start gap-2 rounded-md px-0.5 py-[3px] hover:bg-muted">
                            <button
                                type="button"
                                aria-pressed={s.done}
                                aria-label={"Done: " + (s.text || "step")}
                                onClick={() => onChange(replace(s.id, { done: !s.done }), false)}
                                className={cn(
                                    "mt-0.5 grid size-3.5 flex-none cursor-pointer place-items-center rounded border-[1.5px] p-0",
                                    s.done ? "border-[#D2748F] bg-[#D2748F] text-white" : "border-[var(--box-line)] bg-transparent text-transparent",
                                )}
                            >
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-[9px]"><path d="M2 6.5l2.6 2.6L10 3.5" /></svg>
                            </button>
                            <input
                                value={s.text}
                                maxLength={140}
                                aria-label="Step"
                                onChange={(e) => onChange(replace(s.id, { text: e.target.value }), true)}
                                onBlur={onLeave}
                                className={cn("min-w-0 flex-1 border-0 bg-transparent p-px font-[inherit] text-[12.5px]", s.done ? "text-[var(--done-ink)] line-through" : "text-foreground")}
                            />
                            <RemoveButton aria-label="Remove step" className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                                onClick={() => remove(s)} />
                        </li>
                    ))}
                </ul>
            )}
            {list.length < CHECKLIST_MAX && (
                <input
                    type="text"
                    value={adding}
                    maxLength={140}
                    aria-label="Add a step"
                    autoFocus={autoFocus}
                    placeholder="Add a step, press Enter"
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key !== "Enter" || !adding.trim()) return
                        e.preventDefault()
                        onChange([...list, { id: uid(), text: adding.trim(), done: false }], false)
                        setAdding("")
                    }}
                    className={cn(CONTROL, "border-border")}
                />
            )}
        </Section>
    )
}

export function Links({ item, onChange, autoFocus = false }: { item: Item; onChange: (links: Item["links"]) => void; autoFocus?: boolean }) {
    const links = item.links || []
    const [label, setLabel] = useState("")
    const [url, setUrl] = useState("")
    const [bad, setBad] = useState(false)
    const add = () => {
        const full = linkUrl(url, httpUrl)
        if (!full) { setBad(!!url.trim()); return }
        onChange([...links, { label: (label.trim() || full.replace(/^https?:\/\//i, "")).slice(0, 60), url: full }])
        setLabel(""); setUrl(""); setBad(false)
    }
    const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); add() } }

    return (
        <Section title="Links">
            {links.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[12.5px]">
                    <span aria-hidden="true" className="text-muted-foreground">↗</span>
                    {/* only a web link becomes a link: never a javascript: or data: URL, however it got here */}
                    {httpUrl(l.url)
                        ? <a href={l.url} target="_blank" rel="noopener noreferrer" className="[overflow-wrap:anywhere] text-[var(--accent)] no-underline hover:underline">{l.label || l.url}</a>
                        : <span>{l.label || l.url}</span>}
                    <RemoveButton aria-label="Remove link" className="ml-auto" onClick={() => onChange(links.filter((_, j) => j !== i))} />
                </div>
            ))}
            {links.length < MAX_LINKS && (
                <div className="flex gap-1.5">
                    <input type="text" value={label} maxLength={60} placeholder="Label" aria-label="Link label" autoFocus={autoFocus} onChange={(e) => setLabel(e.target.value)} onKeyDown={onEnter} className={cn(CONTROL, "flex-[0_0_96px] border-border")} />
                    <input type="url" value={url} maxLength={500} placeholder="https://…" aria-label="Link URL" aria-invalid={bad || undefined}
                        onChange={(e) => { setUrl(e.target.value); setBad(false) }} onKeyDown={onEnter} className={cn(CONTROL, "flex-1 border-border")} />
                </div>
            )}
        </Section>
    )
}
