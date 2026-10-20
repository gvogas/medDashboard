// Weighted grades for a course. Pure: give it the course's items, get the numbers back.
// A weight is the share of the course grade an item carries, 0–100; a missed item
// with a weight counts as graded 0.
//
// A course may also have grade categories ("Quizzes 20%, drop the lowest 2"). An item in a
// category leaves its own weight aside: the category's weight is shared equally by the items
// that count in it, and the lowest scores are dropped. Items in no category (or in one the
// course no longer has) keep their own weights, so a course without categories reads as before.
//
// Letters and the GPA come from a grading scale each person can change, and each course's credits.

import type { Item } from './types.ts';

export const GRADABLE = ['exam', 'quiz', 'assignment', 'lab', 'project'];
const TARGETS = [50, 60, 70];

/** A grade category of a course: a share of the grade, split over its items. */
export interface GradeCategory { id: string; name: string; weight: number; drop: number }
/** The most categories a course holds, the most scores one drops (the Worker checks the same). */
export const MAX_CATEGORIES = 12;
export const MAX_DROP = 20;

/** What a grade is worked out from. */
export type Graded = Pick<Item, 'id' | 'status' | 'grade' | 'weight'> & { category?: string | null };

/** What-if scores by item id. */
export type Guesses = Record<string, number | null | undefined>;

/** How one category stands: its average so far and the items its drops leave out. */
export interface CategoryGrade { id: string; name: string; weight: number; current: number | null; items: number; dropped: string[] }

export interface CourseGrade {
  current: number | null;
  graded: number;
  total: number;
  remaining: number;
  needed(target: number): number | null;
  /** each category of the course, in its order; empty without categories */
  categories: CategoryGrade[];
  /** the ids of the items a drop leaves out */
  dropped: string[];
}

const weightOf = (it: Graded) => (typeof it.weight === 'number' && it.weight > 0 ? it.weight : 0);
const guessOf = (g: Guesses, id: string) => (typeof g[id] === 'number' && g[id] >= 0 && g[id] <= 100 ? g[id] : null);
const scoreOf = (it: Graded) => (it.status === 'missed' ? 0 : it.status === 'graded' && typeof it.grade === 'number' ? it.grade : null);
const r1 = (n: number) => Math.round(n * 10) / 10;
const live = (cats: readonly GradeCategory[] | null | undefined) => new Map((cats || []).filter((c) => c.weight > 0).map((c) => [c.id, c]));

/**
 * { current, graded, total, remaining, needed(target), categories, dropped }
 * guesses:    what-if scores by item id, counted as grades for items not graded yet (and
 *             dropped like one when they are the lowest)
 * categories: the course's grade categories; items naming one share its weight
 * current:    weighted average of graded (and guessed) items, or null when there are none
 * graded:     weight already graded; total: all weight entered (a category's in full)
 * remaining:  weight still to come, counting weight not entered yet when the total is under 100
 * needed(t):  average needed on the remaining weight to finish at t, assuming the
 *             course totals 100; null when nothing remains
 *
 * In a category of n items dropping k (at most n − 1, so one always counts), each counting
 * item is worth weight / (n − k). Only scored items are dropped, the lowest first, and one
 * scored item always stays; what the scores kept do not cover is still to come.
 */
export function courseGrade(items: Graded[], guesses: Guesses = {}, categories?: readonly GradeCategory[] | null): CourseGrade {
  let graded = 0, total = 0, points = 0;
  const cats = live(categories), members = new Map<string, Graded[]>();
  for (const it of items) {
    const cat = it.category ? cats.get(it.category) : undefined;
    if (cat) { members.set(cat.id, [...(members.get(cat.id) || []), it]); continue; }
    const w = weightOf(it);
    if (!w) continue;
    total += w;
    const s = scoreOf(it) ?? guessOf(guesses, it.id);
    if (s === null) continue;
    graded += w;
    points += s * w;
  }
  const out: CategoryGrade[] = [], dropped: string[] = [];
  for (const cat of (categories || []).filter((c) => cats.has(c.id))) {
    total += cat.weight;
    const list = members.get(cat.id) || [];
    const scored = list.map((it) => ({ id: it.id, s: scoreOf(it) ?? guessOf(guesses, it.id) }))
      .filter((x): x is { id: string; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
    const k = Math.max(0, Math.min(Math.floor(cat.drop) || 0, list.length - 1));
    const gone = scored.slice(0, Math.min(k, Math.max(0, scored.length - 1)));
    const kept = scored.slice(gone.length);
    const slot = list.length ? cat.weight / (list.length - k) : 0;
    const sum = kept.reduce((n, x) => n + x.s, 0);
    graded += kept.length * slot;
    points += sum * slot;
    dropped.push(...gone.map((x) => x.id));
    out.push({ id: cat.id, name: cat.name, weight: cat.weight, current: kept.length ? r1(sum / kept.length) : null, items: list.length, dropped: gone.map((x) => x.id) });
  }
  const remaining = total ? Math.max(total, 100) - graded : 0;
  return {
    current: graded ? r1(points / graded) : null,
    graded: r1(graded), total: r1(total), remaining: r1(remaining),
    needed(target) {
      if (r1(remaining) <= 0) return null;
      return r1((target * 100 - points) / remaining);
    },
    categories: out,
    dropped,
  };
}

/** Items with no grade yet that count: their own weight, or a category of the course. What a what-if score can be entered for. */
export function ungraded<T extends Graded>(items: T[], categories?: readonly GradeCategory[] | null): T[] {
  const cats = live(categories);
  return items.filter((it) => (weightOf(it) || (it.category && cats.has(it.category))) && scoreOf(it) === null);
}

/** What an item counts for in its course's grade: its category's name and share, or its own weight. */
export function shareOf(it: Graded, items: Graded[], categories?: readonly GradeCategory[] | null): { category: GradeCategory | null; weight: number | null } {
  const cat = it.category ? live(categories).get(it.category) : undefined;
  if (!cat) return { category: null, weight: weightOf(it) || null };
  const n = items.filter((x) => x.category === cat.id).length;
  const k = Math.max(0, Math.min(Math.floor(cat.drop) || 0, n - 1));
  return { category: cat, weight: n ? r1(cat.weight / (n - k)) : null };
}

/** The targets to show: your pass marks (50, 60 and 70 unless you set your own) and the course's own target, in order, without repeats. */
export function targetsFor(target: number | null | undefined, pass?: readonly number[] | null): number[] {
  const base = pass && pass.length ? pass : TARGETS;
  return [...new Set([...base, ...(target ? [target] : [])])].sort((a, b) => a - b);
}

/** How a needed average reads: '≥ 62%', 'secured', 'out of reach'. */
export function neededLabel(n: number | null): string {
  if (n === null) return '';
  if (n <= 0) return 'secured';
  if (n > 100) return 'out of reach';
  return '≥ ' + n + '%';
}

// ── letters and the GPA ─────────────────────────────────────────────────────

/** A step of a grading scale: a letter for a percentage at or above `min`, worth `points`. */
export interface ScaleStep { letter: string; min: number; points: number }
/** How you grade: the scale, highest first, and the pass marks the grade panel shows. */
export interface Grading { scale: ScaleStep[]; pass: number[] }

/** A common 4.0 scale. */
export const DEFAULT_SCALE: ScaleStep[] = [
  { letter: 'A', min: 93, points: 4 }, { letter: 'A-', min: 90, points: 3.7 },
  { letter: 'B+', min: 87, points: 3.3 }, { letter: 'B', min: 83, points: 3 }, { letter: 'B-', min: 80, points: 2.7 },
  { letter: 'C+', min: 77, points: 2.3 }, { letter: 'C', min: 73, points: 2 }, { letter: 'C-', min: 70, points: 1.7 },
  { letter: 'D+', min: 67, points: 1.3 }, { letter: 'D', min: 63, points: 1 }, { letter: 'D-', min: 60, points: 0.7 },
  { letter: 'F', min: 0, points: 0 },
];
/** The credits a course counts for when none are set. */
export const DEFAULT_CREDITS = 3;
/** The most steps a scale holds and the most pass marks (the Worker checks the same). */
export const MAX_STEPS = 20;
export const MAX_PASS = 5;

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Grading as stored (users.grading), made whole: the default scale and pass marks fill what is missing or unreadable. */
export function normalizeGrading(raw: unknown): Grading {
  const g = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const steps = Array.isArray(g.scale)
    ? g.scale.flatMap((s): ScaleStep[] => {
        const o = s && typeof s === 'object' ? s as Record<string, unknown> : {};
        const letter = typeof o.letter === 'string' ? o.letter.trim().slice(0, 4) : '';
        const min = num(o.min, 0, 100), points = num(o.points, 0, 10);
        return letter && min !== null && points !== null ? [{ letter, min, points }] : [];
      }).slice(0, MAX_STEPS)
    : [];
  const pass = Array.isArray(g.pass) ? [...new Set(g.pass.filter((p): p is number => num(p, 1, 100) !== null).map(Math.round))].sort((a, b) => a - b).slice(0, MAX_PASS) : [];
  return {
    scale: steps.length ? [...steps].sort((a, b) => b.min - a.min) : DEFAULT_SCALE,
    pass: pass.length ? pass : TARGETS,
  };
}

/** The scale's step for a percentage: the highest one it reaches, or null when it is under them all. */
export function letterFor(percent: number | null | undefined, scale: readonly ScaleStep[] = DEFAULT_SCALE): ScaleStep | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  return [...scale].sort((a, b) => b.min - a.min).find((s) => percent >= s.min) ?? null;
}

/** A course as a GPA reads it: its credits (null for the default) and its grade so far. */
export interface GpaRow { credits: number | null | undefined; percent: number | null }

/**
 * The credit-weighted GPA of courses with a grade so far: {gpa, credits, courses}, the GPA
 * to two places, or null when none has a grade. A course with 0 credits counts for nothing.
 */
export function gpa(rows: readonly GpaRow[], scale: readonly ScaleStep[] = DEFAULT_SCALE): { gpa: number; credits: number; courses: number } | null {
  let credits = 0, sum = 0, courses = 0;
  for (const r of rows) {
    const step = letterFor(r.percent, scale);
    if (!step) continue;
    const c = typeof r.credits === 'number' && r.credits >= 0 ? r.credits : DEFAULT_CREDITS;
    courses++;
    credits += c;
    sum += step.points * c;
  }
  return courses && credits ? { gpa: Math.round((sum / credits) * 100) / 100, credits: r1(credits), courses } : null;
}
