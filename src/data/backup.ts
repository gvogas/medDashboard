// What Settings downloads: everything of yours on this device as one JSON file, and your
// items as a CSV a spreadsheet opens. Both are built here from plain arrays, so they can be
// tested on their own; actions.ts gathers the store and saves the file.

import { statusLabel, tmeta } from "@/core/model"
import type { Achievement, Course, Item, Mark, Profile, Quote, SharedCourse, SharedItem, Space, SpacePref, StudySession } from "./types"
import type { Card, CardReview, CardState, Deck } from "@/core/types"
import type { EffectiveCourse, EffectiveItem } from "./effective"

/** What a backup reads of the store. */
export interface BackupSource {
    profile: Profile | null
    courses: Course[]
    items: Item[]
    quotes: Quote[]
    study_sessions: StudySession[]
    achievements: Achievement[]
    marks: Mark[]
    space_prefs: SpacePref[]
    shared_courses: SharedCourse[]
    shared_items: SharedItem[]
    removed_items: SharedItem[]
    spaces: Space[]
    /* flashcards (Study Buddy, Stage 3) */
    decks?: Deck[]
    cards?: Card[]
    card_state?: CardState[]
    card_reviews?: CardReview[]
}

/** A class or a project as the backup holds it: the space, its rows, and your layer on it. */
export interface SpaceBackup {
    id: string
    name: string
    role: Space["role"]
    archived: boolean
    members: Space["members"]
    courses: SharedCourse[]
    items: SharedItem[]
    removedItems: SharedItem[]
    marks: Mark[]
    prefs: SpacePref | null
}

/** The bump when the shape below changes; 1 was the store dumped as it was. */
export const BACKUP_FORMAT = 2

/**
 * The backup file: your own rows under `personal`, each class and project with its rows
 * and your layer under `classes` and `projects`, then the edits not synced yet and the
 * saved copies, so nothing on this device is lost.
 */
export function backupFile(d: BackupSource, pending: unknown[], conflicts: unknown[], exportedAt: Date) {
    const space = (s: Space): SpaceBackup => ({
        id: s.id, name: s.name, role: s.role, archived: s.archived, members: s.members,
        courses: d.shared_courses.filter((c) => c.scope === s.scope),
        items: d.shared_items.filter((it) => it.scope === s.scope),
        removedItems: d.removed_items.filter((it) => it.scope === s.scope),
        marks: d.marks.filter((m) => m.spaceId === s.id),
        prefs: d.space_prefs.find((p) => p.spaceId === s.id) ?? null,
    })
    return {
        app: "Term",
        format: BACKUP_FORMAT,
        exportedAt: exportedAt.toISOString(),
        account: d.profile ? { id: d.profile.id, username: d.profile.username, displayName: d.profile.displayName } : null,
        settings: d.profile,
        personal: {
            courses: d.courses, items: d.items, quotes: d.quotes, studySessions: d.study_sessions, achievements: d.achievements,
            decks: d.decks ?? [], cards: d.cards ?? [], cardState: d.card_state ?? [], cardReviews: d.card_reviews ?? [],
        },
        classes: d.spaces.filter((s) => s.kind === "class").map(space),
        projects: d.spaces.filter((s) => s.kind === "project").map(space),
        pending,
        conflicts,
    }
}

const CSV_HEAD = ["Course", "Source", "Type", "Title", "Date", "Start", "End", "Status", "Grade", "Weight"]

/* A cell in quotes when it holds a comma, a quote or a line break; one a spreadsheet would
   run as a formula (=, +, -, @ first) gets a ' in front, so a title never runs as one. */
function cell(v: string | number | null | undefined): string {
    let s = v === null || v === undefined ? "" : String(v)
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/**
 * Your items as CSV, a row each, sorted by date: the course's code, where it comes from
 * (Personal, or the class's or project's name), the type, title, date and times, the
 * status, and the grade and weight as you see them (your mark on a class's item).
 * Starts with a byte-order mark and ends lines with CRLF, so Excel reads accents right.
 */
export function itemsCsv(items: EffectiveItem[], courses: EffectiveCourse[], spaces: Pick<Space, "id" | "name">[]): string {
    const code = new Map(courses.map((c) => [c.key ?? c.id, c.code]))
    const named = new Map(spaces.map((s) => [s.id, s.name]))
    const rows = [...items]
        .sort((a, b) => a.date.localeCompare(b.date) || (a.start || "").localeCompare(b.start || "") || a.title.localeCompare(b.title))
        .map((it) => {
            const courseKey = it.courseKey !== undefined ? it.courseKey : it.courseId
            const from = it.spaceId ? named.get(it.spaceId) ?? (it.source === "project" ? "Project" : "Class") : "Personal"
            return [courseKey ? code.get(courseKey) ?? "" : "", from, tmeta(it.type).label, it.title, it.date, it.start, it.end, statusLabel(it), it.grade, it.weight].map(cell).join(",")
        })
    return "﻿" + [CSV_HEAD.join(","), ...rows].join("\r\n") + "\r\n"
}

/** A file name with today's date in it: term-backup-2026-10-20.json. */
export const fileName = (base: string, day: string, ext: string): string => `${base}-${day}.${ext}`
