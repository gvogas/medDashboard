// A screenshot made small enough to send: at most 1600 px on its long side, as a JPEG on
// white. A timetable stays readable at that size, and the vision model's cost grows with the
// picture (worker/schedule.js). Nothing here touches the network or the page.

import { readImageGrid, type ImageGrid } from "./image-grid"

export const MAX_EDGE = 1600

/** The size to draw at: the same, or scaled down so that the long side is `max`. */
export function fitSize(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
    const k = Math.min(1, max / Math.max(w, h))
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

const fileError = () => Object.assign(new Error("That picture could not be opened. Use a PNG or JPG screenshot."), { name: "FileError" })

/** The picture as a JPEG of at most MAX_EDGE px. A FileError when the browser cannot open it (HEIC, a damaged file). */
export async function shrinkImage(file: Blob): Promise<Blob> {
    return withCanvas(file, (canvas) => jpeg(canvas))
}

/**
 * A timetable screenshot made smaller, with its grid read from the pixels (image-grid.ts): when
 * a grid is found, each class's block gets a red number in its corner, and `grid` says where
 * each numbered block is for the Worker (worker/schedule.js parseGrid): "5.20|0:1-3,0:4-7".
 * No grid: the picture as shrinkImage makes it, and `grid` is "".
 */
export async function shrinkTimetable(file: Blob): Promise<{ blob: Blob; grid: string }> {
    return withCanvas(file, async (canvas, ctx) => {
        let grid: ImageGrid | null = null
        try { grid = readImageGrid(ctx.getImageData(0, 0, canvas.width, canvas.height)) } catch { /* no grid: read as it is */ }
        if (grid) markBlocks(ctx, grid)
        return { blob: await jpeg(canvas), grid: grid ? gridParam(grid) : "" }
    })
}

/** The grid as the Worker reads it: columns.rows, then each block's column:first-last row, in number order. */
export const gridParam = (g: ImageGrid) => g.cols + "." + g.rows + "|" + g.blocks.map((b) => b.col + ":" + b.from + "-" + b.to).join(",")

/* a red number in each block's top-left corner, big enough to read, small enough to leave the words clear */
function markBlocks(ctx: CanvasRenderingContext2D, g: ImageGrid) {
    const rowH = (g.rowTops[g.rowTops.length - 1] - g.rowTops[0]) / g.rows
    const size = Math.round(Math.max(13, Math.min(26, rowH * 0.55)))
    ctx.font = "bold " + size + "px sans-serif"
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    g.blocks.forEach((b, i) => {
        const label = String(i + 1)
        const w = Math.max(size * 1.3, ctx.measureText(label).width + size * 0.6), h = size * 1.3
        const x = b.x1 + 4, y = b.y1 + 4
        ctx.fillStyle = "#d00000"
        ctx.fillRect(x, y, w, h)
        ctx.fillStyle = "#fff"
        ctx.fillText(label, x + w / 2, y + h / 2 + 1)
    })
}

/* The picture drawn on a canvas at most MAX_EDGE px on its long side, on white, for `use`. */
async function withCanvas<T>(file: Blob, use: (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<T>): Promise<T> {
    let bmp: ImageBitmap
    /* a phone photo's EXIF rotation applied, so the timetable is the right way up */
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }) } catch { throw fileError() }
    const canvas = document.createElement("canvas")
    try {
        const { w, h } = fitSize(bmp.width, bmp.height)
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) throw fileError()
        /* a PNG's transparent parts would turn black in a JPEG */
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, w, h)
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(bmp, 0, 0, w, h)
        return await use(canvas, ctx)
    } finally {
        bmp.close()
        /* lets the browser free the canvas's memory at once (Safari keeps it otherwise) */
        canvas.width = canvas.height = 0
    }
}

async function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
    const out = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85))
    if (!out) throw fileError()
    return out
}
