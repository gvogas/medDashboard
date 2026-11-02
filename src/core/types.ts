// The shapes the store keeps, from the normalizers in model.ts and store.ts. The server
// adds its own bookkeeping to every row (revision, updatedAt, deletedAt); only what the
// app reads is typed, and a row may carry more.

import type { Feature, Maintenance } from "./maintenance"
import type { GradeCategory } from "./grades"
import type { CustomBuddy } from "./buddy-rules"

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
    /** A personal item filed under a class: the class's space id (spec §5). A label, opening nothing. */
    classId?: string | null
    /** One of its course's grade categories (core/grades.ts), or none: the item then counts by its own weight. */
    category?: string | null
}

/** `until`: the last day the class meets, YYYY-MM-DD, inclusive; absent or '' is no end. */
export interface Meeting { id: string; kind: string; weekday: number; start: string; end: string; room: string; until?: string }

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
    /** Credits for the GPA; null counts as DEFAULT_CREDITS (core/grades.ts). */
    credits?: number | null
    /** Shares of the grade split over the items in each (core/grades.ts). */
    gradeCategories?: GradeCategory[]
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
    /** The features the admins have switched off while they work on them (core/maintenance.ts). */
    maintenance?: Maintenance | null
    /** What you hid from your Week and Month: 'course:<id>', 'space:<sid>', 'personal' (spec §9). */
    hiddenSources?: string[]
    /** Your grading scale and pass marks, as stored; normalizeGrading in core/grades.ts fills the defaults. */
    grading?: unknown
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

/* ── flashcards (Study Buddy, Stage 3; worker 0012_decks.sql) ── */
export type CardSource = 'hand' | 'ai' | 'paste' | 'connector'
/** A deck: a titled set of cards for one of your courses, filed under a class, or neither. */
export interface Deck extends Synced { id: string; authorId: string; courseId: string | null; classId: string | null; title: string }
export interface Card extends Synced { id: string; deckId: string; authorId: string; front: string; back: string; source: CardSource }
/** Your schedule for one card (core/srs.ts), its id the card's. */
export interface CardState extends Synced { id: string; due: string; interval: number; ease: number; reps: number; lapses: number }
/** One review, kept as it was. */
export interface CardReview extends Synced { id: string; cardRef: string; deckRef: string; day: string; grade: 'again' | 'good' | 'easy'; at: number }
export type SharedDeck = Deck & { scope: string }
export type SharedCard = Card & { scope: string }

export interface StudySession extends Synced {
    id: string
    courseId: string | null
    itemId: string | null
    startedAt: number
    studyMinutes: number
    roundsDone: number
    note: string
    manual: boolean
    /** The space `courseId`/`itemId` belong to, when they are a class's or a project's (spec §7). */
    spaceId?: string | null
    /** The study room it was studied in (study together); its id is 'r-' + this. */
    roomId?: string | null
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
    /** The space `courseId`/`itemId` belong to, when they are a class's or a project's (spec §7). */
    spaceId?: string | null
}

/** What a step of a study flow is: study time or a break. */
export type StepKind = "study" | "break"

/** A study flow, as normalizeFlow in model.ts returns it: 1–12 steps, at least one Study, 1–12 rounds. */
export interface Flow { steps: [StepKind, number][]; rounds: number }

/** The study prefs, as normalizePrefs in model.ts returns them. `alarms`: whether the calendar
    feed carries reminders. `reviews` is the day spaced reviews were turned on (null = off),
    missing on a profile saved before it was synced. `setupDone`: the first-run setup was
    finished or skipped (absent until then). */
export interface StudyPrefs { goal: number; dayMin: number; rest: number[]; celebrate: boolean; alarms: boolean; reviews?: string | null; setupDone?: boolean }

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
export type SharedItem = Item & { scope: string; updatedBy: string | null; assignees: string[]; completedBy: string | null; deletedAt?: number | null }

/** A class assignment a project belongs to: its space and item ids (spec §10). */
export interface ParentRef { space: string; item: string }
/** A space as the class routes answer it: enough to download and open it. */
export interface SpaceSummary { id: string; scope: string; kind: "class" | "project"; name: string; role: "owner" | "editor" | "member"; members: number }
export interface SpaceMember { userId: string; username: string; name: string; role: "owner" | "editor" | "member"; joinedAt: number }
export interface SpaceInvite {
    userId: string; username: string; name: string; role: "editor" | "member"
    status: "pending" | "declined" | "expired"; createdAt: number; expiresAt: number; invitedBy: string | null
}
/** A space for its Members tab (GET /api/spaces/:sid): invites for owner and editors, the code's status for the owner. */
export interface SpaceDetails {
    id: string; scope: string; kind: "class" | "project"; role: "owner" | "editor" | "member"; archived: boolean
    members: SpaceMember[]; invites: SpaceInvite[]; code: { expires: number; usesLeft: number } | null
    schoolCalendar: unknown | null
}
/** A join code just made: shown now and never again (only its hash is kept). */
export interface JoinCode { code: string; expires: number; usesLeft: number }
/** An invite to you (GET /api/inbox, and /api/invites for older tabs). */
export interface Invite {
    spaceId: string; kind: "class" | "project"; name: string; role: "editor" | "member"; from: string
    createdAt: number; expiresAt: number; expired: boolean
}
/** One row of the inbox or an Activity tab (spec §12): who did what in a space; `about` when it is about you. */
export interface ActivityRow {
    seq: number; spaceId: string; space: string; kind: "class" | "project" | null; verb: string; subject: string
    actor: string; subjectUser: string; about: boolean; old: string | null; new: string | null
    detail: { by?: string; title?: string; titles?: string[]; whom?: string; space?: string; assignees?: string[]; assignment?: string }
    n: number; at: number
}
/** Someone on the app, as the Friends tab names them. */
export interface FriendPerson { userId: string; username: string; name: string }
export interface FriendRequest extends FriendPerson { at: number }
/** A friend studying now: what they picked, since when, and the room when you may join it. */
export interface FriendLive { label: string; since: number; room: { id: string; size: number } | null }
/** A friend. `room`: an open room of theirs you may join; `live` while they study; `lastStudied`
    when their latest session began (null when none, or they hide it). */
export interface Friend extends FriendPerson { since: number; room?: { id: string; size: number }; live?: FriendLive; lastStudied?: number | null }
/** Where you stand with someone: friends, you asked, they asked, or nothing yet. */
export type FriendState = 'none' | 'friends' | 'requested' | 'asked';
export interface FriendMatch extends FriendPerson { state: FriendState }
export interface FriendSettings { findable: boolean; showStudying: boolean }
export interface Friends { friends: Friend[]; incoming: FriendRequest[]; sent: FriendRequest[]; settings: FriendSettings }
/** Study Buddy (worker/buddy.js): which buddy, and the Buddy as GET /api/buddy answers while gameplay is on. */
export interface BuddyLook { buddy: string; bg: string; frame: string; name: string }
export interface BuddyTierRow { id: string; minXp: number; reward: number; reached: boolean; claimed: boolean }
export interface BuddyState {
  enabled: true; xp: number; tier: string; next: { tier: string; xp: number } | null;
  health: number; mood: 'happy' | 'tired' | 'sick' | 'hurt'; streak: number; coins: number;
  look: BuddyLook; tz: string; tiers: BuddyTierRow[]; recent: { source: string; amount: number; at: number }[]; due: number;
  /** the saved custom buddy, if any; the backgrounds and frames you own */
  custom: CustomBuddy | null; owned: string[];
  /** "Review cards in my calendar" (Stage 3) */
  cardsInFeed?: boolean;
}
/** GET /api/buddy/shop: each item with your level and the next level's cost (null at the top). */
export interface ShopItem { sku: string; kind: 'upgrade' | 'bg' | 'frame'; name: string; effect: string; level: number; max: number; cost: number | null }
export interface Shop { coins: number; items: ShopItem[] }
export type BuddyAnswer = BuddyState | { enabled: false };
/** GET /api/inbox: your pending invites, the newest rows, and where you have read up to. */
export interface Inbox { invites: Invite[]; friendRequests?: FriendRequest[]; roomInvites?: RoomInvite[]; items: ActivityRow[]; seen: number }

/* ── study rooms (worker/rooms.js) ── */

/** The room's clock: the solo timer's run record (core/timer.ts), in the server's time. */
export interface RoomRun { flow: Flow; startedAt: number; pausedAt: number | null; pausedMs: number; skippedMs: number; skippedStudyMs: number }
export type RoomEventKind = 'started' | 'joined' | 'left' | 'paused' | 'resumed' | 'skipped' | 'ended' | 'host';
export interface RoomEvent { at: number; kind: RoomEventKind; name: string }
/** Someone who is in the room or was. Their minutes: earlierMs + the room's study now − joinedStudyMs. */
export interface RoomMember {
    userId: string; username: string; name: string; state: 'in' | 'left'
    joinedAt: number; joinedStudyMs: number; earlierMs: number; leftAt: number | null; courseLabel: string; away: boolean
}
/** A room as GET /api/rooms/:id gives it; `now` is the server's clock, `tag` goes back as ?v=. */
export interface RoomView {
    room: { id: string; hostId: string | null; run: RoomRun; endedAt: number | null; feed: RoomEvent[] }
    members: RoomMember[]; tag: string; now: number
}
/** A room's group record: the people who were in it, each with the minutes of their own sessions there. */
export interface GroupRecord { roomId: string; startedAt: number; endedAt: number | null; members: { userId: string; username: string; name: string; minutes: number }[] }
/** An invite to a room that is still open, for the inbox. */
export interface RoomInvite { roomId: string; hostId: string | null; name: string; username: string; run: RoomRun; size: number; at: number }
/** A message in a room's chat: between the people in the room now. `id` only goes up, so a poll can ask for what is newer. */
export interface RoomMessage { id: number; userId: string; name: string; body: string; at: number }

/** Your layer on a shared item (spec §4): yours alone. Its id is '<space id>:<item id>'. */
export interface Mark extends Synced {
    id: string
    spaceId: string
    itemId: string
    status: ItemStatus
    grade: number | null
    /** your weight for it, when it differs from the class's; null uses the class's */
    weight: number | null
    notes: string
    checklist: ChecklistEntry[]
    completedAt: number | null
    /** "not mine": left out of your views, grades and stats */
    hidden: boolean
}

/** Your settings for a space: your colour, grade target, semester and sidebar archive for it. Its id is the space id. */
export interface SpacePref extends Synced { id: string; spaceId: string; color: string; target: number | null; term: string; archived: boolean }

/** The Admin page's answers (worker/admin.js). */
export interface AdminAccount {
  id: string; username: string; displayName: string; admin: boolean; lastSeen: string | null; createdAt: number;
  feed: boolean; leaderboard: boolean; spotify: boolean; courses: number; items: number; studyMinutes: number;
}
export interface AdminLock { key: string; username: string; device: boolean; fails: number; lockedUntil: number }
export interface AdminAccounts { accounts: AdminAccount[]; locks: AdminLock[] }
export interface AuditEntry { at: number; admin: string; action: string; target: string; detail: string }
export type ErrorKind = 'server' | 'request' | 'browser' | 'nightly';
export interface ErrorGroup { kind: ErrorKind; method: string; route: string; status: number; message: string; count: number; last: number; first: number; users: number; anon: number }
export interface ErrorRow { at: number; kind: ErrorKind; method: string; route: string; status: number; message: string; username: string | null }
export interface MaintenanceState { features: Feature[]; message: string; updatedAt: number | null; updatedBy: string }
export interface TrafficHour { hour: string; requests: number; errors: number }
export interface AdminTraffic {
  configured: boolean;
  free: { requests: number; neurons: number; rowsRead: number; rowsWritten: number; storageBytes: number };
  hours?: TrafficHour[] | null;
  today?: { requests: number | null; neurons: number | null; rowsRead: number | null; rowsWritten: number | null; storageBytes: number | null };
  failed?: Record<string, string>;
}
export interface AdminHealth {
  migrations: { latest: string; applied: string | null; ok: boolean };
  cronLastRun: number | null;
  secrets: Record<string, boolean>;
  ai: boolean;
  accounts: number;
  errors24h: number;
}
/** The calendar feed's state, as /api/calendar answers. */
export interface CalendarFeed { on: boolean; url?: string }
