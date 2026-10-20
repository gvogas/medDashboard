// Reading a file with AI — a course outline, a school calendar, a class schedule — behind the
// reading card: three steps that tick off as they happen (the file made ready here, the AI's
// read, the match with your courses), and Cancel, which aborts the request. <Overlays> draws
// the card from useBusy(); while it is up, cover() keeps everything else inert.

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { api, ApiError } from "@/core/api"
import { pdfText } from "@/core/pdftext"
import { notify } from "@/bridge"
import { cacheKey, cached, remember } from "./ai-cache"
import { cover } from "./overlay"
import { maintenanceMessage } from "./maintenance"
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

/** The AI reads a day: the Worker's limit once it has said, else 10. */
const readsLimit = () => ui.aiLimit ?? 10

/* The Worker's answers shared by every read. */
const AI_ERRORS: Record<string, string> = {
    outline_unsupported: "That kind of file cannot be read. Try a PDF or Word document.",
    outline_unavailable: "The reader is not available right now. Try again later.",
    get outline_limit() { return "That is the limit of " + readsLimit() + " AI reads for today (outlines, timetables and calendars). Try again tomorrow." },
    outline_quota: "The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).",
    too_large: "That file is over 5 MB.",
    ai_timeout: "The AI took too long to answer. Try again in a minute.",
    image_unsupported: "That is a picture. Outlines and calendars need a PDF, Word or text file; a timetable screenshot goes under Class schedule.",
    /* the admins switched Import with AI off (worker/maintenance.js): their words */
    get maintenance() { return maintenanceMessage() },
}

type Flag = "outlineBusy" | "schoolBusy" | "scheduleBusy"
export type NoteKey = "importNote" | "schoolNote" | "aiNote"

export const MAX_FILE = 5 * 1024 * 1024
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name)

/** What most files are sent as: a PDF's text (the Worker's converter drops the text of many tables), read by
    `read` (a timetable's with its grid, pdfTimetable), anything else as it is. */
export const asSent = async (file: File, read = pdfText): Promise<Blob> => (isPdf(file) ? new Blob([await read(file)], { type: "text/plain" }) : file)

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
    /** the words that, with the file as sent, find a remembered answer: the kind, the account, … */
    cache?: string[]
    call: (body: Blob, signal: AbortSignal) => Promise<T>
    done: (answer: T) => void
    refresh: () => void
}

/** The reads left today and the limit, as the Worker counts them, into ui.aiLeft and ui.aiLimit. Offline it keeps what it knew. */
export async function refreshReads() {
    try {
        const r = await api.aiReads()
        if (!Number.isInteger(r?.left)) return
        ui.aiLeft = r.left
        if (Number.isInteger(r.limit)) ui.aiLimit = r.limit
        notify()
    } catch { /* offline or signed out */ }
}

/** `work`, or the signal's reason as soon as it aborts, whichever comes first. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    /* once Cancel has won, a later failure of the work is of no interest */
    work.catch(() => {})
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
export async function readWithAi<T>(file: File, { what, title, steps, flag, note, errors, prepare = asSent, maxBytes = MAX_FILE, cache, call, done, refresh }: AiRead<T>) {
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
        const key = cache ? await cacheKey(cache, body).catch(() => null) : null
        const hit = key ? cached(key) : null
        show(1)
        const answer = hit != null ? hit as T : await call(body, stop.signal)
        stop.signal.throwIfAborted()
        show(2)
        u[flag] = false; hideBusy()
        try { done(answer) } catch (e) {
            /* the answer came but the preview could not be made from it: not the network's fault */
            console.error("ai read preview:", e)
            throw Object.assign(new Error("The " + what + " was read, but its preview could not be shown. Try again, or another file. (code: preview_failed)"), { name: "FileError" })
        }
        /* only an answer the preview could use is kept: one that made `done` throw is read afresh next time */
        if (key && hit == null) remember(key, answer)
    } catch (err) {
        u[flag] = false; hideBusy()
        const failed = err instanceof ApiError ? err as ApiError & { body?: { error?: string }; status: number } : null
        const code = failed?.body?.error ?? ""
        const stopped = stop.signal.aborted || (err as Error)?.name === "AbortError"
        /* every message ends with its code, so a person reporting it says exactly what happened */
        const tagged = (text: string, c: string) => text + " (code: " + c + ")"
        u[note] = stopped ? { text: "Stopped reading.", error: false }
            : (err as Error)?.name === "FileError" ? { text: (err as Error).message, error: true }
            : (err as Error)?.name === "TimeoutError" ? { text: tagged("The " + what + " took too long to read. Try again in a minute.", "client_timeout"), error: true }
            : {
                text: failed
                    ? tagged(errors[code] || AI_ERRORS[code] || "The " + what + " could not be read.", code || String(failed.status))
                    : tagged("You seem to be offline. Reading " + what + "s needs a connection.", "network"),
                error: true,
            }
        refresh()
    }
    await refreshReads()
}
