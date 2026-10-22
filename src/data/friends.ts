// Friends (study together): the list, requests and the two switches, as the server
// has them. Fetched when the Study page opens (and again after a minute); nothing is pushed.
// Each change updates the list at once and then asks the server again.

import { useSyncExternalStore } from "react"
import { api, ApiError } from "@/core/api"
import * as sync from "@/core/sync"
import { dropFriendRequest } from "./inbox"
import type { FriendMatch, FriendSettings, Friends } from "./types"

export const STALE_MS = 60_000
export const LOAD_ERROR = "Could not load your friends. Try again in a minute."

interface State { list: Friends | null; at: number; loading: boolean; offline: boolean; error: string }
let state: State = { list: null, at: 0, loading: false, offline: false, error: "" }
const listeners = new Set<() => void>()
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; for (const fn of listeners) fn() }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export const friendsNow = () => state
export const useFriends = () => useSyncExternalStore(subscribe, friendsNow)
/** For tests and sign-out. */
export const resetFriends = () => set({ list: null, at: 0, loading: false, offline: false, error: "" })

export const friendsStale = (now = Date.now()) => !state.list || (!state.loading && now - state.at > STALE_MS)

export async function loadFriends(): Promise<void> {
    if (state.loading) return
    set({ loading: true })
    try {
        set({ list: await api.friends.get(), at: Date.now(), loading: false, offline: false, error: "" })
    } catch (e) {
        if ((e as Error)?.name === "AbortError") { set({ loading: false }); return }
        set({ loading: false, offline: navigator.onLine === false, error: navigator.onLine === false ? "" : LOAD_ERROR })
    }
}

/** What a failed change says. */
export function friendMessage(e: unknown): string {
    if (!(e instanceof ApiError)) return "That needs a connection. Try again when you're online."
    const code = e.body?.error
    if (code === "no_user") return "Nobody has that username."
    if (code === "friends") return "You're already friends."
    if (code === "friend_limit") return "One of you already has 200 friends."
    if (e.status === 429) return "That's a lot of requests. Try again later."
    if (e.status === 503) return "Friends are switched off for a moment. Try again soon."
    return "That did not go through. Try again."
}

const edit = (fn: (l: Friends) => Friends) => { if (state.list) set({ list: fn(state.list) }) }
const after = () => { void loadFriends(); sync.syncNow().catch(() => {}) }

/** Ask someone by username. Returns an error message, or "" when it went through. */
export async function askFriend(username: string, shown?: FriendMatch): Promise<string> {
    try {
        const m = await api.friends.ask(username)
        edit((l) => m.state === "friends"
            ? { ...l, incoming: l.incoming.filter((r) => r.userId !== m.userId), friends: [{ userId: m.userId, username: m.username, name: m.name, since: Date.now() }, ...l.friends] }
            : { ...l, sent: [{ userId: m.userId, username: m.username, name: m.name, at: Date.now() }, ...l.sent.filter((r) => r.userId !== m.userId)] })
        if (shown) shown.state = m.state
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

/** Accept or decline someone's request. */
export async function answerRequest(userId: string, accept: boolean): Promise<string> {
    try {
        await api.friends.answer(userId, accept)
        edit((l) => {
            const r = l.incoming.find((x) => x.userId === userId)
            return { ...l, incoming: l.incoming.filter((x) => x.userId !== userId), friends: accept && r ? [{ userId: r.userId, username: r.username, name: r.name, since: Date.now() }, ...l.friends] : l.friends }
        })
        dropFriendRequest(userId)
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

/** Remove a friend, or cancel a request you sent. */
export async function removeFriend(userId: string): Promise<string> {
    try {
        await api.friends.remove(userId)
        edit((l) => ({ ...l, friends: l.friends.filter((x) => x.userId !== userId), sent: l.sent.filter((x) => x.userId !== userId) }))
        after()
        return ""
    } catch (e) { return friendMessage(e) }
}

export async function saveFriendSettings(s: FriendSettings): Promise<string> {
    const before = state.list?.settings
    edit((l) => ({ ...l, settings: s }))
    try { await api.friends.settings(s); return "" } catch (e) {
        if (before) edit((l) => ({ ...l, settings: before }))
        return friendMessage(e)
    }
}

/** Up to 8 people for the search box; [] while it is too short. */
export async function searchPeople(q: string): Promise<{ people: FriendMatch[]; error: string }> {
    if (q.trim().length < 2) return { people: [], error: "" }
    try { return { people: (await api.friends.search(q.trim())).people, error: "" } } catch (e) { return { people: [], error: friendMessage(e) } }
}
