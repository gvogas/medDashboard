import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedRows } from '../worker/calendar.js';
import { unfold } from './helpers.js';
import { makeSpace, mark, ownItem, pref, sharedItem, signInAdmin } from './spaces.js';

const SID = 'sp0000000042';
const meetings = JSON.stringify([{ id: 'm1', kind: 'Lecture', weekday: 1, start: '09:00', end: '10:30', room: 'Hall B' }]);
const classCourse = (over = {}) => ({ sid: SID, id: 'web', code: 'WEB', name: 'Web Services', term: 'Fall 2026', archived: 0, meetings, created_at: 1, my_term: 'Winter 2027', my_archived: 0, ...over });
const classItem = (over = {}) => ({ sid: SID, id: 'a1', type: 'assignment', title: 'REST API', course_id: 'web', date: '2026-10-15', start: '', end: '', location: '',
  status: 'todo', weight: 20, notes: 'Use the starter repo', recur: null, weekday: null, recur_until: null, m_status: null, m_weight: null, m_notes: null, m_hidden: null, ...over });
const own = (over = {}) => ({ id: 'p1', type: 'task', title: 'Read ch. 4', course_id: null, class_id: null, date: '2026-10-14', start: '', end: '', location: '',
  status: 'todo', weight: null, notes: '', recur: null, weekday: null, recur_until: null, ...over });
const feedOf = async (api) => {
  const { url } = await (await api('/api/calendar', { method: 'POST' })).json();
  return { url, ics: unfold(await (await SELF.fetch(url)).text()) };
};

describe('feedRows', () => {
  it("gives a class's rows scoped ids, your semester, your mark, and your notes before the class's", () => {
    const rows = feedRows({ courses: [], items: [], classCourses: [classCourse()], classItems: [classItem({ m_status: 'graded', m_weight: 25, m_notes: 'Mine' })] });
    expect(rows.courses.map((c) => [c.id, c.term, c.archived])).toEqual([[SID + '-web', 'Winter 2027', 0]]);
    expect(rows.items.map((i) => [i.id, i.course_id, i.status, i.weight, i.notes])).toEqual([[SID + '-a1', SID + '-web', 'graded', 25, 'Mine\n\nUse the starter repo']]);
    const ics = unfold(buildCalendar(rows));
    expect(ics).toContain('UID:item-' + SID + '-a1@rounds');
    expect(ics).toContain('UID:class-' + SID + '-web-m1@rounds');
    expect(ics).toContain('SUMMARY:✓ WEB · REST API');
  });

  it("takes the class's semester and weight when you have no prefs or mark", () => {
    const rows = feedRows({ courses: [], items: [], classCourses: [classCourse({ my_term: null, my_archived: null })], classItems: [classItem({ status: 'done' })] });
    expect(rows.courses.map((c) => c.term)).toEqual(['Fall 2026']);
    expect(rows.items.map((i) => [i.status, i.weight, i.notes])).toEqual([['todo', 20, 'Use the starter repo']]);
  });

  it('leaves out what you hid, classes you archived, and hidden sources', () => {
    const hiddenItem = feedRows({ courses: [], items: [], classCourses: [classCourse()], classItems: [classItem({ m_hidden: 1 })] });
    expect(hiddenItem.items).toEqual([]);
    const shelved = feedRows({ courses: [], items: [own({ id: 'f1', class_id: SID })], classCourses: [classCourse({ my_archived: 1 })], classItems: [classItem()] });
    expect([shelved.courses, shelved.items]).toEqual([[], []]);
    const filed = own({ id: 'f1', class_id: SID });
    const off = feedRows({ courses: [{ id: 'bio', code: 'BIO', meetings: '[]' }], items: [own(), own({ id: 'b1', course_id: 'bio' }), filed],
      classCourses: [classCourse()], classItems: [classItem()], hidden: ['space:' + SID, 'course:bio'] });
    expect(off.courses).toEqual([]);
    expect(off.items.map((i) => i.id)).toEqual(['p1']);
    expect(feedRows({ courses: [], items: [own()], hidden: ['personal'] }).items).toEqual([]);
  });

  it("shows your items filed under a class with the class's code, and one whose class you left without a course", () => {
    const rows = feedRows({ courses: [], items: [own({ id: 'f1', class_id: SID })], classCourses: [classCourse()], classItems: [] });
    expect(rows.items[0].course_id).toBe(SID + '-web');
    expect(unfold(buildCalendar(rows))).toContain('SUMMARY:WEB · Read ch. 4');
    const left = feedRows({ courses: [], items: [own({ id: 'f1', class_id: SID })] });
    expect(left.items.map((i) => [i.id, i.course_id])).toEqual([['f1', null]]);
  });
});

describe('the feed, served', () => {
  it("carries the classes you are in with your layer, and nobody else's", async () => {
    const me = await signInAdmin('feedme'), other = await signInAdmin('feedother');
    const s = await makeSpace({ members: { [me.id]: 'member', [other.id]: 'owner' } });
    await env.DB.prepare('UPDATE courses SET meetings = ? WHERE scope = ?').bind(meetings, s.scope).run();
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'REST API', weight: 20 });
    await sharedItem(s.scope, 'gone', { course_id: 'web', title: 'Removed quiz', deleted_at: 5 });
    await sharedItem(s.scope, 'nope', { course_id: 'web', title: 'Not my section' });
    await mark(me.id, s.id, 'a1', { status: 'done' });
    await mark(me.id, s.id, 'gone', { status: 'done', notes: 'Held on' });
    await mark(me.id, s.id, 'nope', { hidden: 1 });
    await mark(other.id, s.id, 'a1', { notes: 'Their secret' });
    await pref(me.id, s.id, { term: '' });
    await ownItem(me.id, 'f1', { class_id: s.id, title: 'Extra reading' });
    const { url, ics } = await feedOf(me);
    expect(ics).toContain(`UID:item-${s.id}-a1@rounds`);
    expect(ics).toContain('SUMMARY:✓ WEB · REST API');
    expect(ics).toContain('SUMMARY:WEB · Extra reading');
    expect(ics).toContain('SUMMARY:WEB Lecture');
    expect(ics).not.toContain('Removed quiz');
    expect(ics).not.toContain('Not my section');
    expect(ics).not.toContain('Their secret');
    /* hiding the class takes it out on the next fetch */
    await env.DB.prepare('UPDATE users SET hidden_sources = ? WHERE id = ?').bind(JSON.stringify(['space:' + s.id]), me.id).run();
    const after = unfold(await (await SELF.fetch(url)).text());
    expect(after).not.toContain('REST API');
    expect(after).not.toContain('Extra reading');
  });

  it('drops a class you archived in your sidebar, with what you filed under it', async () => {
    const me = await signInAdmin('feedshelf');
    const s = await makeSpace({ members: { [me.id]: 'owner' } });
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Shelved work' });
    await pref(me.id, s.id, { archived: 1 });
    await ownItem(me.id, 'f1', { class_id: s.id, title: 'Shelved reading' });
    const { ics } = await feedOf(me);
    expect(ics).not.toContain('Shelved work');
    expect(ics).not.toContain('Shelved reading');
  });

  it('drops a class you left', async () => {
    const me = await signInAdmin('feedleft');
    const s = await makeSpace({ members: { [me.id]: 'member' } });
    await sharedItem(s.scope, 'a1', { course_id: 'web', title: 'Left behind' });
    await env.DB.prepare('UPDATE members SET deleted_at = 3 WHERE space_id = ? AND user_id = ?').bind(s.id, me.id).run();
    expect((await feedOf(me)).ics).not.toContain('Left behind');
  });
});
