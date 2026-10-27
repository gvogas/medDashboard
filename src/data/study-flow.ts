// The study timer's flow: the saved steps and rounds, edited step by step, and the pure helpers the
// cards, the focus screen and the dock draw their numbers from.

import { useMemo } from "react"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { normalizeFlow, normalizePrefs, FLOW_PRESETS } from "@/core/model"
import { iso, today as todayIso } from "@/core/dates"
import { minutesByDay } from "@/core/history"
import { notify } from "@/bridge"
import { toast } from "./toast"
import { useProfile, useStudySessions } from "./store"
import { shownSessions } from "./study"
import { useUi } from "./ui"
import { THEMES, type Bg } from "./themes"
import type { Flow, StepKind, StudySession } from "./types"
import { MINUTE_MS } from "@/lib/time"
import type { Run } from "./study-run"

export const MAX_STEPS = 12
export const MAX_ROUNDS = 12
export const MAX_MINUTES = 180

/* ── the flow ── */

export const savedFlow = (profile = data.profile): Flow => normalizeFlow(profile?.studyFlow)
const copy = (f: Flow): Flow => structuredClone(f)
const hasStudy = (f: Flow) => f.steps.some(([k]) => k === "study")
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)))

/** The saved flow; the same object until the profile changes. */
export function useFlow(): Flow {
    const profile = useProfile()
    return useMemo(() => savedFlow(profile), [profile])
}

/* Every change saves the flow to the profile, so it follows you to other devices. The
   last save is kept so a run started meanwhile waits for it. */
let flowSaving: Promise<unknown> = Promise.resolve()
/** Resolves once the last flow save has. */
export const flowSettled = () => flowSaving
async function saveFlow(next: Flow): Promise<boolean> {
    const saving = store.saveProfile({ studyFlow: normalizeFlow(next) })
    flowSaving = saving.catch(() => {})
    try { await saving } catch { return false }    /* the store shows the save error */
    notify()
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
export const PRESETS: readonly [string, Flow][] = FLOW_PRESETS

/** Replace the flow with a Quick start preset. A flow of your own that it replaces can come
    back with the toast's Undo; a preset replacing a preset needs none. */
export async function applyPreset(i: number): Promise<boolean> {
    const preset = PRESETS[i]
    if (!preset) return false
    const was = savedFlow()
    const own = !PRESETS.some(([, p]) => sameFlow(p, was))
    const saved = await saveFlow(copy(preset[1]))
    if (saved && own) toast("Your flow was replaced", { undo: () => { if (sameFlow(savedFlow(), preset[1])) void saveFlow(was) } })
    return saved
}

/** The Quick start presets as a theme names them: the third is the theme's own ("LeetCode then read"). */
export const presetsFor = (bg: Bg): [string, Flow][] =>
    PRESETS.map(([name, f], i): [string, Flow] => [i === 2 ? THEMES[bg].preset : name, f])

/** Whether two flows have the same steps and rounds. */
export const sameFlow = (a: Flow, b: Flow) =>
    a.rounds === b.rounds && a.steps.length === b.steps.length && a.steps.every(([k, m], i) => k === b.steps[i][0] && m === b.steps[i][1])

/** The Ready card's name for the flow: "Classic 25/5 · 4 rounds", or "Your flow · 1 round" when it is no preset. */
export function flowName(f: Flow, bg: Bg): string {
    const preset = presetsFor(bg).find(([, p]) => sameFlow(p, f))
    return (preset ? preset[0] : "Your flow") + " · " + f.rounds + (f.rounds === 1 ? " round" : " rounds")
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
    return logged + (r && iso(new Date(r.startedAt)) === today ? Math.floor(r.studyMs / MINUTE_MS) : 0)
}

/** Today's study against the daily goal (0 with none), with this run's study so far. */
export function useToday(r: Run | null): { goal: number; minutes: number } {
    const sessions = useStudySessions(), profile = useProfile()
    const undo = useUi((u) => u.hist.undo)
    const goal = (normalizePrefs(profile?.studyPrefs) as { goal: number }).goal
    return { goal, minutes: todaySoFar(shownSessions(sessions, undo), r, todayIso()) }
}

/** "MM:SS", rounded up to the second, as the flip clock shows it. */
export function timeText(ms: number): string {
    const t = Math.max(0, Math.ceil(ms / 1000)), m = Math.min(99, Math.floor(t / 60)), s = t % 60
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
}

export { clockTime } from "./study"

/** The tab's title: the time left and the phase during a run. */
export const tickTitle = (r: Run | null, word = "Study") => (r ? timeText(r.leftMs) + " · " + (r.kind === "study" ? word : "Break") : "Term")
