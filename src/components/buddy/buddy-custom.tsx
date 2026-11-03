// Make your own buddy from a picture (spec §9, Custom buddy): upload, drop or paste one; the
// picture and its pixel version side by side; Detail, Colours and Remove the background. It is all
// worked out here by core/pixelate.ts, and Save sends only the grid and its palette: the picture
// never leaves the device.

import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/views/bits"
import { Button, Checkbox, Note } from "@/components/sheet/fields"
import { customGrid } from "@/core/buddy-art"
import { CUSTOM_MIN, type CustomBuddy } from "@/core/buddy-rules"
import { MAX_PICTURE_BYTES, PICTURE_ERRORS, PICTURE_TYPES, downscale, padTo, pixelGrid, toCustom, type PixelGrid } from "@/core/pixelate"
import { removeCustom, saveCustom } from "@/data/buddy"

const SMALL = "text-[12.5px] text-muted-foreground"
const BOX = 72
type Picture = HTMLImageElement

function paintPicture(canvas: HTMLCanvasElement | null, pic: Picture | null) {
    const ctx = canvas?.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, BOX, BOX)
    if (!pic) return
    const w = pic.naturalWidth || pic.width, h = pic.naturalHeight || pic.height, k = BOX / Math.max(w, h)
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(pic, (BOX - w * k) / 2, (BOX - h * k) / 2, w * k, h * k)
}
function paintPixels(canvas: HTMLCanvasElement | null, grid: PixelGrid | null) {
    const ctx = canvas?.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, BOX, BOX)
    if (!grid) return
    const n = grid.length, k = Math.floor(BOX / n), o = Math.floor((BOX - k * n) / 2)
    grid.forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = c; ctx.fillRect(o + x * k, o + y * k, k, k) } }))
}

export function BuddyCustom({ saved, onDone }: { saved: CustomBuddy | null; onDone?: () => void }) {
    const [pic, setPic] = useState<Picture | null>(null)
    const [size, setSize] = useState(24)
    const [colors, setColors] = useState(10)
    const [removeBg, setRemoveBg] = useState(true)
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)
    const [over, setOver] = useState(false)
    const picRef = useRef<HTMLCanvasElement>(null), pxRef = useRef<HTMLCanvasElement>(null)

    /* the pixel version, worked out again whenever the picture or an option changes */
    const { grid, unreadable } = useMemo(() => {
        if (!pic) return { grid: null, unreadable: false }
        try { return { grid: pixelGrid(downscale(pic, size), { colors, removeBg }), unreadable: false } } catch { return { grid: null, unreadable: true } }
    }, [pic, size, colors, removeBg])
    const shown = pic ? grid : saved ? customGrid(saved) : null
    useEffect(() => { paintPicture(picRef.current, pic) }, [pic])
    useEffect(() => { paintPixels(pxRef.current, shown) })

    const load = (file: File | undefined | null) => {
        if (!file || !PICTURE_TYPES.test(file.type)) { setError(PICTURE_ERRORS.type); return }
        if (file.size > MAX_PICTURE_BYTES) { setError(PICTURE_ERRORS.size); return }
        /* a data: URL, not a blob: one: the CSP's img-src allows data: and not blob: */
        const reader = new FileReader()
        reader.onload = () => {
            const img = new Image()
            img.onload = () => { setError(""); setPic(img) }
            img.onerror = () => setError(PICTURE_ERRORS.open)
            img.src = String(reader.result)
        }
        reader.onerror = () => setError(PICTURE_ERRORS.open)
        reader.readAsDataURL(file)
    }
    /* a picture pasted anywhere on the page while this is open */
    useEffect(() => {
        const paste = (e: ClipboardEvent) => {
            const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"))
            if (f) { e.preventDefault(); load(f) }
        }
        document.addEventListener("paste", paste)
        return () => document.removeEventListener("paste", paste)
    }, [])

    const save = async () => {
        if (!grid) return
        setBusy(true)
        const message = await saveCustom(toCustom(padTo(grid, CUSTOM_MIN)))
        setBusy(false)
        setError(message)
        if (!message) { setPic(null); onDone?.() }
    }
    const remove = async () => {
        setBusy(true)
        setError(await removeCustom())
        setBusy(false)
    }
    const note = error || (unreadable ? PICTURE_ERRORS.open : pic && !grid ? PICTURE_ERRORS.empty : "")
    return (
        <Panel title="Make your own" label="Make your own buddy">
            <div className="flex flex-col gap-3 p-4">
                <label htmlFor="buddy-file"
                    onDragEnter={(e) => { e.preventDefault(); setOver(true) }} onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                    onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]) }}
                    className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-3 text-center", over ? "border-[var(--study)] bg-[var(--study-soft)]" : "border-border bg-muted")}>
                    <span className="flex gap-3">
                        <figure className="m-0 flex flex-col items-center gap-1">
                            <canvas ref={picRef} width={BOX} height={BOX} role="img" aria-label="The picture" className="rounded-md bg-card" />
                            <figcaption className={SMALL}>Picture</figcaption>
                        </figure>
                        <figure className="m-0 flex flex-col items-center gap-1">
                            <canvas ref={pxRef} width={BOX} height={BOX} role="img" aria-label="Its pixel version" className="rounded-md bg-card [image-rendering:pixelated]" />
                            <figcaption className={SMALL}>Pixels</figcaption>
                        </figure>
                    </span>
                    <span className={SMALL}><b className="text-foreground">Upload a picture</b>, drop one here, or paste one. PNG, JPG, GIF or WebP, up to 10 MB. A pet, a doodle or a mascot with a clear shape works best.</span>
                    <input id="buddy-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only"
                        onChange={(e) => { load(e.target.files?.[0]); e.target.value = "" }} />
                </label>
                {pic && (
                    <div className="grid gap-2">
                        <label htmlFor="buddy-detail" className="flex justify-between text-[12.5px] text-ink-2">Detail <output htmlFor="buddy-detail" className="font-mono">{size} px</output></label>
                        <input id="buddy-detail" type="range" min={12} max={24} step={2} value={size} onChange={(e) => setSize(+e.target.value)} />
                        <label htmlFor="buddy-colours" className="flex justify-between text-[12.5px] text-ink-2">Colours <output htmlFor="buddy-colours" className="font-mono">{colors}</output></label>
                        <input id="buddy-colours" type="range" min={3} max={16} value={colors} onChange={(e) => setColors(+e.target.value)} />
                        <Checkbox id="buddy-bg" checked={removeBg} onChange={setRemoveBg}>Remove the background</Checkbox>
                    </div>
                )}
                {note ? <Note tone="bad">{note}</Note> : <p className={cn(SMALL, "m-0")}>Only the pixels are saved to your account, never the picture. Only you see your buddy.</p>}
                <div className="flex flex-wrap gap-2">
                    {pic && <Button variant="study" disabled={busy || !grid} onClick={() => void save()}>{busy ? "Saving…" : "Save as my buddy"}</Button>}
                    {pic && <Button variant="ghost" disabled={busy} onClick={() => { setPic(null); setError("") }}>Cancel</Button>}
                    {!pic && saved && <Button variant="danger" disabled={busy} onClick={() => void remove()}>Delete my custom buddy</Button>}
                </div>
            </div>
        </Panel>
    )
}
