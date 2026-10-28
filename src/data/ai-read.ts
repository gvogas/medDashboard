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
import { createEmitter } from "@/lib/store"
import type { Note, Ui } from "./types"

export interface Busy { title: string; file: string; steps: readonly string[]; step: number; started: number; cancel: () => void }

let busy: Busy | null = null
const { subscribe, emit } = createEmitter()

export const getBusy = () => busy
export const useBusy = () => useSyncExternalStore(subscribe, getBusy)

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

/* the Worker's wait is a 24-hour window from the first read: say when it ends */
const readLimit = (seconds: number | null) => "That is the limit of " + readsLimit() + " AI reads in 24 hours (outlines, timetables and calendars)." + (seconds ? " Try again after " + new Date(Date.now() + seconds * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) + "." : "")

/* The Worker's answers shared by every read. */
const AI_ERRORS: Record<string, string> = {
    outline_unsupported: "That kind of file cannot be read. Try a PDF or Word document.",
    outline_unavailable: "The reader is not available right now. Try again later.",
    outline_quota: "The free AI allowance is used up for today. Try again tomorrow.",
    too_large: "That file is over 5 MB.",
    ai_timeout: "The AI took too long to answer. Try again in a minute.",
    image_unsupported: "That is a picture. Pictures and scans cannot be read. For an outline or calendar, export a text PDF or Word file and try again. A timetable screenshot goes under Class schedule.",
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
    if (file.size > maxBytes) {
        const picture = file.type.startsWith("image/")
        u[note] = { text: picture ? "That picture is too large to read. Try a smaller screenshot." : "That file is over " + Math.round(maxBytes / 1048576) + " MB.", error: true }
        refresh(); return
    }
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
            throw Object.assign(new Error("The " + what + " was read, but its preview could not be shown. Try again, or use another file."), { name: "FileError" })
        }
        /* only an answer the preview could use is kept: one that made `done` throw is read afresh next time */
        if (key && hit == null) remember(key, answer)
    } catch (err) {
        u[flag] = false; hideBusy()
        const failed = err instanceof ApiError ? err as ApiError & { body?: { error?: string }; status: number } : null
        const code = failed?.body?.error ?? ""
        const stopped = stop.signal.aborted || (err as Error)?.name === "AbortError"
        /* the code and status go to the console; the person reads the words */
        const seconds = [failed?.retryAfter, failed?.body?.retryAfter].map(Number).find((s) => Number.isFinite(s) && s > 0) ?? null
        if (!stopped) console.warn("ai read " + what + ":", code || failed?.status || (err as Error)?.name)
        u[note] = stopped ? { text: "Stopped reading.", error: false }
            : (err as Error)?.name === "FileError" ? { text: (err as Error).message, error: true }
            : (err as Error)?.name === "TimeoutError" ? { text: "The " + what + " took too long to read. Try again in a minute.", error: true }
            : {
                text: failed
                    ? code === "outline_limit" ? readLimit(seconds) : errors[code] || AI_ERRORS[code] || "The " + what + " could not be read. Try again in a minute, or use a different file."
                    : "You seem to be offline. Reading " + what + "s needs a connection. Check it and try again.",
                error: true,
            }
        refresh()
    }
    await refreshReads()
}
