// The school calendar the app goes by, and the type filter. The lists the views show are
// worked out in views.ts, from the store and the UI state passed in.

import { data } from "@/core/store"
import { normalizeSchool, currentTerm, type SchoolCalendar } from "@/core/school"
import { today } from "@/core/dates"
import { ui } from "./ui"

/* The school calendar, read once per saved version of the profile. */
let school: { raw: unknown; cal: SchoolCalendar | null } = { raw: undefined, cal: null }
/** The school's academic calendar, or null when none is loaded. */
export function schoolCal(): SchoolCalendar | null {
    const raw = data.profile?.schoolCalendar
    if (raw !== school.raw) school = { raw, cal: normalizeSchool(raw) }
    return school.cal
}

/** The term start the app goes by: the school calendar's semester, else the one set. */
export const termStart = (): string | null => {
    const cal = schoolCal()
    return cal ? currentTerm(cal, today())!.start : data.profile?.termStart || null
}

/** A type filter is on unless it was switched off; new types start on. */
export const typeOn = (t: string) => ui.types[t] !== false
