import { afterEach, describe, expect, it, vi } from "vitest"
import { fitSize, shrinkImage, MAX_EDGE } from "./image"

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("a screenshot made smaller", () => {
    it("keeps a small picture's size and scales a big one to 1600 px on its long side", () => {
        expect(MAX_EDGE).toBe(1600)
        expect(fitSize(1200, 800)).toEqual({ w: 1200, h: 800 })
        expect(fitSize(3200, 2000)).toEqual({ w: 1600, h: 1000 })
        expect(fitSize(1000, 4000)).toEqual({ w: 400, h: 1600 })
    })

    it("draws it on white as a JPEG", async () => {
        const close = vi.fn()
        const open = vi.fn(async () => ({ width: 3200, height: 2000, close }))
        vi.stubGlobal("createImageBitmap", open)
        const ctx = { fillStyle: "", imageSmoothingQuality: "low", fillRect: vi.fn(), drawImage: vi.fn() }
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never)
        let canvas: HTMLCanvasElement | null = null
        const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb, type) {
            canvas = this
            cb(new Blob(["j"], { type: type as string }))
        })
        const out = await shrinkImage(new File(["png"], "t.png", { type: "image/png" }))
        expect(out.type).toBe("image/jpeg")
        expect(toBlob.mock.calls[0][1]).toBe("image/jpeg")
        expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1000)
        expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1000)
        expect(close).toHaveBeenCalled()
        expect(open).toHaveBeenCalledWith(expect.anything(), { imageOrientation: "from-image" })
        expect(ctx.imageSmoothingQuality).toBe("high")
        /* the canvas let go once the JPEG is made */
        expect(canvas!.width).toBe(0)
        expect(canvas!.height).toBe(0)
    })

    it("says so when the browser cannot open it", async () => {
        vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new DOMException("bad", "InvalidStateError") }))
        await expect(shrinkImage(new File(["x"], "t.heic", { type: "image/heic" })))
            .rejects.toMatchObject({ name: "FileError", message: "That picture could not be opened. Use a PNG or JPG screenshot." })
    })
})
