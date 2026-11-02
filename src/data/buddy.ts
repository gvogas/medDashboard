// The Study Buddy as the server has it (worker/buddy.js): XP, rank, mood, coins and the look.
// The Worker works coins out; this only shows what GET /api/buddy answers. It is read on sign-in,
// when the Buddy page opens (again after a minute), and after each sync that uploaded a study
// session, an item or a mark, so new coins show within a sync.

import { api, ApiError } from "@/core/api"
import type { BuddyAnswer, BuddyLook, BuddyState } from "@/core/types"
import { maintenanceState } from "./maintenance"
import { MINUTE_MS } from "@/lib/time"
import { createStore } from "@/lib/store"

export const STALE_MS = MINUTE_MS
export const LOAD_ERROR = "Could not load your buddy. Try again in a minute."

interface State { buddy: BuddyAnswer | null; at: number; loading: boolean; offline: boolean; error: string }
const store = createStore<State>({ buddy: null, at: 0, loading: false, offline: false, error: "" })
const set = store.patch

export const buddyNow = store.get
export const useBuddy = store.use
/** For tests and sign-out. */
export const resetBuddy = () => { inFlight = null; set({ buddy: null, at: 0, loading: false, offline: false, error: "" }) }

/** The Buddy while gameplay is on, else null. */
export const activeBuddy = (s: State = buddyNow()): BuddyState | null => (s.buddy && s.buddy.enabled ? s.buddy : null)
export const buddyStale = (now = Date.now()) => !buddyNow().buddy || (!buddyNow().loading && now - buddyNow().at > STALE_MS)

/** The browser's time zone, which the Worker counts days in. */
export const browserZone = (): string | undefined => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

let inFlight: Promise<void> | null = null
/** Fetch the Buddy; a second call while one is on its way waits for that one. */
export function loadBuddy(): Promise<void> {
    if (maintenanceState("buddy") === "blocked") return Promise.resolve()
    if (inFlight) return inFlight
    set({ loading: true })
    inFlight = (async () => {
        try {
            set({ buddy: await api.buddy.get(), at: Date.now(), loading: false, offline: false, error: "" })
        } catch (e) {
            if ((e as Error)?.name === "AbortError") { set({ loading: false }); return }
            const offline = navigator.onLine === false
            set({ loading: false, offline, error: offline ? "" : LOAD_ERROR })
        } finally {
            inFlight = null
        }
    })()
    return inFlight
}

/** XP gained since the last answer, once the next one arrives; 0 when nothing new, offline, or gameplay off. */
export async function buddyGain(): Promise<number> {
    const before = activeBuddy()?.xp
    if (before === undefined) return 0
    await loadBuddy()
    const after = activeBuddy()?.xp
    return after === undefined ? 0 : Math.max(0, after - before)
}

/** What a failed change says. */
export function buddyMessage(e: unknown): string {
    if (!(e instanceof ApiError)) return "That needs a connection. Try again when you're online."
    const code = e.body?.error
    if (code === "gameplay_off") return "Turn on Gameplay in Settings first."
    if (code === "tier_not_reached") return "Your buddy hasn't reached that rank yet."
    if (code === "not_owned") return "That isn't yours yet."
    if (e.status === 503) return "The buddy is switched off for a moment. Try again soon."
    return "That did not go through. Try again."
}

async function change(call: () => Promise<BuddyAnswer>): Promise<string> {
    try {
        set({ buddy: await call(), at: Date.now(), error: "" })
        return ""
    } catch (e) {
        return buddyMessage(e)
    }
}

/** Turn gameplay on or off. Returns an error message, or "" when it went through. */
export const setGameplay = (enabled: boolean) => change(() => api.buddy.settings(enabled, browserZone()))
/** Claim a reached rank's coins. */
export const claimTier = (tier: string) => change(() => api.buddy.claim(tier))
/** Pick a buddy: 'auto' (your theme) or a theme's. */
export const pickBuddy = (buddy: BuddyLook["buddy"]) => change(() => api.buddy.look({ buddy }))
