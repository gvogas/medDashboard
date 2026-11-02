import { describe, expect, it } from 'vitest'
import { pixelGrid, toCustom, padTo } from './pixelate.ts'
import { checkCustom } from './buddy-rules.ts'

/* a w × h picture from a function of (x, y) → [r, g, b, a] */
const pic = (w: number, h: number, f: (x: number, y: number) => number[]) => {
  const data: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.push(...f(x, y))
  return { width: w, height: h, data }
}
const WHITE = [255, 255, 255, 255], RED = [220, 30, 30, 255], CLEAR = [0, 0, 0, 0]
const square = (x: number, y: number) => (x >= 4 && x < 8 && y >= 2 && y < 10 ? RED : WHITE)

describe('pixelate', () => {
  it('removes a plain white background and crops to the red shape, standing on the bottom row', () => {
    const g = pixelGrid(pic(12, 12, square), { colors: 4, removeBg: true })!
    expect(g).toHaveLength(8)                                         /* 4 wide, 8 tall: an 8 × 8 square */
    expect(g.flat().filter(Boolean).every((c) => c === '#dc1e1e')).toBe(true)
    expect(g.flat().filter(Boolean)).toHaveLength(32)
    expect(g[7].filter(Boolean)).toHaveLength(4)
  })

  it('keeps the background when asked to', () => {
    const g = pixelGrid(pic(12, 12, square), { colors: 4, removeBg: false })!
    expect(g).toHaveLength(12)
    expect(new Set(g.flat())).toEqual(new Set(['#ffffff', '#dc1e1e']))
  })

  it('keeps a transparent PNG’s see-through pixels empty', () => {
    const g = pixelGrid(pic(6, 6, (x, y) => (x + y) % 2 ? RED : CLEAR), { colors: 4, removeBg: false })!
    expect(g.flat().filter((c) => c === null).length).toBe(18)
  })

  it('cuts many colours down to at most the number asked for', () => {
    const g = pixelGrid(pic(16, 16, (x, y) => [x * 16, y * 16, (x * y) % 256, 255]), { colors: 3, removeBg: false })!
    expect(new Set(g.flat().filter(Boolean)).size).toBeLessThanOrEqual(3)
  })

  it('returns null for a blank picture, or one that was all background', () => {
    expect(pixelGrid(pic(8, 8, () => CLEAR), { colors: 4, removeBg: true })).toBeNull()
    expect(pixelGrid(pic(8, 8, () => WHITE), { colors: 4, removeBg: true })).toBeNull()
  })

  it('saves as a palette and rows the Worker accepts', () => {
    const g = padTo(pixelGrid(pic(24, 24, (x, y) => [(x * 10) % 256, (y * 10) % 256, 128, 255]), { colors: 16, removeBg: false })!, 4)
    const c = toCustom(g)
    expect(c.rows).toHaveLength(24)
    expect(c.palette.length).toBeLessThanOrEqual(16)
    expect(checkCustom(c)).toEqual(c)
    const tiny = toCustom(padTo([['#112233']], 4))
    expect(tiny.rows).toEqual(['....', '....', '....', '.0..'])
    expect(checkCustom(tiny)).toEqual(tiny)
  })
})
