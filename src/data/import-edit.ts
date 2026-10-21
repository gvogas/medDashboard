// Importing: a calendar, CSV or course outline read into a plan, shown in the import sheet
// with a tick per row, and written only on Import. The parsing and planning stay in
// core/importers/; this is what the sheet does with a plan. From legacy
// views/drawer-import.js.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { classRoom, normalizeCourse, normalizeItem } from "@/core/model"
import { today } from "@/core/dates"
import { defaultTerm } from "@/core/school"
import { schoolCal, termStart } from "@/data/query"
import { parseIcs } from "@/core/importers/ics"
import { parseCsv } from "@/core/importers/csv"
import { planImport } from "@/core/importers/plan"
import type { Outline, Plan } from "@/core/importers/plan"
import { planForClass, planMine } from "./class-import"
import { api } from "@/core/api"
import { readWithAi, type NoteKey } from "./ai-read"
import { readContext } from "./ai-context"
import { notify } from "@/bridge"
import { openSheet } from "./overlay"
import type { Course, Item } from "./types"

/* The plan's shapes are the importer's (core/importers/plan.ts). */
export type { PlanCourse, PlanItem, PlanMeeting } from "@/core/importers/plan"
export type ImportPlan = Plan

export const MAX_BYTES = 2_000_000

/* A new course's semester lives in core/school.ts, so class-import.ts can share it without importing this file. */
export { defaultTerm }

/** Read a calendar or CSV and open the preview. Returns an error message, or "" when it opened. */
export function previewImport(text: string, name = ""): string {
    const isIcs = /BEGIN:VCALENDAR/i.test(text)
    let events
    try { events = isIcs ? parseIcs(text) : parseCsv(text) } catch { return "That file could not be read." }
    if (!events.length) return isIcs ? "No events were found in that calendar." : "No rows were found. The first line must be a header such as type,course,title,date,start,end,room,weight."
    const plan = planImport(events, data, isIcs ? "ics" : "csv") as ImportPlan
    if (!plan.courses.length && !plan.items.length) return "Nothing in that file could be imported." + (plan.notes[0] ? " " + plan.notes[0] : "")
    openSheet({ kind: "import", plan, name })
    return ""
}

/** A calendar or CSV file picked in Import with AI: over 2 MB is refused. Returns an error message, or "" when it opened. */
export async function importFile(file: File): Promise<string> {
    if (file.size > MAX_BYTES) return "That file is over 2 MB; export a single term instead."
    return previewImport(await file.text(), file.name)
}

/** The files an outline picker takes (Import with AI, and New shared class). */
export const OUTLINE_ACCEPT = ".pdf,.docx,.doc,.txt,.md,.html,.odt,application/pdf"

/** A course outline, read by the Worker with AI, then previewed: for your courses, or (`forNewClass`) for a class made from it. */
export function readOutlineFile(file: File, note: NoteKey = "aiNote", { forNewClass = false } = {}) {
    return readWithAi(file, {
        what: "outline", title: "Reading your course outline",
        steps: ["Reading the document", "Finding dates and deadlines", "Matching it to your courses"],
        flag: "outlineBusy", note, refresh: notify,
        errors: {
            outline_empty: "No text was found in that file. A scanned outline needs to be a text PDF.",
            outline_unreadable: "The outline could not be understood. Try again, or import a CSV instead.",
        },
        cache: ["outline", String(data.profile?.id ?? ""), today().slice(0, 7), termStart() || "", JSON.stringify(readContext())],
        call: (body, signal) => api.readOutline(body, { name: file.name, today: today(), termStart: termStart() || "", ...readContext() }, signal),
        done: (outline: Outline) => {
            if (forNewClass) openSheet({ kind: "import", plan: planForClass(outline, null, []), name: file.name, target: { kind: "new-class" } })
            else openSheet({ kind: "import", plan: planMine(outline), name: file.name })
        },
    })
}

/** What Import would write: the ticked classes and items, and the new courses kept. */
export const importCount = (plan: ImportPlan) =>
    plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length + (c.keep && c.isNew ? 1 : 0), 0)
    + plan.items.filter((i) => i.include).length

/** Write the ticked rows in one save, courses first so the items can point at them. Returns a summary line. */
export async function commitImport(plan: ImportPlan): Promise<string> {
    let classes = 0, items = 0, terms = 0
    const rows: { kind: "courses" | "items"; row: Course | Item }[] = []
    const wanted = new Set(plan.items.filter((i) => i.include).map((i) => i.row.courseId).filter(Boolean))
    for (const c of plan.courses) {
        const add = c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
        if (c.isNew) {
            if (!add.length && !(c.keep || wanted.has(c.id))) continue
            rows.push({ kind: "courses", row: normalizeCourse({ id: c.id, code: c.code, name: c.name, color: c.color, instructor: c.instructor || "", term: c.term || "", meetings: add }) as Course })
        } else {
            /* two of the timetable's courses put on one of yours: the second builds on the first */
            const before = rows.find((r) => r.row.id === c.id)?.row as Course | undefined
            const live = before || store.course(c.id) as Course | null
            /* a semester picked in the preview; undefined (a calendar or CSV import) leaves it */
            const term = c.term ?? live?.term ?? ""
            if (!live || (!add.length && term === live.term)) continue
            /* a class schedule can replace the course's weekly classes with the ticked ones (never with none),
               and a class the course already has is not added twice */
            const kept = c.replace && add.length && !before ? [] : live.meetings
            const fresh = add.filter((m) => !kept.some((k) => k.weekday === m.weekday && k.start === m.start && k.end === m.end))
            const row = { ...live, term, meetings: [...kept, ...fresh].slice(0, 12) }
            if (before) Object.assign(before, row)
            else rows.push({ kind: "courses", row })
            if (term !== live.term) terms++
        }
        classes += add.length
    }
    const meets = new Map(rows.map((r) => [r.row.id, r.row as Course]))
    for (const it of plan.items) {
        if (!it.include || !it.row.date) continue
        const row = normalizeItem(it.row)
        if (!row.where) row.where = classRoom(row, meets.get(row.courseId ?? "") || store.course(row.courseId))
        rows.push({ kind: "items", row })
        items++
    }
    if (rows.length) await store.saveRows(rows)
    /* An outline that says when teaching starts sets the term start, if none is set yet. */
    const start = plan.week1 || plan.termStart
    const profile = data.profile
    if (start && profile && !profile.termStart && !schoolCal()) await store.saveProfile({ termStart: start })
    /* only semesters picked: say that, not "Imported 0 classes" */
    if (!classes && !items && terms) return terms === 1 ? "Updated the semester." : "Updated " + terms + " semesters."
    return "Imported " + classes + " class" + (classes === 1 ? "" : "es") + " and " + items + " item" + (items === 1 ? "" : "s") + "."
}
