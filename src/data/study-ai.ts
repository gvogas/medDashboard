// Making flashcards with AI (spec §6–§8), two ways that end in the same preview:
//  - Generate here: the Worker asks Workers AI (worker/study-ai.js), a few times a day for free.
//  - Use your own AI: the same prompt to copy into any chat, and its answer pasted back and read
//    here. No key, no limit, and nothing reaches the Worker until the cards are saved.
// Files are read here too (PDF, PowerPoint, text); only their words are ever sent. A preview
// already made for the same request is remembered on this device, so asking again is free.

import { api, ApiError } from "@/core/api"
import { asOneText, cardsPrompt, classContext, HERE_LIMIT, OWN_LIMIT, type Level, type Sources } from "@/core/study-prompts"
import { readAnswer, type CardDraft } from "@/core/study-answers"
import { pdfText } from "@/core/pdftext"
import { isPptx, pptxText } from "@/core/pptxtext"
import type { StudyAiStatus } from "@/core/types"
import { cacheKey, cached, remember } from "./ai-cache"
import { createStore } from "@/lib/store"
import { saveCard, saveDeck } from "@/core/store"
import { uid } from "@/core/model"

/* ── files (spec §8) ── */
export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_FILES = 5
export const ACCEPT = ".pdf,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown"
export const FILE_ERRORS = {
    kind: "Use a PDF, PowerPoint (.pptx), TXT or MD file. Old .ppt and Word files can't be read; save them as PDF first.",
    size: "That file is over 20 MB.",
    empty: "This PDF has no text to read (it may be a scan).",
    many: `Up to ${MAX_FILES} files at a time.`,
    unreadable: "That file couldn't be read.",
} as const

/** A file's words, or an error from FILE_ERRORS. */
export async function readStudyFile(file: File): Promise<{ text: string } | { error: string }> {
    if (file.size > MAX_FILE_BYTES) return { error: FILE_ERRORS.size }
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const name = file.name.toLowerCase()
    try {
        if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {   /* %PDF */
            const text = (await pdfText(file)).trim()
            return text.replace(/### Page \d+/g, "").trim() ? { text } : { error: FILE_ERRORS.empty }
        }
        if (head[0] === 0x50 && head[1] === 0x4b) {   /* a zip: only a PowerPoint is read */
            const bytes = new Uint8Array(await file.arrayBuffer())
            return isPptx(bytes) ? { text: await pptxText(file) } : { error: FILE_ERRORS.kind }
        }
        if (/\.(txt|md|markdown)$/.test(name) || /^text\//.test(file.type)) {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())
            return { text }
        }
    } catch {
        return { error: FILE_ERRORS.unreadable }
    }
    return { error: FILE_ERRORS.kind }
}

/* ── what a generate asks for ── */
export interface CardRequest { classData: string; text: string; topic: string; count: number; level: Level }
const sources = (r: CardRequest): Sources => ({ classData: r.classData, text: r.text, topic: r.topic })
export const hasMaterial = (r: CardRequest) => !!(r.classData.trim() || r.text.trim() || r.topic.trim())
export { classContext }

/** The prompt to copy for Use your own AI: the Worker's own, with room for more material. */
export const ownPrompt = (r: CardRequest): string => asOneText(cardsPrompt(sources(r), { count: r.count, level: r.level }, OWN_LIMIT))

/** A pasted answer read: the cards and "N of M", or a message when nothing could be read. */
export function readPasted(text: string, count: number): { cards: CardDraft[]; note: string } {
    const read = readAnswer("cards", text, count)
    if (!read || !read.items.length) return { cards: [], note: "That answer had no cards in it. Copy the prompt again and ask for only the JSON." }
    return { cards: read.items, note: read.items.length < read.total ? `${read.items.length} of ${read.total} cards could be read.` : `${read.items.length} cards read.` }
}

/* ── Generate here: uses left today ── */
const statusStore = createStore<{ status: StudyAiStatus | null }>({ status: null })
export const useStudyAiStatus = () => statusStore.use().status
export async function loadStudyAiStatus(): Promise<void> {
    try { statusStore.set({ status: await api.studyAi.status() }) } catch { statusStore.set({ status: null }) }
}

/** What a refused Generate here says; every refusal offers Use your own AI. */
export function generateMessage(e: unknown): string {
    if (e instanceof DOMException && e.name === "TimeoutError") return "Generate here took too long. Try again, or use your own AI."
    if (!(e instanceof ApiError)) {
        /* A failed request (fetch rejects with a TypeError) or an offline device is a connection problem; anything else is not. */
        if (e instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false)) return "That needs a connection. Use your own AI works offline too: copy the prompt instead."
        return "Generate here didn't work this time. Try again, or use your own AI."
    }
    const code = e.body?.error
    if (code === "ai_timeout") return "Generate here took too long, so this use is given back. Try again, or use your own AI."
    if (code === "study_ai_cap") return "You've used today's free generations. Use your own AI has no limit."
    if (code === "study_ai_busy") return "Generate here is busy for today. Use your own AI still works."
    if (code === "maintenance") return "Generate here is switched off for a moment. Use your own AI still works."
    if (code === "material_too_large") return "That's more material than Generate here takes. Use your own AI takes more."
    if (code === "outline_unreadable") return "The AI's answer had no usable cards. Try again, or use your own AI."
    return "Generate here didn't work this time. Try again, or use your own AI."
}

/**
 * Cards from Workers AI, a preview. The same request asked before (on this device, this account)
 * answers from the cache at once and spends no use.
 */
export async function generateHere(r: CardRequest): Promise<{ cards: CardDraft[]; cached: boolean } | { error: string }> {
    const key = await cacheKey(["study-ai", "cards", String(r.count), r.level, r.topic], new Blob([r.classData + "\n\u0000\n" + r.text.slice(0, HERE_LIMIT * 2)])).catch(() => null)
    const hit = key ? cached(key) : null
    if (Array.isArray(hit) && hit.length) return { cards: hit as CardDraft[], cached: true }
    try {
        const out = await api.studyAi.cards({ sources: { classData: r.classData, text: r.text, topic: r.topic }, count: r.count, level: r.level })
        if (key) remember(key, out.cards)
        void loadStudyAiStatus()
        return { cards: out.cards, cached: false }
    } catch (e) {
        void loadStudyAiStatus()
        if (!(e instanceof ApiError)) console.error("Generate here failed:", e)
        return { error: generateMessage(e) }
    }
}

/** Save the previewed cards into a deck: a new one titled `title` (filed under `group`), or `deckId`. */
export async function saveDrafts(cards: CardDraft[], into: { deckId: string } | { title: string; group: string }, authorId: string, source: "ai" | "paste") {
    let deckId: string
    if ("deckId" in into) deckId = into.deckId
    else {
        deckId = uid()
        const courseId = into.group.startsWith("course:") ? into.group.slice(7) : null
        const classId = into.group.startsWith("class:") ? into.group.slice(6) : null
        await saveDeck({ id: deckId, title: into.title.trim().slice(0, 80) || "Generated cards", courseId, classId, authorId })
    }
    for (const c of cards) await saveCard({ id: uid(), deckId, authorId, front: c.front, back: c.back, source })
    return deckId
}

/** The chats Use your own AI links to; the last one picked is remembered on this device. */
export const CHATS = [
    { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
    { id: "claude", name: "Claude", url: "https://claude.ai/new" },
    { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app" },
] as const
const CHAT_KEY = "term.ownAi"
export const lastChat = (): string => { try { return localStorage.getItem(CHAT_KEY) || "chatgpt" } catch { return "chatgpt" } }
export const pickChat = (id: string) => { try { localStorage.setItem(CHAT_KEY, id) } catch { /* not kept */ } }
