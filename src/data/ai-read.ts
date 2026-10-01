// Reading a file with AI — a course outline, a school calendar, a class schedule — behind the
// reading card: three steps that tick off as they happen (the file made ready here, the AI's
// read, the match with your courses), and Cancel, which aborts the request. <Overlays> draws
// the card from useBusy(); while it is up, cover() keeps everything else inert.

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { api, ApiError } from "@/core/api"
import { pdfText } from "@/core/pdftext"
import { notify } from "@/bridge"
import { cover } from "./overlay"
import { ui } from "./ui"
import type { Note, Ui } from "./types"

export interface Busy { title: string; file: string; steps: readonly string[]; step: number; started: number; cancel: () => void }

let busy: Busy | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }

export const getBusy = () => busy
export const useBusy = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, getBusy)

function showBusy(next: Omit<Busy, "started">) {
    if (!busy) cover(true)
    busy = { ...next, started: busy?.started ?? Date.now() }
    emit()
}

function hideBusy() {
    if (!busy) return
    /* the card held the keyboard: it goes back to the sheet the file was picked in */
    const had = !!document.getElementById("overlays")?.contains(document.activeElement)
    /* drawn now, so the sheet is no longer inert when focus goes back to it */
    flushSync(() => {
        busy = null
        cover(false)
        emit()
    })
    if (had) document.querySelector<HTMLElement>("#sheet [role=dialog]")?.focus({ preventScroll: true })
}

/* The Worker's answers shared by every read. */
const AI_ERRORS: Record<string, string> = {
    outline_unsupported: "That kind of file cannot be read. Try a PDF or Word document.",
    outline_unavailable: "The reader is not available right now. Try again later.",
    outline_limit: "That is the limit of 10 AI reads for today (outlines, timetables and calendars). Try again tomorrow.",
    outline_quota: "The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).",
    too_large: "That file is over 5 MB.",
    ai_timeout: "The AI took too long to answer. Try again in a minute.",
}

type Flag = "outlineBusy" | "schoolBusy" | "scheduleBusy"
export type NoteKey = "importNote" | "schoolNote" | "aiNote"

export const MAX_FILE = 5 * 1024 * 1024
export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)

/** What most files are sent as: a PDF's text (the Worker's converter drops the text of many tables), anything else as it is. */
export const asSent = async (file: File): Promise<Blob> => (isPdf(file) ? new Blob([await pdfText(file)], { type: "text/plain" }) : file)

export interface AiRead<T> {
    /** "outline", "calendar" or "timetable", for the fallback messages */
    what: string
    /** the card's title: "Reading your course outline" */
    title: string
    /** the card's three steps: the file made ready, the AI's read, the match */
    steps: readonly [string, string, string]
    flag: Flag
    note: NoteKey
    /** messages by the API's error code, before the shared ones */
    errors: Record<string, string>
    /** the file as it is sent; asSent unless given */
    prepare?: (file: File) => Promise<Blob>
    /** the largest file taken, before `prepare`; 5 MB unless given (a screenshot may be bigger: it is made smaller) */
    maxBytes?: number
    call: (body: Blob, signal: AbortSignal) => Promise<T>
    done: (answer: T) => void
    refresh: () => void
}

/** The reads left today, as the Worker counts them, into ui.aiLeft. Offline it keeps what it knew. */
export async function refreshReads() {
    try {
        const r = await api.aiReads()
        if (!Number.isInteger(r?.left)) return
        ui.aiLeft = r.left
        notify()
    } catch { /* offline or signed out */ }
}

/** `work`, or the signal's reason as soon as it aborts, whichever comes first. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    let onAbort!: () => void
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
    })
    return Promise.race([work, aborted]).finally(() => signal.removeEventListener("abort", onAbort))
}

/**
 * Read a file with AI behind the reading card. `prepare` makes the file ready (a PDF's text,
 * a smaller picture), `call(body, signal)` asks the Worker, and the answer goes to `done`.
 * While it runs ui[flag] is true; Cancel aborts the request; a problem goes in ui[note].
 */
export async function readWithAi<T>(file: File, { what, title, steps, flag, note, errors, prepare = asSent, maxBytes = MAX_FILE, call, done, refresh }: AiRead<T>) {
    const u = ui as Ui & Record<NoteKey, Note | null> & Record<Flag, boolean>
    if (file.size > maxBytes) { u[note] = { text: "That file is over " + Math.round(maxBytes / 1048576) + " MB.", error: true }; refresh(); return }
    const stop = new AbortController()
    const show = (step: number) => showBusy({ title, file: file.name, steps, step, cancel: () => stop.abort(new DOMException("Stopped reading", "AbortError")) })
    u[flag] = true; u[note] = null; refresh()
    try {
        show(0)
        let body: Blob
        try { body = await untilAborted(prepare(file), stop.signal) } catch (e) {
            if (stop.signal.aborted) throw e
            const own = (e as Error)?.name === "FileError"
            throw Object.assign(new Error(own ? (e as Error).message : "That file could not be opened. Is it a damaged or locked PDF?"), { name: "FileError" })
        }
        stop.signal.throwIfAborted()
        show(1)
        const answer = await call(body, stop.signal)
        stop.signal.throwIfAborted()
        show(2)
        u[flag] = false; hideBusy()
        done(answer)
    } catch (err) {
        u[flag] = false; hideBusy()
        const failed = err instanceof ApiError ? err as ApiError & { body?: { error?: string }; status: number } : null
        const code = failed?.body?.error ?? ""
        const stopped = stop.signal.aborted || (err as Error)?.name === "AbortError"
        u[note] = stopped ? { text: "Stopped reading.", error: false }
            : (err as Error)?.name === "FileError" ? { text: (err as Error).message, error: true }
            : {
                text: errors[code] || AI_ERRORS[code] || (failed
                    ? "The " + what + " could not be read (" + (code || failed.status) + ")."
                    : "You seem to be offline. Reading " + what + "s needs a connection."),
                error: true,
            }
        refresh()
    }
    await refreshReads()
}
