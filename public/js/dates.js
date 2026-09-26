// Date helpers. Dates are YYYY-MM-DD strings in the local calendar; times are HH:MM.

export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function parse(s) {
  const p = String(s || '').split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export function monday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}
export function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
export function today() {
  return iso(new Date());
}
export function hhmm(t) {
  return t ? String(t).replace(':', '') : '';
}
export function dur(a, b) {
  if (!a || !b) return 0;
  const x = a.split(':'), y = b.split(':');
  return Math.max(0, y[0] * 60 + +y[1] - (x[0] * 60 + +x[1])) / 60;
}

/** "14 Sep" */
export const dayMonth = (d) => { const x = parse(d); return x.getDate() + ' ' + MON[x.getMonth()].slice(0, 3); };
/** "Mon 14 Sep" */
export const shortDate = (d) => DOW[parse(d).getDay()] + ' ' + dayMonth(d);
