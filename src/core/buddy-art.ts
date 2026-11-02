// The study buddies, drawn in code as 32 × 32 pixel art (design/study-buddies-prototype.html is
// the reference, and the design doc's "The buddies" the description). sprite() is pure: the same
// buddy, tier, mood and frame always give the same grid of colours, which buddy-sprite.tsx paints
// on a canvas. No image files, so a sprite stays sharp at any whole-number scale.

import type { CustomBuddy, Mood } from './buddy-rules.ts'

export const N = 32
const INK = '#1E1B24', GOLD_OUT = '#7A4A00'
export type Grid = (string | null)[][]
type Put = (x: number, y: number, c: string | null | undefined) => void
type Has = (x: number, y: number) => boolean
type Cell = [number, number, string]

/* ── colour helpers ─────────────────────────────────────────── */
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t))
const grey = (a: string) => { const [r, g, b] = hex(a); const l = 0.3 * r + 0.59 * g + 0.11 * b; return toHex([l, l, l]) }
const moodTint = (c: string, mood: Mood) => mood === 'sick' ? mix(c, '#9EC46A', 0.38) : mood === 'hurt' ? mix(c, grey(c), 0.4) : mood === 'tired' ? mix(c, grey(c), 0.15) : c

/* ── the six buddies ─────────────────────────────────────────── */
export interface Buddy {
  label: string; name: string; kind: string
  /** Rank names, one per tier (TIERS in buddy-rules.ts). */
  ranks: readonly string[]
  body: { l: string; m: string; d: string }; cape: string
  gear: { hat: string; item: string; outfit: string }
  egg: (put: Put, cx: number, cy: number) => void
}
export type BuddyId = 'med' | 'cs' | 'law' | 'pilot' | 'sports' | 'eng'
export const BUDDIES: Record<BuddyId, Buddy> = {
  med: {
    label: 'Medicine', name: 'Pip', kind: 'a mint blob in scrubs',
    ranks: ['Egg', 'Hatchling', 'Pre-med', 'Med student', 'Intern', 'Resident', 'Chief of medicine'],
    body: { l: '#C4F2E4', m: '#86DCC6', d: '#4FAE99' }, cape: '#0F5F58',
    gear: { hat: 'Teal surgical cap, then a head mirror', item: 'Clipboard with a red cross', outfit: 'White coat and stethoscope' },
    egg: (put, cx, cy) => { [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]].forEach(([x, y]) => put(cx + x, cy + y, '#D2443A')) },
  },
  cs: {
    label: 'Computer Science', name: 'Byte', kind: 'a periwinkle blob in a hoodie',
    ranks: ['Egg', 'Hatchling', 'Script kiddie', 'Junior dev', 'Developer', 'Senior dev', '10x engineer'],
    body: { l: '#CDD8FB', m: '#95ACF2', d: '#5F78C8' }, cape: '#2B4FA8',
    gear: { hat: 'Over-ear headphones', item: 'Laptop, screen glowing', outfit: 'Navy hoodie with drawstrings' },
    egg: (put, cx, cy) => { [-3, -1, 1, 3].forEach((x, i) => { put(cx + x, cy - 1, i % 2 ? '#3A63C9' : '#7BE0B0'); put(cx + x + (i % 2 ? -1 : 1), cy + 1, i % 2 ? '#7BE0B0' : '#3A63C9') }) },
  },
  law: {
    label: 'Law', name: 'Brief', kind: 'a rose blob in a barrister’s wig',
    ranks: ['Egg', 'Hatchling', 'Pre-law', '1L', 'Associate', 'Partner', 'Supreme justice'],
    body: { l: '#F7D2D2', m: '#E9A6A6', d: '#C27474' }, cape: '#7A2E2E',
    gear: { hat: 'Curly white barrister’s wig', item: 'Gavel', outfit: 'Charcoal suit, white shirt, red tie' },
    egg: (put, cx, cy) => { for (let x = -5; x <= 5; x++) { put(cx + x, cy, '#7A2E2E'); put(cx + x, cy + 1, '#C99A3A') } },
  },
  pilot: {
    label: 'Aviation', name: 'Jet', kind: 'a sky-blue blob in a flight cap',
    ranks: ['Egg', 'Hatchling', 'Cadet', 'Student pilot', 'First officer', 'Captain', 'Ace'],
    body: { l: '#CBE8FB', m: '#8FCBF1', d: '#5C9CC8' }, cape: '#1F3A5F',
    gear: { hat: 'Leather flight cap with goggles', item: 'Paper plane', outfit: 'Leather flight jacket with a fur collar' },
    egg: (put, cx, cy) => { for (let x = -4; x <= 4; x++) put(cx + x, cy, Math.abs(x) <= 1 ? '#E2B33C' : '#26476F'); [-3, -2, 2, 3].forEach((x) => put(cx + x, cy + 1, '#26476F')) },
  },
  sports: {
    label: 'Sports', name: 'Rookie', kind: 'an orange blob in a jersey',
    ranks: ['Egg', 'Hatchling', 'Benchwarmer', 'Rookie', 'Starter', 'All-star', 'MVP'],
    body: { l: '#FCD0A4', m: '#F6A55E', d: '#D27A30' }, cape: '#2F6B3A',
    gear: { hat: 'Red and white sweatband', item: 'Basketball', outfit: 'Green jersey, number 7' },
    egg: (put, cx, cy) => { for (let y = -5; y <= 5; y++) put(cx, cy + y, '#B5651D'); for (let x = -4; x <= 4; x++) put(cx + x, cy, '#B5651D') },
  },
  eng: {
    label: 'Engineering', name: 'Bolt', kind: 'a yellow blob in a hard hat',
    ranks: ['Egg', 'Hatchling', 'Apprentice', 'Technician', 'Engineer', 'Lead engineer', 'Chief engineer'],
    body: { l: '#FBEBA8', m: '#F3D35A', d: '#C9A21C' }, cape: '#3F4E5E',
    gear: { hat: 'Yellow hard hat', item: 'Wrench', outfit: 'Orange hi-vis vest with reflective stripes' },
    egg: (put, cx, cy) => { for (let y = 0; y <= 2; y++) for (let x = -5; x <= 5; x++) put(cx + x, cy + y, (((x + y + 20) >> 1) % 2) ? '#2A2F35' : '#F2C21B') },
  },
}
export const BUDDY_ORDER: readonly BuddyId[] = ['med', 'cs', 'law', 'pilot', 'sports', 'eng']
const isBuddy = (v: string): v is BuddyId => Object.hasOwn(BUDDIES, v)

/** The custom buddy: the person's own picture. It goes through the ranks and moods with no hat, item or outfit. */
export const CUSTOM = {
  label: 'Custom', name: 'Mochi', kind: 'your own picture, turned into pixel art',
  ranks: ['Egg', 'Hatchling', 'Newbie', 'Learner', 'Scholar', 'Expert', 'Legend'] as readonly string[],
  egg: ((put, cx, cy) => { [[-1, -3], [0, -3], [1, -3], [2, -2], [1, -1], [0, 0], [0, 2]].forEach(([x, y]) => put(cx + x, cy + y, '#6A4FA8')) }) as Buddy['egg'],
}
/** A buddy on screen: one of the six, or the custom one. */
export type Shown = BuddyId | 'custom'

/** The buddy a look shows: 'auto' (or anything unknown) follows the profile's theme. */
export function buddyFor(look: { buddy?: string } | null | undefined, bg: string): BuddyId {
  const b = look?.buddy ?? 'auto'
  if (b !== 'auto' && isBuddy(b)) return b
  return isBuddy(bg) ? bg : 'med'
}
/** Like buddyFor, but 'custom' while a custom buddy is saved. */
export const shownFor = (look: { buddy?: string } | null | undefined, bg: string, custom: CustomBuddy | null | undefined): Shown =>
  look?.buddy === 'custom' && custom ? 'custom' : buddyFor(look, bg)

/** The rank's title for a tier index (0–6). */
export const rankName = (buddy: Shown, tier: number): string => (buddy === 'custom' ? CUSTOM : BUDDIES[buddy]).ranks[Math.max(0, Math.min(6, tier))]
/** The buddy's own name, when the person has not named it. */
export const buddyName = (buddy: Shown): string => (buddy === 'custom' ? CUSTOM : BUDDIES[buddy]).name

/** A saved custom buddy as a square grid of colours, null where empty. */
export function customGrid(c: CustomBuddy): Grid {
  return c.rows.map((r) => [...r].map((ch) => (ch === '.' ? null : c.palette[parseInt(ch, 16)] ?? null)))
}

function ellipse(cx: number, cy: number, rx: number, ry: number, f: (x: number, y: number, dx: number, dy: number) => void) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    const dx = x - cx, dy = y - cy
    if ((dx * dx) / ((rx + 0.5) ** 2) + (dy * dy) / ((ry + 0.5) ** 2) <= 1) f(x, y, dx, dy)
  }
}
/* body shapes by tier: radius x, radius y, centre y (feet rest on row 29) */
const SHAPE: ({ rx: number; ry: number; cy: number } | null)[] = [null, { rx: 4, ry: 3, cy: 22 }, { rx: 5, ry: 4, cy: 25 }, { rx: 6, ry: 5, cy: 24 }, { rx: 6, ry: 6, cy: 23 }, { rx: 7, ry: 7, cy: 22 }, { rx: 7, ry: 7, cy: 22 }]

/**
 * A buddy at a tier (0 egg … 6 legend), in a mood, on frame 0 or 1 of its idle animation:
 * a 32 × 32 grid of CSS colours, null where empty.
 */
export function sprite(buddy: Shown, tier: number, mood: Mood, frame: 0 | 1 = 0, custom?: CustomBuddy | null): Grid {
  if (buddy === 'custom') return customSprite(custom ? customGrid(custom) : null, tier, mood, frame)
  const T = BUDDIES[buddy]
  tier = Math.max(0, Math.min(6, Math.floor(tier)))
  const grid: Grid = Array.from({ length: N }, () => Array<string | null>(N).fill(null))
  const put: Put = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N && c) grid[y][x] = c }
  const has: Has = (x, y) => !!grid[y]?.[x]
  const B = { l: moodTint(T.body.l, mood), m: moodTint(T.body.m, mood), d: moodTint(T.body.d, mood) }
  const legend = tier === 6
  const extras: Cell[] = []      /* after the outline: sparkles, zZ, sweat */

  /* ── tier 0: the egg ── */
  if (tier === 0) {
    const cx = 16, cy = 23, rx = 5, ry = 6
    const shell = { l: moodTint('#FFF8EA', mood), m: moodTint('#F2E7CF', mood), d: moodTint('#D6C6A3', mood) }
    ellipse(cx, cy, rx, ry, (x, y, dx, dy) => put(x, y, dy > ry * 0.45 ? shell.d : (dx < -1 && dy < -2) ? shell.l : shell.m))
    T.egg((x, y, c) => { if (has(x, y) && c) put(x, y, moodTint(c, mood)) }, cx, cy)
    if (mood === 'sick' || mood === 'hurt') [[18, 18], [17, 19], [18, 20], [19, 21]].forEach(([x, y]) => put(x, y, INK))
    if (mood === 'hurt') [[12, 21], [13, 22], [14, 23], [14, 21], [12, 23]].forEach(([x, y]) => put(x, y, '#F1D6B0'))
    /* happy eggs wobble */
    if (mood === 'happy' && frame) { const g2 = grid.map((r) => r.slice()); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) grid[y][x] = y < cy ? (g2[y][x - 1] ?? null) : g2[y][x] }
    return finish(grid, extras, false, mood, frame)
  }

  const { rx, ry, cy } = SHAPE[tier]!
  const cx = 16, yt = cy - ry

  /* legendary cape, behind everything */
  if (legend) {
    for (let y = cy - 3; y <= cy + ry + 1; y++) {
      const w = rx + 1 + Math.floor((y - (cy - 3)) / 3)
      for (let x = cx - w; x <= cx + w; x++) put(x, y, y === cy + ry + 1 ? '#E2B33C' : (x - cx + y) % 5 === 0 ? mix(T.cape, '#000000', 0.25) : T.cape)
    }
  }

  /* the body */
  ellipse(cx, cy, rx, ry, (x, y, dx, dy) => {
    let c = B.m
    if (dy > ry * 0.45) c = B.d
    else if (dx < -rx * 0.2 && dy < -ry * 0.2) c = B.l
    put(x, y, c)
  })
  /* feet and, from tier 3, arms */
  ;[-3, -2, 2, 3].forEach((x) => put(cx + x, cy + ry + 1, B.d))
  if (tier >= 3) { put(cx - rx - 1, cy + 1, B.m); put(cx - rx - 1, cy + 2, B.d); put(cx + rx + 1, cy + 1, B.m); put(cx + rx + 1, cy + 2, B.d) }

  /* the outfit, from tier 5: the lower body */
  if (tier >= 5) outfit(buddy, put, has, cx, cy, rx, ry, cy + Math.round(ry * 0.25))

  /* the face */
  const gap = rx >= 6 ? 3 : 2
  const ey = cy - Math.max(1, Math.round(ry * 0.3))
  const eyes = [cx - gap - 1, cx + gap]          /* each eye is 2 wide from here */
  const m = ey + 3
  if (mood === 'happy') {
    eyes.forEach((x) => { put(x, ey, '#FFFFFF'); put(x + 1, ey, INK); put(x, ey + 1, INK); put(x + 1, ey + 1, INK) })
    ;[cx - 1, cx + 1].forEach((x) => put(x, m, INK)); put(cx, m + 1, INK)
    if (rx >= 5) [[eyes[0] - 1, ey + 2], [eyes[0], ey + 2], [eyes[1] + 1, ey + 2], [eyes[1] + 2, ey + 2]].forEach(([x, y]) => { if (has(x, y)) put(x, y, '#F59AB0') })
  } else if (mood === 'tired') {
    eyes.forEach((x) => { put(x, ey + 1, INK); put(x + 1, ey + 1, INK); put(x, ey + 2, mix(B.d, '#6A5A8A', 0.4)); put(x + 1, ey + 2, mix(B.d, '#6A5A8A', 0.4)) })
    put(cx, m + 1, INK); put(cx + 1, m + 1, INK)
    extras.push(...zz(cx + rx + 1, yt - 3 + (frame ? -1 : 0)))
    extras.push([cx - rx - 1, yt + 2, '#8FD3F5'], [cx - rx - 1, yt + 3, '#5BB6E8'])
  } else if (mood === 'sick') {
    eyes.forEach((x) => { put(x, ey + 1, INK); put(x + 1, ey, INK) })
    put(cx - 1, m, INK); put(cx, m, INK)
    /* a thermometer */
    ;[[cx + 1, m], [cx + 2, m], [cx + 3, m - 1]].forEach(([x, y]) => put(x, y, '#FFFFFF')); put(cx + 4, m - 1, '#D2443A')
  } else {
    put(eyes[0], ey, INK); put(eyes[0] + 1, ey, INK); put(eyes[0], ey + 1, INK); put(eyes[0] + 1, ey + 1, INK)
    put(eyes[0], ey + 2 + (frame ? 1 : 0), '#5BB6E8')                                      /* a tear */
    for (let y = ey - 1; y <= ey + 1; y++) for (let x = eyes[1] - 1; x <= eyes[1] + 2; x++) put(x, y, (x + y) % 2 ? '#FFFFFF' : '#E6E0D4')   /* an eye patch of gauze */
    put(cx - 1, m + 1, INK); put(cx, m, INK); put(cx + 1, m + 1, INK)
    /* a plaster on the head */
    ;[[cx - 3, yt + 1], [cx - 2, yt + 2], [cx - 1, yt + 3], [cx - 1, yt + 1], [cx - 3, yt + 3]].forEach(([x, y]) => put(x, y, '#F1D6B0'))
  }

  /* hat from tier 3, held item from tier 4 */
  if (tier >= 3) hat(buddy, tier, put, has, cx, yt, rx, ey)
  if (tier >= 4) item(buddy, put, cx + rx + 2, cy - 1)

  /* tier 1: an eggshell around the hatchling's lower half */
  if (tier === 1) {
    const shell = { m: moodTint('#F2E7CF', mood), d: moodTint('#D6C6A3', mood) }
    ellipse(16, 25, 5, 5, (x, y, _dx, dy) => {
      if (y < 24 || (y === 24 && (x % 2))) return
      put(x, y, dy > 2 ? shell.d : shell.m)
    })
    T.egg((x, y, c) => { if (y >= 26 && has(x, y) && c) put(x, y, moodTint(c, mood)) }, 16, 27)
  }

  /* legendary: a floating crown */
  if (legend) {
    const y0 = yt - 6 + (frame ? -1 : 0)
    ;[[-2, 0], [0, -1], [2, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]].forEach(([x, y]) => put(cx + x, y0 + y + 1, '#F5C542'))
    put(cx, y0 + 2, '#D2443A')
  }
  return finish(grid, extras, legend, mood, frame)
}

/* the picture's size in pixels at each rank */
const CSIZE = [0, 10, 13, 16, 19, 22, 22]
/** The custom buddy at a tier: the picture scaled to the rank's size, standing on row 29, with mood drawn around it. */
function customSprite(M: Grid | null, tier: number, mood: Mood, frame: 0 | 1): Grid {
  tier = Math.max(0, Math.min(6, Math.floor(tier)))
  const grid: Grid = Array.from({ length: N }, () => Array<string | null>(N).fill(null))
  const put: Put = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N && c) grid[y][x] = c }
  const has: Has = (x, y) => !!grid[y]?.[x]
  const extras: Cell[] = []
  if (!M) return finish(grid, extras, false, mood, frame)
  /* an egg in the custom pattern until it hatches */
  if (tier === 0) {
    const cx = 16, cy = 23, rx = 5, ry = 6
    const shell = { l: moodTint('#FFF8EA', mood), m: moodTint('#F2E7CF', mood), d: moodTint('#D6C6A3', mood) }
    ellipse(cx, cy, rx, ry, (x, y, dx, dy) => put(x, y, dy > ry * 0.45 ? shell.d : (dx < -1 && dy < -2) ? shell.l : shell.m))
    CUSTOM.egg((x, y, c) => { if (has(x, y) && c) put(x, y, moodTint(c, mood)) }, cx, cy)
    return finish(grid, extras, false, mood, frame)
  }
  const n = M.length, S = CSIZE[tier], left = 16 - Math.floor(S / 2), top = 30 - S
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = M[Math.floor((y * n) / S)][Math.floor((x * n) / S)]
    if (c) put(left + x, top + y, moodTint(c, mood))
  }
  if (tier === 1) {
    const shell = { m: moodTint('#F2E7CF', mood), d: moodTint('#D6C6A3', mood) }
    ellipse(16, 25, 5, 5, (x, y, _dx, dy) => { if (y < 24 || (y === 24 && (x % 2))) return; put(x, y, dy > 2 ? shell.d : shell.m) })
    CUSTOM.egg((x, y, c) => { if (y >= 26 && has(x, y) && c) put(x, y, moodTint(c, mood)) }, 16, 27)
  }
  if (mood === 'tired') { extras.push(...zz(left + S, top - 3 + (frame ? -1 : 0))); extras.push([left - 2, top + 2, '#8FD3F5'], [left - 2, top + 3, '#5BB6E8']) }
  if (mood === 'sick') { const y = top + Math.floor(S / 2); [-4, -3, -2, -1].forEach((dy) => put(left + S + 1, y + dy, '#FFFFFF')); put(left + S + 1, y, '#D2443A') }
  if (mood === 'hurt') [[1, 1], [2, 2], [3, 3], [3, 1], [1, 3]].forEach(([dx, dy]) => { if (has(left + dx, top + dy)) put(left + dx, top + dy, '#F1D6B0') })
  if (tier === 6) {
    const y0 = top - 6 + (frame ? -1 : 0), cx = 16
    ;[[-2, 0], [0, -1], [2, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]].forEach(([x, y]) => put(cx + x, y0 + y + 1, '#F5C542'))
    put(cx, y0 + 2, '#D2443A')
  }
  return finish(grid, extras, tier === 6, mood, frame)
}

function zz(x: number, y: number): Cell[] {
  const cells: Cell[] = []
  const z = (ox: number, oy: number, s: number) => { for (let i = 0; i < s; i++) cells.push([ox + i, oy, '#9A97C9'], [ox + i, oy + s - 1, '#9A97C9'], [ox + s - 1 - i, oy + i, '#9A97C9']) }
  z(x, y, 3); z(x + 3, y - 4, 2)
  return cells
}

function outfit(buddy: BuddyId, put: Put, has: Has, cx: number, cy: number, rx: number, ry: number, top: number) {
  const paint = (f: (dx: number, dy: number) => string | null) => { for (let y = top; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (has(x, y)) { const c = f(x - cx, y - top); if (c) put(x, y, c) } }
  const low = (dy: number) => dy > (cy + ry - top) * 0.55
  if (buddy === 'med') {
    paint((dx, dy) => (dx === 0 ? null : low(dy) || Math.abs(dx) >= rx - 1 ? '#C9D8D8' : '#F6FAFA'))
    ;[[-2, 0], [-2, 1], [-2, 2], [-1, 3], [0, 3], [1, 2]].forEach(([x, y]) => put(cx + x, top + y, '#4A545E'))
    put(cx + 1, top + 3, '#C9CED6'); put(cx + 2, top + 3, '#9AA6B2')
  } else if (buddy === 'cs') {
    paint((_dx, dy) => (low(dy) ? '#262F47' : '#34405E'))
    ;[[-1, 0], [-1, 1], [-1, 2], [1, 0], [1, 1], [1, 2]].forEach(([x, y]) => put(cx + x, top + y, '#F2F4FA'))
    for (let x = -2; x <= 2; x++) put(cx + x, top + 4, '#1D2438')
  } else if (buddy === 'law') {
    paint((dx, dy) => (Math.abs(dx) <= 2 - dy && dy <= 2 ? '#FFFFFF' : low(dy) ? '#1E2027' : '#2E3039'))
    ;[0, 1, 2, 3, 4].forEach((y) => put(cx, top + y, y === 0 ? '#8E2A2A' : '#B23A3A'))
  } else if (buddy === 'pilot') {
    paint((dx, dy) => (dy === 0 ? '#EDE1C8' : dx === 0 ? '#C9CED6' : low(dy) ? '#6A4325' : '#8A5A34'))
    put(cx - 2, top + 1, '#FFFFFF'); put(cx - 3, top + 2, '#FFFFFF')
  } else if (buddy === 'sports') {
    paint((dx, dy) => (dy === 0 && Math.abs(dx) <= 1 ? '#FFFFFF' : low(dy) ? '#226A38' : '#2F8A4A'))
    ;[[-1, 1], [0, 1], [1, 1], [1, 2], [0, 3], [0, 4]].forEach(([x, y]) => put(cx + x, top + y, '#FFFFFF'))
  } else {
    paint((dx, dy) => (dy === 2 || dy === 4 ? '#E3E8EE' : dx === 0 ? null : low(dy) ? '#C85E10' : '#F07A1F'))
  }
}

function hat(buddy: BuddyId, tier: number, put: Put, has: Has, cx: number, yt: number, rx: number, ey: number) {
  if (buddy === 'med') {
    for (let y = yt - 2; y <= yt + 1; y++) { const w = y === yt - 2 ? rx - 3 : rx - 1; for (let x = cx - w; x <= cx + w; x++) put(x, y, y === yt + 1 ? '#1C7A71' : (x + y) % 4 === 0 ? '#5CC2B6' : '#2FA59A') }
    if (tier >= 5) { put(cx - 1, yt + 2, '#DDE3E8'); put(cx, yt + 2, '#9AA6B2'); put(cx + 1, yt + 2, '#DDE3E8'); put(cx, yt + 3, '#DDE3E8') }
  } else if (buddy === 'cs') {
    for (let x = cx - rx + 1; x <= cx + rx - 1; x++) put(x, yt - 1, '#2A2F45')
    put(cx - rx, yt, '#2A2F45'); put(cx + rx, yt, '#2A2F45')
    for (let y = ey - 1; y <= ey + 2; y++) { put(cx - rx - 1, y, '#3A63C9'); put(cx - rx, y, '#5C82E0'); put(cx + rx, y, '#5C82E0'); put(cx + rx + 1, y, '#3A63C9') }
  } else if (buddy === 'law') {
    for (let y = yt - 2; y <= yt + 1; y++) { const w = y === yt - 2 ? rx - 2 : rx; for (let x = cx - w; x <= cx + w; x++) put(x, y, (x + y) % 2 ? '#FFFFFF' : '#D9D3C7') }
    for (let y = yt + 2; y <= ey + 3; y++) { put(cx - rx - 1, y, (y % 2) ? '#FFFFFF' : '#D9D3C7'); put(cx - rx, y, (y % 2) ? '#D9D3C7' : '#FFFFFF'); put(cx + rx, y, (y % 2) ? '#D9D3C7' : '#FFFFFF'); put(cx + rx + 1, y, (y % 2) ? '#FFFFFF' : '#D9D3C7') }
  } else if (buddy === 'pilot') {
    for (let y = yt - 1; y <= yt + 1; y++) { const w = y === yt - 1 ? rx - 2 : rx; for (let x = cx - w; x <= cx + w; x++) put(x, y, y === yt - 1 ? '#A8744A' : '#8A5A34') }
    for (let y = yt + 2; y <= ey + 1; y++) { put(cx - rx, y, '#8A5A34'); put(cx + rx, y, '#8A5A34') }
    ;[-3, -2, 2, 3].forEach((x) => put(cx + x, yt, '#8FD3F5'))
    ;[-4, -1, 1, 4].forEach((x) => put(cx + x, yt, '#C9CED6')); put(cx, yt, '#6A4325')
  } else if (buddy === 'sports') {
    for (let x = cx - rx; x <= cx + rx; x++) { if (has(x, ey - 2)) put(x, ey - 2, '#FFFFFF'); if (has(x, ey - 3)) put(x, ey - 3, '#D84A3A') }
    put(cx + rx + 1, ey - 2, '#D84A3A'); put(cx + rx + 2, ey - 1, '#D84A3A')
  } else {
    ellipse(cx, yt + 1, rx - 1, 3, (x, y) => { if (y <= yt + 1) put(x, y, x < cx - 1 && y < yt ? '#FFE58A' : '#F2C21B') })
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) put(x, yt + 2, '#C99A0A')
    put(cx, yt - 2, '#C99A0A'); put(cx, yt - 1, '#C99A0A')
  }
}

function item(buddy: BuddyId, put: Put, ax: number, ay: number) {
  const P = (cells: number[][], c: string) => cells.forEach(([x, y]) => put(ax + x, ay + y, c))
  if (buddy === 'med') {
    for (let y = 0; y <= 5; y++) for (let x = 0; x <= 3; x++) put(ax + x, ay + y, '#A87A4A')
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 2; x++) put(ax + x, ay + y, '#FFFFFF')
    P([[1, -1], [2, -1]], '#9AA6B2'); P([[1, 2], [2, 2]], '#D2443A'); put(ax + 2, ay + 1, '#D2443A')
  } else if (buddy === 'cs') {
    for (let y = 0; y <= 3; y++) for (let x = 0; x <= 4; x++) put(ax + x, ay + y, (x === 0 || x === 4 || y === 0 || y === 3) ? '#9AA6B2' : '#7FB8FF')
    P([[1, 1], [3, 2]], '#E9F8FF')
    for (let x = -1; x <= 4; x++) put(ax + x, ay + 4, '#6E7884')
  } else if (buddy === 'law') {
    for (let y = 0; y <= 1; y++) for (let x = 0; x <= 4; x++) put(ax + x, ay + y, x === 0 || x === 4 ? '#C99A3A' : '#7A4E2A')
    P([[2, 2], [2, 3], [2, 4], [2, 5]], '#A8744A')
  } else if (buddy === 'pilot') {
    P([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 0], [2, 0]], '#FFFFFF')
    P([[2, 2], [3, 2], [1, 2]], '#C9D6E6')
  } else if (buddy === 'sports') {
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) { const d = (x - 2) ** 2 + (y - 2) ** 2; if (d <= 5) put(ax + x, ay + y, x === 2 || y === 2 ? '#7A3A10' : '#E8742A') }
  } else {
    P([[0, 5], [1, 4], [2, 3], [3, 2]], '#9AA6B2')
    P([[3, 0], [4, 1], [5, 1], [3, 1], [5, 0], [4, 2]], '#C9CED6')
  }
}

const AURA = 'rgba(245,197,66,0.38)'
/* the outline, then whatever floats outside it */
function finish(grid: Grid, extras: Cell[], legend: boolean, mood: Mood, frame: 0 | 1): Grid {
  const out = grid.map((r) => r.slice())
  const line = legend ? GOLD_OUT : INK
  const near = (g: Grid, x: number, y: number, test: (c: string | null | undefined) => boolean) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => test(g[y + dy]?.[x + dx]))
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!grid[y][x] && near(grid, x, y, (c) => !!c)) out[y][x] = line
  }
  if (legend) {
    /* a soft gold aura on the beat, and sparkles that trade places */
    if (!frame && mood !== 'hurt') {
      const before = out.map((r) => r.slice())
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!before[y][x] && near(before, x, y, (c) => c === line)) out[y][x] = AURA
    }
    const star = (x: number, y: number, big: boolean): Cell[] => (big
      ? [[0, 0, '#FFFFFF'], [1, 0, '#F5C542'], [-1, 0, '#F5C542'], [0, 1, '#F5C542'], [0, -1, '#F5C542'], [2, 0, '#E0A82A'], [-2, 0, '#E0A82A'], [0, 2, '#E0A82A'], [0, -2, '#E0A82A']] as Cell[]
      : [[0, 0, '#FFF6D6'], [1, 0, '#F5C542'], [-1, 0, '#F5C542'], [0, 1, '#F5C542'], [0, -1, '#F5C542']] as Cell[]).map(([dx, dy, c]) => [x + dx, y + dy, c])
    if (mood !== 'hurt') extras.push(...star(4, 8, !frame), ...star(27, 5, !!frame), ...star(28, 19, !frame), ...star(3, 22, !!frame))
  }
  extras.forEach(([x, y, c]) => { if (x >= 0 && x < N && y >= 0 && y < N && (!out[y][x] || out[y][x] === AURA)) out[y][x] = c })
  return out
}

/* ── backgrounds and frames (the shop's cosmetics, COSMETICS in buddy-rules.ts) ── */

/* a fixed scatter, so a background is the same on every draw */
const scatter = (seed: number, count: number, w: number, h: number): [number, number][] => {
  const out: [number, number][] = []
  let v = seed
  for (let i = 0; i < count; i++) { v = (v * 1103515245 + 12345) >>> 0; const x = v % w; v = (v * 1103515245 + 12345) >>> 0; out.push([x, v % h]) }
  return out
}
const bands = (g: Grid, rows: [number, string][]) => { for (let y = 0; y < N; y++) { const c = rows.filter(([from]) => y >= from).at(-1)![1]; for (let x = 0; x < N; x++) g[y][x] = c } }

/** A background as a full 32 × 32 grid, or null for an unknown id or 'none'. */
export function backdrop(id: string): Grid | null {
  const g: Grid = Array.from({ length: N }, () => Array<string | null>(N).fill(null))
  const put: Put = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N && c) g[y][x] = c }
  if (id === 'bg-meadow') {
    bands(g, [[0, '#BFE6FF'], [8, '#CDEBFF'], [16, '#DDF2FF'], [24, '#7CC66B'], [27, '#6AB55A'], [30, '#5FA854']])
    ;[[4, 5], [5, 4], [6, 4], [7, 5], [5, 5], [6, 5], [22, 8], [23, 7], [24, 7], [25, 8], [23, 8], [24, 8]].forEach(([x, y]) => put(x, y, '#FFFFFF'))
    scatter(7, 10, N, 6).forEach(([x, y]) => put(x, 25 + y, '#4E9446'))
    ;[[3, 26, '#F5C542'], [27, 27, '#F59AB0'], [9, 29, '#FFFFFF']].forEach(([x, y, c]) => put(x as number, y as number, c as string))
  } else if (id === 'bg-sunset') {
    bands(g, [[0, '#6A4FA8'], [5, '#A7579A'], [10, '#E0707A'], [15, '#FF9E6D'], [19, '#FFC27A'], [24, '#4A2E5A'], [28, '#3A2348']])
    ellipse(16, 23, 6, 6, (x, y) => { if (y < 24) put(x, y, y < 20 ? '#FFE08A' : '#FFD06A') })
    ;[[2, 23], [3, 22], [4, 22], [5, 23], [26, 23], [27, 22], [28, 22], [29, 23], [30, 23]].forEach(([x, y]) => put(x, y, '#4A2E5A'))
  } else if (id === 'bg-library') {
    bands(g, [[0, '#5A3D30'], [26, '#8A5A34'], [29, '#6A4325']])
    const spines = ['#B23A3A', '#2F8A4A', '#3A63C9', '#E2B33C', '#7A2E2E', '#26476F', '#C85E10']
    for (const top of [2, 10, 18]) {
      for (let x = 0; x < N; x++) put(x, top + 6, '#A8744A')
      let x = 1, i = top
      while (x < N - 1) { const w = 1 + ((i * 7) % 2), h = 4 + ((i * 3) % 3), c = spines[i % spines.length]; for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) put(x + dx, top + 6 - 1 - dy, c); x += w + ((i % 5) === 0 ? 2 : 0); i++ }
    }
  } else if (id === 'bg-night') {
    bands(g, [[0, '#141A33'], [8, '#1B2244'], [16, '#232C57'], [24, '#2C3768'], [28, '#1E2546']])
    scatter(42, 26, N, 24).forEach(([x, y], i) => put(x, y, i % 4 ? '#C9D6F5' : '#FFFFFF'))
    ellipse(25, 5, 2, 2, (x, y) => put(x, y, '#FFF4C2')); put(26, 4, '#E8DCA0')
  } else if (id === 'bg-aurora') {
    bands(g, [[0, '#0C1E2A'], [12, '#10293A'], [22, '#14324A'], [27, '#E3EEF2'], [29, '#C9DCE4']])
    for (let x = 0; x < N; x++) {
      const w1 = Math.round(6 + 3 * Math.sin(x / 4)), w2 = Math.round(13 + 2 * Math.sin(x / 3 + 1))
      for (let d = 0; d < 3; d++) { put(x, w1 + d, d === 1 ? '#7BE0B0' : '#3FB98A'); put(x, w2 + d, d === 1 ? '#C49BF0' : '#8A6AD0') }
    }
    scatter(9, 10, N, 22).forEach(([x, y]) => { if (!g[y][x] || g[y][x]!.startsWith('#1')) put(x, y, '#FFFFFF') })
  } else return null
  return g
}

/** The width a frame adds on each side, in cells. */
export const FRAME_W = 2
/** A frame around a grid: the grid grows by FRAME_W on every side. Unknown ids leave it as it is. */
export function framed(inner: Grid, id: string): Grid {
  const ring = id === 'frame-wood' ? ['#6A4325', '#A8744A', '#8A5A34'] : id === 'frame-silver' ? ['#6E7884', '#DDE3E8', '#9AA6B2'] : id === 'frame-gold' ? ['#7A4A00', '#F5C542', '#C99A0A'] : null
  if (!ring) return inner
  const n = inner.length + FRAME_W * 2
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => {
    const edge = Math.min(x, y, n - 1 - x, n - 1 - y)
    if (edge >= FRAME_W) return inner[y - FRAME_W][x - FRAME_W]
    if (id === 'frame-gold' && (x < FRAME_W || x >= n - FRAME_W) && (y < FRAME_W || y >= n - FRAME_W)) return '#D2443A'   /* a gem in each corner */
    if (edge === 0) return ring[0]
    return id === 'frame-wood' ? ((x + y) % 5 === 0 ? ring[2] : ring[1]) : (x + y) % 6 < 2 ? ring[1] : ring[2]
  }))
}

