// Study together, Stage 3: solo presence, friends studying now and when they last studied, the
// group record, and the nightly cleanup of rooms and presence.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { createRoom, getRoom, groupRecord, joinRoom, purgeRooms, ROOM_KEEP_MS, STALE_MS } from '../worker/rooms.js';

const MIN = 60_000;
const FLOW = { steps: [['study', 25], ['break', 5]], rounds: 2 };
const T0 = 1_800_000_000_000;

async function person(name) {
  const api = await signIn(name);
  api.id = 'u-' + name;
  return api;
}
async function befriend(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', 1, 1)").bind(lo, hi, lo).run();
}
const friendOf = async (api, id) => (await (await api('/api/friends')).json()).friends.find((f) => f.userId === id);

describe('presence', () => {
  it('shows a solo run to friends until it stops, and only while you show it', async () => {
    const me = await person('pr-me'), pal = await person('pr-pal');
    await befriend(me.id, pal.id);
    const now = Date.now();
    expect((await me('/api/presence', { method: 'PUT', body: { courseLabel: 'BIO', startedAt: now - MIN, endsAt: now + 25 * MIN } })).status).toBe(204);
    expect((await friendOf(pal, me.id)).live).toEqual({ label: 'BIO', since: now - MIN, room: null });
    expect((await me('/api/presence', { method: 'DELETE' })).status).toBe(204);
    expect((await friendOf(pal, me.id)).live).toBeUndefined();

    await me('/api/presence', { method: 'PUT', body: { courseLabel: 'BIO', startedAt: now, endsAt: now + 25 * MIN } });
    await me('/api/friends/settings', { method: 'PUT', body: { findable: true, showStudying: false } });
    expect((await friendOf(pal, me.id)).live).toBeUndefined();
    /* hidden: a new run is not kept at all */
    await me('/api/presence', { method: 'PUT', body: { courseLabel: 'BIO', startedAt: now, endsAt: now + 25 * MIN } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM presence WHERE user_id = ?').bind(me.id).first()).toEqual({ n: 0 });
  });

  it('refuses a body without times', async () => {
    const me = await person('pr-bad');
    expect((await me('/api/presence', { method: 'PUT', body: { courseLabel: 'X' } })).status).toBe(400);
  });

  it('says when a friend last studied, unless they hide it', async () => {
    const me = await person('pr-last'), pal = await person('pr-last-pal');
    await befriend(me.id, pal.id);
    await me('/api/study_sessions/s1', { method: 'PUT', body: { startedAt: T0, studyMinutes: 30 } });
    expect((await friendOf(pal, me.id)).lastStudied).toBe(T0);
    await me('/api/friends/settings', { method: 'PUT', body: { findable: true, showStudying: false } });
    expect((await friendOf(pal, me.id)).lastStudied).toBeNull();
  });

  it('shows a friend in a room you may not join as studying, without Join', async () => {
    const [h, g, other] = await Promise.all(['pr-r-h', 'pr-r-g', 'pr-r-o'].map((n) => createUser(n)));
    await befriend(h, g);
    await befriend(g, other);
    const { room } = await createRoom(env.DB, h, { flow: FLOW }, Date.now());
    await joinRoom(env.DB, g, room.id, { courseLabel: 'Chem' }, Date.now());
    const otherApi = await signIn('pr-r-o2');
    await befriend('u-pr-r-o2', g);
    const f = await friendOf(otherApi, g);
    expect(f.live).toMatchObject({ label: 'Chem', room: null });
    expect(f.room).toBeUndefined();
  });
});

describe('the group record', () => {
  it('sums each member\'s own sessions in the room, for people who were in it', async () => {
    const host = await person('gr-host'), pal = await person('gr-pal'), out = await person('gr-out');
    await befriend(host.id, pal.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW, invite: [pal.id] } })).json();
    await pal(`/api/rooms/${room.id}/join`, { method: 'POST', body: {} });
    await host(`/api/study_sessions/r-${room.id}`, { method: 'PUT', body: { startedAt: T0, studyMinutes: 50, roomId: room.id } });
    await pal(`/api/study_sessions/r-${room.id}`, { method: 'PUT', body: { startedAt: T0, studyMinutes: 30, roomId: room.id } });
    const rec = await (await pal(`/api/rooms/${room.id}/record`)).json();
    expect(rec.members.map((m) => [m.userId, m.minutes])).toEqual([[host.id, 50], [pal.id, 30]]);
    /* an edit to your own session shows */
    await pal(`/api/study_sessions/r-${room.id}`, { method: 'PUT', body: { startedAt: T0, studyMinutes: 55, roomId: room.id } });
    expect((await groupRecord(env.DB, host.id, room.id)).members[0]).toMatchObject({ userId: pal.id, minutes: 55 });
    expect((await out(`/api/rooms/${room.id}/record`)).status).toBe(404);
  });
});

describe('the nightly cleanup', () => {
  it('ends rooms nobody polls, drops old presence, and deletes old rooms no session names', async () => {
    const [h, g] = await Promise.all(['pu-h', 'pu-g'].map((n) => createUser(n)));
    await befriend(h, g);
    const stale = await createRoom(env.DB, h, { flow: { steps: [['study', 180]], rounds: 1 } }, T0);
    await joinRoom(env.DB, g, stale.room.id, {}, T0 + 5 * MIN);
    await env.DB.prepare('UPDATE room_members SET last_seen = ? WHERE user_id = ?').bind(T0 + 5 * MIN, h).run();
    await env.DB.prepare("INSERT INTO presence (user_id, course_label, started_at, ends_at) VALUES (?, '', 1, ?)").bind(h, T0 + 10 * MIN).run();
    await purgeRooms(env.DB, T0 + 5 * MIN + STALE_MS + MIN);
    const r = await getRoom(env.DB, h, stale.room.id, null, T0 + 5 * MIN + STALE_MS + MIN);
    expect(r.room.endedAt).toBe(T0 + 5 * MIN);
    expect(r.members.every((m) => m.state === 'left')).toBe(true);
    expect(r.members.find((m) => m.userId === h).earlierMs).toBe(5 * MIN);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM presence WHERE user_id = ?').bind(h).first()).toEqual({ n: 0 });

    /* 90 days on: kept while a session names it, gone after */
    const later = T0 + ROOM_KEEP_MS + 6 * MIN;
    await env.DB.prepare("INSERT INTO study_sessions (user_id, id, started_at, study_minutes, room_id, created_at, updated_at) VALUES (?, 'keep', 1, 5, ?, 1, 1)").bind(h, stale.room.id).run();
    await purgeRooms(env.DB, later);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM rooms WHERE id = ?').bind(stale.room.id).first()).toEqual({ n: 1 });
    await env.DB.prepare("DELETE FROM study_sessions WHERE id = 'keep'").run();
    await purgeRooms(env.DB, later);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM rooms WHERE id = ?').bind(stale.room.id).first()).toEqual({ n: 0 });
  });
});
