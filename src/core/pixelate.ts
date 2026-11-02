// A picture turned into a custom buddy, all in the browser (spec §9, Custom buddy; ported from
// design/study-buddies-prototype.html): shrink it in halving steps, flood the commonest edge
// colour away, cut it to a few colours with k-means, crop it to the shape and stand it on the
// bottom row. Only the result is kept: a square grid of at most 24 × 24 and its palette. The
// picture itself never leaves the device.

import { CUSTOM_COLORS, type CustomBuddy } from './buddy-rules.ts'

export type Pixels = { width: number; height: number; data: Uint8ClampedArray | number[] }
export type PixelGrid = (string | null)[][]
export interface PixelOptions { colors: number; removeBg: boolean }

type RGB = [number, number, number]
const d2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const BG_NEAR = 62 ** 2      /* how close to the edge colour a pixel must be to count as background */

/**
 * Small pixels (already shrunk to the size wanted) as a cropped square grid of colours, null
 * where empty; null when nothing is left (a blank picture, or all of it was background).
 */
export function pixelGrid({ width: w, height: h, data }: Pixels, { colors, removeBg }: PixelOptions): PixelGrid | null {
  const px: (RGB | null)[] = []
  for (let i = 0; i < w * h; i++) px.push(data[i * 4 + 3] >= 128 ? [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] : null)

  /* the background: the commonest edge colour, if a quarter of the edge has it, flooded in from the edges */
  if (removeBg) {
    const border: number[] = []
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
    for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1)
    const counts = new Map<string, RGB[]>()
    border.forEach((i) => { const c = px[i]; if (c) { const k = c.map((v) => v >> 5).join(); counts.set(k, [...(counts.get(k) ?? []), c]) } })
    const top = [...counts.values()].sort((a, b) => b.length - a.length)[0]
    if (top && top.length >= border.length * 0.25) {
      const bg = [0, 1, 2].map((j) => top.reduce((s, c) => s + c[j], 0) / top.length) as RGB
      const near = (i: number) => !!px[i] && d2(px[i]!, bg) < BG_NEAR
      const queue = border.filter(near), seen = new Set(queue)
      while (queue.length) {
        const i = queue.pop()!
        px[i] = null
        const x = i % w, y = (i / w) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, j = ny * w + nx
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen.has(j) && near(j)) { seen.add(j); queue.push(j) }
        }
      }
    }
  }

  /* a few colours: k-means, seeded across the brightness range */
  const opaque = px.filter((c): c is RGB => !!c)
  if (!opaque.length) return null
  const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
  const sorted = opaque.slice().sort((a, b) => lum(a) - lum(b))
  const k = Math.max(1, Math.min(colors, CUSTOM_COLORS, opaque.length))
  let cents: RGB[] = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)].slice() as RGB)
  const nearest = (c: RGB) => { let b = 0; cents.forEach((m, j) => { if (d2(c, m) < d2(c, cents[b])) b = j }); return b }
  for (let it = 0; it < 8; it++) {
    const sums = cents.map(() => [0, 0, 0, 0])
    opaque.forEach((c) => { const b = nearest(c); sums[b][0] += c[0]; sums[b][1] += c[1]; sums[b][2] += c[2]; sums[b][3]++ })
    cents = cents.map((m, j) => (sums[j][3] ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : m))
  }

  /* crop to the shape and stand it on the bottom row, centred */
  let x0 = w, x1 = -1, y0 = h, y1 = -1
  px.forEach((c, i) => { if (!c) return; const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) })
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = Math.max(bw, bh)
  const grid: PixelGrid = Array.from({ length: n }, () => Array<string | null>(n).fill(null))
  const ox = Math.floor((n - bw) / 2), oy = n - bh
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = px[y * w + x]; if (c) grid[oy + y - y0][ox + x - x0] = toHex(cents[nearest(c)]) }
  return grid
}

/** A grid as the saved form: its palette (each colour once) and one character per cell. */
export function toCustom(grid: PixelGrid): CustomBuddy {
  const palette: string[] = []
  const rows = grid.map((row) => row.map((c) => {
    if (!c) return '.'
    let i = palette.indexOf(c)
    if (i < 0) { i = palette.length; palette.push(c) }
    return i.toString(16)
  }).join(''))
  return { palette, rows }
}

/* a cell grid at least 4 wide, as the saved form needs: a smaller shape is centred and stood on the bottom row */
export function padTo(grid: PixelGrid, min: number): PixelGrid {
  const n = grid.length
  if (n >= min) return grid
  const out: PixelGrid = Array.from({ length: min }, () => Array<string | null>(min).fill(null))
  const ox = Math.floor((min - n) / 2), oy = min - n
  grid.forEach((row, y) => row.forEach((c, x) => { out[oy + y][ox + x] = c }))
  return out
}

/** Shrink a picture to fit `size` × `size`: halve until close, then one last smooth step (a cleaner small picture than one big jump). */
export function downscale(img: CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number }, size: number): Pixels {
  let cur: CanvasImageSource = img, cw = img.naturalWidth || img.width, ch = img.naturalHeight || img.height
  let ctx: CanvasRenderingContext2D | null = null
  const step = (w: number, h: number) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    ctx = c.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cur, 0, 0, w, h)
    cur = c; cw = w; ch = h
  }
  while (Math.max(cw, ch) > size * 2) step(Math.max(1, Math.round(cw / 2)), Math.max(1, Math.round(ch / 2)))
  const k = size / Math.max(cw, ch)
  step(Math.max(1, Math.round(cw * k)), Math.max(1, Math.round(ch * k)))
  return (ctx as unknown as CanvasRenderingContext2D).getImageData(0, 0, cw, ch)
}

export const MAX_PICTURE_BYTES = 10 * 1024 * 1024
export const PICTURE_TYPES = /^image\/(png|jpeg|gif|webp)$/
export const PICTURE_ERRORS = {
  type: "That isn't a picture this can read. Use a PNG, JPG, GIF or WebP.",
  size: "That picture is over 10 MB. Pick a smaller one.",
  open: "That file couldn't be opened as a picture. Try saving it as PNG or JPG.",
  empty: 'Nothing was left once the background was removed. Turn off "Remove the background", or try a picture with more contrast.',
} as const
