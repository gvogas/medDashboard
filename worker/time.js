// Lengths of time in milliseconds, for the whole worker.
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A time zone name as the browser reports it (the shape only; localNow checks it exists). */
export const TZ = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** Whether `v` is a day that exists, written YYYY-MM-DD: the shape alone lets 2026-13-45 through. */
export function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = new Date(v + 'T00:00:00.000Z');
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === v;
}

/** The date `n` days after the YYYY-MM-DD date `d` (before, when n is negative). */
export function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
