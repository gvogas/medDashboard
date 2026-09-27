import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { minutesByDay, streak, week, month, heatRange, level, dayOf } from '../src/legacy/js/history.js';
import { normalizePrefs, normalizeStudySession } from '../src/legacy/js/model.js';
import { studyPrefs, validateStudySession } from '../worker/validate.js';
import { upsertRow, syncPage } from '../worker/db.js';
import { createUser, signIn } from './helpers.js';

/* A session at a local day and hour, so the tests hold in any time zone. */
const at = (day, hour, minutes, courseId = 'bio', extra = {}) => {
  const [y, m, d] = day.split('-').map(Number);
  return { id: day + '-' + hour, startedAt: new Date(y, m - 1, d, hour).getTime(), studyMinutes: minutes, courseId, ...extra };
};

/* 2026-09-21 is a Monday; today is Friday the 25th */
const TODAY = '2026-09-25';
const sessions = [
  at('2026-09-14', 10, 60), at('2026-09-15', 10, 60), at('2026-09-16', 10, 60),
  at('2026-09-21', 9, 50), at('2026-09-21', 19, 45, 'chem'),
  at('2026-09-22', 10, 20),
  at('2026-09-24', 15, 100, 'chem'),
  at('2026-09-25', 8, 10),
];

describe('a week', () => {
  it('runs Monday to Sunday with a total a day, stacked by course', () => {
    const w = week(sessions, TODAY);
    expect([w.from, w.to]).toEqual(['2026-09-21', '2026-09-27']);
    expect(w.days.map((d) => d.total)).toEqual([95, 20, 0, 100, 10, 0, 0]);
    expect(w.days[0].byCourse).toEqual([['bio', 50], ['chem', 45]]);
    expect(w.total).toBe(225);
    expect(w.count).toBe(5);
    expect(w.perCourse).toEqual([['chem', 145], ['bio', 80]]);
    expect(w.sessions.map((s) => dayOf(s))).toEqual(['2026-09-25', '2026-09-24', '2026-09-22', '2026-09-21', '2026-09-21']);
  });

  it('can be any week, found from any day in it', () => {
    expect(week(sessions, '2026-09-19').total).toBe(180);
    expect(week(sessions, '2026-08-01').count).toBe(0);
  });
});

describe('a month', () => {
  it('groups by day, newest first, and finds the best day', () => {
    const m = month(sessions, 2026, 8);
    expect(m.total).toBe(405);
    expect(m.count).toBe(8);
    expect(m.daysStudied).toBe(7);
    expect(m.best).toEqual({ date: '2026-09-24', total: 100 });
    expect(m.groups.map((g) => g.date)).toEqual(['2026-09-25', '2026-09-24', '2026-09-22', '2026-09-21', '2026-09-16', '2026-09-15', '2026-09-14']);
    expect(m.groups[3]).toMatchObject({ total: 95 });
    expect(m.groups[3].sessions.map((s) => s.studyMinutes)).toEqual([45, 50]);
  });

  it('is empty for a month with nothing', () => {
    expect(month(sessions, 2026, 7)).toMatchObject({ total: 0, count: 0, best: null, groups: [] });
  });
});

describe('the streak', () => {
  const byDay = minutesByDay(sessions);

  it('counts days that reached the minimum, back from yesterday until today counts', () => {
    expect(streak(byDay, TODAY, { dayMin: 15 })).toEqual({ current: 1, longest: 3, today: false });
    expect(streak(byDay, TODAY, { dayMin: 10 })).toMatchObject({ current: 2, today: true });
  });

  it('skips rest days without breaking, and counts them when studied', () => {
    // Wednesday the 23rd was a rest day: 21, 22 and 24 join up.
    expect(streak(byDay, TODAY, { dayMin: 15, rest: [3] }).current).toBe(3);
    // With Wednesday to Sunday off, the 14th-16th and 21st-24th run together: 6 study days.
    expect(streak(byDay, TODAY, { dayMin: 15, rest: [0, 3, 4, 5, 6] }).longest).toBe(6);
  });

  it('is nothing without sessions', () => {
    expect(streak(new Map(), TODAY, { dayMin: 15 })).toEqual({ current: 0, longest: 0, today: false });
  });
});

describe('the heatmap', () => {
  it('starts on the Monday of the term start, sixteen weeks at least', () => {
    expect(heatRange('2026-09-02', TODAY)).toEqual({ from: '2026-08-31', to: '2026-12-20', weeks: 16, since: '2026-09-02' });
  });

  it('goes back twelve weeks without a term start, or with one too old or still to come', () => {
    for (const t of [null, '2025-01-05', '2026-10-01']) expect(heatRange(t, TODAY)).toMatchObject({ from: '2026-06-29', weeks: 16, since: null });
  });

  it('grows past sixteen weeks as the term goes on', () => {
    expect(heatRange('2026-08-31', '2027-01-20')).toMatchObject({ weeks: 21, to: '2027-01-24' });
  });

  it('shades by the hour, or against the goal', () => {
    expect([0, 20, 60, 120, 200].map((m) => level(m))).toEqual([0, 1, 2, 3, 4]);
    expect([30, 60, 120, 160].map((m) => level(m, 120))).toEqual([1, 2, 3, 4]);
  });
});

describe('study prefs', () => {
  it('fill in what is missing on the client', () => {
    expect(normalizePrefs(undefined)).toEqual({ goal: 0, dayMin: 15, rest: [], celebrate: true });
    expect(normalizePrefs({ goal: 125.4, dayMin: 0, rest: [6, 0, 6, 9], celebrate: false })).toEqual({ goal: 125, dayMin: 1, rest: [0, 6], celebrate: false });
  });

  it('are checked by the Worker', () => {
    expect(studyPrefs({ goal: 120, dayMin: 20, rest: [6, 0], celebrate: false })).toEqual({ goal: 120, dayMin: 20, rest: [0, 6], celebrate: false });
    expect(studyPrefs({})).toEqual({ goal: 0, dayMin: 15, rest: [], celebrate: true });
    for (const bad of [{ goal: 721 }, { goal: 1.5 }, { dayMin: 0 }, { rest: [7] }, { rest: [1, 1] }, { rest: [0, 1, 2, 3, 4, 5, 6] }, { rest: 'sun' }, { celebrate: 'yes' }]) {
      expect(() => studyPrefs(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('are saved on the profile and kept when a later save leaves them out', async () => {
    const api = await signIn();
    const body = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };
    let res = await api('/api/me', { method: 'PUT', body: { ...body, studyPrefs: { goal: 90, dayMin: 20, rest: [0], celebrate: true } } });
    expect(res.status).toBe(200);
    expect((await res.json()).studyPrefs).toEqual({ goal: 90, dayMin: 20, rest: [0], celebrate: true });
    res = await api('/api/me', { method: 'PUT', body: { ...body, theme: 'light' } });
    expect((await res.json()).studyPrefs).toEqual({ goal: 90, dayMin: 20, rest: [0], celebrate: true });
    res = await api('/api/me', { method: 'PUT', body: { ...body, studyPrefs: { goal: -1 } } });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'studyPrefs.goal' });
  });
});

describe('a session typed in by hand', () => {
  it('carries a note and says it was logged by hand', () => {
    const v = validateStudySession({ startedAt: 1000, studyMinutes: 30, note: 'Anki, 120 cards', manual: true });
    expect(v).toMatchObject({ note: 'Anki, 120 cards', manual: true });
    expect(validateStudySession({ startedAt: 1000, studyMinutes: 30 })).toMatchObject({ note: '', manual: false });
    expect(() => validateStudySession({ startedAt: 1000, studyMinutes: 30, note: 'x'.repeat(201) })).toThrow();
    expect(normalizeStudySession({ studyMinutes: 30, note: 'n', manual: 1 })).toMatchObject({ note: 'n', manual: true });
  });

  it('is stored, and synced with its note', async () => {
    const id = await createUser('hand-log');
    const saved = await upsertRow(env.DB, 'study_sessions', id, 's1', validateStudySession({ startedAt: 1000, studyMinutes: 45, note: 'Library', manual: true }));
    expect(saved).toMatchObject({ note: 'Library', manual: true, studyMinutes: 45 });
    const page = await syncPage(env.DB, id, 0);
    expect(page.changes.find((c) => c.kind === 'study_sessions').row).toMatchObject({ note: 'Library', manual: true });
    await expect(env.DB.prepare('UPDATE study_sessions SET manual = 2 WHERE user_id = ?').bind(id).run()).rejects.toThrow(/CHECK constraint failed/);
  });
});
