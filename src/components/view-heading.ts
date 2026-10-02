// The top bar's title and the date line over it, for the view on screen.

import { parse, addDays, monday, iso, today, MON } from "@/core/dates"
import { schoolCal } from "@/data/query"
import { weekOf, type WeekInfo } from "@/core/school"
import { state as spotify } from "@/data/spotify/player"
import type { Ui } from "@/data/types"

export interface Heading { title: string; sub: string }

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** "28 Sep" */
const short = (d: Date) => d.getDate() + " " + MON[d.getMonth()].slice(0, 3)

/** "Fall 2026, week 4 of 14", "Fall 2026, study break", "Fall 2026, exams", or '' outside school. */
export function schoolLine(w: WeekInfo | null | undefined): string {
    if (!w) return ""
    if (w.kind === "break") return w.term.name + ", study break"
    if (w.kind === "exams") return w.term.name + ", exams"
    return w.week ? w.term.name + ", week " + w.week + " of " + w.of : w.term.name
}

export function viewHeading(ui: Pick<Ui, "view" | "anchor">): Heading {
    const a = parse(ui.anchor)
    switch (ui.view) {
        case "week": {
            /* the title is the week; the line over it the day you are on (with its year when
               that isn't this year), and the school week */
            const st = monday(a), en = addDays(st, 6)
            const school = schoolLine(weekOf(schoolCal(), iso(st)))
            const year = a.getFullYear() === parse(today()).getFullYear() ? "" : " " + a.getFullYear()
            const day = WEEKDAY[a.getDay()] + " " + a.getDate() + " " + MON[a.getMonth()] + year
            return { title: short(st) + " – " + short(en), sub: day + (school ? " · " + school : "") }
        }
        case "month":
            return { title: MON[a.getMonth()] + " " + a.getFullYear(), sub: "" }
        case "study":
            return { title: "Study", sub: "" }
        case "admin":
            return { title: "Admin", sub: "" }
        case "spotify":
            return {
                title: "Music",
                sub: !spotify.loaded ? "" : !spotify.connected ? "Not connected" : spotify.device ? "Playing on " + spotify.device : "No active device",
            }
        default:
            return { title: "All items", sub: "" }
    }
}
