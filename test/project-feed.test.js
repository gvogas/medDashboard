import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildCalendar, feedRows } from '../worker/calendar.js';
import { unfold } from './helpers.js';
import { makeSpace, mark, pref, sharedItem, signInAdmin } from './spaces.js';

const SID = 'fire00000042';
const pItem = (over = {}) => ({ sid: SID, project: 'Fire Response API', id: 't1', type: 'task', title: 'Create incidents endpoint', course_id: null, date: '2026-10-20',
  start: '', end: '', location: '', status: 'todo', weight: null, notes: 'Team notes', recur: null, weekday: null, recur_until: null, assignees: '["u-me"]',
  my_archived: 0, m_notes: null, m_hidden: null, ...over });

describe('feedRows with projects (Stage 10 plan, Decisions 1-3)', () => {
  it("names a project's own item and its tasks, scopes their ids, and puts your notes first", () => {
    const rows = feedRows({ courses: [], items: [], projectItems: [pItem({ id: 'project', type: 'project', title: 'Fire Response API', assignees: '[]', date: '2026-10-30' }), pItem({ m_notes: 'Mine' })], me: 'u-me' });
    expect(rows.items.map((i) => [i.id, i.title, i.notes])).toEqual([
      [SID + '-t1', 'Fire Response API · Create incidents endpoint', 'Mine\n\nTeam notes'],
      [SID + '-project', 'Team · Fire Response API', 'Team notes'],
    ]);
    const ics = unfold(buildCalendar(rows));
    expect(ics).toContain('UID:item-' + SID + '-t1@rounds');
    expect(ics).toContain('UID:item-' + SID + '-project@rounds');
    expect(ics).toContain('SUMMARY:Fire Response API · Create incidents endpoint');
  });

  it("keeps only your tasks and everyone's, and leaves out what you hid, hidden sources, and projects you archived", () => {
    const rows = (items, hidden = []) => feedRows({ courses: [], items: [], projectItems: items, me: 'u-me', hidden }).items.map((i) => i.id);
    expect(rows([pItem(), pItem({ id: 't2', assignees: '["*"]' }), pItem({ id: 't3', assignees: '["u-sam"]' }), pItem({ id: 't4', assignees: '[]' })]))
      .toEqual([SID + '-t1', SID + '-t2']);
    expect(rows([pItem({ m_hidden: 1 })])).toEqual([]);
    expect(rows([pItem()], ['space:' + SID])).toEqual([]);
    expect(rows([pItem({ my_archived: 1 })])).toEqual([]);
  });

  it('marks a finished task ✓ whoever finished it', () => {
    const ics = unfold(buildCalendar(feedRows({ courses: [], items: [], projectItems: [pItem({ status: 'done' })], me: 'u-me' })));
    expect(ics).toContain('SUMMARY:✓ Fire Response API · Create incidents endpoint');
  });
});

describe('the feed, served, with projects', () => {
  it("carries your projects' rows with your layer, and drops a project you left", async () => {
    const me = await signInAdmin('pfme'), sam = await signInAdmin('pfsam');
    const s = await makeSpace({ kind: 'project', members: { [me.id]: 'editor', [sam.id]: 'owner' } });
    await sharedItem(s.scope, 't1', { title: 'Mine to do', assignees: JSON.stringify([me.id]) });
    await sharedItem(s.scope, 't2', { title: 'Sam alone', assignees: JSON.stringify([sam.id]) });
    await sharedItem(s.scope, 't3', { title: 'Gone task', assignees: JSON.stringify([me.id]), deleted_at: 5 });
    await sharedItem(s.scope, 't4', { title: 'For all', assignees: '["*"]' });
    await mark(sam.id, s.id, 't1', { notes: 'Sam secret' });
    await mark(me.id, s.id, 't4', { notes: 'My own note' });
    await pref(me.id, s.id, { term: '' });
    const { url } = await (await me('/api/calendar', { method: 'POST' })).json();
    const ics = unfold(await (await SELF.fetch(url)).text());
    expect(ics).toContain('SUMMARY:Fire Response API · Mine to do');
    expect(ics).toContain('SUMMARY:Fire Response API · For all');
    expect(ics).toContain('My own note');
    expect(ics).toContain('SUMMARY:Team · Fire Response API');
    expect(ics).not.toContain('Sam alone');
    expect(ics).not.toContain('Gone task');
    expect(ics).not.toContain('Sam secret');
    await env.DB.prepare('UPDATE members SET deleted_at = 3 WHERE space_id = ? AND user_id = ?').bind(s.id, me.id).run();
    expect(unfold(await (await SELF.fetch(url)).text())).not.toContain('Mine to do');
  });

  it('leaves out a project you archived in your sidebar, and a deleted project', async () => {
    const me = await signInAdmin('pfarch');
    const shelved = await makeSpace({ kind: 'project', members: { [me.id]: 'owner' } });
    await pref(me.id, shelved.id, { archived: 1 });
    const gone = await makeSpace({ kind: 'project', members: { [me.id]: 'owner' } });
    await env.DB.prepare('UPDATE spaces SET deleted_at = 4 WHERE id = ?').bind(gone.id).run();
    const { url } = await (await me('/api/calendar', { method: 'POST' })).json();
    const ics = unfold(await (await SELF.fetch(url)).text());
    expect(ics).not.toContain('Fire Response API');
  });
});
