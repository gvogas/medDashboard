// A small iCalendar reader: enough of RFC 5545 for a university timetable export.
// parseIcs(text) → [{ summary, location, date, start, end, weekly, weekdays }]
// Dates are YYYY-MM-DD in the local calendar and times HH:MM, like the rest of the app.

import { iso } from '../dates.js';

const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const pad = (n) => String(n).padStart(2, '0');

/** Join folded lines: a line break followed by a space or tab continues the line. */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** "DTSTART;TZID=Europe/London:20260914T090000" → { name, params, value } */
function property(line) {
  let quoted = false, colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const [name, ...rest] = line.slice(0, colon).split(';');
  const params = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescape(s) {
  return s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).trim();
}

/** A DATE or DATE-TIME value → { date, time }. UTC ('Z') moves to local; TZID and floating stay as written. */
function when(prop) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || prop.params.VALUE === 'DATE') return { date: m[1] + '-' + m[2] + '-' + m[3], time: '' };
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return { date: iso(d), time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  }
  return { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] + ':' + m[5] };
}

export function parseIcs(text) {
  const out = [];
  let ev = null, inner = 0;   /* inner: depth inside an event's own parts, like a VALARM */
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT$/i.test(line)) { ev = {}; inner = 0; continue; }
    if (/^END:VEVENT$/i.test(line)) {
      if (ev && ev.start && !ev.cancelled) out.push(finish(ev));
      ev = null; continue;
    }
    if (!ev) continue;
    /* an alarm has a SUMMARY of its own ("Alarm notification" from Google): not the event's */
    if (/^BEGIN:/i.test(line)) { inner++; continue; }
    if (/^END:/i.test(line)) { inner = Math.max(0, inner - 1); continue; }
    if (inner) continue;
    const p = property(line);
    if (!p) continue;
    if (p.name === 'SUMMARY') ev.summary = unescape(p.value);
    else if (p.name === 'LOCATION') ev.location = unescape(p.value);
    else if (p.name === 'DTSTART') ev.start = when(p);
    else if (p.name === 'DTEND') ev.end = when(p);
    else if (p.name === 'RRULE') ev.rrule = p.value;
    else if (p.name === 'STATUS' && /^CANCELLED$/i.test(p.value.trim())) ev.cancelled = true;
  }
  return out;
}

function finish(ev) {
  const rule = {};
  for (const part of (ev.rrule || '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) rule[k.toUpperCase()] = v.toUpperCase();
  }
  const weekly = rule.FREQ === 'WEEKLY' && !!ev.start.time;
  const weekdays = weekly && rule.BYDAY
    ? rule.BYDAY.split(',').map((d) => DAY[d.replace(/^[+-]?\d+/, '')]).filter((d) => d !== undefined)
    : [];
  const [y, mo, d] = ev.start.date.split('-').map(Number);
  return {
    summary: ev.summary || '',
    location: ev.location || '',
    date: ev.start.date,
    start: ev.start.time,
    end: ev.end && ev.end.date === ev.start.date ? ev.end.time : '',
    weekly,
    weekdays: weekly ? (weekdays.length ? weekdays : [new Date(y, mo - 1, d).getDay()]) : [],
  };
}
