// The leaderboard on the Study page: study hours this week and all-time for everyone who
// has joined. Joining is opt-in, and someone who has not joined sees nobody. The totals
// come from the server; your own row uses this device's sessions, so a session that has
// not synced yet still counts. What the server said is kept in the legacy ui (`ui.lb`).

import { useMemo, useSyncExternalStore } from "react"
import { getVersion, notify, subscribe } from "@/bridge"
import { api } from "@/legacy/js/api.js"
import { monday } from "@/legacy/js/dates.js"
import { useStudySessions } from "./store"
import { ui } from "./ui"
import type { Leaderboard, LbRow, LbTab, StudySession } from "./types"

/** The totals are asked for again when the Study page opens after a minute. */
export const STALE_MS = 60_000

export const LOAD_ERROR = "Could not load the leaderboard. Try again in a minute."
export const SAVE_ERROR = "That did not go through. Try again when you are online."

/** The viewer's Monday 00:00, the start of the week the server counts from. */
export const weekStart = (now = Date.now()) => (monday(new Date(now)) as Date).getTime()

/** Hours to one decimal, whole from 100: "12.5", "140". */
export const lbHours = (minutes: number) => {
    const h = minutes / 60
    return h >= 100 ? String(Math.round(h)) : String(Math.round(h * 10) / 10)
}

export interface LbRank extends LbRow {
    rank: number
    /* 1 to 3 for the top three, only above zero */
    medal: number | null
    /* the bar, as a percent of the top */
    width: number
}

/**
 * A tab's list: your row set from this device's sessions, sorted most first (then by
 * name), ranked with ties sharing a rank.
 */
export function lbRows(lb: Leaderboard | null, tab: LbTab, sessions: StudySession[], now = Date.now()): LbRank[] {
    const list = lb?.[tab]
    if (!list) return []
    const since = weekStart(now)
    const own = sessions.reduce((a, s) => a + (tab === "all" || s.startedAt >= since ? s.studyMinutes : 0), 0)
    const sorted = list.map((r) => (r.me ? { ...r, minutes: own } : r)).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
    const top = sorted[0]?.minutes || 1
    let rank = 0, prev: number | null = null
    return sorted.map((r, i) => {
        if (r.minutes !== prev) { rank = i + 1; prev = r.minutes }
        return { ...r, rank, medal: rank <= 3 && r.minutes > 0 ? rank : null, width: Math.round((r.minutes / top) * 1000) / 10 }
    })
}

/* ── talking to the server ── */

const set = (lb: Leaderboard) => {
    ui.lb = lb
    notify()
}

const valid = (b: unknown): b is Required<Pick<Leaderboard, "joined" | "week" | "all">> => {
    const x = b as Leaderboard | null
    return !!x && typeof x.joined === "boolean" && (["week", "all"] as const).every((k) => Array.isArray(x[k])
        && x[k]!.every((r) => r && typeof r.name === "string" && Number.isSafeInteger(r.minutes) && typeof r.me === "boolean"))
}

/** Missing, or over a minute old and not already on its way. */
export const lbStale = (now = Date.now()) => !ui.lb || (!ui.lb.loading && now - (ui.lb.at || 0) > STALE_MS)

/** Ask for the totals. Offline, the card says so; another failure keeps what it had, with a note. */
export async function loadLeaderboard() {
    if (ui.lb?.loading) return
    set({ ...ui.lb, loading: true, at: Date.now() })
    try {
        const b: unknown = await api.leaderboard(weekStart())
        if (!valid(b)) throw new Error("invalid")
        set({ joined: b.joined, week: b.week, all: b.all, at: Date.now() })
    } catch {
        set(navigator.onLine === false ? { offline: true, at: Date.now() } : { ...ui.lb, loading: false, error: LOAD_ERROR })
    }
}

/** Join (true) or leave, then load the totals again. Busy until both are done; false when the change failed. */
export async function joinLeaderboard(join: boolean): Promise<boolean> {
    set({ ...ui.lb, busy: true, error: null })
    try {
        await api.leaderboardJoin(join)
    } catch {
        set({ ...ui.lb, busy: false, error: SAVE_ERROR })
        return false
    }
    set({ ...ui.lb, loading: false })
    await loadLeaderboard()
    if (ui.lb?.busy) set({ ...ui.lb, busy: false })
    return true
}

/** This week or all-time; kept for the session. */
export function setLbTab(tab: LbTab) {
    ui.lbTab = tab
    notify()
}

/** What the card shows: the state, the tab, and the tab's ranked rows. */
export function useLeaderboard() {
    const sessions = useStudySessions()
    const version = useSyncExternalStore(subscribe, getVersion)
    return useMemo(() => {
        const tab: LbTab = ui.lbTab === "all" ? "all" : "week"
        return { lb: ui.lb, tab, rows: lbRows(ui.lb, tab, sessions) }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the ui
    [sessions, version])
}
