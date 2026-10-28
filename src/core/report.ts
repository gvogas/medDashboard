// Crashes in this browser go to the error log (POST /api/errors → Admin → Errors, browser): an
// uncaught error, a promise nobody caught, or React failing to draw. A failed API answer is
// not sent: the server logged it already. Nor is a lost connection, or an extension's error.
// At most MAX a page load, each message once; sending one never throws. Only signed in: the
// server refuses a report from no session, so a signed-out page sends nothing and counts nothing.

import { ApiError, signedIn } from "./api"

export const MAX = 10
let sent = 0
const seen = new Set<string>()

/* what offline looks like in each browser */
const NETWORK = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The network connection was lost\.?)$/

/** The first line of the stack that is ours: where it broke. */
function whereIn(e: Error): string {
    const line = (e.stack ?? "").split("\n").find((l) => l.includes(location.origin))
    return line ? " @ " + line.trim().replace(/^at\s+/, "").replace(location.origin, "") : ""
}

/** Send one error; `kind` says how it was caught. */
export function reportError(kind: "error" | "rejection" | "react", e: unknown): void {
    try {
        if (!signedIn() || e instanceof ApiError || (e as Error)?.name === "AbortError") return
        const err = e instanceof Error ? e : null
        const text = err ? `${err.name}: ${err.message}` : String(e)
        if (err && NETWORK.test(err.message)) return
        const message = (text + (err ? whereIn(err) : "")).slice(0, 500)
        if (sent >= MAX || seen.has(message)) return
        seen.add(message)
        sent++
        void fetch("/api/errors", {
            method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true,
            body: JSON.stringify({ kind, message, where: location.pathname }),
        }).catch(() => {})
    } catch { /* reporting must never break the page */ }
}

/** Listen for what nobody caught. Once, before anything else runs. */
export function watchErrors() {
    window.addEventListener("error", (ev) => {
        /* a script from elsewhere (an extension) says only "Script error." */
        if (ev.filename && !ev.filename.startsWith(location.origin)) return
        reportError("error", ev.error ?? ev.message)
    })
    window.addEventListener("unhandledrejection", (ev) => reportError("rejection", ev.reason))
}

/** createRoot's options: React's crashes are reported, and still printed as React would. */
export const reactErrors = {
    onUncaughtError: (e: unknown) => { console.error(e); reportError("react", e) },
    onCaughtError: (e: unknown) => { console.error(e); reportError("react", e) },
    onRecoverableError: (e: unknown) => { console.error(e); reportError("react", e) },
}
