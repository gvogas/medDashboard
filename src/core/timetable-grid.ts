// A timetable PDF's grid, read from where things sit on the page. Its text alone (pdftext.ts)
// says nothing of which weekday a class is under or how many rows it spans, so a model reading
// it guesses both. Here the weekdays across the top give the columns, the time labels down the
// left give the rows, and each class's cell (a box PDF.js draws) gives its start and end:
// "Mon 08:30-10:00 | Le Contrat Racial | 345-HSZ-VF sec.00007 | Classroom N-362".

import { DOW } from "./dates"
import { clockTime, parseTime } from "@/lib/time"

/** A piece of text in PDF points, y up: its left, its baseline, its width and height. */
export interface PdfItem { str: string; x: number; y: number; w: number; h: number }
/** A drawn box in PDF points, y up: a cell's background, a border, the page's frame. */
export interface PdfBox { x1: number; y1: number; x2: number; y2: number }
/** The classes, one line each in weekday and time order, and the items they and the grid's labels took. */
export interface Grid { lines: string[]; used: Set<number> }

/* By DOW's index (Sunday first); English and French, written out or short */
const DAY_WORDS = [
    /^(sunday|sun|dimanche|dim)\.?$/i, /^(monday|mon|lundi|lun)\.?$/i, /^(tuesday|tues?|mardi|mar)\.?$/i,
    /^(wednesday|wed|mercredi|mer)\.?$/i, /^(thursday|thu|thurs?|jeudi|jeu)\.?$/i, /^(friday|fri|vendredi|ven)\.?$/i,
    /^(saturday|sat|samedi|sam)\.?$/i,
]
const dayOf = (s: string) => DAY_WORDS.findIndex((re) => re.test(s.trim()))
/* Monday first, as a timetable is */
const weekOrder = (day: number) => (day + 6) % 7

/** A time label as minutes after midnight, -1 for anything else. It needs a separator or am/pm,
    so a bare number (a page number, a room) is not taken for an hour. */
function minutesOf(s: string): number {
    if (!/[:h.]|[ap]\.?m/i.test(s)) return -1
    const t = parseTime(s)
    return t ? +t.slice(0, 2) * 60 + +t.slice(3) : -1
}

const midX = (i: PdfItem) => i.x + i.w / 2
const midY = (i: PdfItem) => i.y + i.h / 2
const area = (b: PdfBox) => (b.x2 - b.x1) * (b.y2 - b.y1)

/**
 * The page's classes by the grid they are in, or null when it has no weekday row and time
 * column. The boxes are asked for only once both are found: reading a page's drawing is the
 * costly part, and most pages are not a timetable.
 */
export async function readGrid(items: PdfItem[], loadBoxes: () => PdfBox[] | Promise<PdfBox[]>): Promise<Grid | null> {
    /* the weekday row: three weekdays or more at one height */
    const days = items.map((it, i) => ({ i, day: dayOf(it.str), x: midX(it), y: it.y })).filter((d) => d.day >= 0)
    const row = days
        .map((d) => days.filter((e) => Math.abs(e.y - d.y) < 2))
        .find((r) => new Set(r.map((e) => e.day)).size >= 3)
    if (!row) return null
    const heads = [...new Map(row.map((d) => [d.day, d])).values()].sort((a, b) => a.x - b.x)
    const headY = heads[0].y
    const spacing = (heads[heads.length - 1].x - heads[0].x) / (heads.length - 1)
    const left = heads[0].x - spacing / 2, right = heads[heads.length - 1].x + spacing / 2

    /* the time column, left of the first weekday and below the row: each time's labels' mean height */
    const labels = items
        .map((it, i) => ({ i, min: minutesOf(it.str), y: midY(it) }))
        .filter((l) => l.min >= 0 && midX(items[l.i]) < left && l.y < headY)
    const heights = new Map<number, number[]>()
    for (const l of labels) heights.set(l.min, [...(heights.get(l.min) ?? []), l.y])
    const times = [...heights.entries()].map(([min, ys]) => ({ min, y: ys.reduce((s, y) => s + y, 0) / ys.length })).sort((a, b) => a.min - b.min)
    if (times.length < 2) return null

    /* minutes from height, by least squares; a border is on a row's edge, so it snaps to the rows' step */
    const n = times.length
    const my = times.reduce((s, t) => s + t.y, 0) / n, mm = times.reduce((s, t) => s + t.min, 0) / n
    const slope = times.reduce((s, t) => s + (t.y - my) * (t.min - mm), 0) / times.reduce((s, t) => s + (t.y - my) ** 2, 0)
    if (!(slope < 0)) return null
    const step = Math.min(...times.slice(1).map((t, k) => t.min - times[k].min))
    const first = times[0].min, last = times[n - 1].min
    const at = (y: number) => first + Math.round((mm + slope * (y - my) - first) / step) * step
    const bottom = my + (last - mm) / slope - Math.abs(step / slope)

    /* each class: the smallest column-wide box around a piece of text in the grid */
    const cols = (await loadBoxes()).filter((b) => b.x2 - b.x1 >= spacing / 2 && b.x2 - b.x1 <= spacing * 1.5)
    const cellOf = (it: PdfItem) => {
        const x = midX(it), y = midY(it)
        let best: PdfBox | null = null
        for (const b of cols) {
            if (b.y2 - b.y1 < it.h || x < b.x1 - 1 || x > b.x2 + 1 || y < b.y1 - 1 || y > b.y2 + 1) continue
            if (!best || area(b) < area(best)) best = b
        }
        return best
    }
    const used = new Set([...heads.map((d) => d.i), ...labels.map((l) => l.i)])
    const cells = new Map<PdfBox, number[]>()
    items.forEach((it, i) => {
        if (used.has(i) || !it.str.trim()) return
        const x = midX(it), y = midY(it)
        if (x < left || x > right || y > headY || y < bottom) return
        const box = cellOf(it)
        if (box) cells.set(box, [...(cells.get(box) ?? []), i])
    })

    const classes = [...cells].flatMap(([box, mine]) => {
        const start = at(box.y2), end = at(box.y1)
        if (end <= start) return []
        const cx = (box.x1 + box.x2) / 2
        const day = heads.reduce((a, b) => (Math.abs(b.x - cx) < Math.abs(a.x - cx) ? b : a)).day
        /* its lines top to bottom, the pieces of each left to right: "Classroom D-243" "L" is one line */
        const lines: PdfItem[][] = []
        for (const it of mine.map((i) => items[i]).sort((a, b) => midY(b) - midY(a))) {
            const line = lines[lines.length - 1]
            if (line && Math.abs(midY(line[0]) - midY(it)) < it.h / 2) line.push(it)
            else lines.push([it])
        }
        const text = lines.map((l) => l.sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(" ")).join(" | ")
        mine.forEach((i) => used.add(i))
        return [{ day, start, line: DOW[day] + " " + clockTime(start) + "-" + clockTime(end) + " | " + text }]
    })
    if (!classes.length) return null
    classes.sort((a, b) => weekOrder(a.day) - weekOrder(b.day) || a.start - b.start)
    return { lines: classes.map((c) => c.line), used }
}
