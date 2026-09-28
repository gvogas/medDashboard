// The shapes the legacy store keeps, from the normalizers in legacy/js/model.js and
// store.js. Only what React reads is typed; the store may carry more.

import type { SpotifyPlace } from "./spotify/types"

export type View = "week" | "month" | "table" | "spotify" | "study"
export type ItemStatus = "todo" | "submitted" | "graded" | "done" | "missed" | (string & {})

export interface ChecklistEntry { id: string; text: string; done: boolean }

export interface Item {
    id: string
    type: string
    title: string
    courseId: string | null
    date: string
    start: string
    end: string
    where: string
    status: ItemStatus
    grade: number | null
    weight: number | null
    notes: string
    checklist: ChecklistEntry[]
    links: { label: string; url: string }[]
    recur: "weekly" | null
    weekday: number | null
    recurUntil: string | null
    dept: string
    completedAt: number | null
}

export interface Meeting { id: string; kind: string; weekday: number; start: string; end: string; room: string }

export interface Course {
    id: string
    code: string
    name: string
    color: string
    instructor: string
    term: string
    archived: boolean
    target: number | null
    meetings: Meeting[]
}

export interface Coat { name: string; role: string; color: string }

export interface Profile {
    id: string
    username?: string
    displayName?: string
    theme?: string
    bg?: string
    coat: Coat
    types: TypePref[]
    schoolCalendar?: unknown
    studyPrefs?: unknown
    studyFlow?: unknown
    termStart?: string | null
}

/** A type as the profile stores it: built-ins only carry what differs from their default. */
export interface TypePref { id: string; label?: string; color?: string; kind?: string; hidden?: boolean }

/** A type in sidebar order, as legacy typeList() returns it. */
export interface ItemType {
    id: string
    label: string
    plural: string
    color: string
    kind: string | null
    custom: boolean
    hidden: boolean
    hiddenSet: boolean
}

export interface Quote { id: string; text: string; source: string }

export interface StudySession {
    id: string
    courseId: string | null
    itemId: string | null
    startedAt: number
    studyMinutes: number
    roundsDone: number
    note: string
    manual: boolean
}

/** An achievement of your own: a sticker, earned by hours on a course or a grade on an exam. */
export interface Achievement {
    id: string
    name: string
    sticker: string
    rule: "hours" | "grade"
    courseId: string | null
    itemId: string | null
    target: number
    createdAt?: number | null
}

/** What a step of a study flow is: study time or a break. */
export type StepKind = "study" | "break"

/** A study flow, as normalizeFlow in legacy/js/model.js returns it: 1–12 steps, at least one Study, 1–12 rounds. */
export interface Flow { steps: [StepKind, number][]; rounds: number }

/** The study prefs, as normalizePrefs in legacy/js/model.js returns them. */
export interface StudyPrefs { goal: number; dayMin: number; rest: number[]; celebrate: boolean }

/** A badge as legacy achievements.js works it out: built in, or one of your own (with its sticker). */
export interface Badge {
    id: string
    group: string
    tier: string
    name: string
    blurb: string
    goal: number
    have: number
    /* how far along, 0 to 1 */
    frac: number
    earned: boolean
    earnedOn: string | null
    progress: string
    /* your own only */
    ownId?: string
    sticker?: string
}

/** The History card on the Study page: its tab, the week and month shown, the day picked, a delete Undo can take back. */
export type HistTab = "week" | "month" | "term"
export interface SessionUndo { session: StudySession; timer: ReturnType<typeof setTimeout> }
export interface Hist { weekOffset: number; tab: HistTab; monthOffset: number; focusDay: string | null; undo: SessionUndo | null }

/** The leaderboard as the server sent it, or loading, offline or failed; your row is `me`. */
export interface LbRow { name: string; minutes: number; me: boolean }
export interface Leaderboard {
    joined?: boolean
    week?: LbRow[]
    all?: LbRow[]
    /* when it was last asked for */
    at?: number
    loading?: boolean
    busy?: boolean
    offline?: boolean
    error?: string | null
}
export type LbTab = "week" | "all"

/** What the week and month show: both lists, the dated items only, or the classes only. */
export type Schedule = "all" | "deadlines" | "classes"
export type SortKey = "title" | "type" | "course" | "date" | "status"

export type SyncState = "idle" | "pending" | "syncing" | "offline" | "error" | "signed-out"
export interface SyncStatus { state: SyncState; pending: number; message: string }

/** The parts of legacy ui (legacy/js/state.js) that React reads or sets. */
export interface Ui {
    view: View
    anchor: string
    search: string
    types: Record<string, boolean>
    course: string
    settings: boolean
    focus: boolean
    /* the focus screen's music panel is open */
    focusMusic: boolean
    /* which part of the music is open, shared by the Spotify page and the focus panel */
    spotify: SpotifyPlace
    /* what the next study run is logged against */
    study: { courseId: string | null; itemId: string | null }
    /* the Study page: the History card and the leaderboard */
    hist: Hist
    lb: Leaderboard | null
    lbTab: LbTab
    bg: "med" | "cs"
    theme: string
    schedule: Schedule
    sort: { key: SortKey; dir: 1 | -1 }
    quoteIx: number
    /* Settings: the last tab, what AI reads and imports said, and its questions */
    settingsTab: "you" | "study" | "spotify" | "account"
    importNote: Note | null
    schoolNote: Note | null
    spotifyNote: "connected" | "error" | null
    outlineBusy: boolean
    schoolBusy: boolean
    schoolAsk: boolean
    signoutAsk: { everywhere: boolean } | null
    feed: Feed | null
}

export interface Note { text: string; error: boolean }

/** An edit the server turned down, kept so it can be restored or discarded. */
export interface SavedCopy { id: string; key: string; op: string; reason: string; body: Record<string, unknown> | null }

/** The calendar feed as Settings knows it. */
export interface Feed { loading?: boolean; on?: boolean; url?: string; busy?: boolean; copied?: boolean; error?: string | null; confirm?: "renew" | "stop" | null }
