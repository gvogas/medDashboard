// The top bar's title and the line under it, for the view on screen.

import { parse, addDays, monday, iso, DOW, MON } from "@/legacy/js/dates.js"
import { schoolCal } from "@/legacy/js/query.js"
import { weekOf } from "@/legacy/js/school.js"
import { weekLabel } from "@/legacy/js/views/school-bits.js"
import { state as spotify } from "@/legacy/js/spotify.js"
import type { Ui } from "@/data/types"

export interface Heading { title: string; sub: string }

const day = (d: Date) => DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()].slice(0, 3)

export function viewHeading(ui: Pick<Ui, "view" | "anchor">): Heading {
    const a = parse(ui.anchor)
    switch (ui.view) {
        case "week": {
            const st = monday(a), en = addDays(st, 6)
            const school = weekLabel(weekOf(schoolCal(), iso(st)))
            return { title: "Week board", sub: day(st) + " – " + day(en) + " " + en.getFullYear() + (school ? " · " + school : "") }
        }
        case "month":
            return { title: MON[a.getMonth()] + " " + a.getFullYear(), sub: "" }
        case "study":
            return { title: "Study", sub: "" }
        case "spotify":
            return {
                title: "Spotify",
                sub: !spotify.loaded ? "" : !spotify.connected ? "Not connected" : spotify.device ? "Playing on " + spotify.device : "No active device",
            }
        default:
            return { title: "All items", sub: "" }
    }
}
