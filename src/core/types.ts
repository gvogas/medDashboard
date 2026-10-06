// The shapes the store keeps, from the normalizers in model.ts and store.ts. The server
// adds its own bookkeeping to every row (revision, updatedAt, deletedAt); only what the
// app reads is typed, and a row may carry more.

export type ItemStatus = "todo" | "submitted" | "graded" | "done" | "missed" | (string & {})

/** What every synced row carries besides its own fields. A draft not yet saved may lack them. */
export interface Synced {
    createdAt?: number | null
    revision?: number
    updatedAt?: number | null
}

export interface ChecklistEntry { id: string; text: string; done: boolean }

export interface Item extends Synced {
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

export interface Course extends Synced {
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
    /** May open the Admin page (the Worker checks it again on every admin call). */
    isAdmin?: boolean
    /** The admins' message to everyone, from GET /api/me while it lasts. */
    announcement?: Announcement | null
    revision?: number
}

export interface Announcement { id: number; text: string; until: number }

/** A type as the profile stores it: built-ins only carry what differs from their default. */
export interface TypePref { id: string; label?: string; color?: string; kind?: string | null; hidden?: boolean }

/** A type in sidebar order, as typeList() in model.ts returns it. */
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

export interface Quote extends Synced { id: string; text: string; source: string }

export interface StudySession extends Synced {
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
export interface Achievement extends Synced {
    id: string
    name: string
    sticker: string
    rule: "hours" | "grade"
    courseId: string | null
    itemId: string | null
    target: number
}

/** What a step of a study flow is: study time or a break. */
export type StepKind = "study" | "break"

/** A study flow, as normalizeFlow in model.ts returns it: 1–12 steps, at least one Study, 1–12 rounds. */
export interface Flow { steps: [StepKind, number][]; rounds: number }

/** The study prefs, as normalizePrefs in model.ts returns them. */
export interface StudyPrefs { goal: number; dayMin: number; rest: number[]; celebrate: boolean }

/** A badge as achievements.ts works it out: built in, or one of your own (with its sticker). */
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
    rule?: Achievement["rule"]
    courseId?: string | null
    itemId?: string | null
}

export type SyncState = "idle" | "pending" | "syncing" | "offline" | "error" | "signed-out"
export interface SyncStatus { state: SyncState; pending: number; message: string }

/** An edit the server turned down, kept so it can be restored or discarded. */
export interface SavedCopy { id: string; key: string; op: string; reason: string; body: Record<string, unknown> | null }

/** A shared space as sync describes it (spec §6): your role in it, and its members when they last moved. */
export interface Space {
    id: string
    scope: string
    kind: "class" | "project"
    role: "owner" | "editor" | "member"
    archived: boolean
    name: string
    parent: { space: string; item: string } | null
    revision: number
    members: { userId: string; name: string; role: string }[]
}
/** A class's one course, as the class keeps it. */
export type SharedCourse = Course & { scope: string; updatedBy: string | null }
/** A class's item (its facts), or a project's item or task (the team's). */
export type SharedItem = Item & { scope: string; updatedBy: string | null; assignees: string[]; completedBy: string | null }
