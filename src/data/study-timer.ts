// The study timer: the running run, what starts, pauses and stops it, the focus screen
// it opens, and the flow it follows. The run itself is run.ts's (core/timer.ts
// does the arithmetic); useRun() reads it on each of run.ts's ticks, which also keep
// the tab's title and the Study icon's badge. The helpers below are pure, so the cards,
// the focus screen and the dock draw from the same numbers.

import { useMemo, useSyncExternalStore } from "react"
import * as focus from "./run"
import * as store from "@/core/store"
import { data } from "@/core/store"
import { isOpen, normalizeFlow, normalizePrefs, FLOW_PRESETS } from "@/core/model"
import { iso, today as todayIso } from "@/core/dates"
import { minutesByDay } from "@/core/history"
import { rememberUi } from "@/data/ui"
import { notify, setStudyBadge, subscribe as subscribeBridge } from "@/bridge"
import { getSheet } from "./overlay"
import { useCourses, useItems, useProfile, useStudySessions } from "./store"
import { shownSessions } from "./study"
import { ui, useUi } from "./ui"
import { effectiveCourses, effectiveItems } from "./effective"
import { keyedCourses, keyedItems } from "./refs"
import { withProjects } from "./projects"
import { THEMES, type Bg } from "./themes"
import type { Course, Flow, Item, StepKind, StudySession } from "./types"

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

/* run.ts ticks four times a second; a new snapshot is taken only when something shown
   changes (at most once a second, and on every step, start and end), so between those
   getSnapshot returns the same object. */
let run: Run | null = null
let runKey = ""
const listeners = new Set<() => void>()

function readRun(): Run | null {
    const now = Date.now()
    const s = focus.read(now)
    return s ? { ...s, at: now } : null
}

const keyOf = (r: Run | null) => (r
    ? [r.round, r.index, r.kind, r.paused, r.done, r.roundsDone, Math.ceil(r.leftMs / 1000), Math.floor(r.studyMs / 1000),
        Math.floor(r.at / 1000), r.courseId, r.itemId].join()
    : "")

/* A new snapshot also retitles the tab ("24:13 · Study") and badges the Study icon. */
function refresh(force: boolean) {
    const next = readRun(), key = keyOf(next)
    if (!force && key === runKey) return
    run = next
    runKey = key
    document.title = tickTitle(run, THEMES[ui.bg].studyWord)
    setStudyBadge(run ? timeText(run.leftMs) : null)
    for (const fn of listeners) fn()
}

/* The title carries the theme's study word, so a theme change retitles the tab even while paused. */
let titledBg = ui.bg
subscribeBridge(() => {
    if (ui.bg === titledBg) return
    titledBg = ui.bg
    refresh(true)
})

/* What a run does to the page: Start opens the focus screen; a new Study step pulls you
   back into it (unless a sheet is open); Stop & log, or the flow's end, goes to the
   Study page's Timer tab, whose Today card now lists the session. */
focus.onTick((s: { kind: StepKind } | null, event: string) => {
    let moved = false
    if (event === "start") { ui.focus = true; moved = true }
    else if (event === "end") {
        ui.focus = false
        ui.view = "study"
        ui.studyTab = "timer"
        rememberUi()
        moved = true
    } else if (event === "step" && s?.kind === "study" && !ui.focus && !getSheet()) { ui.focus = true; moved = true }
    refresh(event !== "tick")
    if (moved) notify()
})

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

/** What the Ready card offers: the live courses, the picked course's open items (soonest
    first), and what the next run is logged against. */
export function useStudyPick() {
    /* the pickers work in keys: a class's course and items sit beside yours (refs.ts) */
    const courses = keyedCourses(useCourses()), items = keyedItems(useItems()), me = useProfile()?.id ?? ""
    const study = useUi((u) => u.study)
    return useMemo(() => {
        /* and a course per team project you are in, of your tasks there (projects.ts) */
        const lists = withProjects(courses, items, me), pick = pickFor(lists.courses, lists.items, study)
        return {
            ...pick,
            courses: lists.courses.filter((c) => !c.archived),
            items: lists.items.filter((it) => it.courseId === pick.courseId && isOpen(it)).sort((a, b) => a.date.localeCompare(b.date)),
        }
        /* ui.study is changed in place: its two ids are the dependency */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courses, items, me, study.courseId, study.itemId])
}

/** Pick the course for the next run; its item goes back to none. */
export function pickCourse(id: string) {
    ui.study.courseId = id
    ui.study.itemId = null
    notify()
}

/** Pick one of the course's open items for the next run, or none. */
export function pickItem(id: string | null) {
    ui.study.itemId = id || null
    notify()
}

const studyLists = (): [Course[], Item[]] => {
    const l = withProjects(keyedCourses(effectiveCourses()), keyedItems(effectiveItems()), data.profile?.id ?? "")
    return [l.courses, l.items]
}

/** Start a run on the saved flow. Call it inside the click, so full screen and sound are allowed. */
export async function startRun(): Promise<boolean> {
    if (focus.active()) return false
    if (!pickFor(...studyLists(), ui.study).courseId) return false
    focus.prime()      /* inside the click: a wait below could lose the browser's permission */
    /* a step's minutes typed and then Start clicked: the box saves as it loses focus, just before */
    await flowSaving
    if (focus.active()) return false
    const { courseId, itemId } = pickFor(...studyLists(), ui.study)
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

/** Back to the focus screen (the dock's Focus, or the Study view during a run), full screen again. */
export function openFocus() {
    ui.focus = true
    focus.fullscreen(true)
    notify()
}

/** Leave the focus screen; the run goes on in the dock. The Study view would open it
    again, so from there you land on the week. */
export function leaveFocus() {
    ui.focus = false
    focus.fullscreen(false)
    if (ui.view === "study") { ui.view = "week"; rememberUi() }
    notify()
}

/** Esc on the focus screen: the music panel shuts first, then the screen is left. */
export function escapeFocus() {
    if (ui.focusMusic) toggleMusic(false)
    else leaveFocus()
}

/** Open or shut the focus screen's music panel. */
export function toggleMusic(open = !ui.focusMusic) {
    if (ui.focusMusic === open) return
    ui.focusMusic = open
    notify()
}

/* ── the flow ── */

const savedFlow = (profile = data.profile): Flow => normalizeFlow(profile?.studyFlow)
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

/** Replace the flow with a Quick start preset. */
export function applyPreset(i: number): Promise<boolean> {
    const preset = PRESETS[i]
    return preset ? saveFlow(copy(preset[1])) : Promise.resolve(false)
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
    return logged + (r && iso(new Date(r.startedAt)) === today ? Math.floor(r.studyMs / MIN) : 0)
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
