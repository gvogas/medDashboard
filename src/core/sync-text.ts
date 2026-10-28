// Plain-language sync wording, shared by the sync button, the Account line and the
// sync messages. Every sentence ends with a full stop.

/** Saved copies wait for a decision in Settings. */
export const REVIEW_TEXT = "Saved copies need review in Settings."
/** Edits wait while a feature is in maintenance. */
export const HOLD_TEXT = "Shared edits are waiting: classes and projects are being worked on."
/** The fallback when nothing more specific is known. */
export const CHECK_TEXT = "Check your connection and try again."

const BY_STATUS: Record<number, string> = {
    429: "Too many requests. Trying again shortly.",
    500: "The server had a problem. Trying again shortly.",
    502: "The server had a problem. Trying again shortly.",
    503: "The server is busy. Trying again shortly.",
    504: "The server is busy. Trying again shortly.",
}

/** A plain sentence for a failed sync: a known server status, else the connection hint. */
export function plainError(e: unknown): string {
    const status = (e as { status?: unknown } | null)?.status
    return (typeof status === "number" && BY_STATUS[status]) || CHECK_TEXT
}

/** "1 change waiting" / "3 changes waiting". */
export function changesWaiting(n: number): string {
    return n + " change" + (n === 1 ? "" : "s") + " waiting"
}
