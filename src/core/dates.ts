// Date helpers. Dates are YYYY-MM-DD strings in the local calendar; times are HH:MM.

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function iso(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parse(s: string | null | undefined): Date {
  const p = String(s || '').split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function monday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
export function today(): string {
  return iso(new Date());
}
export function hhmm(t: string | null | undefined): string {
  return t ? String(t).replace(':', '') : '';
}
export function dur(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const x = a.split(':'), y = b.split(':');
  return Math.max(0, +y[0] * 60 + +y[1] - (+x[0] * 60 + +x[1])) / 60;
}

/** "14 Sep" */
export const dayMonth = (d: string | null | undefined): string => { const x = parse(d); return x.getDate() + ' ' + MON[x.getMonth()].slice(0, 3); };
/** "Mon 14 Sep" */
export const shortDate = (d: string | null | undefined): string => DOW[parse(d).getDay()] + ' ' + dayMonth(d);

/** "5 min ago", "3 h ago", "1 day ago", "2 days ago": whole units, so never "60 min" or "24 h". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  const d = Math.floor(s / 86400);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
