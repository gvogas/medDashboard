// The toasts on screen. A notice (an error, a hint, an achievement) takes the one notice
// slot, and a new notice replaces the old. A toast with an Undo waits in a list of its own:
// several can be up at once, and a notice never takes them away. Each toast runs its own
// clock; holdToasts() stops the clocks while the pointer or focus is on the toasts.
// <Toaster /> shows them.

import { useSyncExternalStore } from "react"
import { createEmitter } from "@/lib/store"

export interface ToastOptions {
    /** A button (Undo, or `label`) that hides the toast and calls this. */
    undo?: (() => void) | null
    label?: string
    /** The achievement just earned, shown in front: your sticker, or the medal in its group's colour. */
    badge?: ToastBadge | null
    error?: boolean
    /** How long it stays, in ms. */
    ms?: number
    /** With an undo: called when the toast goes without its Undo taken (its time is up, or it is dismissed). */
    onGone?: (() => void) | null
}

export interface ToastBadge { sticker?: string | null; group: string; tier: string }

export interface Toast {
    id: number
    text: string
    undo: (() => void) | null
    label: string
    badge: ToastBadge | null
    error: boolean
    onGone: (() => void) | null
}

/** How long a toast stays up, and a longer stay for an error worth reading. */
export const TOAST_MS = 6000, TOAST_LONG_MS = 8000

interface Clock { left: number; since: number; timer?: ReturnType<typeof setTimeout> }

let current: Toast | null = null
let undos: Toast[] = []
const clocks = new Map<number, Clock>()
/** What is holding the toasts still: "pointer", "focus". */
const holds = new Set<string>()
let nextId = 1
const { subscribe, emit } = createEmitter()

function startClock(id: number, ms: number) {
    clocks.set(id, { left: ms, since: Date.now() })
    if (holds.size === 0) runClock(id)
}
function runClock(id: number) {
    const c = clocks.get(id)
    if (!c || c.timer) return
    c.since = Date.now()
    c.timer = setTimeout(() => hideToast(id), c.left)
}
function stopClock(id: number) {
    const c = clocks.get(id)
    if (!c?.timer) return
    clearTimeout(c.timer)
    c.timer = undefined
    c.left -= Date.now() - c.since
}
/** Forget a toast's clock: it is leaving the screen. */
function dropClock(id: number) {
    const c = clocks.get(id)
    if (c?.timer) clearTimeout(c.timer)
    clocks.delete(id)
}

/** Take a toast off the screen. Its Undo does not run here; hideToast runs its onGone. */
function take(t: Toast) {
    dropClock(t.id)
    if (current?.id === t.id) current = null
    undos = undos.filter((x) => x.id !== t.id)
    if (!current && undos.length === 0) holds.clear()
    emit()
}

/** The toast an id names: the notice or an Undo toast. No id: the newest Undo toast. */
function target(id: number | undefined): Toast | null {
    if (id === undefined) return undos[undos.length - 1] ?? null
    if (current?.id === id) return current
    return undos.find((t) => t.id === id) ?? null
}

/** Show a toast. With an undo it joins the Undo toasts; without one it replaces the notice. Returns its id. */
export function toast(text: string, { undo = null, label = "Undo", badge = null, error = false, ms = TOAST_MS, onGone = null }: ToastOptions = {}): number {
    const t: Toast = { id: nextId++, text, undo, label, badge, error, onGone }
    if (undo) undos = [...undos, t]
    else {
        if (current) dropClock(current.id)
        current = t
    }
    startClock(t.id, ms)
    emit()
    return t.id
}

/** The notice on screen (one without an Undo), or null. */
export const currentToast = (): Toast | null => current

/** Hide a toast: the one with this id; with none, the notice, else the newest Undo toast. Its onGone runs. */
export function hideToast(id?: number) {
    const t = id === undefined ? current ?? target(undefined) : target(id)
    if (!t) return
    take(t)
    t.onGone?.()
}

/** The action button: take the toast down first, so the callback can show a toast of its own. No id: the newest Undo toast. */
export function runToastAction(id?: number) {
    const t = target(id)
    if (!t) return
    take(t)
    t.undo?.()
}

/** The pointer or focus is on the toasts (`on`) or has left them. While anything holds them, their clocks stand still. */
export function holdToasts(source: "pointer" | "focus", on: boolean) {
    const was = holds.size > 0
    if (on) holds.add(source)
    else holds.delete(source)
    const now = holds.size > 0
    if (was === now) return
    for (const id of [...clocks.keys()]) {
        if (now) stopClock(id)
        else runClock(id)
    }
}

export function useToast(): Toast | null {
    return useSyncExternalStore(subscribe, () => current)
}

/** The toasts with an Undo, oldest first. */
export function useUndoToasts(): Toast[] {
    return useSyncExternalStore(subscribe, () => undos)
}
