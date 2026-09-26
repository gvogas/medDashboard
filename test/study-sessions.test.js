import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { signIn, feed, BASE } from './helpers.js';
import { SELF } from 'cloudflare:test';

const session = (over = {}) => ({ courseId: null, itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 50, roundsDone: 2, ...over });
const course = { code: 'BIOC', name: 'Biochemistry', color: '#E4749B', instructor: '', term: '', archived: false, meetings: [] };
const item = (courseId) => ({ type: 'exam', title: 'Midterm', courseId, date: '2026-10-02', start: '', end: '', where: '', status: 'todo',
  grade: null, weight: null, notes: '', checklist: [], links: [], recur: null, weekday: null, recurUntil: null, dept: '', completedAt: null });

const rowsOf = async (api) => (await feed(api)).study_sessions;

describe('study sessions', () => {
  it('PUT saves a session and the change feed carries it', async () => {
    const api = await signIn();
    const res = await api('/api/study_sessions/s1', { method: 'PUT', body: session() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 's1', ...session(), deletedAt: null, revision: expect.any(Number) });
    expect(await rowsOf(api)).toEqual([expect.objectContaining({ id: 's1', studyMinutes: 50 })]);
  });

  it('refuses a bad shape and names the field', async () => {
    const api = await signIn();
    for (const [body, field] of [
      [session({ studyMinutes: 0 }), 'studyMinutes'],
      [session({ studyMinutes: 12.5 }), 'studyMinutes'],
      [session({ roundsDone: 13 }), 'roundsDone'],
      [session({ startedAt: 'yesterday' }), 'startedAt'],
      [session({ itemId: 'x'.repeat(25) }), 'itemId'],
    ]) {
      const res = await api('/api/study_sessions/bad', { method: 'PUT', body });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
  });

  it('needs a session cookie, and keeps each person to their own rows', async () => {
    const unauth = await SELF.fetch(`${BASE}/api/study_sessions/s1`, { method: 'GET' });
    expect(unauth.status).toBe(401);
    const a = await signIn(), b = await signIn();
    await a('/api/study_sessions/mine', { method: 'PUT', body: session() });
    expect((await b('/api/study_sessions/mine')).status).toBe(404);
    expect(await rowsOf(b)).toEqual([]);
  });

  it('deleting a course or an item unlinks its sessions, which stay', async () => {
    const api = await signIn();
    await api('/api/courses/bioc', { method: 'PUT', body: course });
    await api('/api/items/mid', { method: 'PUT', body: item('bioc') });
    await api('/api/study_sessions/s1', { method: 'PUT', body: session({ courseId: 'bioc', itemId: 'mid' }) });
    await api('/api/study_sessions/s2', { method: 'PUT', body: session({ courseId: 'bioc' }) });

    expect((await api('/api/items/mid', { method: 'DELETE' })).status).toBe(204);
    let s1 = await (await api('/api/study_sessions/s1')).json();
    expect(s1).toMatchObject({ courseId: 'bioc', itemId: null, deletedAt: null });

    expect((await api('/api/courses/bioc', { method: 'DELETE' })).status).toBe(204);
    s1 = await (await api('/api/study_sessions/s1')).json();
    const s2 = await (await api('/api/study_sessions/s2')).json();
    expect(s1.courseId).toBeNull();
    expect(s2.courseId).toBeNull();
    expect((await rowsOf(api)).every((s) => s.courseId === null)).toBe(true);
  });

  it('an unrelated delete leaves sessions alone', async () => {
    const api = await signIn();
    await api('/api/courses/bioc', { method: 'PUT', body: course });
    await api('/api/study_sessions/s1', { method: 'PUT', body: session({ courseId: 'bioc' }) });
    const before = await (await api('/api/study_sessions/s1')).json();
    await api('/api/quotes/q1', { method: 'PUT', body: { text: 'Keep going.', source: '' } });
    await api('/api/quotes/q1', { method: 'DELETE' });
    expect(await (await api('/api/study_sessions/s1')).json()).toEqual(before);
  });

  it('the nightly purge removes deleted sessions', async () => {
    const api = await signIn();
    await api('/api/study_sessions/old', { method: 'PUT', body: session() });
    await api('/api/study_sessions/old', { method: 'DELETE' });
    const { purgeTombstones } = await import('../worker/db.js');
    await purgeTombstones(env.DB, Date.now() + 1);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM study_sessions WHERE id = 'old'").first('n')).toBe(0);
  });
});

describe('the study flow on the profile', () => {
  it('starts as Classic 25/5 and saves a new flow', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    expect(me.studyFlow).toEqual({ steps: [['study', 25], ['break', 5]], rounds: 4 });
    const flow = { steps: [['study', 50], ['break', 10], ['study', 20]], rounds: 3 };
    const res = await api('/api/me', { method: 'PUT', body: { ...me, studyFlow: flow } });
    expect(res.status).toBe(200);
    expect((await res.json()).studyFlow).toEqual(flow);
  });

  it('keeps the stored flow when an older client leaves it out', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    const flow = { steps: [['study', 40]], rounds: 2 };
    const saved = await (await api('/api/me', { method: 'PUT', body: { ...me, studyFlow: flow } })).json();
    const { studyFlow, ...older } = saved;
    expect((await (await api('/api/me', { method: 'PUT', body: older })).json()).studyFlow).toEqual(flow);
  });

  it('refuses a flow the timer cannot run', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    for (const [studyFlow, field] of [
      [{ steps: [['break', 5]], rounds: 1 }, 'studyFlow.steps'],
      [{ steps: [], rounds: 1 }, 'studyFlow.steps'],
      [{ steps: [['study', 181]], rounds: 1 }, 'studyFlow.steps[0]'],
      [{ steps: [['nap', 5], ['study', 5]], rounds: 1 }, 'studyFlow.steps[0]'],
      [{ steps: [['study', 25]], rounds: 0 }, 'studyFlow.rounds'],
      [{ steps: Array(13).fill(['study', 5]), rounds: 1 }, 'studyFlow.steps'],
    ]) {
      const res = await api('/api/me', { method: 'PUT', body: { ...me, studyFlow } });
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
  });
});
