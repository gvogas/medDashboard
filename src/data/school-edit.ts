// The school calendar: read from a PDF with AI, checked and fixed in the school sheet
// (semesters and special days), saved on the profile. core/school.ts says what each
// day is. From legacy views/drawer-school.js.

import * as store from "@/core/store"
import { today } from "@/core/dates"
import { normalizeSchool, validDate } from "@/core/school"
import { schoolCal } from "@/data/query"
import { api } from "@/core/api"
import { readWithAi } from "./ai-read"
import { toast } from "./toast"
import { notify } from "@/bridge"
import { ui } from "./ui"
import { closeSheet, openSheet } from "./overlay"

export type DayKind = "off" | "break" | "exams" | "swap" | "note"
export interface Term { name: string; start: string; end: string }
export interface SpecialDay { from: string; to: string; kind: DayKind; label: string; follows?: number }
export interface SchoolDraft { source: string | null; truncated: boolean; name: string; terms: Term[]; days: SpecialDay[] }

export const termOk = (t: Term) => !!t.name.trim() && validDate(t.start) && validDate(t.end) && t.start <= t.end
export const dayOk = (d: SpecialDay) => validDate(d.from) && validDate(d.to) && d.to >= d.from
export const valid = (s: SchoolDraft) => s.terms.length > 0 && s.terms.every(termOk) && s.days.every(dayOk)

const plural = (n: number, one: string) => n + " " + one + (n === 1 ? "" : "s")
export const footHint = (s: SchoolDraft) => (valid(s) ? plural(s.terms.length, "semester") + ", " + plural(s.days.length, "day") : "Fix the dates marked in red")

/** The draft as it is saved: trimmed, and sorted by date. */
export function toSave(s: SchoolDraft) {
    return {
        name: s.name.trim(),
        terms: s.terms.map((t) => ({ name: t.name.trim(), start: t.start, end: t.end })).sort((a, b) => a.start.localeCompare(b.start)),
        days: s.days.map((d) => ({ from: d.from, to: d.to, kind: d.kind, label: d.label.trim(), ...(d.kind === "swap" ? { follows: d.follows ?? 1 } : {}) }))
            .sort((a, b) => a.from.localeCompare(b.from)),
    }
}

/** A day's first date changed: its last date comes along when it was the same, empty or earlier. */
export function moveFrom(d: SpecialDay, from: string): SpecialDay {
    const next = { ...d, from }
    if (validDate(from) && (!d.to || d.to === d.from || d.to < from)) next.to = from
    return next
}

/** The special days in date order, each with its index in the draft, under the semester they fall in or follow. */
export function groupDays(s: SchoolDraft): { term: Term | null; days: [SpecialDay, number][] }[] {
    const order = s.days.map((d, i) => [d, i] as [SpecialDay, number]).sort((a, b) => (a[0].from || "").localeCompare(b[0].from || ""))
    const terms = s.terms.filter(termOk).sort((a, b) => a.start.localeCompare(b.start))
    const out: { term: Term | null; days: [SpecialDay, number][] }[] = []
    for (const pair of order) {
        const t = [...terms].reverse().find((x) => x.start <= pair[0].from) || terms[0] || null
        if (!out.length || out[out.length - 1].term !== t) out.push({ term: t, days: [] })
        out[out.length - 1].days.push(pair)
    }
    return out
}

/** Open the sheet on a calendar just read (with its file name), or on the saved one. */
export function openSchool(read: unknown, source: string | null = null) {
    const cal = normalizeSchool(read) || schoolCal()
    if (!cal) return
    const r = read as { truncated?: boolean } | null
    openSheet({ kind: "school", draft: {
        source, truncated: !!r?.truncated, name: cal.name,
        terms: cal.terms.map((t: Term) => ({ ...t })), days: cal.days.map((d: SpecialDay) => ({ ...d })),
    } })
}

/** A calendar file was picked: read it with AI, then check it in the sheet. */
export function readSchoolFile(file: File) {
    return readWithAi(file, {
        what: "calendar", title: "Reading your school calendar", stage: "Finding the semesters, breaks and days off with AI…",
        flag: "schoolBusy", note: "schoolNote", refresh: notify,
        errors: {
            outline_empty: "No text was found in that file. A scanned calendar needs to be a text PDF.",
            school_unreadable: "No semesters could be found in that calendar. Try again, or check it is the academic calendar.",
        },
        call: (body: Blob) => api.readSchool(body, { name: file.name, today: today() }),
        done: (read: unknown) => openSchool(read, file.name),
    })
}

export async function saveSchool(s: SchoolDraft) {
    if (!valid(s)) return
    await store.saveProfile({ schoolCalendar: toSave(s) })
    closeSheet()
    notify()
    toast("School calendar saved")
}

/** Remove it: classes show every week again, and the term start goes back to the one set. */
export async function removeSchool() {
    await store.saveProfile({ schoolCalendar: {} })
    ui.schoolNote = { text: "School calendar removed.", error: false }
    notify()
}
