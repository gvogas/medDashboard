// AI reads remembered on this device: the same file read again (the same text or picture,
// for the same kind of read, account, month and semesters) answers from here at once, using
// no read and no neurons. Kept in localStorage for 30 days, the newest 12; never synced;
// forgotten on sign-out (data/session.ts). Without storage or WebCrypto, nothing is kept.

const KEY = "term.aiReads"
const DAYS_30 = 30 * 86_400_000
const KEEP = 12
interface Entry { k: string; at: number; answer: unknown }

/** The SHA-256 of the read's words and the file as sent, in hex; null where WebCrypto is missing. */
export async function cacheKey(parts: string[], body: Blob): Promise<string | null> {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const head = new TextEncoder().encode(parts.join("\n") + "\n\n")
    const file = new Uint8Array(await body.arrayBuffer())
    const all = new Uint8Array(head.length + file.length)
    all.set(head)
    all.set(file, head.length)
    return Array.from(new Uint8Array(await subtle.digest("SHA-256", all)), (b) => b.toString(16).padStart(2, "0")).join("")
}

function load(): Entry[] {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) || "[]")
        return Array.isArray(v) ? v : []
    } catch { return [] }
}

/** The answer remembered for `k`, or null. */
export function cached(k: string, now = Date.now()): unknown {
    return load().find((e) => e.k === k && now - e.at < DAYS_30)?.answer ?? null
}

export function remember(k: string, answer: unknown, now = Date.now()) {
    const keep = [{ k, at: now, answer }, ...load().filter((e) => e.k !== k && now - e.at < DAYS_30)].slice(0, KEEP)
    try { localStorage.setItem(KEY, JSON.stringify(keep)) } catch { /* full or blocked: not kept */ }
}

export function forgetReads() {
    try { localStorage.removeItem(KEY) } catch { /* blocked */ }
}
