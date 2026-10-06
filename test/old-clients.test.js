import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';

const SID = 'abcdefghij12';
const item = (over = {}) => ({ type: 'quiz', title: 'Quiz 1', courseId: null, date: '2026-10-01', status: 'todo', ...over });
const session = (over = {}) => ({ courseId: 'web', itemId: null, startedAt: 1_790_000_000_000, studyMinutes: 30, ...over });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const profile = { coat: { name: '', role: '', color: '#E4749B' }, theme: 'dark', termStart: null, displayName: '' };

describe('a client from before Stage 4', () => {
  it('pages only the five kinds it knows on v2, and still reaches the head', async () => {
    const api = await signIn('old-v2');
    expect((await api('/api/items/q1', { method: 'PUT', body: item() })).status).toBe(200);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO marks (user_id, id, space_id, item_id, created_at, updated_at) VALUES ('u-old-v2', ?, ?, 'x', 1, 1)").bind(SID + ':x', SID),
      env.DB.prepare("INSERT INTO space_prefs (user_id, id, space_id, color, created_at, updated_at) VALUES ('u-old-v2', ?, ?, '#17B3AE', 1, 1)").bind(SID, SID),
    ]);
    const page = await (await api('/api/sync?v=2&cursor=0')).json();
    expect(page.changes.map((c) => c.kind)).toEqual(['items']);
    const { head } = await env.DB.prepare("SELECT seq AS head FROM sqlite_sequence WHERE name = 'changes'").first();
    expect(page.cursor).toBe(head);
  });

  it("keeps an item's class label when the body leaves it out; the new client sets and clears it", async () => {
    const api = await signIn('old-label');
    expect((await api('/api/items/r1', { method: 'PUT', body: item() })).status).toBe(200);
    /* as a convert files it (Task 19); the revision is left alone, so the next PUT matches */
    await env.DB.prepare("UPDATE items SET class_id = ? WHERE scope = 'u:u-old-label' AND id = 'r1'").bind(SID).run();
    const kept = await (await api('/api/items/r1', { method: 'PUT', body: item({ title: 'Renamed' }) })).json();
    expect(kept).toMatchObject({ title: 'Renamed', classId: SID });
    const cleared = await (await api('/api/items/r1', { method: 'PUT', body: item({ classId: null }) })).json();
    expect(cleared.classId).toBeNull();
    const set = await (await api('/api/items/r1', { method: 'PUT', body: item({ classId: SID }) })).json();
    expect(set.classId).toBe(SID);
    expect(await (await api('/api/items/r2', { method: 'PUT', body: item({ classId: 'Not-A-Space' }) })).json()).toEqual({ error: 'invalid', field: 'classId' });
    await api('/api/courses/bio', { method: 'PUT', body: { code: 'BIO', name: 'Biology', color: '#17B3AE', meetings: [] } });
    expect(await (await api('/api/items/r3', { method: 'PUT', body: item({ classId: SID, courseId: 'bio' }) })).json()).toEqual({ error: 'invalid', field: 'classId' });
    /* an old client puts the filed item under a course of its own: that unfiles it */
    const moved = await api('/api/items/r1', { method: 'PUT', body: item({ courseId: 'bio' }) });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ courseId: 'bio', classId: null });
  });

  it("keeps a session's and an achievement's space when the body leaves it out", async () => {
    const api = await signIn('old-space');
    const s1 = await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ spaceId: SID }) })).json();
    expect(s1.spaceId).toBe(SID);
    const s2 = await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ studyMinutes: 45 }) })).json();
    expect(s2).toMatchObject({ studyMinutes: 45, spaceId: SID });
    expect((await (await api('/api/achievements/a1', { method: 'PUT', body: { name: 'Web', sticker: PNG, rule: 'hours', courseId: 'web', target: 10, spaceId: SID } })).json()).spaceId).toBe(SID);
    const a2 = await (await api('/api/achievements/a1', { method: 'PUT', body: { name: 'Web 2', sticker: PNG, rule: 'hours', courseId: 'web', target: 10 } })).json();
    expect(a2).toMatchObject({ name: 'Web 2', spaceId: SID });
    expect(await (await api('/api/study_sessions/s2', { method: 'PUT', body: session({ spaceId: 7 }) })).json()).toEqual({ error: 'invalid', field: 'spaceId' });
  });

  it("drops a session's and an achievement's space when an old client points them at another course or item", async () => {
    const api = await signIn('old-move');
    expect((await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ itemId: 'q1', spaceId: SID }) })).json()).spaceId).toBe(SID);
    /* same course and item: kept */
    expect(await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ itemId: 'q1', note: 'ch. 2' }) })).json()).toMatchObject({ note: 'ch. 2', spaceId: SID });
    /* another item: the label no longer fits */
    expect(await (await api('/api/study_sessions/s1', { method: 'PUT', body: session({ itemId: 'q2' }) })).json()).toMatchObject({ itemId: 'q2', spaceId: null });
    /* another course, item unchanged */
    expect((await (await api('/api/study_sessions/s2', { method: 'PUT', body: session({ spaceId: SID }) })).json()).spaceId).toBe(SID);
    expect(await (await api('/api/study_sessions/s2', { method: 'PUT', body: session({ courseId: 'bio' }) })).json()).toMatchObject({ courseId: 'bio', spaceId: null });
    /* a new row left without one starts with none */
    expect((await (await api('/api/study_sessions/s3', { method: 'PUT', body: session() })).json()).spaceId).toBeNull();

    const ach = (over) => ({ name: 'Quiz', sticker: PNG, rule: 'grade', itemId: 'q1', target: 90, ...over });
    expect((await (await api('/api/achievements/a1', { method: 'PUT', body: ach({ spaceId: SID }) })).json()).spaceId).toBe(SID);
    expect(await (await api('/api/achievements/a1', { method: 'PUT', body: ach({ target: 80 }) })).json()).toMatchObject({ target: 80, spaceId: SID });
    expect(await (await api('/api/achievements/a1', { method: 'PUT', body: ach({ itemId: 'q2' }) })).json()).toMatchObject({ itemId: 'q2', spaceId: null });
  });

  it('keeps the hidden sources when PUT /api/me leaves them out', async () => {
    const api = await signIn('old-hidden');
    expect((await (await api('/api/me')).json()).hiddenSources).toEqual([]);
    const set = await (await api('/api/me', { method: 'PUT', body: { ...profile, hiddenSources: ['personal', 'course:bio', 'space:' + SID] } })).json();
    expect(set.hiddenSources).toEqual(['personal', 'course:bio', 'space:' + SID]);
    const kept = await (await api('/api/me', { method: 'PUT', body: { ...profile, displayName: 'Old tab' } })).json();
    expect(kept).toMatchObject({ displayName: 'Old tab', hiddenSources: ['personal', 'course:bio', 'space:' + SID] });
    for (const bad of [['space:short'], ['personal', 'personal'], ['calendar'], Array.from({ length: 41 }, (_, i) => 'course:c' + i)]) {
      const res = await api('/api/me', { method: 'PUT', body: { ...profile, hiddenSources: bad } });
      expect(res.status).toBe(400);
    }
  });
});
