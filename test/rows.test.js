import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { signIn } from './helpers.js';

/** The change feed after `cursor`, as the latest row of each kind; deleted rows carry deletedAt. */
async function feed(api, cursor = 0) {
  const out = { courses: [], items: [], quotes: [] };
  for (let more = true; more;) {
    const page = await (await api(`/api/sync?v=2&cursor=${cursor}`)).json();
    for (const { kind, row } of page.changes) out[kind] = [...out[kind].filter((r) => r.id !== row.id), row];
    ({ cursor, more } = page);
  }
  return { ...out, cursor };
}

const course = (over = {}) => ({
  code: 'CVS',
  name: 'Cardiovascular Block',
  color: '#E4749B',
  instructor: 'Dr. Alvarez',
  term: '',
  archived: false,
  meetings: [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '08:00', end: '10:00', room: 'Hall A' }],
  ...over,
});

const item = (over = {}) => ({
  type: 'exam',
  title: 'Cardiovascular Block Exam I',
  courseId: null,
  date: '2026-10-03',
  start: '09:00',
  end: '11:30',
  where: 'Hall A',
  status: 'todo',
  grade: null,
  weight: null,
  notes: '',
  checklist: [{ id: 'c1', text: 'Lectures 1–7 re-read', done: true }],
  links: [{ label: 'Blueprint', url: 'https://example.edu/cvs/exam1' }],
  recur: null,
  weekday: null,
  recurUntil: null,
  dept: '',
  completedAt: null,
  ...over,
});

const quote = (over = {}) => ({ text: 'Listen to your patient.', source: 'William Osler', ...over });

describe('courses', () => {
  it('PUT creates a course and returns it with server timestamps', async () => {
    const api = await signIn();
    const res = await api('/api/courses/cvs', { method: 'PUT', body: course() });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ id: 'cvs', ...course() });
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(saved.updatedAt).toBe(saved.createdAt);
    expect(saved.deletedAt).toBeNull();
  });

  it('PUT on an existing id updates it and keeps createdAt', async () => {
    const api = await signIn();
    const first = await (await api('/api/courses/cvs', { method: 'PUT', body: course() })).json();
    const res = await api('/api/courses/cvs', { method: 'PUT', body: course({ name: 'Cardio' }) });
    const second = await res.json();
    expect(second.name).toBe('Cardio');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('rejects a 13th meeting and names the field', async () => {
    const api = await signIn();
    const meetings = Array.from({ length: 13 }, (_, i) => ({ id: `m${i}`, kind: 'Lecture', weekday: 1, start: '08:00', end: '09:00', room: '' }));
    const res = await api('/api/courses/cvs', { method: 'PUT', body: course({ meetings }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'meetings' });
  });

  it('rejects a meeting that ends before it starts', async () => {
    const api = await signIn();
    const meetings = [{ id: 'm1', kind: 'Lecture', weekday: 1, start: '10:00', end: '09:00', room: '' }];
    const res = await api('/api/courses/cvs', { method: 'PUT', body: course({ meetings }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'meetings[0].end' });
  });

  it('DELETE soft-deletes and clears courseId on the items that used it', async () => {
    const api = await signIn();
    await api('/api/courses/cvs', { method: 'PUT', body: course() });
    await api('/api/items/i1', { method: 'PUT', body: item({ courseId: 'cvs' }) });
    const del = await api('/api/courses/cvs', { method: 'DELETE' });
    expect(del.status).toBe(204);
    const sync = await feed(api);
    expect(sync.courses).toEqual([expect.objectContaining({ id: 'cvs', deletedAt: expect.any(Number) })]);
    expect(sync.items[0].courseId).toBeNull();
  });

  it('DELETE of a course you do not own is 404', async () => {
    const alice = await signIn();
    const bob = await signIn();
    await alice('/api/courses/cvs', { method: 'PUT', body: course() });
    expect((await bob('/api/courses/cvs', { method: 'DELETE' })).status).toBe(404);
    const sync = await feed(alice);
    expect(sync.courses[0].deletedAt).toBeNull();
  });
});

describe('items', () => {
  it('PUT creates an item, mapping where <-> location', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item() });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ id: 'i1', ...item() });
    expect(saved).not.toHaveProperty('location');
  });

  it('rejects a bad status', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item({ status: 'late' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'status' });
  });

  it('rejects a malformed date', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item({ date: '3 Oct' }) });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'date' });
  });

  it('rejects a weekly slot without a weekday', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item({ recur: 'weekly', weekday: null }) });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'weekday' });
  });

  it('rejects a courseId that is not one of your courses', async () => {
    const alice = await signIn();
    const bob = await signIn();
    await alice('/api/courses/cvs', { method: 'PUT', body: course() });
    const res = await bob('/api/items/i1', { method: 'PUT', body: item({ courseId: 'cvs' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'courseId' });
  });

  it('rejects a link whose URL is not http or https', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item({ links: [{ label: 'x', url: 'javascript:alert(1)' }] }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'links[0].url' });
  });

  it('rejects notes over 5000 characters', async () => {
    const api = await signIn();
    const res = await api('/api/items/i1', { method: 'PUT', body: item({ notes: 'x'.repeat(5001) }) });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'notes' });
  });

  it('DELETE soft-deletes; a second DELETE is still 204', async () => {
    const api = await signIn();
    await api('/api/items/i1', { method: 'PUT', body: item() });
    expect((await api('/api/items/i1', { method: 'DELETE' })).status).toBe(204);
    expect((await api('/api/items/i1', { method: 'DELETE' })).status).toBe(204);
  });

  it('PUT on a deleted id revives it', async () => {
    const api = await signIn();
    await api('/api/items/i1', { method: 'PUT', body: item() });
    await api('/api/items/i1', { method: 'DELETE' });
    const saved = await (await api('/api/items/i1', { method: 'PUT', body: item() })).json();
    expect(saved.deletedAt).toBeNull();
  });
});

describe('quotes', () => {
  it('PUT creates a quote', async () => {
    const api = await signIn();
    const res = await api('/api/quotes/q1', { method: 'PUT', body: quote() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'q1', ...quote() });
  });

  it('rejects empty text', async () => {
    const api = await signIn();
    const res = await api('/api/quotes/q1', { method: 'PUT', body: quote({ text: '' }) });
    expect(await res.json()).toEqual({ error: 'invalid', field: 'text' });
  });
});

describe('sync', () => {
  it('cursor=0 returns every live row of mine, and nothing of anyone else', async () => {
    const alice = await signIn();
    const bob = await signIn();
    await alice('/api/courses/cvs', { method: 'PUT', body: course() });
    await alice('/api/items/i1', { method: 'PUT', body: item() });
    await alice('/api/quotes/q1', { method: 'PUT', body: quote() });
    await bob('/api/items/i2', { method: 'PUT', body: item({ title: 'Bob only' }) });

    const res = await alice('/api/sync?v=2&cursor=0');
    expect(res.status).toBe(200);
    expect((await res.json()).reset).toBe(false);
    const sync = await feed(alice);
    expect(sync.courses.map((c) => c.id)).toEqual(['cvs']);
    expect(sync.items.map((i) => i.id)).toEqual(['i1']);
    expect(sync.quotes.map((q) => q.id)).toEqual(['q1']);
  });

  it('a cursor returns only rows changed after it', async () => {
    const api = await signIn();
    await api('/api/items/i1', { method: 'PUT', body: item() });
    const { cursor } = await feed(api);
    await api('/api/items/i2', { method: 'PUT', body: item({ title: 'Later' }) });
    const sync = await feed(api, cursor);
    expect(sync.items.map((i) => i.id)).toEqual(['i2']);
  });

  it('a deleted row comes back as a tombstone', async () => {
    const api = await signIn();
    await api('/api/quotes/q1', { method: 'PUT', body: quote() });
    await api('/api/quotes/q1', { method: 'DELETE' });
    const sync = await feed(api);
    expect(sync.quotes).toEqual([expect.objectContaining({ id: 'q1', deletedAt: expect.any(Number) })]);
  });

  it('rejects a non-numeric cursor', async () => {
    const api = await signIn();
    expect((await api('/api/sync?v=2&cursor=yesterday')).status).toBe(400);
  });
});

describe('stored JSON', () => {
  it('a corrupt JSON column does not fail the whole sync page', async () => {
    const api = await signIn('corrupt-json');
    await api('/api/quotes/q1', { method: 'PUT', body: quote() });
    // The columns are CHECKed now, but a change-feed payload keeps whatever was written.
    await env.DB.prepare(`INSERT INTO changes (user_id, kind, row_id, payload, deleted_at) VALUES (?1, 'courses', 'bad', json_object(
      'user_id', ?1, 'id', 'bad', 'code', 'BAD', 'name', 'Bad', 'color', '#E4749B', 'instructor', '', 'term', '', 'archived', 0,
      'meetings', '[{"id":', 'created_at', 1, 'updated_at', 1, 'deleted_at', NULL, 'revision', 1), NULL)`).bind('u-corrupt-json').run();
    const res = await api('/api/sync?v=2&cursor=0');
    expect(res.status).toBe(200);
    const { changes } = await res.json();
    expect(changes.find((c) => c.row.id === 'bad').row.meetings).toEqual([]);
    expect(changes.find((c) => c.row.id === 'q1').row.text).toBe(quote().text);
  });
});
