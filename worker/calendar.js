// The calendar feed: a private .ics link that Google or Apple Calendar subscribes to.
//
// The link is /api/calendar/<userId>/<token>.ics, where the token is an HMAC of the
// user id and users.feed_gen under a key derived from SESSION_SECRET. Nothing secret
// is stored: turning the feed off clears feed_gen, and a new link bumps it, so every
// earlier link stops working. Rotating SESSION_SECRET retires every link too.
//
// Times are floating (no zone): a class at 09:00 is 09:00 wherever the calendar is.
// A `tz` query parameter, added by the app from the browser's zone, becomes
// X-WR-TIMEZONE, which Google uses to place floating times.
//
// With a school calendar, classes repeat only within each semester, skip the days with
// no classes (EXDATE), and run on the days that follow their weekday's timetable.

import { HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { sameString, hex } from './auth.js';
import { normalizeSchool, classWeekday, courseTerm, dayInfo, weekdayOf } from '../src/core/school.ts';

const FEED_LIMIT = 60;                     /* fetches an hour per link; calendars poll a few times a day */
const HOUR_MS = 60 * 60 * 1000;
const LABELS = { exam: 'Exam', quiz: 'Quiz', assignment: 'Assignment', lab: 'Lab', tutoring: 'Tutorial', office: 'Office hours', task: 'Task', project: 'Project' };
const COMPLETE = { done: 1, graded: 1, submitted: 1 };
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const TZ = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;

let cachedKey = null;
async function feedKey(secret) {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey('raw', new TextEncoder().encode('rounds calendar feed\n' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    cachedKey = { secret, key };
    key.catch(() => { if (cachedKey?.key === key) cachedKey = null; });
  }
  return cachedKey.key;
}

/** 32 hex characters: the first 128 bits of the HMAC of `userId:gen`. */
export async function feedToken(userId, gen, secret) {
  const sig = await crypto.subtle.sign('HMAC', await feedKey(secret), new TextEncoder().encode(`${userId}:${gen}`));
  return hex(sig.slice(0, 16));
}

async function feedUrl(origin, userId, gen, secret) {
  return `${origin}/api/calendar/${encodeURIComponent(userId)}/${await feedToken(userId, gen, secret)}.ics`;
}

/** The feed's state for the signed-in user: { on, url }. */
export async function feedState(env, origin, userId) {
  const row = await env.DB.prepare('SELECT feed_gen FROM users WHERE id = ?').bind(userId).first();
  const gen = row?.feed_gen;
  return gen ? { on: true, url: await feedUrl(origin, userId, gen, env.SESSION_SECRET) } : { on: false, url: null };
}

/** Turn the feed on, or give it a new link: the old one stops working. */
export async function renewFeed(env, origin, userId) {
  const row = await env.DB.prepare('UPDATE users SET feed_gen = COALESCE(feed_gen, 0) + 1 WHERE id = ? RETURNING feed_gen').bind(userId).first();
  if (!row) throw new HttpError(401, { error: 'unauthenticated' });
  return { on: true, url: await feedUrl(origin, userId, row.feed_gen, env.SESSION_SECRET) };
}

export async function stopFeed(env, userId) {
  await env.DB.prepare('UPDATE users SET feed_gen = NULL WHERE id = ?').bind(userId).run();
}

/** The public fetch. Any mismatch is a plain 404, so a link reveals nothing about others. */
export async function serveFeed(env, url, userId, token) {
  const gone = () => new HttpError(404, { error: 'not_found' });
  if (!/^[0-9a-f]{32}$/.test(token)) throw gone();
  const user = await env.DB.prepare('SELECT feed_gen, term_start, types, school_calendar FROM users WHERE id = ?').bind(userId).first();
  if (!user?.feed_gen || !sameString(await feedToken(userId, user.feed_gen, env.SESSION_SECRET), token)) throw gone();
  const wait = await claimLimit(env.DB, `feed:${userId}`, FEED_LIMIT, Date.now(), HOUR_MS);
  if (wait) throw rateLimited(wait);

  const [courses, items] = await env.DB.batch([
    env.DB.prepare('SELECT id, code, name, term, archived, meetings, created_at FROM courses WHERE user_id = ? AND deleted_at IS NULL').bind(userId),
    env.DB.prepare('SELECT id, type, title, course_id, date, start, end, location, status, weight, notes, recur, weekday, recur_until FROM items WHERE user_id = ? AND deleted_at IS NULL ORDER BY date').bind(userId),
  ]);
  const tz = url.searchParams.get('tz');
  const body = buildCalendar({
    courses: courses.results, items: items.results, termStart: user.term_start, school: parseSchool(user.school_calendar),
    types: parseList(user.types), tz: tz && TZ.test(tz) && tz.length <= 64 ? tz : null, now: Date.now(),
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="term.ics"',
    },
  });
}

function parseSchool(v) {
  try { return normalizeSchool(JSON.parse(v)); } catch { return null; }
}

function parseList(v) {
  try { const out = JSON.parse(v); return Array.isArray(out) ? out : []; } catch { return []; }
}

// ── building the file ────────────────────────────────────────────────────────

/** The calendar as text, CRLF lines folded at 75 octets. Pure, for tests. */
export function buildCalendar({ courses, items, termStart = null, school = null, types = [], tz = null, now = Date.now() }) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const byId = new Map(courses.map((c) => [c.id, c]));
  const labelOf = (t) => types.find((x) => x && x.id === t)?.label || LABELS[t] || 'Item';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rounds//Calendar feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Term', 'X-WR-CALDESC:Deadlines\\, exams and classes from Term',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  if (tz) lines.push('X-WR-TIMEZONE:' + tz);

  for (const it of items) {
    const c = byId.get(it.course_id);
    const label = labelOf(it.type);
    const weekly = it.recur === 'weekly' && Number.isInteger(it.weekday);
    const first = weekly ? onOrAfter(it.date, it.weekday) : it.date;
    if (weekly && it.recur_until && first > it.recur_until) continue;
    const ev = ['BEGIN:VEVENT', 'UID:item-' + it.id + '@rounds', 'DTSTAMP:' + stamp,
      ...when(first, it.start, it.end),
      'SUMMARY:' + text((COMPLETE[it.status] ? '✓ ' : '') + (c ? c.code + ' · ' : '') + it.title),
      'CATEGORIES:' + text(label)];
    if (weekly) ev.push('RRULE:FREQ=WEEKLY;BYDAY=' + DAYS[it.weekday] + (it.recur_until ? ';UNTIL=' + compact(it.recur_until) + (it.start ? 'T235959' : '') : ''));
    if (it.location) ev.push('LOCATION:' + text(it.location));
    if (it.status === 'missed') ev.push('STATUS:CANCELLED');
    const about = [label + (c ? ' — ' + c.name : ''), typeof it.weight === 'number' && it.weight > 0 ? 'Weight: ' + it.weight + '%' : '', it.notes || '']
      .filter(Boolean).join('\n');
    ev.push('DESCRIPTION:' + text(about.slice(0, 1500)), 'END:VEVENT');
    lines.push(...ev);
  }

  for (const c of courses) {
    if (c.archived) continue;
    const from = termStart || new Date(c.created_at || now).toISOString().slice(0, 10);
    for (const m of parseList(c.meetings)) {
      if (!m || !Number.isInteger(m.weekday) || !/^\d\d:\d\d$/.test(m.start || '') || !/^\d\d:\d\d$/.test(m.end || '')) continue;
      if (school) { lines.push(...schoolClasses(c, m, school, stamp)); continue; }
      const day = onOrAfter(from, m.weekday);
      lines.push('BEGIN:VEVENT', 'UID:class-' + c.id + '-' + bare(m.id) + '@rounds', 'DTSTAMP:' + stamp,
        ...when(day, m.start, m.end),
        'RRULE:FREQ=WEEKLY;BYDAY=' + DAYS[m.weekday],
        'SUMMARY:' + text(c.code + ' ' + (m.kind || 'Class')),
        'CATEGORIES:Class');
      if (m.room) lines.push('LOCATION:' + text(m.room));
      lines.push('DESCRIPTION:' + text(c.name), 'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* One class meeting through each semester (only its own, for a course set to one): weekly
   from the first day of classes to the last, minus the days its weekday has no classes,
   plus the days that follow its weekday. */
function schoolClasses(c, m, school, stamp) {
  const out = [];
  const event = (uid, day, extra) => {
    out.push('BEGIN:VEVENT', 'UID:' + uid + '@rounds', 'DTSTAMP:' + stamp, ...when(day, m.start, m.end), ...extra,
      'SUMMARY:' + text(c.code + ' ' + (m.kind || 'Class')), 'CATEGORIES:Class');
    if (m.room) out.push('LOCATION:' + text(m.room));
    out.push('DESCRIPTION:' + text(c.name), 'END:VEVENT');
  };
  const at = (d) => compact(d) + 'T' + m.start.replace(':', '') + '00';
  const only = courseTerm(school, c.term);
  for (const term of school.terms) {
    if (only && term !== only) continue;
    const first = onOrAfter(term.start, m.weekday), id = 'class-' + c.id + '-' + bare(m.id) + '-' + term.start;
    if (first <= term.end) {
      const skip = [];
      for (let d = first; d <= term.end; d = addDays(d, 7)) if (classWeekday(school, d) !== m.weekday) skip.push(d);
      event(id, first, ['RRULE:FREQ=WEEKLY;BYDAY=' + DAYS[m.weekday] + ';UNTIL=' + compact(term.end) + 'T235959',
        ...(skip.length ? ['EXDATE:' + skip.map(at).join(',')] : [])]);
    }
    for (const d of school.days) {
      if (d.kind !== 'swap' || d.follows !== m.weekday) continue;
      for (let day = d.from; day <= d.to; day = addDays(day, 1)) {
        if (weekdayOf(day) !== m.weekday && dayInfo(school, day).kind === 'swap' && day >= term.start && day <= term.end) event(id + '-' + day, day, []);
      }
    }
  }
  return out;
}

/** DTSTART/DTEND: timed and floating, or a whole day. A timed item with no end lasts an hour. */
function when(day, start, end) {
  if (!start) return ['DTSTART;VALUE=DATE:' + compact(day), 'DTEND;VALUE=DATE:' + compact(addDays(day, 1))];
  const stop = end && end > start ? end : plusHour(start);
  return ['DTSTART:' + compact(day) + 'T' + start.replace(':', '') + '00', 'DTEND:' + compact(day) + 'T' + stop.replace(':', '') + '00'];
}

function plusHour(t) {
  const m = Math.min(23 * 60 + 59, +t.slice(0, 2) * 60 + +t.slice(3, 5) + 60);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

const compact = (d) => d.replace(/-/g, '');

function addDays(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The first date on or after `d` that falls on `weekday` (0 = Sunday). */
export function onOrAfter(d, weekday) {
  const day = new Date(d + 'T00:00:00Z').getUTCDay();
  return addDays(d, (weekday - day + 7) % 7);
}

/** RFC 5545 TEXT: backslash, semicolon, comma and line breaks escaped; other controls dropped. */
function text(s) {
  return bare(String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n'));
}

/* Without control characters: a lone CR ends a line in some readers, so saved text could start a property of its own. */
const bare = (s) => String(s).replace(/[\x00-\x08\x0a-\x1f\x7f]/g, '');

/** Lines longer than 75 octets continue on the next line after a space. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  let out = '', width = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (width + n > 75) { out += '\r\n '; width = 1; }
    out += ch; width += n;
  }
  return out;
}
