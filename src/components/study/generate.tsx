// Study › Cards › Generate (spec §9, Generate sheet): the material (the class's own items and
// notes, files, pasted text, a topic), how many cards and at what level, then one of two ways:
// Generate here (Workers AI, a few a day) or Use your own AI (copy the prompt into any chat and
// paste its answer back). Both end in the same preview, where cards can be edited or dropped
// before they are saved into a new or existing deck.

import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Panel, HeadNote } from "@/components/views/bits"
import { Button, Checkbox, Note, Select, TextArea, TextInput } from "@/components/sheet/fields"
import { LEVELS, type Level } from "@/core/study-prompts"
import { PASTE_MAX, type CardDraft } from "@/core/study-answers"
import { useMaintenance } from "@/data/maintenance"
import { useCourses, useItems, useProfile } from "@/data/store"
import { showCards, useFlashcards } from "@/data/cards"
import {
    ACCEPT, CHATS, FILE_ERRORS, MAX_FILES, classContext, generateHere, hasMaterial, lastChat, loadStudyAiStatus, ownPrompt, pickChat,
    readPasted, readStudyFile, saveDrafts, useStudyAiStatus, type CardRequest,
} from "@/data/study-ai"

const SMALL = "text-[12.5px] text-muted-foreground"
const LEVEL_NAME: Record<Level, string> = { basic: "Basics", exam: "Exam prep", deep: "Deeper" }

export interface GenerateStart { group: string | null; topic?: string; text?: string; title?: string }

export function GenerateCards({ start }: { start: GenerateStart }) {
    const me = useProfile()?.id ?? ""
    const courses = useCourses()
    const items = useItems()
    const f = useFlashcards()
    const status = useStudyAiStatus()
    const off = useMaintenance("studyai") === "blocked"
    useEffect(() => { void loadStudyAiStatus() }, [])

    const [group, setGroup] = useState(start.group ?? "none")
    const course = group.startsWith("course:") ? courses.find((c) => !c.spaceId && c.id === group.slice(7))
        : group.startsWith("class:") ? courses.find((c) => c.spaceId === group.slice(6)) : undefined
    const [useClass, setUseClass] = useState(!!course)
    const [files, setFiles] = useState<{ name: string; text: string }[]>([])
    const [fileError, setFileError] = useState("")
    const [pasted, setPasted] = useState(start.text ?? "")
    const [topic, setTopic] = useState(start.topic ?? "")
    const [count, setCount] = useState(15)
    const [level, setLevel] = useState<Level>("exam")
    const [way, setWay] = useState<"here" | "own">("here")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")
    const [drafts, setDrafts] = useState<CardDraft[] | null>(null)
    const [source, setSource] = useState<"ai" | "paste">("ai")
    const [note, setNote] = useState("")

    /* the class as the prompt reads it: its own items, newest first */
    const classData = useMemo(() => {
        if (!useClass || !course) return ""
        const mine = items.filter((it) => (course.spaceId ? it.spaceId === course.spaceId : it.courseId === course.id))
        const name = course.code ? `${course.code} · ${course.name}` : course.name
        return classContext(name, mine.map((it) => ({ type: it.type, title: it.title, date: it.date, notes: it.notes, checklist: it.checklist })), 60_000)
    }, [useClass, course, items])
    const req: CardRequest = { classData, text: [...files.map((x) => x.text), pasted].filter((t) => t.trim()).join("\n\n"), topic, count, level }
    const ready = hasMaterial(req)

    const addFiles = async (list: FileList | null) => {
        setFileError("")
        const picked = [...(list ?? [])]
        if (files.length + picked.length > MAX_FILES) { setFileError(FILE_ERRORS.many); return }
        for (const file of picked) {
            const r = await readStudyFile(file)
            if ("error" in r) { setFileError(`${file.name}: ${r.error}`); continue }
            setFiles((fs) => [...fs, { name: file.name, text: r.text }])
        }
    }
    const generate = async () => {
        setBusy(true); setError("")
        const r = await generateHere(req)
        setBusy(false)
        if ("error" in r) { setError(r.error); return }
        setSource("ai"); setDrafts(r.cards); setNote(r.cached ? "From this device: asked before, so it used nothing." : "")
    }

    if (drafts) return <Preview drafts={drafts} setDrafts={setDrafts} source={source} note={note} group={group} me={me} decks={f.decks} title={start.title ?? (topic || course?.name || "")} onBack={() => setDrafts(null)} />

    const here = status && status.providers.length > 0 && !off
    return (
        <Panel title="Make cards with AI" label="Make cards with AI" head={<Button variant="ghost" onClick={() => showCards({ mode: "home" })}>Cancel</Button>}>
            <div className="grid gap-4 p-4">
                <section className="grid gap-2">
                    <h3 className="m-0 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">From</h3>
                    <label className="grid gap-1 text-[12.5px] text-ink-2">Class
                        <Select value={group} onChange={(e) => { setGroup(e.target.value); setUseClass(e.target.value !== "none") }}>
                            <option value="none">No class</option>
                            {courses.filter((c) => !c.archived).map((c) => <option key={c.key ?? c.id} value={c.spaceId ? "class:" + c.spaceId : "course:" + c.id}>{c.code ? `${c.code} · ${c.name}` : c.name}</option>)}
                        </Select>
                    </label>
                    {course && <Checkbox id="gen-class" checked={useClass} onChange={setUseClass}>Use this class's items and notes</Checkbox>}
                    <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed border-border bg-muted p-3 text-center text-[12.5px] text-ink-2" htmlFor="gen-files">
                        <b className="text-foreground">Add files</b> PDF, PowerPoint (.pptx), TXT or MD, up to 20 MB each. Only their words are used.
                        <input id="gen-files" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = "" }} />
                    </label>
                    {files.map((x) => (
                        <span key={x.name} className="flex items-center gap-2 text-[12.5px] text-ink-2">
                            <span className="flex-1 truncate">{x.name} · {x.text.length.toLocaleString()} characters</span>
                            <Button variant="ghost" onClick={() => setFiles((fs) => fs.filter((y) => y !== x))} aria-label={`Remove ${x.name}`}>Remove</Button>
                        </span>
                    ))}
                    {fileError && <Note tone="bad">{fileError}</Note>}
                    <label htmlFor="gen-text" className="text-[12.5px] text-ink-2">Or paste notes</label>
                    <TextArea id="gen-text" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Lecture notes, a summary, anything to study from" />
                    <label className="grid gap-1 text-[12.5px] text-ink-2">Topic
                        <TextInput value={topic} maxLength={120} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Beta blockers" />
                    </label>
                </section>
                <section className="flex flex-wrap gap-3">
                    <label className="grid gap-1 text-[12.5px] text-ink-2">Cards
                        <TextInput type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className="w-24" />
                    </label>
                    <label className="grid gap-1 text-[12.5px] text-ink-2">Level
                        <Select value={level} onChange={(e) => setLevel(e.target.value as Level)}>{LEVELS.map((l) => <option key={l} value={l}>{LEVEL_NAME[l]}</option>)}</Select>
                    </label>
                </section>
                <div role="tablist" aria-label="How" className="flex gap-1 border-b border-border">
                    {([["here", "Generate here"], ["own", "Use your own AI"]] as const).map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={way === id} onClick={() => setWay(id)}
                            className={cn("h-9 cursor-pointer border-0 bg-transparent px-3 font-[inherit] text-[13px]", way === id ? "font-semibold text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground")}>{label}</button>
                    ))}
                </div>
                {way === "here" ? (
                    <div className="grid gap-2">
                        <p className={cn(SMALL, "m-0")}>
                            {off ? "Generate here is switched off for a moment. Use your own AI still works."
                                : !status ? "Checking today's free generations…"
                                : !status.globalOpen ? "Generate here is busy for today. Use your own AI still works."
                                : `${status.left} of ${status.perUser} free generations left today.${status.extraLeft ? " More can be bought with coins in the Buddy shop." : ""}`}
                        </p>
                        {error && <Note tone="bad">{error}</Note>}
                        <span><Button variant="study" disabled={!ready || busy || !here || !status?.left || !status.globalOpen} onClick={() => void generate()}>{busy ? "Making cards…" : "Generate"}</Button></span>
                        {!ready && <span className={SMALL}>Pick a class, add a file, paste notes, or type a topic.</span>}
                    </div>
                ) : (
                    <OwnAi req={req} ready={ready} onCards={(cards, n) => { setSource("paste"); setDrafts(cards); setNote(n) }} />
                )}
            </div>
        </Panel>
    )
}

function OwnAi({ req, ready, onCards }: { req: CardRequest; ready: boolean; onCards: (cards: CardDraft[], note: string) => void }) {
    const prompt = useMemo(() => (ready ? ownPrompt(req) : ""), [ready, req.classData, req.text, req.topic, req.count, req.level])   // eslint-disable-line react-hooks/exhaustive-deps
    const [copied, setCopied] = useState<"" | "yes" | "no">("")
    const [answer, setAnswer] = useState("")
    const [note, setNote] = useState("")
    const [chat, setChat] = useState(lastChat())
    const copy = async () => {
        try { await navigator.clipboard.writeText(prompt); setCopied("yes") } catch { setCopied("no") }
    }
    const read = () => {
        const r = readPasted(answer, req.count)
        if (!r.cards.length) { setNote(r.note); return }
        onCards(r.cards, r.note)
    }
    return (
        <div className="grid gap-3">
            <p className={cn(SMALL, "m-0")}>Works with any chat you already use, with no limit and nothing to sign up for. 1. Copy the prompt. 2. Paste it into your chat. 3. Paste its answer below.</p>
            <span className="flex flex-wrap items-center gap-2">
                <Button variant="study" disabled={!ready} onClick={() => void copy()}>{copied === "yes" ? "Copied" : "Copy prompt"}</Button>
                {CHATS.map((c) => (
                    <a key={c.id} href={c.url} target="_blank" rel="noopener noreferrer" onClick={() => { pickChat(c.id); setChat(c.id) }}
                        className={cn("rounded-md border px-2.5 py-1 text-[12.5px] no-underline", chat === c.id ? "border-[var(--study)] text-foreground" : "border-border text-ink-2")}>Open {c.name}</a>
                ))}
            </span>
            {!ready && <span className={SMALL}>Pick a class, add a file, paste notes, or type a topic first.</span>}
            {copied === "no" && (
                <label className="grid gap-1 text-[12.5px] text-ink-2">Copying didn't work here: select the prompt and copy it yourself
                    <TextArea readOnly rows={6} value={prompt} onFocus={(e) => e.currentTarget.select()} />
                </label>
            )}
            <label htmlFor="own-answer" className="text-[12.5px] text-ink-2">The chat's answer</label>
            <TextArea id="own-answer" rows={6} maxLength={PASTE_MAX} value={answer} onChange={(e) => { setAnswer(e.target.value); setNote("") }} placeholder="Paste the whole answer here" />
            {note && <Note tone="bad">{note}</Note>}
            <span><Button variant="study" disabled={!answer.trim()} onClick={read}>Read the answer</Button></span>
        </div>
    )
}

function Preview({ drafts, setDrafts, source, note, group, me, decks, title, onBack }: {
    drafts: CardDraft[]; setDrafts: (d: CardDraft[]) => void; source: "ai" | "paste"; note: string; group: string; me: string
    decks: { id: string; title: string }[]; title: string; onBack: () => void
}) {
    const [into, setInto] = useState("new")
    const [name, setName] = useState(title)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const edit = (i: number, field: "front" | "back", v: string) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, [field]: v } : d)))
    const ok = drafts.filter((d) => d.front.trim() && d.back.trim())
    const save = async () => {
        setSaving(true)
        try {
            await saveDrafts(ok, into === "new" ? { title: name, group } : { deckId: into }, me, source)
            showCards({ mode: "home" })
        } catch { setError("Those cards couldn't be saved on this device."); setSaving(false) }
    }
    return (
        <Panel title="Check the cards" label="Check the cards" head={<HeadNote>{drafts.length} cards</HeadNote>}>
            <div className="grid gap-3 p-4">
                {note && <p className={cn(SMALL, "m-0")} role="status">{note}</p>}
                <ol className="m-0 grid list-none gap-2 p-0">
                    {drafts.map((d, i) => (
                        <li key={i} className="grid gap-1.5 rounded-lg border border-border bg-muted p-2.5">
                            <TextArea aria-label={`Card ${i + 1} front`} rows={1} value={d.front} onChange={(e) => edit(i, "front", e.target.value)} />
                            <TextArea aria-label={`Card ${i + 1} back`} rows={2} value={d.back} onChange={(e) => edit(i, "back", e.target.value)} />
                            <span><Button variant="ghost" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} aria-label={`Drop card ${i + 1}`}>Drop</Button></span>
                        </li>
                    ))}
                </ol>
                <div className="flex flex-wrap items-end gap-2 border-t border-line-2 pt-3">
                    <label className="grid gap-1 text-[12.5px] text-ink-2">Save into
                        <Select value={into} onChange={(e) => setInto(e.target.value)}>
                            <option value="new">A new deck</option>
                            {decks.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                        </Select>
                    </label>
                    {into === "new" && <label className="grid min-w-[180px] flex-1 gap-1 text-[12.5px] text-ink-2">Deck title
                        <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                    </label>}
                    <Button variant="study" disabled={!ok.length || saving || (into === "new" && !name.trim())} onClick={() => void save()}>{saving ? "Saving…" : `Save ${ok.length} cards`}</Button>
                    <Button variant="ghost" onClick={onBack}>Back</Button>
                </div>
                {error && <Note tone="bad">{error}</Note>}
            </div>
        </Panel>
    )
}
