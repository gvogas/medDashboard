import { env, SELF, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../worker/index.js';
import { signIn } from './helpers.js';

const payload = () => ({
  profile: { coat: { name: 'G. Vogas', role: 'MS II · Cardio block', color: '#17B3AE' }, theme: 'dark', termStart: null, displayName: '' },
  courses: [
    { id: 'cvs', code: 'CVS', name: 'Cardiovascular Block', color: '#E4749B', instructor: 'Dr. Alvarez', term: '', archived: false,
      meetings: [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '08:00', end: '10:00', room: 'Hall A' }] },
  ],
  items: [
    { id: 'i1', type: 'exam', title: 'CVS Exam I', courseId: 'cvs', date: '2026-10-03', start: '09:00', end: '11:30', where: 'Hall A',
      status: 'todo', grade: null, weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null },
    { id: 'i2', type: 'task', title: 'Anki', courseId: null, date: '2026-10-01', start: '', end: '', where: '',
      status: 'done', grade: null, weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null },
  ],
  quotes: [{ id: 'q1', text: 'Listen to your patient.', source: 'William Osler' }],
});

describe('import', () => {
  it('writes profile, courses, items and quotes in one go and stamps importedAt', async () => {
    const api = await signIn();
    const res = await api('/api/import', { method: 'POST', body: payload() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: { courses: 1, items: 2, quotes: 1 } });

    const me = await (await api('/api/me')).json();
    expect(me.coat).toEqual({ name: 'G. Vogas', role: 'MS II · Cardio block', color: '#17B3AE' });
    expect(me.theme).toBe('dark');
    expect(me.importedAt).toBeGreaterThan(0);

    const sync = await (await api('/api/sync?since=0')).json();
    expect(sync.courses.map((c) => c.id)).toEqual(['cvs']);
    expect(sync.items.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    expect(sync.items.find((i) => i.id === 'i1').courseId).toBe('cvs');
    expect(sync.quotes.map((q) => q.id)).toEqual(['q1']);
  });

  it('a second import is refused with 409', async () => {
    const api = await signIn();
    await api('/api/import', { method: 'POST', body: payload() });
    const res = await api('/api/import', { method: 'POST', body: payload() });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_imported' });
  });

  it('one bad row fails the whole import and names it', async () => {
    const api = await signIn();
    const bad = payload();
    bad.items[1].status = 'late';
    const res = await api('/api/import', { method: 'POST', body: bad });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'items[1].status' });
    const sync = await (await api('/api/sync?since=0')).json();
    expect(sync.courses).toEqual([]);
    expect((await (await api('/api/me')).json()).importedAt).toBeNull();
  });

  it('an item pointing at a course not in the import is refused', async () => {
    const api = await signIn();
    const bad = payload();
    bad.items[0].courseId = 'nope';
    const res = await api('/api/import', { method: 'POST', body: bad });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'items[0].courseId' });
  });
});

describe('nightly purge', () => {
  it('hard-deletes tombstones older than 30 days and keeps newer ones', async () => {
    const api = await signIn();
    await api('/api/quotes/old', { method: 'PUT', body: { text: 'old', source: '' } });
    await api('/api/quotes/new', { method: 'PUT', body: { text: 'new', source: '' } });
    await api('/api/quotes/old', { method: 'DELETE' });
    await api('/api/quotes/new', { method: 'DELETE' });
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await env.DB.prepare("UPDATE quotes SET deleted_at = ? WHERE id = 'old'").bind(old).run();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: '0 3 * * *' }), env, ctx);
    await waitOnExecutionContext(ctx);

    const { results } = await env.DB.prepare("SELECT id FROM quotes WHERE id IN ('old', 'new') ORDER BY id").all();
    expect(results.map((r) => r.id)).toEqual(['new']);
  });
});
