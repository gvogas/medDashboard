import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedToken, onOrAfter } from '../worker/calendar.js';
import { BASE, signIn, unfold } from './helpers.js';

/* 2026-09-21 is a Monday */
const course = { id: 'bio', code: 'BIO', name: 'Biology, cells; and more', archived: 0, created_at: Date.UTC(2026, 8, 1),
  meetings: JSON.stringify([{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }]) };
const item = (over) => ({ id: 'i1', type: 'exam', title: 'Midterm', course_id: 'bio', date: '2026-10-05', start: '', end: '',
  location: '', status: 'todo', weight: null, notes: '', recur: null, weekday: null, recur_until: null, ...over });
const events = (ics) => ics.split('BEGIN:VEVENT').slice(1).map((e) => e.split('END:VEVENT')[0]);

describe('the .ics file', () => {
  it('writes a valid calendar with CRLF lines no longer than 75 octets', () => {
    const ics = buildCalendar({ courses: [course], items: [item({ notes: 'x'.repeat(400) })], now: Date.UTC(2026, 8, 25) });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain('DTSTAMP:20260925T000000Z');
  });

  it('makes an untimed item an all-day event, and a timed one floating with an hour by default', () => {
    const [allDay] = events(buildCalendar({ courses: [course], items: [item()] }));
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261005\r\nDTEND;VALUE=DATE:20261006');
    expect(allDay).toContain('SUMMARY:BIO · Midterm');
    expect(allDay).toContain('CATEGORIES:Exam');
    const [timed] = events(buildCalendar({ courses: [], items: [item({ course_id: null, start: '14:00', type: 'quiz', location: 'Room 2' })] }));
    expect(timed).toContain('DTSTART:20261005T140000\r\nDTEND:20261005T150000');
    expect(timed).toContain('SUMMARY:Midterm');
    expect(timed).toContain('CATEGORIES:Quiz');
    expect(timed).toContain('LOCATION:Room 2');
  });

  it('ticks off completed items, cancels missed ones and escapes text', () => {
    const ics = unfold(buildCalendar({ courses: [course], items: [
      item({ id: 'a', status: 'graded', weight: 20, notes: 'Line one\nsee; notes, too' }),
      item({ id: 'b', type: 'lab', status: 'missed' }),
    ] }));
    const [a, b] = events(ics);
    expect(a).toContain('SUMMARY:✓ BIO · Midterm');
    expect(a).toContain('DESCRIPTION:Exam — Biology\\, cells\\; and more\\nWeight: 20%\\nLine one\\nsee\\; notes\\, too');
    expect(b).toContain('STATUS:CANCELLED');
  });

  it('lets no saved text or meeting id start a property of its own', () => {
    const sneaky = { ...course, code: 'BIO\rX-A:1', meetings: JSON.stringify([{ id: 'm\r\nX-B:1', kind: 'Lab', weekday: 1, start: '09:00', end: '10:00', room: 'R\u000bX-C:1' }]) };
    const ics = buildCalendar({ courses: [sneaky], items: [item({ title: 'T\rX-D:1', location: 'L\rX-E:1', notes: 'one\r\ntwo\rthree' })] });
    for (const line of ics.split('\r\n')) expect(line).not.toMatch(/[\x00-\x08\x0a-\x1f\x7f]/);
    expect(ics).not.toMatch(/(^|\r\n)X-[A-E]:1/);
    expect(unfold(ics)).toContain('UID:class-bio-mX-B:1@rounds');
    expect(unfold(ics)).toContain('\\none\\ntwo\\nthree');
  });

  it('repeats a weekly item from its first weekday until its end date', () => {
    const [ev] = events(buildCalendar({ courses: [], items: [item({ type: 'office', date: '2026-09-21', weekday: 3, recur: 'weekly', recur_until: '2026-12-09', start: '13:00', end: '14:00' })] }));
    expect(ev).toContain('DTSTART:20260923T130000');
    expect(ev).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261209T235959');
  });

  it('repeats each class weekly from the term start, and leaves out archived courses', () => {
    const [cls] = events(buildCalendar({ courses: [course, { ...course, id: 'old', code: 'OLD', archived: 1 }], items: [], termStart: '2026-09-02' }));
    expect(cls).toContain('UID:class-bio-m1@rounds');
    expect(cls).toContain('DTSTART:20260907T090000\r\nDTEND:20260907T103000');
    expect(cls).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(cls).toContain('SUMMARY:BIO Lecture');
    expect(cls).toContain('LOCATION:Hall B');
    expect(buildCalendar({ courses: [{ ...course, archived: 1 }], items: [] })).not.toContain('BEGIN:VEVENT');
  });

  it('uses the names of the person\'s own types and adds a time zone only when given', () => {
    const ics = buildCalendar({ courses: [], items: [item({ type: 'c-osce', course_id: null })], types: [{ id: 'c-osce', label: 'OSCE' }], tz: 'America/Toronto' });
    expect(ics).toContain('CATEGORIES:OSCE');
    expect(ics).toContain('X-WR-TIMEZONE:America/Toronto');
    expect(buildCalendar({ courses: [], items: [] })).not.toContain('X-WR-TIMEZONE');
  });

  it('finds the first weekday on or after a date', () => {
    expect(onOrAfter('2026-09-21', 1)).toBe('2026-09-21');
    expect(onOrAfter('2026-09-21', 0)).toBe('2026-09-27');
    expect(onOrAfter('2026-12-30', 5)).toBe('2027-01-01');
  });
});

describe('the feed endpoints', () => {
  it('is off until turned on, then serves the person\'s items and classes to anyone with the link', async () => {
    const api = await signIn();
    expect(await (await api('/api/calendar')).json()).toEqual({ on: false, url: null });
    await api('/api/courses/bio', { method: 'PUT', body: { code: 'BIO', name: 'Biology', color: '#17B3AE', meetings: [{ id: 'm', kind: 'Lab', weekday: 2, start: '13:00', end: '15:00', room: 'Lab 1' }] } });
    await api('/api/items/q1', { method: 'PUT', body: { type: 'quiz', title: 'Quiz 1', courseId: 'bio', date: '2026-10-01', status: 'todo' } });

    const on = await (await api('/api/calendar', { method: 'POST' })).json();
    expect(on.on).toBe(true);
    expect(on.url).toMatch(/^http:\/\/localhost\/api\/calendar\/u-user\d+\/[0-9a-f]{32}\.ics$/);
    expect(await (await api('/api/calendar')).json()).toEqual(on);

    const res = await SELF.fetch(on.url + '?tz=Europe/London');   /* no cookie: a calendar fetching it */
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const ics = unfold(await res.text());
    expect(ics).toContain('SUMMARY:BIO · Quiz 1');
    expect(ics).toContain('SUMMARY:BIO Lab');
    expect(ics).toContain('X-WR-TIMEZONE:Europe/London');
  });

  it('retires the old link on a new one, and every link when turned off', async () => {
    const api = await signIn();
    const first = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    const second = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect(second).not.toBe(first);
    expect((await SELF.fetch(first)).status).toBe(404);
    expect((await SELF.fetch(second)).status).toBe(200);
    expect((await api('/api/calendar', { method: 'DELETE' })).status).toBe(204);
    expect((await SELF.fetch(second)).status).toBe(404);
    expect(await (await api('/api/calendar')).json()).toEqual({ on: false, url: null });
  });

  it('refuses a forged or malformed token, and another person\'s id with your token', async () => {
    const api = await signIn(), other = await signIn();
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    await other('/api/calendar', { method: 'POST' });
    const [, id, token] = url.match(/calendar\/([^/]+)\/([0-9a-f]+)\.ics$/);
    const otherId = (await (await other('/api/me')).json()).id;
    for (const path of [`${id}/${'0'.repeat(32)}.ics`, `${id}/${token.slice(1)}.ics`, `${id}/NOTHEX${token.slice(6)}.ics`, `${otherId}/${token}.ics`, `nobody/${token}.ics`]) {
      expect((await SELF.fetch(`${BASE}/api/calendar/${path}`)).status, path).toBe(404);
    }
    expect(await feedToken(id, 1, env.SESSION_SECRET)).toBe(token);
  });

  it('needs a session to see, create or stop the link', async () => {
    for (const method of ['GET', 'POST', 'DELETE']) {
      expect((await SELF.fetch(`${BASE}/api/calendar`, { method })).status, method).toBe(401);
    }
  });

  it('ignores a time zone that is not one', async () => {
    const api = await signIn();
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    const ics = await (await SELF.fetch(url + '?tz=' + encodeURIComponent('Evil\r\nX-INJECT:1'))).text();
    expect(ics).not.toContain('X-WR-TIMEZONE');
    expect(ics).not.toContain('X-INJECT');
  });
});
