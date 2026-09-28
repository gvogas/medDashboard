// The shapes the legacy store keeps, from the normalizers in legacy/js/model.js and
// store.js. Only what React reads is typed; the store may carry more.

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

/** The study prefs, as normalizePrefs in legacy/js/model.js returns them. */
export interface StudyPrefs { goal: number; dayMin: number; rest: number[]; celebrate: boolean }

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
    /* what the next study run is logged against */
    study: { courseId: string | null; itemId: string | null }
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
