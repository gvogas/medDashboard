// The study timer: the running run, what starts, pauses and stops it, and the flow it
// follows. The run itself stays in legacy/js/focus.js (timer.js does the arithmetic);
// useRun() reads it on each of focus.js's ticks. The helpers below are pure, so the
// cards, the focus screen and the dock draw from the same numbers.

import { useMemo, useSyncExternalStore } from "react"
import * as focus from "@/legacy/js/focus.js"
import * as store from "@/legacy/js/store.js"
import { data } from "@/legacy/js/store.js"
import { isOpen, normalizeFlow, FLOW_PRESETS } from "@/legacy/js/model.js"
import { iso } from "@/legacy/js/dates.js"
import { minutesByDay } from "@/legacy/js/history.js"
import { renderView } from "@/legacy/js/views/render.js"
import { openFocus, leaveFocus } from "@/legacy/js/study-controller.js"
import { notify, subscribe as subscribeBridge } from "@/bridge"
import { useProfile } from "./store"
import { ui } from "./ui"
import type { Course, Flow, Item, Profile, StepKind, StudySession } from "./types"

export { openFocus, leaveFocus }

const MIN = 60_000
export const MAX_STEPS = 12
export const MAX_ROUNDS = 12
export const MAX_MINUTES = 180

/** The run as focus.read() gives it, and when it was read. */
export interface Run {
    round: number                /* 1-based */
    index: number                /* the step within the round */
    kind: StepKind
    leftMs: number               /* left in this step */
    stepMs: number
    studyMs: number              /* study done so far; skipped study never counts */
    roundsDone: number
    done: boolean
    paused: boolean
    leftInFlowMs: number
    courseId: string | null
    itemId: string | null
    flow: Flow
    startedAt: number
    at: number
}

/* ── the running run, as an external store ── */

/* focus.js ticks four times a second; a new snapshot is taken only when something shown
   changes (at most once a second, and on every step, start and end), so between those
   getSnapshot returns the same object. */
let run: Run | null = null
let runKey = ""
const listeners = new Set<() => void>()

function readRun(): Run | null {
    const now = Date.now()
    const s = focus.read(now) as unknown as Omit<Run, "at"> | null
    return s ? { ...s, at: now } : null
}

const keyOf = (r: Run | null) => (r
    ? [r.round, r.index, r.kind, r.paused, r.done, r.roundsDone, Math.ceil(r.leftMs / 1000), Math.floor(r.studyMs / 1000),
        Math.floor(r.at / 1000), r.courseId, r.itemId].join()
    : "")

function refresh(force: boolean) {
    const next = readRun(), key = keyOf(next)
    if (!force && key === runKey) return
    run = next
    runKey = key
    for (const fn of listeners) fn()
}

focus.onTick((_s: unknown, event: string) => refresh(event !== "tick"))

function getRun(): Run | null {
    /* focus.reset() on sign-out forgets the run without a tick; a run begun before this
       module loaded has not ticked here yet */
    if (run && !focus.active()) { run = null; runKey = "" }
    else if (!run && focus.active()) { run = readRun(); runKey = keyOf(run) }
    return run
}

function subscribeRun(fn: () => void) {
    listeners.add(fn)
    const off = subscribeBridge(fn)
    return () => { listeners.delete(fn); off() }
}

/** The running study run, or null; redraws as it ticks. */
export const useRun = () => useSyncExternalStore(subscribeRun, getRun)

/* ── starting, pausing, stopping ── */

/** The course and item the next run is logged against: a live course, and an open item of it or none. */
export function pickFor(courses: Course[], items: Item[], study: { courseId: string | null; itemId: string | null }) {
    const live = courses.filter((c) => !c.archived)
    const courseId = live.some((c) => c.id === study.courseId) ? study.courseId : live[0]?.id || null
    const itemId = study.itemId && items.some((it) => it.id === study.itemId && it.courseId === courseId && isOpen(it)) ? study.itemId : null
    return { courseId, itemId }
}

/** Start a run on the saved flow. Call it inside the click, so full screen and sound are allowed. */
export async function startRun(): Promise<boolean> {
    if (focus.active()) return false
    const { courseId, itemId } = pickFor(data.courses as Course[], data.items as Item[], ui.study)
    ui.study.courseId = courseId
    ui.study.itemId = itemId
    if (!courseId) return false
    await focus.begin(savedFlow(), courseId, itemId)
    return true
}

export const togglePause = (): Promise<void> => focus.togglePause()
export const skip = (): Promise<void> => focus.skip()
/** Stop & log: the study time done so far is saved as a session. */
export const stopRun = (): Promise<void> => focus.stop()

/** Open or shut the focus screen's music panel. */
export function toggleMusic(open = !ui.focusMusic) {
    if (ui.focusMusic === open) return
    ui.focusMusic = open
    notify()
}

/* ── the flow ── */

const savedFlow = (profile = data.profile as Profile | null): Flow => normalizeFlow(profile?.studyFlow) as Flow
const copy = (f: Flow): Flow => structuredClone(f)
const hasStudy = (f: Flow) => f.steps.some(([k]) => k === "study")
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))

/** The saved flow; the same object until the profile changes. */
export function useFlow(): Flow {
    const profile = useProfile()
    return useMemo(() => savedFlow(profile), [profile])
}

/* Every change saves the flow to the profile, so it follows you to other devices. */
async function saveFlow(next: Flow): Promise<boolean> {
    await store.saveProfile({ studyFlow: normalizeFlow(next) })
    renderView()
    return true
}

/** Switch a step between Study and Break; the only Study step cannot become a Break. */
export function setStepKind(i: number): Promise<boolean> {
    const f = copy(savedFlow()), step = f.steps[i]
    if (!step) return Promise.resolve(false)
    step[0] = step[0] === "study" ? "break" : "study"
    return hasStudy(f) ? saveFlow(f) : Promise.resolve(false)
}

/** A step's length, 1 to 180 whole minutes. */
export function setStepMinutes(i: number, minutes: number): Promise<boolean> {
    const f = copy(savedFlow()), step = f.steps[i]
    if (!step || !Number.isFinite(minutes)) return Promise.resolve(false)
    const m = clamp(minutes, 1, MAX_MINUTES)
    if (m === step[1]) return Promise.resolve(false)
    step[1] = m
    return saveFlow(f)
}

/** A new last step, up to 12: 25 minutes of study or a 5-minute break. */
export function addStep(kind: StepKind): Promise<boolean> {
    const f = copy(savedFlow())
    if (f.steps.length >= MAX_STEPS) return Promise.resolve(false)
    f.steps.push([kind, kind === "study" ? 25 : 5])
    return saveFlow(f)
}

/** Remove a step; never the last one, nor the only Study step. */
export function delStep(i: number): Promise<boolean> {
    const f = copy(savedFlow())
    if (f.steps.length < 2 || !f.steps[i]) return Promise.resolve(false)
    f.steps.splice(i, 1)
    return hasStudy(f) ? saveFlow(f) : Promise.resolve(false)
}

/** How many times the steps repeat, 1 to 12. */
export function setRounds(n: number): Promise<boolean> {
    const f = copy(savedFlow())
    if (!Number.isFinite(n)) return Promise.resolve(false)
    const rounds = clamp(n, 1, MAX_ROUNDS)
    if (rounds === f.rounds) return Promise.resolve(false)
    f.rounds = rounds
    return saveFlow(f)
}

/** The Quick start presets: [name, flow]. */
export const PRESETS = FLOW_PRESETS as unknown as readonly [string, Flow][]

/** Replace the flow with a Quick start preset. */
export function applyPreset(i: number): Promise<boolean> {
    const preset = PRESETS[i]
    return preset ? saveFlow(copy(preset[1])) : Promise.resolve(false)
}

/* ── what the cards, the focus screen and the dock show ── */

/** Minutes of study and in all, over every round. */
export function flowTotals(f: Flow): { study: number; total: number } {
    let study = 0, total = 0
    for (const [k, m] of f.steps) { total += m; if (k === "study") study += m }
    return { study: study * f.rounds, total: total * f.rounds }
}

export interface Segment { kind: StepKind; minutes: number; fill: number; now: boolean }

/** The round strip: per round, per step, how full it is (1 done, 0 still to come). No run: all to come. */
export function stripSegments(f: Flow, r: Run | null): Segment[][] {
    return Array.from({ length: f.rounds }, (_, ri) => f.steps.map(([kind, minutes], i) => {
        const round = ri + 1
        const now = !!r && round === r.round && i === r.index
        const past = !!r && (round < r.round || (round === r.round && i < r.index))
        const fill = past ? 1 : now ? Math.min(1, Math.max(0, (r.stepMs - r.leftMs) / r.stepMs)) : 0
        return { kind, minutes, fill, now }
    }))
}

export type NextLine = { last: true } | { last: false; kind: StepKind; minutes: number; round: number }

/** What comes after this step: the next step (maybe in the next round), or nothing. */
export function nextLine(r: Run): NextLine {
    let i = r.index + 1, round = r.round
    if (i >= r.flow.steps.length) { i = 0; round++ }
    if (round > r.flow.rounds) return { last: true }
    const [kind, minutes] = r.flow.steps[i]
    return { last: false, kind, minutes, round }
}

/** When the run will end, in ms. While it runs that is fixed; while paused it moves on with `now`. */
export const doneAt = (r: Run, now = Date.now()) => (r.paused ? now : r.at) + r.leftInFlowMs

/** Minutes studied today: the logged sessions, and this run's study so far. A run is logged
    on the day it started, so one begun before midnight counts toward that day, not today. */
export function todaySoFar(sessions: StudySession[], r: Run | null, today: string): number {
    const logged = minutesByDay(sessions).get(today) || 0
    return logged + (r && iso(new Date(r.startedAt)) === today ? Math.floor(r.studyMs / MIN) : 0)
}

/** "MM:SS", rounded up to the second, as the flip clock shows it. */
export function timeText(ms: number): string {
    const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.min(99, Math.floor(t / 60)), s = t % 60
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
}

/** The tab's title: the time left and the phase during a run. */
export const tickTitle = (r: Run | null) => (r ? timeText(r.leftMs) + " · " + (r.kind === "study" ? "Study" : "Break") : "Rounds")
