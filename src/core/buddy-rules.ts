// The Study Buddy's numbers (docs/superpowers/specs/2026-10-14-study-buddy-design.md, Game
// economy): the Worker's awards and the Buddy page both read them here, so a change is one edit.
// Starting values, for tuning. Plain TypeScript with no imports: worker/ uses it too.

/* Ids only: each buddy names its own ranks (src/core/buddy-art.ts). */
export interface Tier { id: string; minXp: number; reward: number }
export const TIERS: readonly Tier[] = [
  { id: 'egg', minXp: 0, reward: 5 },
  { id: 'hatchling', minXp: 120, reward: 25 },
  { id: 'r3', minXp: 300, reward: 50 },
  { id: 'r4', minXp: 700, reward: 100 },
  { id: 'r5', minXp: 1400, reward: 200 },
  { id: 'r6', minXp: 2500, reward: 400 },
  { id: 'legend', minXp: 4000, reward: 800 },
];

export const DAY_MINUTES = 240;              /* timed minutes a day that earn XP and coins */
export const FINISH_XP = 10;
export const MINUTES_PER_COIN = 5;
export const FINISH_COINS = 5;
export const BIG_FINISH_COINS = 15;          /* a class exam or project; personal ones pay FINISH_COINS */
export const BIG_TYPES: readonly string[] = ['exam', 'project'];
export const PERSONAL_FINISH_LIMIT = 5;      /* paying personal finishes a day, every type */
export const REVIEW_FINISH_LIMIT = 4;        /* lecture review tasks a day, apart from the 5 */
export const LOG_WINDOW_MS = 48 * 3_600_000; /* a session saved later than this after its start earns nothing */
export const STREAK_MINUTES = 15;
export const STREAK_COINS = 2;               /* per streak day */
export const STREAK_MAX = 20;
export const HEALTH_DAYS = 14;
export const HEALTH = { missed: -10, idle: -5, idleFrom: 4, perTenMinutes: 1, perCard: 2 } as const;
export const REVIEWS_PER_COIN = 10;          /* card reviews a day per coin */
export const CARD_COIN_CAP = 10;             /* card coins a day, +1 per Card Foundry level */
export const STREAK_REVIEWS = 10;            /* or this many card reviews make a streak day */
export const FINISHED: readonly string[] = ['done', 'submitted', 'graded'];
export const GRANT_MAX = { coins: 5000, xp: 10000 } as const;
export const NAME_MAX = 16;

/* A lecture review task (src/core/reviews.ts): its id and its title, both made by the app. */
export const REVIEW_ID = /^rv[a-z0-9]+\d$/;
export const REVIEW_TITLE = /^Review \d\/\d · /;
export const isReview = (id: string, title: string): boolean => REVIEW_ID.test(id) && REVIEW_TITLE.test(title);

export const tierOf = (xp: number): Tier => [...TIERS].reverse().find((t) => xp >= t.minXp)!;
export const nextTier = (xp: number): Tier | null => TIERS.find((t) => t.minXp > xp) ?? null;
export type Mood = 'happy' | 'tired' | 'sick' | 'hurt';
export const MOODS: readonly Mood[] = ['happy', 'tired', 'sick', 'hurt'];
export const moodOf = (h: number): Mood => (h >= 70 ? 'happy' : h >= 40 ? 'tired' : h >= 15 ? 'sick' : 'hurt');

/* Which buddy: 'auto' follows the profile's theme; 'custom' needs a saved custom buddy. */
export const BUDDY_IDS: readonly string[] = ['med', 'cs', 'law', 'pilot', 'sports', 'eng'];
export const LOOK_BUDDIES: readonly string[] = ['auto', ...BUDDY_IDS, 'custom'];

/* ── the shop (design doc, Shop) ── */
/** An upgrade: buying level n (1…max) costs base + step × n. `open` is false until its stage ships. */
export interface Upgrade { sku: string; name: string; effect: string; base: number; step: number; max: number; open: boolean }
export const UPGRADES: readonly Upgrade[] = [
  { sku: 'focus', name: 'Focus Engine', effect: '+20% study coins', base: 40, step: 35, max: 5, open: true },
  { sku: 'finisher', name: 'Finisher', effect: '+2 coins per finished item', base: 65, step: 50, max: 5, open: true },
  { sku: 'foundry', name: 'Card Foundry', effect: '+1 coin cap on cards', base: 55, step: 45, max: 5, open: true },
  { sku: 'magnet', name: 'Quiz Magnet', effect: '+5 quiz coin cap', base: 70, step: 55, max: 5, open: false },       /* Stage 5: quizzes */
];
export const FOCUS_RATE = 0.2;               /* per Focus Engine level, on session coins */
export const FINISHER_COINS = 2;             /* per Finisher level, on each paying finish */
export const upgradeCost = (u: Upgrade, level: number): number => u.base + u.step * level;

/** A background (drawn behind the buddy) or a frame (around it): cosmetic only, bought once. */
export interface Cosmetic { sku: string; kind: 'bg' | 'frame'; name: string; cost: number }
export const COSMETICS: readonly Cosmetic[] = [
  { sku: 'bg-meadow', kind: 'bg', name: 'Meadow', cost: 30 },
  { sku: 'bg-sunset', kind: 'bg', name: 'Sunset', cost: 60 },
  { sku: 'bg-library', kind: 'bg', name: 'Library', cost: 120 },
  { sku: 'bg-night', kind: 'bg', name: 'Starry night', cost: 200 },
  { sku: 'bg-aurora', kind: 'bg', name: 'Aurora', cost: 300 },
  { sku: 'frame-wood', kind: 'frame', name: 'Wooden frame', cost: 40 },
  { sku: 'frame-silver', kind: 'frame', name: 'Silver frame', cost: 100 },
  { sku: 'frame-gold', kind: 'frame', name: 'Gold frame', cost: 250 },
];

/** A class item's grade bonus: each step pays once, the first time the grade reaches it. */
export const GRADE_BONUS: readonly { min: number; coins: number; key: string }[] = [
  { min: 80, coins: 10, key: 'grade80' },
  { min: 90, coins: 15, key: 'grade90' },
];

/* ── the custom buddy (spec §2 buddy_settings.custom) ── */
export interface CustomBuddy { palette: string[]; rows: string[] }
export const CUSTOM_MIN = 4;
export const CUSTOM_MAX = 24;
export const CUSTOM_COLORS = 16;
export const CUSTOM_BYTES = 1024;
const HEX = /^#[0-9a-f]{6}$/;
/** The custom buddy if it keeps the rules (n rows of n chars, each a palette index or '.', at most 1 KB), else null. */
export function checkCustom(v: unknown): CustomBuddy | null {
  if (!v || typeof v !== 'object' || JSON.stringify(v).length > CUSTOM_BYTES) return null;
  const { palette, rows } = v as Record<string, unknown>;
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > CUSTOM_COLORS || !palette.every((c) => typeof c === 'string' && HEX.test(c))) return null;
  if (!Array.isArray(rows) || rows.length < CUSTOM_MIN || rows.length > CUSTOM_MAX) return null;
  const n = rows.length, digits = '0123456789abcdef'.slice(0, palette.length);
  if (!rows.every((r) => typeof r === 'string' && r.length === n && [...r].every((ch) => ch === '.' || digits.includes(ch)))) return null;
  if (!rows.some((r) => /[^.]/.test(r as string))) return null;
  return { palette: palette as string[], rows: rows as string[] };
}
