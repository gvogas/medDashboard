// The item card's date: the chosen day in words, Today, and a Week / Month switch. Week is
// the chosen day's week as seven buttons with ‹ › (the day a week back or on); Month is a
// calendar with ‹ October 2026 ›, and picking a day there goes back to Week. Today is
// ringed; a day that already has something due has a dot.

import { addDays, diffDays, iso, monday, parse, shortDate, today } from "@/core/dates"

/** The seven days, Monday first, of the week holding `date`. */
export const weekOf = (date: string): string[] => {
    const m = monday(parse(date))
    return Array.from({ length: 7 }, (_, i) => iso(addDays(m, i)))
}

/** A month (0–11) as whole weeks, Monday first: days of the months around it fill the first and last rows. */
export function monthDays(year: number, month: number): string[] {
    const first = iso(monday(new Date(year, month, 1)))
    const n = diffDays(first, iso(new Date(year, month + 1, 0))) + 1
    return Array.from({ length: Math.ceil(n / 7) * 7 }, (_, i) => iso(addDays(parse(first), i)))
}

/** "Wed 23 Sep · today", "Thu 24 Sep · tomorrow", "Fri 2 Oct". */
export function pickedLabel(date: string, now = today()): string {
    const d = diffDays(now, date)
    return shortDate(date) + (d === 0 ? " · today" : d === 1 ? " · tomorrow" : "")
}
