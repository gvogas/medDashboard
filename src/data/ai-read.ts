// Reading a course outline or a school calendar with AI, behind the busy card: the AI
// step can take half a minute, and a button label alone is easy to miss. <Overlays>
// draws the card from useBusy(); while it is up, cover() keeps everything else inert.

import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { ApiError } from "@/core/api"
import { pdfText } from "@/core/pdftext"
import { cover } from "./overlay"
import { ui } from "./ui"
import type { Note, Ui } from "./types"

export interface Busy { title: string; file: string; stage: string; started: number }

let busy: Busy | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }

export const getBusy = () => busy
export const useBusy = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }, getBusy)

function showBusy(file: string, stage: string, title: string) {
    if (!busy) cover(true)
    busy = { title, file, stage, started: busy?.started ?? Date.now() }
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

/* The Worker's answers shared by outlines and calendars. */
const AI_ERRORS: Record<string, string> = {
    outline_unsupported: "That kind of file cannot be read. Try a PDF or Word document.",
    outline_unavailable: "The reader is not available right now. Try again later.",
    outline_limit: "That is the limit of 10 AI reads for today (outlines and calendars). Try again tomorrow.",
    outline_quota: "The free AI allowance for today is used up. It resets at 8 pm Eastern (midnight UTC).",
    too_large: "That file is over 5 MB.",
}

type Flag = "outlineBusy" | "schoolBusy"
type NoteKey = "importNote" | "schoolNote"

export interface AiRead<T> {
    /** "outline" or "calendar", for the fallback messages */
    what: string
    title?: string
    stage: string
    flag: Flag
    note: NoteKey
    /** messages by the API's error code, before the shared ones */
    errors: Record<string, string>
    call: (body: Blob) => Promise<T>
    done: (answer: T) => void
    refresh: () => void
}

/**
 * Read a file with AI behind the busy card. A PDF's text is pulled out here first: the
 * Worker's converter drops the text of many tables. `call(body)` asks the Worker and its
 * answer goes to `done`. While it runs ui[flag] is true; a problem is put in ui[note].
 */
export async function readWithAi<T>(file: File, { what, title = "Uploading your course", stage, flag, note, errors, call, done, refresh }: AiRead<T>) {
    const u = ui as Ui & Record<NoteKey, Note | null>
    if (file.size > 5 * 1024 * 1024) { u[note] = { text: "That file is over 5 MB.", error: true }; refresh(); return }
    u[flag] = true; u[note] = null; refresh()
    try {
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
        if (isPdf) showBusy(file.name, "Pulling the text out of the PDF…", title)
        const body = isPdf ? new Blob([await pdfText(file)], { type: "text/plain" }) : file
        showBusy(file.name, stage, title)
        const answer = await call(body)
        u[flag] = false; hideBusy()
        done(answer)
    } catch (err) {
        u[flag] = false; hideBusy()
        const api = err instanceof ApiError ? err as ApiError & { body?: { error?: string }; status: number } : null
        const code = api?.body?.error ?? ""
        u[note] = {
            text: errors[code] || AI_ERRORS[code] || (api
                ? "The " + what + " could not be read (" + (code || api.status) + ")."
                : "You seem to be offline. Reading " + what + "s needs a connection."),
            error: true,
        }
        refresh()
    }
}
