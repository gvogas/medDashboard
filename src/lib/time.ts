// Times as the app keeps them, HH:MM: reading what people type, and nudging by a quarter
// hour. Used by the React time field (components/sheet/time-field.tsx) and the CSV importer;
// and lengths of study, for the Study page and the timer.

export const STEP = 15

const pad = (n: number) => String(n).padStart(2, "0")

/** Every quarter hour of the day, for the picker's list. */
export const SLOTS: string[] = Array.from({ length: (24 * 60) / STEP }, (_, i) => pad(Math.floor((i * STEP) / 60)) + ":" + pad((i * STEP) % 60))

/** "8", "830", "8:30", "8pm" → "08:30" etc. '' for blank, null for nonsense. */
export function parseTime(raw: unknown): string | null {
    const s = String(raw ?? "").trim().toLowerCase()
    if (!s) return ""
    const m = s.match(/^(\d{1,2})(?:[:.h]\s*(\d{1,2})|(\d{2}))?\s*([ap])?\.?m?\.?$/)
    if (!m) return null
    let h = +m[1]
    const min = m[2] != null ? +m[2] : m[3] != null ? +m[3] : 0
    if (m[4] === "p" && h < 12) h += 12
    if (m[4] === "a" && h === 12) h = 0
    if (h > 23 || min > 59) return null
    return pad(h) + ":" + pad(min)
}

/** Nudge by a quarter hour, snapping to the grid, clamped to the day. */
export function stepTime(value: string, dir: number): string {
    const v = parseTime(value)
    if (!v) return "09:00"
    const [h, m] = v.split(":").map(Number)
    let total = h * 60 + m
    total = dir > 0 ? Math.floor(total / STEP) * STEP + STEP : Math.ceil(total / STEP) * STEP - STEP
    total = Math.max(0, Math.min(23 * 60 + 45, total))
    return pad(Math.floor(total / 60)) + ":" + pad(total % 60)
}

/** The quarter hour at or before a time, for highlighting in the list. */
export function nearestSlot(value: string): string {
    const v = parseTime(value) || "09:00"
    const [h, m] = v.split(":").map(Number)
    return pad(h) + ":" + pad(Math.floor(m / STEP) * STEP)
}

/** A length of study: "2h 05m", "45m". */
export function duration(minutes: number): string {
    const h = Math.floor(minutes / 60), m = minutes % 60
    return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m"
}
