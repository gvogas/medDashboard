// The one toast on screen: a delete that can still be undone, an error that used to be a
// blocking alert, or an achievement just earned. Anything may call toast();
// <Toaster /> shows it. A new one replaces the old.

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
}

export interface ToastBadge { sticker?: string | null; group: string; tier: string }

export interface Toast {
    id: number
    text: string
    undo: (() => void) | null
    label: string
    badge: ToastBadge | null
    error: boolean
}

/** How long a toast stays up, and a longer stay for an error worth reading. */
export const TOAST_MS = 6000, TOAST_LONG_MS = 8000

let current: Toast | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let nextId = 1
const { subscribe, emit } = createEmitter()

export function toast(text: string, { undo = null, label = "Undo", badge = null, error = false, ms = TOAST_MS }: ToastOptions = {}) {
    clearTimeout(timer)
    current = { id: nextId++, text, undo, label, badge, error }
    timer = setTimeout(hideToast, ms)
    emit()
}

/** The toast showing now, or null. */
export const currentToast = (): Toast | null => current

export function hideToast() {
    clearTimeout(timer)
    if (!current) return
    current = null
    emit()
}

/** The action button: hide first, so the callback can show a toast of its own. */
export function runToastAction() {
    const fn = current?.undo
    hideToast()
    fn?.()
}

export function useToast(): Toast | null {
    return useSyncExternalStore(subscribe, () => current)
}
