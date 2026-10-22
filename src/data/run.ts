// A study run on this device: starts, pauses, skips, stops, and logs its study time.
// The run record lives in IndexedDB's meta store, so a reload picks it up; only the
// finished session syncs. study-timer.ts draws from read() and listens with onTick().
// A run in a study room (room.ts) carries `room`: its clock is the room's, which adopt()
// replaces on each poll, and it logs as the session 'r-' + the room id.

import * as store from "@/core/store"
import { data } from "@/core/store"
import * as timer from "@/core/timer"
import { uid } from "@/core/model"
import { refOf } from "./refs"
import type { Flow, StepKind } from "./types"

/** A run's place in a room: the room, when you first joined (on this device's clock), the room's
    study time when you last joined, and what earlier stints in it came to. */
export interface RoomLink { id: string; joinedAt: number; joinedStudyMs: number; earlierMs: number }
/** timer.start() plus what the run is logged against. */
export interface StoredRun extends timer.Run { id: string; courseId: string | null; itemId: string | null; room?: RoomLink }
/** What read() gives: the timer's state and what the run is logged against. */
export interface RunRead extends timer.RunState { courseId: string | null; itemId: string | null; flow: Flow; startedAt: number; room: RoomLink | null }
export type RunEvent = "tick" | "step" | "start" | "end"

const KEY = "studyRun"
let run: StoredRun | null = null
let ticker: ReturnType<typeof setInterval> | null = null, lastStep: string | null = null
let wake: WakeLockSentinel | null = null, audio: AudioContext | null = null
const listeners = new Set<(state: RunRead | null, event: RunEvent) => void>()

/** fn(state, event): event is 'tick', 'step' (a new step began), 'start' or 'end'. */
export const onTick = (fn: (state: RunRead | null, event: RunEvent) => void) => listeners.add(fn)
const emit = (event: RunEvent) => { const s = read(); for (const fn of listeners) fn(s, event) }

export const active = () => !!run
export function read(now = Date.now()): RunRead | null {
    return run ? { ...timer.read(run, now), courseId: run.courseId, itemId: run.itemId, flow: run.flow, startedAt: run.startedAt, room: run.room ?? null } : null
}

/** Whole rounds of study in `ms`: a room run logs the rounds' worth you studied, not the room's. */
const roundsIn = (flow: Flow, ms: number) => {
    const per = flow.steps.reduce((a, [k, m]) => a + (k === "study" ? m * 60_000 : 0), 0)
    return Math.min(flow.rounds, Math.floor(ms / per))
}

/** Your study in a room run: earlier stints, and the room's study since you last joined. */
export function roomStudyMs(r: Pick<StoredRun, "room"> & timer.Run, now = Date.now()): number {
    if (!r.room) return timer.read(r, now).studyMs
    return r.room.earlierMs + Math.max(0, timer.read(r, now).studyMs - r.room.joinedStudyMs)
}

/** On sign-in: resume a run this device was in the middle of. */
export async function load() {
    const kept = await store.meta.get(KEY) as StoredRun | null | undefined
    run = kept && typeof kept.id === "string" && timer.resumable(kept) ? kept : null
    if (!run) { if (kept) await store.meta.set(KEY, null); return }   /* a damaged run would stop sign-in */
    if (timer.read(run).done) { await finish(); return }
    lastStep = stepKey(run)
    tick()
    ensureTicking()
}

const save = () => store.meta.set(KEY, run)
const stepKey = (r: StoredRun) => { const s = timer.read(r); return s.round + ":" + s.index }

function ensureTicking() {
    if (!ticker) ticker = setInterval(tick, 250)
}

function tick() {
    if (!run) return
    const s = timer.read(run)
    if (s.done) { finish().catch(() => {}); return }
    const key = s.round + ":" + s.index
    if (key !== lastStep) {
        lastStep = key
        chime(s.kind)
        emit("step")
    } else emit("tick")
}

/** Full screen and sound, which the browser allows only inside a click: before any wait. */
export function prime() {
    unlockAudio()
    fullscreen(true)
}

const clockOf = (r: timer.Run): timer.Run => ({
    flow: r.flow, startedAt: r.startedAt, pausedAt: r.pausedAt, pausedMs: r.pausedMs, skippedMs: r.skippedMs, skippedStudyMs: r.skippedStudyMs,
})

/** Begin a run, after prime() in the Start click; in a room, on the room's clock. */
export async function begin(flow: Flow, courseId: string, itemId: string | null, room?: { link: RoomLink; clock: timer.Run }) {
    run = room
        ? { ...clockOf(room.clock), id: "r-" + room.link.id, courseId, itemId: itemId || null, room: room.link }
        : { ...timer.start(flow), id: uid(), courseId, itemId: itemId || null }
    lastStep = stepKey(run)
    await save()
    holdScreen()
    ensureTicking()
    emit("start")
}

/** A room's latest clock, and your place in it. Nothing when this is not that room's run. */
export async function adopt(clock: timer.Run, link: RoomLink) {
    if (!run?.room || run.room.id !== link.id) return
    const was = run.pausedAt
    run = { ...run, ...clockOf(clock), room: link }
    if (run.pausedAt === null && was !== null) holdScreen()
    else if (run.pausedAt !== null && was === null) releaseScreen()
    await save()
    tick()
}

/** Change what the run is logged against (a room member picks another class mid-run). */
export async function setPick(courseId: string, itemId: string | null) {
    if (!run) return
    run = { ...run, courseId, itemId: itemId || null }
    await save()
    emit("tick")
}

export async function togglePause() {
    if (!run || run.room) return
    /* the timer copies the run with its changes, so the id and what it is logged against stay */
    run = (run.pausedAt === null ? timer.pause(run) : timer.resume(run)) as StoredRun
    if (run.pausedAt === null) holdScreen(); else releaseScreen()
    await save()
    emit("tick")
}

export async function skip() {
    if (!run || run.room) return
    run = timer.skip(run) as StoredRun
    await save()
    tick()
}

/** Stop & log: save the study time done so far. */
export const stop = () => finish()

async function finish() {
    if (!run) return
    const ended = run
    run = null
    if (ticker) clearInterval(ticker)
    ticker = null
    releaseScreen()
    fullscreen(false)
    // Another tab of this device may have logged this run already.
    const stored = await store.meta.get(KEY) as StoredRun | null | undefined
    try {
        if (stored?.id === ended.id) {
            const s = timer.read(ended)
            const minutes = timer.loggedMinutes({ studyMs: roomStudyMs(ended) })
            /* the session first: if it fails, the kept run is still there on the next load */
            if (minutes >= 1) {
                /* back in a room after leaving it: the same session, written again with the total */
                const before = ended.room ? data.study_sessions.find((x) => x.id === ended.id) : undefined
                await store.saveStudySession({
                    ...before,
                    /* the run holds keys; the session stores the ids and the space they are in */
                    id: ended.id, ...refOf(ended.courseId, ended.itemId),
                    startedAt: ended.room ? ended.room.joinedAt : ended.startedAt, studyMinutes: minutes, roundsDone: ended.room ? roundsIn(ended.flow, roomStudyMs(ended)) : s.roundsDone,
                    ...(ended.room ? { roomId: ended.room.id } : {}),
                })
            }
            await store.meta.set(KEY, null)
        }
        if (!ended.pausedAt && timer.read(ended).done) chime("done")
    } catch {
        /* kept paused where it stopped, so it neither loses nor gains minutes before it is logged */
        if (ended.pausedAt === null) await store.meta.set(KEY, timer.pause(ended)).catch(() => {})
    } finally {
        emit("end")   /* the page leaves the run behind either way */
    }
}

/* ── the screen: full screen and a wake lock, both optional ── */

export function fullscreen(on: boolean) {
    try {
        if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch(() => {})
        if (!on && document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {})
    } catch {}
}

async function holdScreen() {
    if (!run || run.pausedAt !== null || wake || !navigator.wakeLock) return
    try {
        wake = await navigator.wakeLock.request("screen")
        wake.addEventListener("release", () => { wake = null })
    } catch { wake = null }
}
function releaseScreen() { wake?.release().catch(() => {}); wake = null }
/* The browser drops the lock when the tab is hidden; take it again on return. */
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { holdScreen(); tick() } })

/* ── a short chime when a step changes: two notes up for study, down for a break ── */

function unlockAudio() {
    try {
        audio ||= new (window.AudioContext || window.webkitAudioContext!)()
        if (audio.state === "suspended") audio.resume()
    } catch { audio = null }
}

function chime(kind: StepKind | "done") {
    if (!audio) return
    const ac = audio
    const notes = kind === "study" ? [523.25, 783.99] : kind === "break" ? [659.25, 440] : [523.25, 659.25, 783.99]
    const t0 = ac.currentTime
    notes.forEach((f, i) => {
        const osc = ac.createOscillator(), gain = ac.createGain(), t = t0 + i * 0.18
        osc.type = "sine"; osc.frequency.value = f
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
        osc.connect(gain).connect(ac.destination)
        osc.start(t); osc.stop(t + 0.55)
    })
}

/** Signing out: forget the run without logging it. */
export function reset() {
    run = null
    if (ticker) clearInterval(ticker)
    ticker = null
    releaseScreen()
}
