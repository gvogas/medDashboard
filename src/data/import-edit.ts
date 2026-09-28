// Importing: a calendar, CSV or course outline read into a plan, shown in the import sheet
// with a tick per row, and written only on Import. The parsing and planning stay in
// legacy/js/importers/; this is what the sheet does with a plan. From legacy
// views/drawer-import.js.

import * as store from "@/legacy/js/store.js"
import { data } from "@/legacy/js/store.js"
import { classRoom, normalizeCourse, normalizeItem } from "@/legacy/js/model.js"
import { today } from "@/legacy/js/dates.js"
import { schoolCal, termStart } from "@/legacy/js/query.js"
import { parseIcs } from "@/legacy/js/importers/ics.js"
import { parseCsv } from "@/legacy/js/importers/csv.js"
import { planImport, planOutline } from "@/legacy/js/importers/plan.js"
import { api } from "@/legacy/js/api.js"
import { readWithAi } from "@/legacy/js/views/busy.js"
import { notify } from "@/bridge"
import { ui } from "./ui"
import { openSheet } from "./overlay"
import type { Course, Item, Meeting, Profile } from "./types"

export interface PlanMeeting extends Meeting { include: boolean }
export interface PlanCourse {
    id: string; code: string; name: string; color: string; instructor?: string; term?: string
    isNew: boolean; keep: boolean; meetings: PlanMeeting[]
}
export interface PlanItem { row: Item; include: boolean; duplicate?: boolean; week?: number }
export interface ImportPlan { courses: PlanCourse[]; items: PlanItem[]; notes: string[]; week1?: string | null; termStart?: string | null }

export const MAX_BYTES = 2_000_000

/** A problem to show under Import in Settings. */
function note(text: string, error = true) {
    ui.importNote = { text, error }
    notify()
}

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
export function readOutlineFile(file: File) {
    return readWithAi(file, {
        what: "outline", title: undefined, stage: "Reading the dates and grades with AI…", flag: "outlineBusy", note: "importNote", refresh: notify,
        errors: {
            outline_empty: "No text was found in that file. A scanned outline needs to be a text PDF.",
            outline_unreadable: "The outline could not be understood. Try again, or import a CSV instead.",
        },
        call: (body: Blob) => api.readOutline(body, { name: file.name, today: today(), termStart: termStart() || "" }),
        done: (outline: unknown) => openSheet({ kind: "import", plan: planOutline(outline, data, termStart() || "") as ImportPlan, name: file.name }),
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
        if (!add.length && !(c.isNew && (c.keep || wanted.has(c.id)))) continue
        if (c.isNew) {
            rows.push({ kind: "courses", row: normalizeCourse({ id: c.id, code: c.code, name: c.name, color: c.color, instructor: c.instructor || "", term: c.term || "", meetings: add }) as Course })
        } else {
            const live = store.course(c.id) as Course | null
            if (!live) continue
            rows.push({ kind: "courses", row: { ...live, meetings: [...live.meetings, ...add].slice(0, 12) } })
        }
        classes += add.length
    }
    const meets = new Map(rows.map((r) => [r.row.id, r.row as Course]))
    for (const it of plan.items) {
        if (!it.include || !it.row.date) continue
        const row = normalizeItem(it.row) as Item
        if (!row.where) row.where = classRoom(row, meets.get(row.courseId ?? "") || store.course(row.courseId))
        rows.push({ kind: "items", row })
        items++
    }
    if (rows.length) await store.saveRows(rows)
    /* An outline that says when teaching starts sets the term start, if none is set yet. */
    const start = plan.week1 || plan.termStart
    const profile = data.profile as Profile | null
    if (start && profile && !profile.termStart && !schoolCal()) await store.saveProfile({ termStart: start })
    return "Imported " + classes + " class" + (classes === 1 ? "" : "es") + " and " + items + " item" + (items === 1 ? "" : "s") + "."
}
