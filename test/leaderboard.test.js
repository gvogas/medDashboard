import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { signIn, BASE } from './helpers.js';

const DAY = 86_400_000;
const now = Date.now();
const since = now - 3 * DAY;
const session = (startedAt, studyMinutes) => ({ courseId: null, itemId: null, startedAt, studyMinutes, roundsDone: 1 });

async function studied(api, id, startedAt, minutes) {
  expect((await api(`/api/study_sessions/${id}`, { method: 'PUT', body: session(startedAt, minutes) })).status).toBe(200);
}
const join = async (api, joined = true) => expect((await api('/api/leaderboard', { method: 'PUT', body: { joined } })).status).toBe(204);
const board = async (api, from = since) => {
  const res = await api(`/api/leaderboard?since=${from}`);
  expect(res.status).toBe(200);
  return res.json();
};
const pick = (list, names) => list.filter((r) => names.includes(r.name));

describe('the study leaderboard', () => {
  it('shows nobody to a user who has not joined', async () => {
    const shy = await signIn('shy'), keen = await signIn('keen');
    await join(keen);
    await studied(keen, 'k1', now - DAY, 60);
    expect(await board(shy)).toEqual({ joined: false, week: [], all: [] });
  });

  it('ranks joined users by minutes this week and all-time, and leaves out the rest', async () => {
    const ana = await signIn('ana'), ben = await signIn('ben'), cy = await signIn('cyd'), dee = await signIn('dee');
    for (const api of [ana, ben, dee]) await join(api);
    await studied(ana, 'a1', now - DAY, 30);
    await studied(ana, 'a2', now - 20 * DAY, 300);   /* before this week: all-time only */
    await studied(ben, 'b1', now - 2 * DAY, 90);
    await studied(cy, 'c1', now - DAY, 500);         /* cyd never joined */
    const names = ['ana', 'ben', 'cyd', 'dee'];
    const b = await board(ana);
    expect(b.joined).toBe(true);
    expect(pick(b.week, names)).toEqual([
      { name: 'ben', minutes: 90, me: false },
      { name: 'ana', minutes: 30, me: true },
      { name: 'dee', minutes: 0, me: false },
    ]);
    expect(pick(b.all, names)).toEqual([
      { name: 'ana', minutes: 330, me: true },
      { name: 'ben', minutes: 90, me: false },
      { name: 'dee', minutes: 0, me: false },
    ]);
  });

  it('shows the display name when there is one, and never ids or usernames behind it', async () => {
    const eve = await signIn('eve');
    await env.DB.prepare("UPDATE users SET display_name = 'Evelyn' WHERE username = 'eve'").run();
    await join(eve);
    const b = await board(eve);
    const row = b.all.find((r) => r.me);
    expect(row).toEqual({ name: 'Evelyn', minutes: 0, me: true });
    expect(JSON.stringify(b)).not.toMatch(/u-eve|"eve"/);
  });

  it('leaves out deleted sessions', async () => {
    const fay = await signIn('fay');
    await join(fay);
    await studied(fay, 'f1', now - DAY, 45);
    await studied(fay, 'f2', now - DAY, 15);
    expect((await fay('/api/study_sessions/f2', { method: 'DELETE' })).status).toBe(204);
    const b = await board(fay);
    expect(b.week.find((r) => r.me).minutes).toBe(45);
    expect(b.all.find((r) => r.me).minutes).toBe(45);
  });

  it('drops a user who leaves', async () => {
    const gil = await signIn('gil'), hal = await signIn('hal');
    await join(gil); await join(hal);
    expect((await board(hal)).all.some((r) => r.name === 'gil')).toBe(true);
    await join(gil, false);
    expect((await board(hal)).all.some((r) => r.name === 'gil')).toBe(false);
    expect(await board(gil)).toEqual({ joined: false, week: [], all: [] });
  });

  it('refuses a week start that is not a recent timestamp, and a bad join value', async () => {
    const ivy = await signIn('ivy');
    await join(ivy);
    for (const bad of ['', 'monday', '1.5', String(now - 9 * DAY), String(now + 2 * DAY), '0']) {
      const res = await ivy(`/api/leaderboard?since=${bad}`);
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe('since');
    }
    for (const joined of ['yes', 1, null]) {
      expect((await ivy('/api/leaderboard', { method: 'PUT', body: { joined } })).status).toBe(400);
    }
  });

  it('needs a signed-in user', async () => {
    expect((await SELF.fetch(`${BASE}/api/leaderboard?since=${since}`)).status).toBe(401);
    expect((await SELF.fetch(`${BASE}/api/leaderboard`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"joined":true}' })).status).toBe(401);
  });
});
