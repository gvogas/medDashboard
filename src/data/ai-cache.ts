// AI reads remembered on this device: the same file read again (the same text or picture,
// for the same kind of read, account, month and semesters) answers from here at once, using
// no read and no neurons. Kept in localStorage for 30 days, the newest 12; never synced;
// each answer marked with the account it was read for, and forgotten on sign-out, when the
// account changes, and when another account's session starts (data/session.ts). Without
// storage or WebCrypto, nothing is kept.

/* the version is in the key: an answer of an older shape is never read back as a new one */
const KEY = "term.aiReads.v1"
const OLD_KEYS = ["term.aiReads"]
const DAYS_30 = 30 * 86_400_000
const KEEP = 12
interface Entry { k: string; at: number; user: string; answer: unknown }

/* the account whose session is open; answers are kept and found for it only */
let owner = ""

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

const save = (list: Entry[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked: not kept */ }
}

/** A session started for `user`: answers are kept for it, and those read for anyone else go. */
export function keepReadsFor(user: string) {
    owner = user
    try { for (const k of OLD_KEYS) localStorage.removeItem(k) } catch { /* blocked */ }
    const all = load()
    const mine = all.filter((e) => e.user === user)
    if (mine.length !== all.length) save(mine)
}

/** The answer remembered for `k` for this session's account, or null. */
export function cached(k: string, now = Date.now()): unknown {
    return load().find((e) => e.k === k && e.user === owner && now - e.at < DAYS_30)?.answer ?? null
}

export function remember(k: string, answer: unknown, now = Date.now()) {
    save([{ k, at: now, user: owner, answer }, ...load().filter((e) => e.k !== k && now - e.at < DAYS_30)].slice(0, KEEP))
}

export function forgetReads() {
    try { for (const k of [KEY, ...OLD_KEYS]) localStorage.removeItem(k) } catch { /* blocked */ }
}
