import { describe, it, expect } from "vitest"
import { readImageGrid, type Pixels } from "./image-grid"
import { gridParam } from "./image"

/* A timetable drawn into RGBA by hand, as a screenshot or a print of one looks: a time column
   and weekday columns, rows with a line under each, grey (or white) empty cells, and white
   class blocks with no line inside them and some "text" (dark specks) in their middle. */
function draw({ cols = 5, rows = 20, rowH = 40, colW = 160, timeW = 70, head = 30, empty = 238, blocks = [] as [number, number, number][], scribble = null as null | [number, number], margin = 20 } = {}): Pixels {
    /* margin 0: cropped to the table, its outer lines on the picture's last column and row of px */
    const width = margin + timeW + cols * colW + Math.max(margin, 1), height = margin + head + rows * rowH + Math.max(margin, 1)
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    const put = (x: number, y: number, v: number) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = v }
    const rect = (x1: number, y1: number, x2: number, y2: number, v: number) => { for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) put(x, y, v) }
    const left = margin, top = margin, gx = (c: number) => left + timeW + c * colW, gy = (r: number) => top + head + r * rowH
    /* every cell empty, then the blocks over them */
    rect(gx(0), gy(0), gx(cols), gy(rows), empty)
    for (const [c, from, to] of blocks) rect(gx(c), gy(from), gx(c + 1), gy(to + 1), 255)
    /* lines: the frame, the columns, the header's, and each row's except inside a block */
    const line = 205
    for (let c = 0; c <= cols; c++) rect(gx(c), top, gx(c) + 1, gy(rows), line)
    rect(left, top, left + 1, gy(rows), line)
    rect(left, top, gx(cols), top + 1, line)
    for (let r = 0; r <= rows; r++) {
        rect(left, gy(r), gx(0), gy(r) + 1, line)
        for (let c = 0; c < cols; c++) {
            const inside = blocks.some(([bc, from, to]) => bc === c && r > from && r <= to)
            if (!inside) rect(gx(c), gy(r), gx(c + 1), gy(r) + 1, line)
        }
    }
    /* time labels down the side, and words in each block, made of short dark strokes with gaps */
    const words = (x1: number, y: number, len: number) => { for (let x = x1; x < x1 + len; x += 7) rect(x, y, x + 4, y + 9, 40) }
    for (let r = 0; r < rows; r++) words(left + 15, gy(r) + 8, 35)
    for (const [c, from, to] of blocks) {
        const mid = Math.round((gy(from) + gy(to + 1)) / 2)
        for (let k = -1; k <= 1; k++) words(gx(c) + 30, mid + k * 14, colW - 60)
    }
    if (scribble) { const [c, r] = scribble; for (let i = 0; i < 30; i++) rect(gx(c) + 20 + i * 3, gy(r) + 10 + (i % 5) * 3, gx(c) + 23 + i * 3, gy(r) + 13 + (i % 5) * 3, 10) }
    return { data, width, height }
}

const BLOCKS: [number, number, number][] = [[0, 1, 3], [0, 4, 7], [1, 4, 7], [2, 1, 4], [2, 5, 8], [4, 12, 15]]
const found = (g: ReturnType<typeof readImageGrid>) => g!.blocks.map((b) => [b.col, b.from, b.to])

describe("readImageGrid", () => {
    it("finds each class block's column and rows in a screenshot's grid (grey empty cells)", () => {
        const g = readImageGrid(draw({ blocks: BLOCKS }))
        expect(g).toMatchObject({ cols: 5, rows: 20 })
        expect(found(g)).toEqual(BLOCKS)
    })

    it("finds the last weekday and the last row of a picture cropped to the table, and gives px in the picture", () => {
        const g = readImageGrid(draw({ blocks: BLOCKS, margin: 0 }))!
        expect(g).toMatchObject({ cols: 5, rows: 20 })
        expect(found(g)).toEqual(BLOCKS)
        expect(g.rowTops[0]).toBe(30)
        expect(g.blocks[0]).toMatchObject({ x1: 70, y1: 70 })
    })

    it("and in a print's (white empty cells, a line round each)", () => {
        expect(found(readImageGrid(draw({ blocks: BLOCKS, empty: 255 })))).toEqual(BLOCKS)
    })

    it("keeps two blocks one above the other apart, and a block's lines of text do not split it", () => {
        const g = readImageGrid(draw({ blocks: [[2, 1, 4], [2, 5, 8]], rowH: 30 }))
        expect(found(g)).toEqual([[2, 1, 4], [2, 5, 8]])
    })

    it("gives the rows' tops, the header left out", () => {
        const g = readImageGrid(draw({ blocks: BLOCKS }))!
        expect(g.rowTops).toHaveLength(21)
        expect(g.rowTops[1] - g.rowTops[0]).toBeGreaterThanOrEqual(39)
        expect(g.rowTops[1] - g.rowTops[0]).toBeLessThanOrEqual(41)
    })

    it("takes a scribble in an empty cell for a one-row block (the model is asked whether it is a class)", () => {
        const g = readImageGrid(draw({ blocks: BLOCKS, empty: 255, scribble: [3, 17] }))
        expect(found(g)).toContainEqual([3, 17, 17])
    })

    it("finds no grid in a picture without one, or with rows too small to read", () => {
        expect(readImageGrid({ data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 })).toBeNull()
        expect(readImageGrid(draw({ blocks: BLOCKS, rowH: 10 }))).toBeNull()
    })

    it("says the grid for the Worker: columns.rows, then each block's column:first-last", () => {
        expect(gridParam(readImageGrid(draw({ blocks: BLOCKS }))!)).toBe("5.20|0:1-3,0:4-7,1:4-7,2:1-4,2:5-8,4:12-15")
    })
})
