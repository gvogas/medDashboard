import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { signIn, BASE, feed, noon } from './helpers.js';
import { validateAchievement } from '../worker/validate.js';
import { ownAchievements } from '../public/js/achievements.js';
import { normalizeAchievement } from '../public/js/model.js';

/* a tiny but real sticker: a 1×1 PNG */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const hours = (over = {}) => ({ name: '20 hours on Neuro', sticker: PNG, rule: 'hours', courseId: 'neuro', itemId: null, target: 20, ...over });
const grade = (over = {}) => ({ name: 'ANAT midterm 85+', sticker: PNG, rule: 'grade', courseId: null, itemId: 'mid', target: 85, ...over });

const rowsOf = async (api) => (await feed(api)).achievements;

describe('your own achievements: the API', () => {
  it('saves one with its sticker, and the change feed carries it', async () => {
    const api = await signIn();
    const res = await api('/api/achievements/a1', { method: 'PUT', body: hours() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'a1', ...hours(), deletedAt: null, revision: expect.any(Number) });
    expect(await rowsOf(api)).toEqual([expect.objectContaining({ id: 'a1', sticker: PNG, target: 20 })]);
    expect((await api('/api/achievements/a1', { method: 'DELETE' })).status).toBe(204);
    expect(await rowsOf(api)).toEqual([expect.objectContaining({ id: 'a1', deletedAt: expect.any(Number) })]);
  });

  it('keeps each sticker to the account that made it', async () => {
    const unauth = await SELF.fetch(`${BASE}/api/achievements/a1`);
    expect(unauth.status).toBe(401);
    const a = await signIn(), b = await signIn();
    await a('/api/achievements/mine', { method: 'PUT', body: grade() });
    expect((await b('/api/achievements/mine')).status).toBe(404);
    expect(await rowsOf(b)).toEqual([]);
  });

  it('refuses a bad shape and names the field', async () => {
    const api = await signIn();
    for (const [body, field] of [
      [hours({ name: '' }), 'name'],
      [hours({ name: 'x'.repeat(41) }), 'name'],
      [hours({ sticker: 'https://example.com/a.png' }), 'sticker'],
      [hours({ sticker: 'data:image/svg+xml;base64,PHN2Zz4=' }), 'sticker'],
      [hours({ sticker: 'data:image/png;base64,' + 'A'.repeat(90_000) }), 'sticker'],
      [hours({ rule: 'vibes' }), 'rule'],
      [hours({ courseId: null }), 'courseId'],
      [hours({ target: 1001 }), 'target'],
      [grade({ itemId: '' }), 'itemId'],
      [grade({ target: 101 }), 'target'],
      [grade({ target: 8.5 }), 'target'],
    ]) {
      const res = await api('/api/achievements/bad', { method: 'PUT', body });
      expect(res.status, field).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
  });

  it('holds thirty at most, but an edit to one of them still saves', async () => {
    const api = await signIn();
    for (let i = 0; i < 30; i++) expect((await api('/api/achievements/n' + i, { method: 'PUT', body: hours() })).status).toBe(200);
    const over = await api('/api/achievements/n30', { method: 'PUT', body: hours() });
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: 'too_many', limit: 30 });
    expect((await api('/api/achievements/n3', { method: 'PUT', body: hours({ name: 'Renamed' }) })).status).toBe(200);
    expect((await api('/api/achievements/n0', { method: 'DELETE' })).status).toBe(204);
    expect((await api('/api/achievements/n30', { method: 'PUT', body: hours() })).status).toBe(200);
  });

  it('clears the other rule’s reference', () => {
    expect(validateAchievement(hours({ itemId: 'mid' }))).toMatchObject({ courseId: 'neuro', itemId: null });
    expect(validateAchievement(grade({ courseId: 'neuro' }))).toMatchObject({ courseId: null, itemId: 'mid' });
  });
});

/* A session at a local day and hour, so the tests hold in any time zone. */
const at = (day, minutes, courseId) => {
  const [y, m, d] = day.split('-').map(Number);
  return { id: day + courseId, startedAt: new Date(y, m - 1, d, 10).getTime(), studyMinutes: minutes, courseId };
};
const courses = [{ id: 'neuro' }, { id: 'anat' }];

describe('your own achievements: earned or not', () => {
  it('counts hours on its course only, dated the day they were reached', () => {
    const s = [at('2026-09-01', 300, 'neuro'), at('2026-09-02', 600, 'anat'), at('2026-09-05', 400, 'neuro'), at('2026-09-09', 600, 'neuro')];
    const [b] = ownAchievements([normalizeAchievement({ id: 'x', ...hours() })], s, [], courses);
    expect(b).toMatchObject({ id: 'own-x', group: 'own', earned: true, earnedOn: '2026-09-09', have: 21.7, sticker: PNG });
    const [c] = ownAchievements([normalizeAchievement({ id: 'y', ...hours({ target: 30 }) })], s, [], courses);
    expect(c).toMatchObject({ earned: false, progress: '21.7 / 30 h' });
  });

  it('earns a grade on the exam it names, when graded high enough', () => {
    const mid = (g, status = 'graded') => ({ id: 'mid', type: 'exam', status, grade: g, date: '2026-09-20', completedAt: noon('2026-09-21') });
    const own = [normalizeAchievement({ id: 'g', ...grade() })];
    expect(ownAchievements(own, [], [mid(90)], courses)[0]).toMatchObject({ earned: true, earnedOn: '2026-09-21' });
    expect(ownAchievements(own, [], [mid(71)], courses)[0]).toMatchObject({ earned: false, progress: 'Got 71, need 85' });
    expect(ownAchievements(own, [], [mid(null, 'done')], courses)[0]).toMatchObject({ earned: false, progress: 'Not graded yet' });
  });

  it('stays locked once its course or exam is gone', () => {
    const s = [at('2026-09-01', 1500, 'neuro')];
    const own = [normalizeAchievement({ id: 'h', ...hours() }), normalizeAchievement({ id: 'g', ...grade() })];
    const [h, g] = ownAchievements(own, s, [], [{ id: 'anat' }]);
    expect(h).toMatchObject({ earned: false, progress: 'Course removed' });
    expect(g).toMatchObject({ earned: false, progress: 'Exam removed' });
  });
});
