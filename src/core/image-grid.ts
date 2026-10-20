// A timetable screenshot's grid, read from its pixels. A vision model reading the picture
// guesses which weekday a class is under and how many rows it spans, and it guesses badly:
// starts snap to a row's second label, ends are made up, blocks move a day over. Here the
// grid's lines give all of that exactly, as timetable-grid.ts does for a PDF: the vertical
// lines give the columns (a narrow time column, then the weekdays), the time column's
// lines give the rows, and in each weekday column a run of rows with no line between them
// and some ink in it is one class. The model is then asked only for each block's words.
//
// Pure: it reads an RGBA array (ImageData's shape), so it is tested without a canvas.

/** The pixels as ImageData holds them: 4 bytes a pixel, row by row. */
export interface Pixels { data: Uint8ClampedArray | Uint8Array; width: number; height: number }

/** One class's box: its weekday column (0 = the first), its first row and its last (0 = the grid's first), and where it is in px. */
export interface Block { col: number; from: number; to: number; x1: number; y1: number; x2: number; y2: number }

/** The grid found: how many weekday columns and rows, where the rows are, and the class blocks. */
export interface ImageGrid { cols: number; rows: number; rowTops: number[]; blocks: Block[] }

/* how much darker than both sides a pixel must be to be part of a line */
const STEP = 3, DARKER = 7
/* a pixel this dark is ink: text, not a cell's background or a border */
const INK = 150

/* A screenshot cropped to the table has its outer lines on the picture's edge, where a line
   cannot be told from its sides: the last weekday and the last row were lost. A white margin
   all round puts them inside; the grid found is given back in the picture's own px. */
const MARGIN = 8

export function readImageGrid(px: Pixels): ImageGrid | null {
    const g = readGrid(withMargin(px, MARGIN))
    if (!g) return null
    const m = MARGIN
    return {
        ...g,
        rowTops: g.rowTops.map((y) => y - m),
        blocks: g.blocks.map((b) => ({ ...b, x1: b.x1 - m, y1: b.y1 - m, x2: b.x2 - m, y2: b.y2 - m })),
    }
}

/** The pixels with `m` px of white all round. */
function withMargin({ data, width, height }: Pixels, m: number): Pixels {
    const w = width + 2 * m, h = height + 2 * m
    const out = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 0; y < height; y++) out.set(data.subarray(y * width * 4, (y + 1) * width * 4), ((y + m) * w + m) * 4)
    return { data: out, width: w, height: h }
}

function readGrid(px: Pixels): ImageGrid | null {
    const { width: w, height: h } = px
    if (w < 200 || h < 200) return null
    const lum = luminance(px)
    const at = (x: number, y: number) => lum[y * w + x]
    const vLine = (x: number, y: number) => x >= STEP && x < w - STEP && at(x, y) <= Math.min(at(x - STEP, y), at(x + STEP, y)) - DARKER
    const hLine = (x: number, y: number) => y >= STEP && y < h - STEP && at(x, y) <= Math.min(at(x, y - STEP), at(x, y + STEP)) - DARKER

    /* the vertical lines: x's dark against both sides over a good part of the height */
    const vx: number[] = []
    for (let x = STEP; x < w - STEP; x++) {
        let n = 0
        for (let y = 0; y < h; y++) if (vLine(x, y)) n++
        if (n >= h * 0.3) vx.push(x)
    }
    const vLines = cluster(vx)
    if (vLines.length < 4) return null

    /* the grid's height: where most of those lines are drawn */
    const inGrid = (y: number) => vLines.filter((x) => vLine(x, y) || vLine(x - 1, y) || vLine(x + 1, y)).length >= vLines.length * 0.6
    let top = 0, bottom = h - 1
    while (top < h && !inGrid(top)) top++
    while (bottom > top && !inGrid(bottom)) bottom--
    if (bottom - top < 150) return null

    /* the columns: the weekdays are the widest, all about as wide; the time column is the narrower one just left of them */
    const spans = vLines.slice(1).map((x, i) => ({ x1: vLines[i], x2: x, w: x - vLines[i] }))
    const widest = Math.max(...spans.map((s) => s.w))
    const days = longestRun(spans, (s) => s.w >= widest * 0.8)
    if (days.length < 3) return null
    const first = spans.indexOf(days[0])
    const time = first > 0 && spans[first - 1].w >= widest * 0.2 ? spans[first - 1] : null
    if (!time) return null

    /* A line across most of a column at y (or a pixel off), with no break wider than `gapMax`:
       a line of text has gaps between its letters and words. */
    const lineAcross = (c: { x1: number; x2: number }, y: number, share: number, gapMax: number) => {
        const x1 = c.x1 + 4, x2 = c.x2 - 4
        let n = 0, gap = 0, widest = 0
        for (let x = x1; x < x2; x++) {
            if (hLine(x, y) || hLine(x, y - 1) || hLine(x, y + 1)) { n++; gap = 0 } else widest = Math.max(widest, ++gap)
        }
        return n >= (x2 - x1) * share && widest <= gapMax
    }
    /* A row boundary in a weekday column: a line, or the fill changing from one side to the
       other (an empty grey cell against a class's white one, its line faint once made smaller). */
    /* a cell's line runs to the column's sides; centred text never does */
    const edges = (c: { x1: number; x2: number }, y: number) => {
        const near = (from: number, to: number) => {
            for (let x = from; x <= to; x++) for (let d = -1; d <= 1; d++) if (hLine(x, y + d)) return true
            return false
        }
        return near(c.x1 + 2, c.x1 + 8) && near(c.x2 - 8, c.x2 - 2)
    }
    const boundary = (c: { x1: number; x2: number }, y: number) => {
        if (edges(c, y) && lineAcross(c, y, 0.75, Math.max(6, (c.x2 - c.x1) * 0.06))) return true
        const x1 = c.x1 + 4, x2 = c.x2 - 4, d = 4
        if (y < d || y >= h - d) return false
        /* a row's background: its commonest shade, which text does not move */
        const fill = (yy: number) => {
            const bins = new Uint16Array(64)
            for (let x = x1; x < x2; x++) bins[at(x, yy) >> 2]++
            return bins.indexOf(Math.max(...bins)) << 2
        }
        return Math.abs(fill(y - d) - fill(y + d)) >= 8
    }

    /* the rows: the time column's lines; the header is the first space, the rows the run of spaces all alike */
    const hy: number[] = []
    for (let y = top; y <= bottom; y++) if (lineAcross(time, y, 0.6, Infinity)) hy.push(y)
    const hLines = cluster(hy)
    if (hLines.length < 4) return null
    const gaps = hLines.slice(1).map((y, i) => ({ y1: hLines[i], y2: y, h: y - hLines[i] }))
    const usual = median(gaps.map((g) => g.h))
    /* a row has its time written in the time column: the header's corner, as tall as a row at times, has none */
    const labelled = (g: { y1: number; y2: number }) => inked(lum, w, time.x1 + 3, g.y1 + 3, time.x2 - 3, g.y2 - 3)
    const rowGaps = longestRun(gaps, (g) => Math.abs(g.h - usual) <= usual * 0.25 && labelled(g))
    /* rows this short are too small to read: the model reads the picture as it is instead */
    if (rowGaps.length < 3 || usual < 14) return null
    const rowTops = [...rowGaps.map((g) => g.y1), rowGaps[rowGaps.length - 1].y2]

    /* in each weekday column, runs of rows with no line between them; a run with ink is a class */
    const blocks: Block[] = []
    days.forEach((c, col) => {
        let from = 0
        for (let r = 1; r <= rowGaps.length; r++) {
            if (r < rowGaps.length && !boundary(c, rowTops[r])) continue
            const y1 = rowTops[from], y2 = rowTops[r]
            if (inked(lum, w, c.x1 + 4, y1 + 3, c.x2 - 4, y2 - 3)) blocks.push({ col, from, to: r - 1, x1: c.x1, y1, x2: c.x2, y2 })
            from = r
        }
    })
    if (!blocks.length) return null
    return { cols: days.length, rows: rowGaps.length, rowTops, blocks }
}

/** Luminance 0–255 a pixel, from RGBA. */
function luminance({ data, width, height }: Pixels): Uint8Array {
    const out = new Uint8Array(width * height)
    for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
    return out
}

/* Some ink in a box: text, not only a border's edge or JPEG noise. */
function inked(lum: Uint8Array, w: number, x1: number, y1: number, x2: number, y2: number): boolean {
    let n = 0
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (lum[y * w + x] < INK) n++
    return n >= Math.max(12, (x2 - x1) * (y2 - y1) * 0.002)
}

/* positions next to each other (a line 2 px thick, blurred) as one: their middle */
function cluster(xs: number[]): number[] {
    const out: number[] = []
    let run: number[] = []
    for (const x of xs) {
        if (run.length && x - run[run.length - 1] > 2) { out.push(Math.round((run[0] + run[run.length - 1]) / 2)); run = [] }
        run.push(x)
    }
    if (run.length) out.push(Math.round((run[0] + run[run.length - 1]) / 2))
    return out
}

/* the longest run of neighbours that all pass */
function longestRun<T>(list: T[], ok: (t: T) => boolean): T[] {
    let best: T[] = [], run: T[] = []
    for (const t of list) {
        run = ok(t) ? [...run, t] : []
        if (run.length > best.length) best = run
    }
    return best
}

const median = (ns: number[]) => [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)]
