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
export const HEALTH = { missed: -10, idle: -5, idleFrom: 4, perTenMinutes: 1 } as const;
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

/* Which buddy: 'auto' follows the profile's theme; 'custom' arrives in Stage 2. */
export const BUDDY_IDS: readonly string[] = ['med', 'cs', 'law', 'pilot', 'sports', 'eng'];
export const LOOK_BUDDIES: readonly string[] = ['auto', ...BUDDY_IDS];
