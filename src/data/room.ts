// A study room on this device (study together, spec §2, §6, §7): the room as the server last
// gave it, and the poller that keeps it fresh. The clock itself is run.ts's: each answer's
// record replaces the run's (adopt), shifted onto this device's clock by the server's `now`,
// so the clock runs on locally between polls and through a lost connection.
//
// Polls every 5 s while the tab shows, every 30 s while it is hidden (it still has to notice the
// host ending the room). The room ending, or the server having taken you out, ends the run,
// which logs your minutes. study-timer.ts wraps these for the buttons, with the class picked.

import { api, ApiError } from "@/core/api"
import { data } from "@/core/store"
import * as run from "./run"
import { toast } from "./toast"
import { openRecord } from "./record"
import type { Flow, RoomRun, RoomView } from "./types"
import { MINUTE_MS } from "@/lib/time"
import { createStore } from "@/lib/store"

export const VISIBLE_MS = 5_000
export const HIDDEN_MS = 30_000
/** No poll for this long and the server takes you out (worker/rooms.js GONE_MS). */
const GONE_MS = 10 * MINUTE_MS
/** Friends one room can invite at a time: the room holds 8, you included. */
export const ROOM_INVITES = 7

interface State {
    view: RoomView | null
    /** The server's clock minus this device's, from the last full answer. */
    offset: number
    /** The last poll failed: the clock runs on from the last record. */
    reconnecting: boolean
}
const store = createStore<State>({ view: null, offset: 0, reconnecting: false })
const set = store.patch

export const roomNow = store.get
export const useRoom = store.use

/** The room this device's run is in, or null. */
export const roomId = (): string | null => run.read()?.room?.id ?? null
const me = () => data.profile?.id ?? ""

/** Whether you are the room's host, as the last answer said. */
export const isHost = (s: State = roomNow()) => !!s.view && s.view.room.hostId === me()

/* ── applying an answer ── */

/** A room record on this device's clock. */
const local = (r: RoomRun, offset: number): RoomRun =>
    ({ ...r, startedAt: r.startedAt - offset, pausedAt: r.pausedAt === null ? null : r.pausedAt - offset })

/* The room's version in the last answer taken (the tag starts with it). A poll sent before the
   host's Pause can come back after it: an older answer is dropped, not adopted. */
let applied = { id: "", version: 0 }
const versionOf = (v: RoomView) => Number.parseInt(v.tag, 10) || 0

/** Take a full answer: the run follows it, or ends when the room has ended or let you go. */
async function apply(view: RoomView, sentAt: number): Promise<void> {
    const id = roomId()
    if (!id || view.room.id !== id) return
    if (applied.id === id && versionOf(view) < applied.version) return
    applied = { id, version: versionOf(view) }
    /* the answer was made somewhere between sending and now: take the middle */
    const offset = view.now - (sentAt + Date.now()) / 2
    set({ view, offset, reconnecting: false })
    const mine = view.members.find((m) => m.userId === me())
    const clock = local(view.room.run, offset)
    const kept = run.read()?.room
    if (!mine || mine.state !== "in") {
        /* taken out after 10 minutes away, or left from another device: what the server kept counts */
        await run.adopt(clock, { id, joinedAt: kept?.joinedAt ?? Date.now(), joinedStudyMs: Number.MAX_SAFE_INTEGER, earlierMs: mine?.earlierMs ?? kept?.earlierMs ?? 0 })
        /* taken out for being away: the server dates the leave to when you were last seen, 10+ minutes back */
        const away = mine?.state === "left" && mine.leftAt !== null && view.now - mine.leftAt >= GONE_MS
        toast(away ? "You left the room after a while away. Your minutes are saved." : "You left the room. Your minutes are saved.")
        await end(false)
        return
    }
    await run.adopt(clock, { id, joinedAt: mine.joinedAt - offset, joinedStudyMs: mine.joinedStudyMs, earlierMs: mine.earlierMs })
    if (view.room.endedAt !== null) {
        const host = view.members.find((m) => m.userId === view.room.hostId)
        if (view.room.hostId !== me()) toast((host ? host.name : "The host") + " ended the session. Your minutes are saved.")
        await end(false)
    }
}

/* ── the poller ── */

let timer: ReturnType<typeof setTimeout> | null = null
let polling: string | null = null

function schedule() {
    if (timer) clearTimeout(timer)
    timer = polling ? setTimeout(() => void poll(), document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS) : null
}

/** Ask the server now; then again in 5 or 30 s. */
export async function poll(): Promise<void> {
    const id = roomId()
    if (!id) { stop(); return }
    const sentAt = Date.now()
    try {
        const known = roomNow().view
        const view = await api.rooms.get(id, known?.room.id === id ? known.tag : undefined)
        if (view) await apply(view, sentAt)
        else if (roomNow().reconnecting) set({ reconnecting: false })
    } catch (e) {
        if ((e as Error)?.name === "AbortError") return
        if (e instanceof ApiError && e.status === 404) {
            /* the room is gone, or closed to you: keep what you studied */
            toast("That room is closed. Your minutes are saved.")
            await end(false)
            return
        }
        set({ reconnecting: true })
    }
    if (polling === id) schedule()
}

function startPolling() {
    const id = roomId()
    if (!id || polling === id) return
    polling = id
    schedule()
}

function stop() {
    polling = null
    if (timer) clearTimeout(timer)
    timer = null
}

/* A run that begins or resumes in a room starts the polling; a run that ends stops it, and tells
   the server you left (the flow ran out, or Stop & log) unless it already knows. */
let tellLeave: string | null = null
run.onTick((s, event) => {
    if (event === "end") {
        const id = polling ?? tellLeave
        stop()
        set({ view: null, reconnecting: false })
        if (id && tellLeave === id) sendLeave(id)
        tellLeave = null
        /* the session is saved before the end is told: with a minute or more, the summary */
        if (id && data.study_sessions.some((x) => x.id === "r-" + id)) openRecord(id, true)
        return
    }
    if (s?.room && polling !== s.room.id) { tellLeave = s.room.id; startPolling(); if (!roomNow().view) void poll() }
})
document.addEventListener("visibilitychange", () => { if (polling && document.visibilityState === "visible") void poll() })

/* Tell the server you left; offline or switched off for maintenance, try again a few times
   (until then the room shows you, and the server takes you out after 10 minutes anyway). */
function sendLeave(id: string, tries = 4) {
    api.rooms.leave(id).catch((e) => {
        if (e instanceof ApiError && e.status !== 503 && e.status < 500) return   /* gone, or not yours: nothing to tell */
        if (tries > 1) setTimeout(() => sendLeave(id, tries - 1), 30_000)
    })
}

/** End this device's run: it logs your minutes. `leave` tells the server too. */
async function end(leave: boolean) {
    if (!leave) tellLeave = null
    await run.stop()   /* the 'end' it emits tells the server, when `leave` */
}

/* ── what the buttons do ── */

/** What a failed room request says. */
export function roomMessage(e: unknown): string {
    if (!(e instanceof ApiError)) return "That needs a connection. Try again when you're online."
    const code = e.body?.error
    if (code === "full") return "That room is full: 8 people are in it."
    if (code === "ended") return "That session has ended."
    if (code === "not_found") return "That room is closed to you, or no longer there."
    if (code === "not_host") return "Only the host can do that now."
    if (e.status === 429) return "You've started a lot of rooms today. Try again tomorrow."
    if (e.status === 503) return "Study together is switched off for a moment. Try again soon."
    return "That did not go through. Try again."
}

/** Begin this device's run in the room an answer describes. */
async function enter(view: RoomView, sentAt: number, courseId: string, itemId: string | null) {
    const offset = view.now - (sentAt + Date.now()) / 2
    const mine = view.members.find((m) => m.userId === me())!
    applied = { id: view.room.id, version: versionOf(view) }
    set({ view, offset, reconnecting: false })
    await run.begin(view.room.run.flow, courseId, itemId, {
        link: { id: view.room.id, joinedAt: mine.joinedAt - offset, joinedStudyMs: mine.joinedStudyMs, earlierMs: mine.earlierMs },
        clock: local(view.room.run, offset),
    })
}

/** Start a room as its host, inviting `invite`. A run already going ends once the room is made (it
    is logged); a start that fails leaves it running. Returns an error message or "". */
export async function startRoom(flow: Flow, courseId: string, itemId: string | null, courseLabel: string, invite: string[]): Promise<string> {
    const sentAt = Date.now()
    let view: RoomView
    try { view = await api.rooms.create(flow, courseLabel, invite) } catch (e) { return roomMessage(e) }
    /* the server has already taken you out of any other room */
    if (run.active()) await end(false)
    await enter(view, sentAt, courseId, itemId)
    return ""
}

/** Join a room. A run already going ends first, unless it is this room's. Returns an error message or "". */
export async function joinRoom(id: string, courseId: string, itemId: string | null, courseLabel: string): Promise<string> {
    if (roomId() === id) return ""
    const sentAt = Date.now()
    let view: RoomView
    try { view = await api.rooms.join(id, courseLabel) } catch (e) { return roomMessage(e) }
    /* the server has already taken you out of any other room */
    if (run.active()) await end(false)
    await enter(view, sentAt, courseId, itemId)
    return ""
}

/** Leave: your minutes are logged and the server is told. */
export const leaveRoom = () => end(true)

/** The host's Pause, Resume, Skip and End, for everyone. */
export async function hostClock(action: "pause" | "resume" | "skip" | "end"): Promise<void> {
    const id = roomId()
    if (!id) return
    if (!isHost()) { toast("Only the host controls the timer."); return }
    const sentAt = Date.now()
    try { await apply(await api.rooms.clock(id, action), sentAt) } catch (e) {
        toast(roomMessage(e), { error: true })
        void poll()
    }
}

/** Invite more friends (the host). Returns an error message or "". */
export async function inviteMore(userIds: string[]): Promise<string> {
    const id = roomId()
    if (!id || !userIds.length) return ""
    try { await api.rooms.invite(id, userIds); return "" } catch (e) { return roomMessage(e) }
}

/** Log to another class from here on; the room sees its label. */
export async function setRoomPick(courseId: string, itemId: string | null, courseLabel: string): Promise<void> {
    const id = roomId()
    if (!id) return
    await run.setPick(courseId, itemId)
    const sentAt = Date.now()
    try { await apply(await api.rooms.label(id, courseLabel), sentAt) } catch { /* the label shows at the next change */ }
}

/** Minutes so far for someone in the room, from the record on this device's clock. */
export function memberMinutes(m: RoomView["members"][number], clock: RoomRun, now = Date.now()): number {
    const studied = run.roomStudyMs({ ...clock, room: { id: "", joinedAt: 0, joinedStudyMs: m.joinedStudyMs, earlierMs: m.earlierMs } }, m.state === "in" ? now : (m.leftAt ?? now))
    return Math.floor((m.state === "in" ? studied : m.earlierMs) / MINUTE_MS)
}

/** The record on this device's clock, for drawing. */
export const localClock = (s: State = roomNow()): RoomRun | null => (s.view ? local(s.view.room.run, s.offset) : null)

/** For tests and sign-out. */
export function resetRoom() { stop(); tellLeave = null; applied = { id: "", version: 0 }; set({ view: null, offset: 0, reconnecting: false }) }
