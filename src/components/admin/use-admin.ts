// What the Admin page's tabs share: loading one admin call into local state, and the
// words for what came back wrong. Nothing here is kept between visits; each tab asks
// again when it opens.

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/core/api"

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> }

/** Call `load` when the tab opens and on reload(); a later answer replaces an earlier one. */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
    const [data, setData] = useState<T | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const seq = useRef(0)
    const reload = useCallback(async () => {
        const mine = ++seq.current
        setLoading(true)
        try {
            const got = await load()
            if (mine === seq.current) { setData(got); setError(null) }
        } catch (e) {
            if (mine === seq.current) setError(problem(e))
        } finally {
            if (mine === seq.current) setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useEffect(() => { void reload() }, [reload])
    return { data, error, loading, reload }
}

const WORDS: Record<string, string> = {
    forbidden: "Only admins can do that.",
    unauthenticated: "You were signed out. Sign in again.",
    taken: "That username is taken.",
    self: "You can't do that to your own account.",
    last_admin: "There has to be at least one admin.",
    not_found: "That account no longer exists. Refresh the list.",
    rate_limited: "Too many requests. Wait a moment.",
}
const FIELDS: Record<string, string> = {
    username: "Usernames are 3 to 32 letters, digits, dots, dashes or underscores.",
    password: "Passwords are 8 to 200 characters.",
    confirm: "Type the username exactly to confirm.",
    text: "Write a message of up to 280 characters.",
    until: "Pick an end within the next 30 days.",
    message: "Write a message of up to 280 characters.",
    features: "Reload the page: this app doesn't know one of those features.",
}

/** A sentence for a failed admin call. */
export function problem(e: unknown): string {
    if (e instanceof ApiError) {
        const code = e.body?.error || ""
        if (code === "invalid" && typeof e.body?.field === "string" && FIELDS[e.body.field]) return FIELDS[e.body.field]
        return WORDS[code] || (e.status >= 500 ? "The server had a problem. It's in the Errors tab." : e.message)
    }
    return (e as Error)?.message || "Something went wrong."
}

/** "3 Oct, 14:05" in the viewer's time. */
export const when = (ms: number | null | undefined) =>
    ms ? new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(ms: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - ms) / 1000))
    if (s < 60) return "just now"
    if (s < 3600) return Math.round(s / 60) + " min ago"
    if (s < 86400) return Math.round(s / 3600) + " h ago"
    return Math.round(s / 86400) + " days ago"
}
