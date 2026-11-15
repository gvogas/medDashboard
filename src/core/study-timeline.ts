// The study plan card's shared shapes and window (study-today.ts plans from them). The input is
// the effective item list (data/effective.ts): your own items, and your classes' items with
// your mark (status, checklist) applied, so a class's midterm counts as your own.

import type { Item } from './types.ts';

export const TIMELINE_DAYS = 14;

/** An effective item: an Item, plus where it came from (`source`), its key, and a removal tombstone. */
export type TimelineItem = Item & { key?: string; source?: string; removed?: unknown };
export interface TimelineEntry { date: string; examKey: string; exam: string; topics: string[] }
