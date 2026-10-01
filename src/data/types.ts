// The record shapes live in core/types.ts, beside the store that keeps them; they are
// re-exported here so components keep one place to import from. What stays here is the
// app's own state: the ui object React reads and sets.

import type { SpotifyPlace } from "./spotify/types"
import type { Bg } from "./themes"
import type { StudySession } from "../core/types"

export type * from "../core/types"

export type View = "week" | "month" | "table" | "spotify" | "study"

/** The History card on the Study page: its tab, the week and month shown, the day picked, a delete Undo can take back. */
export type HistTab = "week" | "month" | "term"
/** The Study page's four tabs. */
export type StudyTab = "timer" | "history" | "achievements" | "leaderboard"
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
/** What the All items table shows by status: everything, the open items, or the overdue. */
export type Show = "all" | "open" | "overdue"

/** The UI state (ui.ts): what is open, filtered and sorted. */
export interface Ui {
    view: View
    anchor: string
    search: string
    /* the All items table's filters: the type chips and the status chips */
    types: Record<string, boolean>
    show: Show
    course: string
    /* the sidebar's semester: a school calendar semester's name, or null for the current one */
    sem: string | null
    /* "tile" while the table shows a stat tile's list, which leaves out the course and the search */
    listFrom: "tile" | null
    focus: boolean
    /* the focus screen's music panel is open */
    focusMusic: boolean
    /* which part of the music is open, shared by the Music page and the focus panel */
    spotify: SpotifyPlace
    /* what the next study run is logged against */
    study: { courseId: string | null; itemId: string | null }
    /* the Study page: its tab (remembered on this browser), the History card and the leaderboard */
    studyTab: StudyTab
    hist: Hist
    lb: Leaderboard | null
    lbTab: LbTab
    bg: Bg
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

/** The calendar feed as Settings knows it. */
export interface Feed { loading?: boolean; on?: boolean; url?: string; busy?: boolean; copied?: boolean; error?: string | null; confirm?: "renew" | "stop" | null }
