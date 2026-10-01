// Importing: a calendar, CSV or course outline read into a plan, shown in the import sheet
// with a tick per row, and written only on Import. The parsing and planning stay in
// core/importers/; this is what the sheet does with a plan. From legacy
// views/drawer-import.js.

import * as store from "@/core/store"
import { data } from "@/core/store"
import { classRoom, normalizeCourse, normalizeItem } from "@/core/model"
import { today } from "@/core/dates"
import { courseTerm, currentTerm, type SchoolCalendar } from "@/core/school"
import { schoolCal, termStart } from "@/data/query"
import { parseIcs } from "@/core/importers/ics"
import { parseCsv } from "@/core/importers/csv"
import { planImport, planOutline } from "@/core/importers/plan"
import type { Outline, Plan } from "@/core/importers/plan"
import { api } from "@/core/api"
import { readWithAi, type NoteKey } from "./ai-read"
import { notify } from "@/bridge"
import { ui } from "./ui"
import { openSheet } from "./overlay"
import type { Course, Item } from "./types"

/* The plan's shapes are the importer's (core/importers/plan.ts). */
export type { PlanCourse, PlanItem, PlanMeeting } from "@/core/importers/plan"
export type ImportPlan = Plan

export const MAX_BYTES = 2_000_000

/** A new course's semester: with a school calendar, the one its file names, else the current
    one; without one, the file's own words, as before. */
export function defaultTerm(cal: SchoolCalendar | null, named: string, day: string): string {
    if (!cal) return named
    return (courseTerm(cal, named) ?? currentTerm(cal, day))?.name ?? ""
}

/** A problem to show under Import in Settings. */
function note(text: string, error = true) {
    ui.importNote = { text, error }
    notify()
}

/** Read a calendar or CSV and open the preview. Returns an error message, or "" when it opened. */
export function previewImport(text: string, name = "", back?: "ai"): string {
    const isIcs = /BEGIN:VCALENDAR/i.test(text)
    let events
    try { events = isIcs ? parseIcs(text) : parseCsv(text) } catch { return "That file could not be read." }
    if (!events.length) return isIcs ? "No events were found in that calendar." : "No rows were found. The first line must be a header such as type,course,title,date,start,end,room,weight."
    const plan = planImport(events, data, isIcs ? "ics" : "csv") as ImportPlan
    if (!plan.courses.length && !plan.items.length) return "Nothing in that file could be imported." + (plan.notes[0] ? " " + plan.notes[0] : "")
    openSheet({ kind: "import", plan, name, ...(back ? { back } : {}) })
    return ""
}

/** A file picked under Import: over 2 MB is refused; a problem shows as the import note. */
export async function importFile(file: File) {
    if (file.size > MAX_BYTES) { note("That file is over 2 MB; export a single term instead."); return }
    const error = previewImport(await file.text(), file.name)
    if (error) note(error)
}

/** Text pasted under Import. */
export function importPasted(text: string) {
    if (!text.trim()) return
    const error = previewImport(text)
    if (error) note(error)
}

/** A course outline, read by the Worker with AI, then previewed. */
export function readOutlineFile(file: File, note: NoteKey = "importNote", back?: "ai") {
    return readWithAi(file, {
        what: "outline", title: "Reading your course outline",
        steps: ["Reading the document", "Finding dates and deadlines", "Matching it to your courses"],
        flag: "outlineBusy", note, refresh: notify,
        errors: {
            outline_empty: "No text was found in that file. A scanned outline needs to be a text PDF.",
            outline_unreadable: "The outline could not be understood. Try again, or import a CSV instead.",
        },
        call: (body, signal) => api.readOutline(body, { name: file.name, today: today(), termStart: termStart() || "" }, signal),
        done: (outline: Outline) => {
            const plan = planOutline(outline, data, termStart() || "") as ImportPlan
            for (const c of plan.courses) if (c.isNew) c.term = defaultTerm(schoolCal(), c.term || "", today())
            openSheet({ kind: "import", plan, name: file.name, ...(back ? { back } : {}) })
        },
    })
}

/** What Import would write: the ticked classes and items, and the new courses kept. */
export const importCount = (plan: ImportPlan) =>
    plan.courses.reduce((n, c) => n + c.meetings.filter((m) => m.include).length + (c.keep && c.isNew ? 1 : 0), 0)
    + plan.items.filter((i) => i.include).length

/** Write the ticked rows in one save, courses first so the items can point at them. Returns a summary line. */
export async function commitImport(plan: ImportPlan): Promise<string> {
    let classes = 0, items = 0
    const rows: { kind: "courses" | "items"; row: Course | Item }[] = []
    const wanted = new Set(plan.items.filter((i) => i.include).map((i) => i.row.courseId).filter(Boolean))
    for (const c of plan.courses) {
        const add = c.meetings.filter((m) => m.include).map(({ include: _, ...m }) => m)
        if (c.isNew) {
            if (!add.length && !(c.keep || wanted.has(c.id))) continue
            rows.push({ kind: "courses", row: normalizeCourse({ id: c.id, code: c.code, name: c.name, color: c.color, instructor: c.instructor || "", term: c.term || "", meetings: add }) as Course })
        } else {
            const live = store.course(c.id) as Course | null
            /* a semester picked in the preview; undefined (a calendar or CSV import) leaves it */
            const term = c.term ?? live?.term ?? ""
            if (!live || (!add.length && term === live.term)) continue
            rows.push({ kind: "courses", row: { ...live, term, meetings: [...live.meetings, ...add].slice(0, 12) } })
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
    return "Imported " + classes + " class" + (classes === 1 ? "" : "es") + " and " + items + " item" + (items === 1 ? "" : "s") + "."
}
