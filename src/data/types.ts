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
    bg: "med" | "cs"
    theme: string
}
