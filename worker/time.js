// Lengths of time in milliseconds, for the whole worker.
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A time zone name as the browser reports it (the shape only; localNow checks it exists). */
export const TZ = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** The date `n` days after the YYYY-MM-DD date `d` (before, when n is negative). */
export function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
