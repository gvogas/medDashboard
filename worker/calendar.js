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
//
// Your classes and your team projects come too, with your own layer on top (spec §9): see feedRows.

import { HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { sameString, hex } from './auth.js';
import { personal } from './db.js';
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

/* Your live projects (?1 = you): their own item and their live tasks assigned to you or to everyone,
   with your mark and your prefs. Others' tasks stay in D1; feedRows checks again. */
export const PROJECT_ROWS = `SELECT s.id AS sid, (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') AS project,
    i.id, i.type, i.title, i.course_id, i.date, i.start, i.end, i.location, i.status, i.weight, i.notes, i.recur, i.weekday, i.recur_until, i.assignees,
    COALESCE(p.archived, 0) AS my_archived, k.notes AS m_notes, k.hidden AS m_hidden
  FROM spaces AS s JOIN members AS m ON m.space_id = s.id AND m.user_id = ?1 AND m.deleted_at IS NULL
    JOIN items AS i ON i.scope = 'p:' || s.id AND i.deleted_at IS NULL
      AND (i.type = 'project' OR EXISTS (SELECT 1 FROM json_each(i.assignees) AS a WHERE a.value IN (?1, '*')))
    LEFT JOIN marks AS k ON k.user_id = ?1 AND k.space_id = s.id AND k.item_id = i.id AND k.deleted_at IS NULL
    LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = s.id AND p.deleted_at IS NULL
  WHERE s.kind = 'project' AND s.deleted_at IS NULL`;

/** The public fetch. Any mismatch is a plain 404, so a link reveals nothing about others. */
export async function serveFeed(env, url, userId, token) {
  const gone = () => new HttpError(404, { error: 'not_found' });
  if (!/^[0-9a-f]{32}$/.test(token)) throw gone();
  const user = await env.DB.prepare('SELECT feed_gen, term_start, types, school_calendar, hidden_sources FROM users WHERE id = ?').bind(userId).first();
  if (!user?.feed_gen || !sameString(await feedToken(userId, user.feed_gen, env.SESSION_SECRET), token)) throw gone();
  const wait = await claimLimit(env.DB, `feed:${userId}`, FEED_LIMIT, Date.now(), HOUR_MS);
  if (wait) throw rateLimited(wait);

  const me = personal(userId);
  /* your live classes, read with your membership in the statement (spec §5); a removed class item is a tombstone, left out */
  const IN = 'JOIN members AS m ON m.space_id = s.id AND m.user_id = ?1 AND m.deleted_at IS NULL';
  const [courses, items, classCourses, classItems, projectItems] = await env.DB.batch([
    env.DB.prepare('SELECT id, code, name, term, archived, meetings, created_at FROM courses WHERE scope = ? AND deleted_at IS NULL').bind(me),
    env.DB.prepare('SELECT id, type, title, course_id, class_id, date, start, end, location, status, weight, notes, recur, weekday, recur_until FROM items WHERE scope = ? AND deleted_at IS NULL').bind(me),
    env.DB.prepare(`SELECT s.id AS sid, c.id, c.code, c.name, c.term, c.archived, c.meetings, c.created_at, p.term AS my_term, p.archived AS my_archived
      FROM spaces AS s ${IN} JOIN courses AS c ON c.scope = 'c:' || s.id AND c.deleted_at IS NULL
        LEFT JOIN space_prefs AS p ON p.user_id = ?1 AND p.id = s.id AND p.deleted_at IS NULL
      WHERE s.kind = 'class' AND s.deleted_at IS NULL`).bind(userId),
    env.DB.prepare(`SELECT s.id AS sid, i.id, i.type, i.title, i.course_id, i.date, i.start, i.end, i.location, i.status, i.weight, i.notes, i.recur, i.weekday, i.recur_until,
        k.status AS m_status, k.weight AS m_weight, k.notes AS m_notes, k.hidden AS m_hidden
      FROM spaces AS s ${IN} JOIN items AS i ON i.scope = 'c:' || s.id AND i.deleted_at IS NULL
        LEFT JOIN marks AS k ON k.user_id = ?1 AND k.space_id = s.id AND k.item_id = i.id AND k.deleted_at IS NULL
      WHERE s.kind = 'class' AND s.deleted_at IS NULL`).bind(userId),
    env.DB.prepare(PROJECT_ROWS).bind(userId),
  ]);
  const tz = url.searchParams.get('tz');
  const rows = feedRows({ courses: courses.results, items: items.results, classCourses: classCourses.results, classItems: classItems.results,
    projectItems: projectItems.results, me: userId, hidden: parseList(user.hidden_sources) });
  const body = buildCalendar({
    ...rows, termStart: user.term_start, school: parseSchool(user.school_calendar),
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

/* A task's assignees (JSON) include you or everyone. */
const mineOrAll = (json, me) => {
  try { const a = JSON.parse(json); return Array.isArray(a) && (a.includes(me) || a.includes('*')); } catch { return false; }
};

/**
 * The feed's rows (spec §9): your courses and items, and each class you are in with your layer
 * on top, in buildCalendar's shape. A class's ids become '<space>-<id>', so its UIDs read
 * item-<space>-<id> and class-<space>-<course>-<meeting> and never meet yours. Its course takes
 * your semester; a class you archived in your sidebar is left out whole. Its items take your
 * status and weight, your notes before the class's, and are left out when you hid them. Your
 * items filed under a class show under its course; one whose class you left stays, without a
 * course. Hidden sources (course:<id>, space:<sid>, personal) are left out, as in the Week.
 * Each project you are in: its own item as 'Team · <project>', and its tasks assigned to you
 * or to everyone as '<project> · <task>', ids '<space>-<id>', your notes first; left out when
 * you hid the row, hid the project (space:<sid>) or archived it in your sidebar. The feed does
 * not fold a project into its assignment (Stage 10 plan, Decision 2).
 * Pure, for tests.
 */
export function feedRows({ courses, items, classCourses = [], classItems = [], projectItems = [], me = '', hidden = [] }) {
  const off = new Set(hidden);
  const shown = classCourses.filter((c) => c.my_archived !== 1 && !off.has('space:' + c.sid));
  const inFeed = new Set(shown.map((c) => c.sid));
  const courseOf = new Map(shown.map((c) => [c.sid, c.sid + '-' + c.id]));
  const source = (it) => (it.class_id ? 'space:' + it.class_id : it.course_id ? 'course:' + it.course_id : 'personal');
  return {
    courses: [
      ...courses.filter((c) => !off.has('course:' + c.id)),
      ...shown.map((c) => ({ ...c, id: c.sid + '-' + c.id, term: c.my_term ?? c.term, archived: 0 })),
    ],
    items: [
      ...items.filter((it) => !off.has(source(it)) && (!it.class_id || inFeed.has(it.class_id) || !classCourses.some((c) => c.sid === it.class_id)))
        .map((it) => (it.class_id ? { ...it, course_id: courseOf.get(it.class_id) ?? null } : it)),
      ...classItems.filter((it) => inFeed.has(it.sid) && it.m_hidden !== 1).map((it) => ({
        ...it, id: it.sid + '-' + it.id, course_id: it.course_id ? it.sid + '-' + it.course_id : null,
        status: it.m_status ?? 'todo', weight: it.m_weight ?? it.weight,
        notes: [it.m_notes, it.notes].filter(Boolean).join('\n\n'),
      })),
      ...projectItems.filter((it) => it.my_archived !== 1 && !off.has('space:' + it.sid) && it.m_hidden !== 1
          && (it.type === 'project' || mineOrAll(it.assignees, me)))
        .map((it) => ({
          ...it, id: it.sid + '-' + it.id, course_id: null,
          title: it.type === 'project' ? 'Team · ' + (it.project ?? 'Team project') : (it.project ?? 'Team project') + ' · ' + it.title,
          notes: [it.m_notes, it.notes].filter(Boolean).join('\n\n'),
        })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

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
