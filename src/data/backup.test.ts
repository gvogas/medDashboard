// The backup file and the items CSV, built from plain arrays.

import { describe, expect, it } from "vitest"
import { normalizeCourse, normalizeItem } from "@/core/model"
import { backupFile, fileName, itemsCsv, BACKUP_FORMAT, type BackupSource } from "./backup"
import type { EffectiveCourse, EffectiveItem } from "./effective"
import type { Space } from "./types"

const space = (id: string, kind: Space["kind"], name: string): Space => ({ id, scope: (kind === "class" ? "c:" : "p:") + id, kind, role: "member", archived: false, name, parent: null, revision: 1, members: [] })
const shared = <T extends object>(row: T, scope: string) => ({ ...row, scope, updatedBy: null, assignees: [], completedBy: null })

const source = (): BackupSource => ({
    profile: { id: "u1", username: "sam", displayName: "Sam" } as never,
    courses: [normalizeCourse({ id: "c1", code: "PHYS" })],
    items: [normalizeItem({ id: "i1", type: "exam", title: "Midterm", courseId: "c1", date: "2026-10-05" })],
    quotes: [], study_sessions: [], achievements: [],
    marks: [{ id: "m1", spaceId: "s1", itemId: "x1" } as never],
    space_prefs: [{ id: "s1", spaceId: "s1", color: "#000", target: null, term: "", archived: false }],
    shared_courses: [shared(normalizeCourse({ id: "k1", code: "ANAT" }), "c:s1") as never],
    shared_items: [shared(normalizeItem({ id: "x1", type: "quiz", title: "Bones", courseId: "k1", date: "2026-10-02" }), "c:s1") as never,
        shared(normalizeItem({ id: "t1", type: "task", title: "Slides", date: "2026-10-03" }), "p:s2") as never],
    removed_items: [],
    spaces: [space("s1", "class", "Anatomy"), space("s2", "project", "Poster")],
})

describe("the backup file", () => {
    it("keeps your own rows apart from each class's and project's, with your layer on them", () => {
        const f = backupFile(source(), [{ key: "items:i1" }], [], new Date("2026-10-20T12:00:00Z"))
        expect(f).toMatchObject({ app: "Term", format: BACKUP_FORMAT, exportedAt: "2026-10-20T12:00:00.000Z", account: { id: "u1", username: "sam" } })
        expect(f.personal.items.map((it) => it.id)).toEqual(["i1"])
        expect(f.classes).toHaveLength(1)
        expect(f.classes[0]).toMatchObject({ id: "s1", name: "Anatomy", prefs: { spaceId: "s1" } })
        expect(f.classes[0].items.map((it) => it.id)).toEqual(["x1"])
        expect(f.classes[0].courses.map((c) => c.code)).toEqual(["ANAT"])
        expect(f.classes[0].marks).toHaveLength(1)
        expect(f.projects[0].items.map((it) => it.id)).toEqual(["t1"])
        expect(f.projects[0].prefs).toBe(null)
        expect(f.pending).toEqual([{ key: "items:i1" }])
    })

    it("is named for the day", () => {
        expect(fileName("term-backup", "2026-10-20", "json")).toBe("term-backup-2026-10-20.json")
    })
})

describe("the items CSV", () => {
    const courses = [{ ...normalizeCourse({ id: "c1", code: "PHYS" }) }, { ...normalizeCourse({ id: "k1", code: "ANAT" }), key: "c:s1/k1" }] as EffectiveCourse[]
    const spaces = [{ id: "s1", name: "Anatomy" }]

    it("has a header, a row per item by date, the course's code and where the item comes from", () => {
        const items = [
            normalizeItem({ id: "i1", type: "exam", title: "Midterm", courseId: "c1", date: "2026-10-05", start: "09:00", end: "11:00", status: "graded", grade: 84, weight: 30 }),
            { ...normalizeItem({ id: "x1", type: "quiz", title: "Bones", courseId: "k1", date: "2026-10-02" }), courseKey: "c:s1/k1", spaceId: "s1", source: "class" },
        ] as EffectiveItem[]
        const lines = itemsCsv(items, courses, spaces).replace(/^﻿/, "").split("\r\n")
        expect(lines[0]).toBe("Course,Source,Type,Title,Date,Start,End,Status,Grade,Weight")
        expect(lines[1]).toMatch(/^ANAT,Anatomy,Quiz,Bones,2026-10-02,,,/)
        expect(lines[2]).toMatch(/^PHYS,Personal,Exam,Midterm,2026-10-05,09:00,11:00,Graded,84,30$/)
        expect(lines[3]).toBe("")
    })

    it("quotes commas, quotes and line breaks, and keeps a title from running as a formula", () => {
        const items = [
            normalizeItem({ id: "a", type: "task", title: 'Read "ch 3", then notes', date: "2026-10-01" }),
            normalizeItem({ id: "b", type: "task", title: "=HYPERLINK(1)", date: "2026-10-02" }),
        ] as EffectiveItem[]
        const csv = itemsCsv(items, courses, spaces)
        expect(csv.startsWith("﻿")).toBe(true)
        expect(csv).toContain(',"Read ""ch 3"", then notes",')
        expect(csv).toContain(",'=HYPERLINK(1),")
    })
})
