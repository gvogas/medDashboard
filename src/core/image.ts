// A screenshot made small enough to send: at most 1600 px on its long side, as a JPEG on
// white. A timetable stays readable at that size, and the vision model's cost grows with the
// picture (worker/schedule.js). Nothing here touches the network or the page.

export const MAX_EDGE = 1600

/** The size to draw at: the same, or scaled down so that the long side is `max`. */
export function fitSize(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
    const k = Math.min(1, max / Math.max(w, h))
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

const fileError = () => Object.assign(new Error("That picture could not be opened. Use a PNG or JPG screenshot."), { name: "FileError" })

/** The picture as a JPEG of at most MAX_EDGE px. A FileError when the browser cannot open it (HEIC, a damaged file). */
export async function shrinkImage(file: Blob): Promise<Blob> {
    let bmp: ImageBitmap
    /* a phone photo's EXIF rotation applied, so the timetable is the right way up */
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }) } catch { throw fileError() }
    const canvas = document.createElement("canvas")
    try {
        const { w, h } = fitSize(bmp.width, bmp.height)
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (!ctx) throw fileError()
        /* a PNG's transparent parts would turn black in a JPEG */
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, w, h)
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(bmp, 0, 0, w, h)
        const out = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85))
        if (!out) throw fileError()
        return out
    } finally {
        bmp.close()
        /* lets the browser free the canvas's memory at once (Safari keeps it otherwise) */
        canvas.width = canvas.height = 0
    }
}
