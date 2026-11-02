import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedToken, onOrAfter } from '../worker/calendar.js';
import { BASE, login, signIn, unfold } from './helpers.js';
import { signInAdmin } from './spaces.js';

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

  it("ends a class's weekly rule on its last day, and leaves out one that ended before it began", () => {
    const meet = (until) => ({ ...course, meetings: JSON.stringify([{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: '', until }]) });
    const [cls] = events(buildCalendar({ courses: [meet('2026-11-16')], items: [], termStart: '2026-09-02' }));
    expect(cls).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T235959');
    expect(buildCalendar({ courses: [meet('2026-09-01')], items: [], termStart: '2026-09-02' })).not.toContain('BEGIN:VEVENT');
    expect(events(buildCalendar({ courses: [meet('')], items: [], termStart: '2026-09-02' }))[0]).not.toContain('UNTIL');
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

describe('reminders in the feed', () => {
  const alarmsOf = (ev) => [...ev.matchAll(/BEGIN:VALARM\r\n([\s\S]*?)END:VALARM/g)].map((m) => m[1]);
  const now = Date.UTC(2026, 9, 1);

  it('reminds a day and an hour before a timed exam, and at 09:00 the day before an all-day one', () => {
    const [timed, allDay] = events(buildCalendar({ courses: [course], items: [item({ start: '09:00' }), item({ id: 'i2', type: 'assignment', title: 'Essay' })], now, alarms: true }));
    expect(alarmsOf(timed).map((a) => a.match(/TRIGGER:(\S+)/)[1])).toEqual(['-P1D', '-PT1H']);
    expect(alarmsOf(timed)[0]).toContain('ACTION:DISPLAY\r\nDESCRIPTION:Exam: BIO · Midterm');
    expect(alarmsOf(allDay).map((a) => a.match(/TRIGGER:(\S+)/)[1])).toEqual(['-PT15H']);
  });

  it('leaves out what is done, missed, past, weekly or not a deadline, and everything when off', () => {
    const items = [item({ status: 'graded' }), item({ id: 'b', status: 'missed' }), item({ id: 'c', date: '2026-09-20' }),
      item({ id: 'd', type: 'office', recur: 'weekly', weekday: 1 }), item({ id: 'e', type: 'task' }), item({ id: 'f', type: 'tutoring' })];
    expect(buildCalendar({ courses: [course], items, now, alarms: true })).not.toContain('VALARM');
    expect(buildCalendar({ courses: [course], items: [item()], now })).not.toContain('VALARM');
    const team = events(buildCalendar({ courses: [], items: [item({ type: 'project', course_id: null, title: 'Team · Poster' })], now, alarms: true }))[0];
    expect(alarmsOf(team)).toHaveLength(1);
  });

  it('keeps every line valid and short with a long title', () => {
    const ics = buildCalendar({ courses: [course], items: [item({ title: 'Ω'.repeat(80) + ', with; text' })], now, alarms: true });
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain('\\, with\\; text');
  });

  it('are on by default in the served feed and follow the study prefs', async () => {
    const api = await signIn();
    const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await api('/api/items/x1', { method: 'PUT', body: { type: 'exam', title: 'Final', date: day, status: 'todo' } });
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect(await (await SELF.fetch(url)).text()).toContain('BEGIN:VALARM');
    const me = await (await api('/api/me')).json();
    const res = await api('/api/me', { method: 'PUT', body: { coat: me.coat, theme: me.theme, termStart: null, displayName: '', studyPrefs: { ...me.studyPrefs, alarms: false } } });
    expect(res.status).toBe(200);
    expect(await (await SELF.fetch(url)).text()).not.toContain('VALARM');
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
    expect(on.url).toMatch(/^http:\/\/localhost\/api\/calendar\.ics\?u=u-user\d+&t=[0-9a-f]{32}$/);
    expect(await (await api('/api/calendar')).json()).toEqual(on);

    const res = await SELF.fetch(on.url + '&tz=Europe/London');   /* no cookie: a calendar fetching it */
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

  it('keeps every retired link dead when the feed is turned off and on again', async () => {
    const api = await signIn();
    const first = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    const second = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect((await api('/api/calendar', { method: 'DELETE' })).status).toBe(204);
    const third = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect((await SELF.fetch(first)).status).toBe(404);
    expect((await SELF.fetch(second)).status).toBe(404);
    expect((await SELF.fetch(third)).status).toBe(200);
  });

  it('kills the link on sign-out everywhere', async () => {
    const api = await signIn();
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect((await SELF.fetch(url)).status).toBe(200);
    expect((await api('/api/session/revoke-all', { method: 'POST' })).status).toBe(204);
    expect((await SELF.fetch(url)).status).toBe(404);
  });

  it('kills the link when an admin resets the password, or revokes the sessions', async () => {
    const api = await signIn('feed-reset');
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    expect((await SELF.fetch(url)).status).toBe(200);
    const admin = await signInAdmin('feed-boss');
    expect((await admin('/api/admin/accounts/u-feed-reset/password', { method: 'POST', body: { password: 'brand new pw' } })).status).toBe(204);
    expect((await SELF.fetch(url)).status).toBe(404);
    const relogin = await login('feed-reset', 'brand new pw');
    expect(relogin.status).toBe(200);
    const cookie = relogin.headers.get('set-cookie').split(';')[0];
    const fresh = await (await SELF.fetch(`${BASE}/api/calendar`, { method: 'POST', headers: { cookie } })).json();
    expect((await SELF.fetch(fresh.url)).status).toBe(200);
    expect((await admin('/api/admin/accounts/u-feed-reset/revoke', { method: 'POST' })).status).toBe(204);
    expect((await SELF.fetch(fresh.url)).status).toBe(404);
  });

  it('refuses a forged or malformed token, and another person\'s id with your token', async () => {
    const api = await signIn(), other = await signIn();
    const url = (await (await api('/api/calendar', { method: 'POST' })).json()).url;
    await other('/api/calendar', { method: 'POST' });
  const [, id, token] = url.match(/\?u=([^&]+)&t=([0-9a-f]+)$/);
  const otherId = (await (await other('/api/me')).json()).id;
  for (const q of [`u=${id}&t=${'0'.repeat(32)}`, `u=${id}&t=${token.slice(1)}`, `u=${id}&t=NOTHEX${token.slice(6)}`, `u=${otherId}&t=${token}`, `u=nobody&t=${token}`, `t=${token}`]) {
    expect((await SELF.fetch(`${BASE}/api/calendar.ics?${q}`)).status, q).toBe(404);
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
    const ics = await (await SELF.fetch(url + '&tz=' + encodeURIComponent('Evil\r\nX-INJECT:1'))).text();
    expect(ics).not.toContain('X-WR-TIMEZONE');
    expect(ics).not.toContain('X-INJECT');
  });
});

describe('flashcards in the feed (Study Buddy, Stage 3)', () => {
  it('adds an all-day "Flashcards: N due" for each day cards fall due, worded apart from lecture reviews', () => {
    const ics = buildCalendar({ courses: [], items: [], flashcards: [{ day: '2026-11-02', n: 12 }, { day: '2026-11-04', n: 3 }] });
    const ev = events(ics);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toContain('DTSTART;VALUE=DATE:20261102');
    expect(ev[0]).toContain('SUMMARY:Flashcards: 12 due');
    expect(ev[1]).toContain('SUMMARY:Flashcards: 3 due');
    expect(ics).not.toContain('Review 1/4');
  });

  it('counts the next 7 days from card_state, only with "Review cards in my calendar" on', async () => {
    const { flashcardDays } = await import('../worker/calendar.js');
    const api = await signIn('cal-cards');
    const put = (id, due) => api(`/api/card_state/${id}`, { method: 'PUT', body: { due, interval: 1, ease: 2.5, reps: 1, lapses: 0 } });
    const now = Date.UTC(2026, 10, 2, 12), d = (n) => new Date(now + n * 86_400_000).toISOString().slice(0, 10);
    await put('k1', '2026-10-01'); await put('k2', d(0)); await put('k3', d(2)); await put('k4', d(2)); await put('k5', d(9));
    expect(await flashcardDays(env.DB, 'u-cal-cards', now)).toEqual([]);
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC', cardsInFeed: true } });
    expect(await flashcardDays(env.DB, 'u-cal-cards', now)).toEqual([{ day: d(0), n: 2 }, { day: d(2), n: 2 }]);
    const b = await (await api('/api/buddy')).json();
    expect(b.cardsInFeed).toBe(true);
    expect((await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, cardsInFeed: 'yes' } })).status).toBe(400);
  });
});
