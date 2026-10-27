// The study timer's run: the running run as an external store, what starts, pauses and stops it, and
// the focus screen it opens. The run itself is run.ts's (core/timer.ts does the arithmetic); useRun()
// reads it on each of run.ts's ticks, which also keep the tab's title and the Study icon's badge.

import { useMemo, useSyncExternalStore } from "react"
import * as focus from "./run"
import * as room from "./room"
import type { RoomLink } from "./run"
import { data } from "@/core/store"
import { isOpen } from "@/core/model"
import { rememberUi } from "@/data/ui"
import { notify, setStudyBadge, subscribe as subscribeBridge } from "@/bridge"
import { getSheet } from "./overlay"
import { createEmitter } from "@/lib/store"
import { useCourses, useItems, useProfile } from "./store"
import { ui, useUi } from "./ui"
import { effectiveCourses, effectiveItems } from "./effective"
import { keyedCourses, keyedItems } from "./refs"
import { withProjects } from "./projects"
import { THEMES } from "./themes"
import type { Course, Flow, Item, StepKind } from "./types"
import { savedFlow, flowSettled, timeText, tickTitle } from "./study-flow"

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
    /** In a study room (room.ts): which, and your place in it. */
    room: RoomLink | null
    at: number
}

/* ── the running run, as an external store ── */

/* run.ts ticks four times a second; a new snapshot is taken only when something shown
   changes (at most once a second, and on every step, start and end), so between those
   getSnapshot returns the same object. */
let run: Run | null = null
let runKey = ""
const runChange = createEmitter()

function readRun(): Run | null {
    const now = Date.now()
    const s = focus.read(now)
    return s ? { ...s, at: now } : null
}

const keyOf = (r: Run | null) => (r
    ? [r.round, r.index, r.kind, r.paused, r.done, r.roundsDone, Math.ceil(r.leftMs / 1000), Math.floor(r.studyMs / 1000),
        Math.floor(r.at / 1000), r.courseId, r.itemId, r.room?.id ?? ""].join()
    : "")

/* A new snapshot also retitles the tab ("24:13 · Study") and badges the Study icon. */
function refresh(force: boolean) {
    const next = readRun(), key = keyOf(next)
    if (!force && key === runKey) return
    run = next
    runKey = key
    document.title = tickTitle(run, THEMES[ui.bg].studyWord)
    setStudyBadge(run ? timeText(run.leftMs) : null)
    runChange.emit()
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
    const offRun = runChange.subscribe(fn)
    const off = subscribeBridge(fn)
    return () => { offRun(); off() }
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

export const studyLists = (): [Course[], Item[]] => {
    const l = withProjects(keyedCourses(effectiveCourses()), keyedItems(effectiveItems()), data.profile?.id ?? "")
    return [l.courses, l.items]
}

/** Start a run on the saved flow. Call it inside the click, so full screen and sound are allowed. */
export async function startRun(): Promise<boolean> {
    if (focus.active()) return false
    if (!pickFor(...studyLists(), ui.study).courseId) return false
    focus.prime()      /* inside the click: a wait below could lose the browser's permission */
    /* a step's minutes typed and then Start clicked: the box saves as it loses focus, just before */
    await flowSettled()
    if (focus.active()) return false
    const { courseId, itemId } = pickFor(...studyLists(), ui.study)
    ui.study.courseId = courseId
    ui.study.itemId = itemId
    if (!courseId) return false
    await focus.begin(savedFlow(), courseId, itemId)
    return true
}

/* In a room the clock is the room's: Pause and Skip are the host's, for everyone (room.ts). */
export function togglePause(): Promise<void> {
    const r = focus.read()
    if (r?.room) return room.hostClock(r.paused ? "resume" : "pause")
    return focus.togglePause()
}
export function skip(): Promise<void> {
    return focus.read()?.room ? room.hostClock("skip") : focus.skip()
}
/** Stop & log: the study time done so far is saved as a session. In a room, that is Leave. */
export const stopRun = (): Promise<void> => (focus.read()?.room ? room.leaveRoom() : focus.stop())

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
