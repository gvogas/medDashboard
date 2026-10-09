import { describe, it, expect, vi } from "vitest"
import { readGrid, type PdfBox, type PdfItem } from "./timetable-grid"

/* A student portal's timetable as PDF.js gives it (Omnivox's print, in PDF points, y up):
   the weekdays across the top, two labels per half-hour row down the left (its start at
   the top, its end at the bottom), and each class a cell spanning its rows, its text
   centred in it. */
const ROW = 23.3
const TOP = 694                                     /* the 08:00 border */
const border = (min: number) => TOP - ((min - 480) / 30) * ROW
const hhmm = (min: number) => String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0")
const COLS = [[125.2, 207], [207, 288], [288, 369.7]] as const

const item = (str: string, x: number, y: number, w = str.length * 3.3): PdfItem => ({ str, x, y, w, h: 5.5 })

function layout() {
    const items: PdfItem[] = [
        item("Vanier College", 272.8, 754.5),
        item("Monday", 153.4, 699, 25.5), item("Tuesday", 234.2, 699, 26.9), item("Wednesday", 310.3, 699, 37.4),
    ]
    const boxes: PdfBox[] = [{ x1: 28.5, y1: 28.1, x2: 583.9, y2: 763.5 }]   /* the page's frame */
    for (let t = 480; t < 660; t += 30) {
        items.push(item(hhmm(t), 95.4, border(t) - 4.7, 15), item(hhmm(t + 30), 95.4, border(t + 30) + 4.4, 15))
        boxes.push({ x1: 69, y1: border(t + 30), x2: 125.2, y2: border(t) })
    }
    /* a class: its cell, and its lines centred in it */
    const cell = (col: number, from: number, to: number, lines: string[][]) => {
        const [x1, x2] = COLS[col]
        boxes.push({ x1, y1: border(to), x2, y2: border(from) })
        const mid = (border(from) + border(to)) / 2
        lines.forEach((parts, i) => {
            let x = x1 + 10
            parts.forEach((s) => { items.push(item(s, x, mid + 13 - i * 6.75)); x += s.length * 3.3 + 6 })
        })
    }
    cell(0, 510, 600, [["Le Contrat Racial"], ["345-HSZ-VF sec.00007"], ["Classroom N-362"], ["Leila Bdeir"]])
    cell(1, 600, 660, [["Game Programming 2"], ["420-541-VA sec.00002"], ["Classroom D-243", "L"], ["Antoine McNabb-Baltar"]])
    cell(2, 480, 540, [["Web Services"], ["420-511-VA sec.00002"], ["Classroom D-242"]])
    /* the empty half-hours are cells too */
    boxes.push({ x1: COLS[0][0], y1: border(510), x2: COLS[0][1], y2: border(480) })
    boxes.push({ x1: COLS[2][0], y1: border(570), x2: COLS[2][1], y2: border(540) })
    items.push(item("Courses List", 79.5, 182.3))
    return { items, boxes }
}

describe("readGrid", () => {
    it("gives each class its weekday from its column and its times from its cell's borders", async () => {
        const { items, boxes } = layout()
        expect((await readGrid(items, () => boxes))?.lines).toEqual([
            "Mon 08:30-10:00 | Le Contrat Racial | 345-HSZ-VF sec.00007 | Classroom N-362 | Leila Bdeir",
            "Tue 10:00-11:00 | Game Programming 2 | 420-541-VA sec.00002 | Classroom D-243 L | Antoine McNabb-Baltar",
            "Wed 08:00-09:00 | Web Services | 420-511-VA sec.00002 | Classroom D-242",
        ])
    })

    it("marks the weekdays, the time labels and the classes as used, and leaves the rest", async () => {
        const { items, boxes } = layout()
        const used = (await readGrid(items, () => boxes))!.used
        expect(items.filter((_, i) => !used.has(i)).map((i) => i.str)).toEqual(["Vanier College", "Courses List"])
    })

    it("reads French weekdays and times written 8h30", async () => {
        const { items, boxes } = layout()
        const fr = items.map((i) => ({ ...i, str: { Monday: "Lundi", Tuesday: "Mardi", Wednesday: "Mercredi" }[i.str] ?? i.str.replace(/^(\d\d):(\d\d)$/, "$1h$2") }))
        expect((await readGrid(fr, () => boxes))?.lines[0]).toBe("Mon 08:30-10:00 | Le Contrat Racial | 345-HSZ-VF sec.00007 | Classroom N-362 | Leila Bdeir")
    })

    it("is null for a page that is not a timetable grid, without reading its drawing", async () => {
        const { items, boxes } = layout()
        const load = vi.fn(() => boxes)
        expect(await readGrid(items.filter((i) => !/day$/.test(i.str)), load)).toBeNull()
        expect(await readGrid(items.filter((i) => !/^\d\d:\d\d$/.test(i.str)), load)).toBeNull()
        expect(await readGrid([item("Week 3: Monday quiz", 80, 500)], load)).toBeNull()
        expect(load).not.toHaveBeenCalled()
    })
})
