// Rooms (study together, Stage 2): the schema, the shared clock, joining and leaving, the host,
// invites in the inbox, and sessions that remember their room.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn, feed } from './helpers.js';
import { unreadCount } from '../worker/activity.js';
import { createRoom, friendsLive, getRoom, inviteToRoom, joinRoom, leaveRoom, roomClock, settle, studyAt, AWAY_MS, GONE_MS, REINVITE_MS, ROOM_SIZE } from '../worker/rooms.js';
import * as timer from '../src/core/timer.ts';

const MIN = 60_000;
const FLOW = { steps: [['study', 25], ['break', 5]], rounds: 2 };
const T0 = 1_800_000_000_000;

/* a signed-in user who knows their own id (helpers.js makes ids 'u-' + username) */
async function person(name) {
  const api = await signIn(name);
  api.id = 'u-' + name;
  return api;
}
async function befriend(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', 1, 1)").bind(lo, hi, lo).run();
}
const users = async (...names) => Promise.all(names.map((n) => createUser(n)));

describe('the rooms tables', () => {
  it('drop a room with its members, and keep a session room id 12 characters long', async () => {
    const [a] = await users('rt-a');
    await env.DB.prepare("INSERT INTO rooms (id, host_id, flow, started_at, created_at) VALUES ('rtroom000001', ?, '{}', 1, 1)").bind(a).run();
    await env.DB.prepare("INSERT INTO room_members (room_id, user_id, state) VALUES ('rtroom000001', ?, 'in')").bind(a).run();
    await expect(env.DB.prepare("INSERT INTO room_members (room_id, user_id, state) VALUES ('rtroom000001', ?, 'gone')").bind(a).run()).rejects.toThrow(/CHECK/);
    await env.DB.prepare("DELETE FROM rooms WHERE id = 'rtroom000001'").run();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM room_members WHERE user_id = ?').bind(a).first()).toEqual({ n: 0 });
    await expect(env.DB.prepare("INSERT INTO study_sessions (user_id, id, started_at, study_minutes, room_id, created_at, updated_at) VALUES (?, 'x', 1, 5, 'short', 1, 1)").bind(a).run()).rejects.toThrow(/CHECK/);
  });
});

describe('the clock', () => {
  it('counts study at a moment from the record, a later pause aside', () => {
    const run = timer.start(FLOW, T0);
    expect(studyAt(run, T0 + 10 * MIN)).toBe(10 * MIN);
    /* paused at 20 minutes: 10 minutes in still reads 10 */
    expect(studyAt(timer.pause(run, T0 + 20 * MIN), T0 + 10 * MIN)).toBe(10 * MIN);
    expect(studyAt(timer.pause(run, T0 + 20 * MIN), T0 + 40 * MIN)).toBe(20 * MIN);
  });

  it('settles a flow that ran out, and takes out someone quiet for 10 minutes', () => {
    const room = { id: 'x', hostId: 'a', endedAt: null, feed: [], run: timer.start(FLOW, T0) };
    const a = { userId: 'a', name: 'A', state: 'in', joinedAt: T0, joinedStudyMs: 0, earlierMs: 0, lastSeen: T0 + 30 * MIN };
    const b = { userId: 'b', name: 'B', state: 'in', joinedAt: T0 + MIN, joinedStudyMs: MIN, earlierMs: 0, lastSeen: T0 + 5 * MIN };
    settle(room, [a, b], T0 + 30 * MIN);
    expect(b).toMatchObject({ state: 'left', leftAt: T0 + 5 * MIN, earlierMs: 4 * MIN });
    expect(room.endedAt).toBeNull();
    a.lastSeen = T0 + 60 * MIN;
    settle(room, [a, b], T0 + 61 * MIN);
    expect(room.endedAt).toBe(T0 + 60 * MIN);
    expect(timer.read(room.run, T0 + 99 * MIN).studyMs).toBe(50 * MIN);
  });
});

describe('a room', () => {
  it('starts with you as host, invites your friends only, and shows in their inbox', async () => {
    const host = await person('ro-host'), pal = await person('ro-pal'), stranger = await person('ro-str');
    await befriend(host.id, pal.id);
    const res = await host('/api/rooms', { method: 'POST', body: { flow: FLOW, courseLabel: 'BIO 101', invite: [pal.id, stranger.id] } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.room).toMatchObject({ hostId: host.id, endedAt: null, run: { flow: FLOW, pausedAt: null, pausedMs: 0 } });
    expect(body.members).toEqual([expect.objectContaining({ userId: host.id, state: 'in', joinedStudyMs: 0, courseLabel: 'BIO 101', away: false })]);
    expect(body.room.feed[0]).toMatchObject({ kind: 'started' });

    const box = await (await pal('/api/inbox')).json();
    expect(box.roomInvites).toEqual([expect.objectContaining({ roomId: body.room.id, hostId: host.id, size: 1 })]);
    expect(await unreadCount(env.DB, pal.id)).toBeGreaterThanOrEqual(1);
    expect((await (await stranger('/api/inbox')).json()).roomInvites).toEqual([]);
    /* someone not in it cannot read it */
    expect((await stranger(`/api/rooms/${body.room.id}`)).status).toBe(404);
  });

  it('answers 304 while nothing changed, and the full room after a change', async () => {
    const host = await person('ro-304');
    const { room, tag } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW } })).json();
    expect((await host(`/api/rooms/${room.id}?v=${tag}`)).status).toBe(304);
    await host(`/api/rooms/${room.id}/clock`, { method: 'PUT', body: { action: 'pause' } });
    const res = await host(`/api/rooms/${room.id}?v=${tag}`);
    expect(res.status).toBe(200);
    expect((await res.json()).room.run.pausedAt).not.toBeNull();
  });

  it('lets an invited person or a friend of the host join, and nobody else', async () => {
    const host = await person('ro-j-host'), inv = await person('ro-j-inv'), pal = await person('ro-j-pal'), other = await person('ro-j-other');
    await befriend(host.id, inv.id);
    await befriend(host.id, pal.id);
    await befriend(inv.id, other.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW, invite: [inv.id] } })).json();
    expect((await other(`/api/rooms/${room.id}/join`, { method: 'POST', body: {} })).status).toBe(404);
    const joined = await (await inv(`/api/rooms/${room.id}/join`, { method: 'POST', body: { courseLabel: 'Chem' } })).json();
    expect(joined.members.map((m) => m.userId).sort()).toEqual([host.id, inv.id].sort());
    expect(joined.room.feed[0]).toMatchObject({ kind: 'joined' });
    expect((await pal(`/api/rooms/${room.id}/join`, { method: 'POST', body: {} })).status).toBe(200);
    /* the invite is used up */
    expect((await (await inv('/api/inbox')).json()).roomInvites).toEqual([]);
  });

  it('holds 8 people', async () => {
    const host = await createUser('ro-full-h');
    const r = await createRoom(env.DB, host, { flow: FLOW }, T0);
    for (let i = 1; i < ROOM_SIZE; i++) {
      const u = await createUser('ro-full-' + i);
      await befriend(host, u);
      await joinRoom(env.DB, u, r.room.id, {}, T0 + i);
    }
    const late = await createUser('ro-full-late');
    await befriend(host, late);
    await expect(joinRoom(env.DB, late, r.room.id, {}, T0 + 20)).rejects.toMatchObject({ status: 409, body: { error: 'full' } });
  });

  it('counts a joiner from when they joined, and keeps earlier stints when they come back', async () => {
    const [h, g] = await users('ro-m-h', 'ro-m-g');
    await befriend(h, g);
    const { room } = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await getRoom(env.DB, h, room.id, null, T0 + 9 * MIN);   /* the host polls */
    const j = await joinRoom(env.DB, g, room.id, {}, T0 + 10 * MIN);
    expect(j.members.find((m) => m.userId === g)).toMatchObject({ joinedAt: T0 + 10 * MIN, joinedStudyMs: 10 * MIN });
    await getRoom(env.DB, h, room.id, null, T0 + 15 * MIN);
    await leaveRoom(env.DB, g, room.id, T0 + 15 * MIN);
    const back = await joinRoom(env.DB, g, room.id, {}, T0 + 20 * MIN);
    expect(back.members.find((m) => m.userId === g)).toMatchObject({ state: 'in', joinedAt: T0 + 10 * MIN, joinedStudyMs: 20 * MIN, earlierMs: 5 * MIN });
  });

  it('passes the host to whoever has been there longest, and ends when the last person leaves', async () => {
    const [h, a, b] = await users('ro-h-h', 'ro-h-a', 'ro-h-b');
    await befriend(h, a);
    await befriend(h, b);
    const { room } = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await joinRoom(env.DB, a, room.id, {}, T0 + MIN);
    await joinRoom(env.DB, b, room.id, {}, T0 + 2 * MIN);
    await leaveRoom(env.DB, h, room.id, T0 + 3 * MIN);
    let r = await getRoom(env.DB, a, room.id, null, T0 + 3 * MIN);
    expect(r.room.hostId).toBe(a);
    expect(r.room.feed[0]).toMatchObject({ kind: 'host' });
    await leaveRoom(env.DB, a, room.id, T0 + 4 * MIN);
    await leaveRoom(env.DB, b, room.id, T0 + 5 * MIN);
    r = await getRoom(env.DB, b, room.id, null, T0 + 6 * MIN);
    expect(r.room.endedAt).toBe(T0 + 5 * MIN);
    expect(r.room.run.pausedAt).toBe(T0 + 5 * MIN);
  });

  it('lets only the host pause, skip and end, for everyone', async () => {
    const [h, g] = await users('ro-c-h', 'ro-c-g');
    await befriend(h, g);
    const { room } = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await joinRoom(env.DB, g, room.id, {}, T0);
    await expect(roomClock(env.DB, g, room.id, { action: 'pause' }, T0 + MIN)).rejects.toMatchObject({ status: 403 });
    let r = await roomClock(env.DB, h, room.id, { action: 'pause' }, T0 + 10 * MIN);
    expect(r.room.run.pausedAt).toBe(T0 + 10 * MIN);
    r = await roomClock(env.DB, h, room.id, { action: 'resume' }, T0 + 12 * MIN);
    expect(r.room.run).toMatchObject({ pausedAt: null, pausedMs: 2 * MIN });
    r = await roomClock(env.DB, h, room.id, { action: 'skip' }, T0 + 13 * MIN);
    expect(timer.read(r.room.run, T0 + 13 * MIN)).toMatchObject({ kind: 'break', studyMs: 11 * MIN });
    /* g went quiet meanwhile and was taken out */
    expect(r.room.feed.map((e) => e.kind).filter((k) => k !== 'left').slice(0, 3)).toEqual(['skipped', 'resumed', 'paused']);
    r = await roomClock(env.DB, h, room.id, { action: 'end' }, T0 + 14 * MIN);
    expect(r.room.endedAt).toBe(T0 + 14 * MIN);
    await expect(roomClock(env.DB, h, room.id, { action: 'resume' }, T0 + 15 * MIN)).rejects.toMatchObject({ status: 409, body: { error: 'ended' } });
    await expect(joinRoom(env.DB, g, room.id, {}, T0 + 15 * MIN)).rejects.toMatchObject({ status: 409 });
  });

  it('marks someone away after 2 minutes without a poll, and takes them out after 10', async () => {
    const [h, g] = await users('ro-a-h', 'ro-a-g');
    await befriend(h, g);
    const { room } = await createRoom(env.DB, h, { flow: { steps: [['study', 120]], rounds: 1 } }, T0);
    await joinRoom(env.DB, g, room.id, {}, T0);
    await getRoom(env.DB, h, room.id, null, T0 + AWAY_MS);
    let r = await getRoom(env.DB, h, room.id, null, T0 + AWAY_MS + 1);
    expect(r.members.find((m) => m.userId === g).away).toBe(true);
    for (let t = T0 + MIN; t <= T0 + GONE_MS + 2 * MIN; t += MIN) r = await getRoom(env.DB, h, room.id, null, t);
    expect(r.members.find((m) => m.userId === g)).toMatchObject({ state: 'left', leftAt: T0, earlierMs: 0 });
  });

  it('leaves your other room when you start or join one', async () => {
    const [h, g, h2] = await users('ro-o-h', 'ro-o-g', 'ro-o-h2');
    await befriend(h, g);
    await befriend(h2, g);
    const one = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await joinRoom(env.DB, g, one.room.id, {}, T0);
    const two = await createRoom(env.DB, h2, { flow: FLOW }, T0 + MIN);
    await joinRoom(env.DB, g, two.room.id, {}, T0 + 2 * MIN);
    const r = await getRoom(env.DB, h, one.room.id, null, T0 + 3 * MIN);
    expect(r.members.find((m) => m.userId === g)).toMatchObject({ state: 'left', earlierMs: 2 * MIN });
  });

  it('closes the room to someone the host unfriends, invite or not', async () => {
    const host = await person('ro-u-host'), pal = await person('ro-u-pal');
    await befriend(host.id, pal.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW, invite: [pal.id] } })).json();
    await host(`/api/friends/${pal.id}`, { method: 'DELETE' });
    expect((await (await pal('/api/inbox')).json()).roomInvites).toEqual([]);
    expect(await unreadCount(env.DB, pal.id)).toBe(0);
    expect((await pal(`/api/rooms/${room.id}`)).status).toBe(404);
    expect((await pal(`/api/rooms/${room.id}/join`, { method: 'POST', body: {} })).status).toBe(404);
  });

  it('keeps you in your room when a join elsewhere fails', async () => {
    const [h, g, h2] = await users('ro-k-h', 'ro-k-g', 'ro-k-h2');
    await befriend(h, g);
    await befriend(h2, g);
    const one = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await joinRoom(env.DB, g, one.room.id, {}, T0);
    const two = await createRoom(env.DB, h2, { flow: FLOW }, T0);
    await roomClock(env.DB, h2, two.room.id, { action: 'end' }, T0 + MIN);
    await expect(joinRoom(env.DB, g, two.room.id, {}, T0 + 2 * MIN)).rejects.toMatchObject({ status: 409 });
    const r = await getRoom(env.DB, g, one.room.id, null, T0 + 2 * MIN);
    expect(r.members.find((m) => m.userId === g).state).toBe('in');
  });

  it('drops an invite on Not now, and still lets a friend of the host join later', async () => {
    const host = await person('ro-n-host'), pal = await person('ro-n-pal');
    await befriend(host.id, pal.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW, invite: [pal.id] } })).json();
    expect((await pal(`/api/rooms/${room.id}/leave`, { method: 'POST' })).status).toBe(204);
    expect((await (await pal('/api/inbox')).json()).roomInvites).toEqual([]);
    expect((await pal(`/api/rooms/${room.id}/join`, { method: 'POST', body: {} })).status).toBe(200);
  });

  it('lets the host invite more friends, and members change their label', async () => {
    const host = await person('ro-i-host'), pal = await person('ro-i-pal');
    await befriend(host.id, pal.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW } })).json();
    expect((await host(`/api/rooms/${room.id}/invite`, { method: 'POST', body: { userIds: [pal.id] } })).status).toBe(204);
    expect((await (await pal('/api/inbox')).json()).roomInvites).toHaveLength(1);
    const me = await (await host(`/api/rooms/${room.id}/me`, { method: 'PUT', body: { courseLabel: 'Physics' } })).json();
    expect(me.members[0].courseLabel).toBe('Physics');
    expect((await host(`/api/rooms/${room.id}/me`, { method: 'PUT', body: { courseLabel: 'x'.repeat(61) } })).status).toBe(400);
  });

  it('lets someone who was in it back in once the host has passed to a stranger, if a friend is in it', async () => {
    const [a, b, c] = await users('ro-r-a', 'ro-r-b', 'ro-r-c');
    await befriend(a, b);
    await befriend(a, c);
    await befriend(b, c);
    const { room } = await createRoom(env.DB, a, { flow: FLOW }, T0);
    await joinRoom(env.DB, b, room.id, {}, T0 + MIN);
    await joinRoom(env.DB, c, room.id, {}, T0 + 2 * MIN);
    await leaveRoom(env.DB, a, room.id, T0 + 3 * MIN);
    await leaveRoom(env.DB, c, room.id, T0 + 4 * MIN);
    /* the host is now b, c's friend; once c is no friend of b, only a friend inside lets c back */
    await env.DB.prepare('DELETE FROM friendships WHERE user_lo = ? AND user_hi = ?').bind(...(b < c ? [b, c] : [c, b])).run();
    expect((await friendsLive(env.DB, c, T0 + 5 * MIN)).get(b)).toBeUndefined();
    await expect(joinRoom(env.DB, c, room.id, {}, T0 + 5 * MIN)).rejects.toMatchObject({ status: 404 });
    await joinRoom(env.DB, a, room.id, {}, T0 + 5 * MIN);
    expect((await friendsLive(env.DB, c, T0 + 6 * MIN)).get(a).room).toMatchObject({ id: room.id });
    const r = await joinRoom(env.DB, c, room.id, {}, T0 + 6 * MIN);
    expect(r.members.find((m) => m.userId === c).state).toBe('in');
  });

  it('passes the host on when the host deletes their account', async () => {
    const [h, a] = await users('ro-d-h', 'ro-d-a');
    await befriend(h, a);
    const { room } = await createRoom(env.DB, h, { flow: FLOW }, T0);
    await joinRoom(env.DB, a, room.id, {}, T0 + MIN);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(h).run();
    const r = await getRoom(env.DB, a, room.id, null, T0 + 2 * MIN);
    expect(r.room).toMatchObject({ hostId: a, endedAt: null });
    expect((await roomClock(env.DB, a, room.id, { action: 'pause' }, T0 + 3 * MIN)).room.run.pausedAt).toBe(T0 + 3 * MIN);
  });

  it('leaves someone who studied here as they are on Invite, and asks again after Not now only after a while', async () => {
    const [h, a, b] = await users('ro-ri-h', 'ro-ri-a', 'ro-ri-b');
    await befriend(h, a);
    await befriend(h, b);
    const { room } = await createRoom(env.DB, h, { flow: FLOW, invite: [b] }, T0);
    await joinRoom(env.DB, a, room.id, {}, T0 + MIN);
    await leaveRoom(env.DB, a, room.id, T0 + 2 * MIN);
    await leaveRoom(env.DB, b, room.id, T0 + 2 * MIN);
    await inviteToRoom(env.DB, h, room.id, { userIds: [a, b] }, T0 + 3 * MIN);
    let r = await getRoom(env.DB, h, room.id, null, T0 + 3 * MIN);
    expect(r.members.find((m) => m.userId === a).state).toBe('left');
    const state = async (id) => (await env.DB.prepare('SELECT state FROM room_members WHERE room_id = ? AND user_id = ?').bind(room.id, id).first()).state;
    expect(await state(b)).toBe('left');
    await inviteToRoom(env.DB, h, room.id, { userIds: [b] }, T0 + 2 * MIN + REINVITE_MS);
    expect(await state(b)).toBe('invited');
  });

  it('shows a friend in a room on your Friends list, with Join', async () => {
    const host = await person('ro-f-host'), pal = await person('ro-f-pal');
    await befriend(host.id, pal.id);
    const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW } })).json();
    const list = await (await pal('/api/friends')).json();
    expect(list.friends.find((f) => f.userId === host.id).room).toEqual({ id: room.id, size: 1 });
    await env.DB.prepare('INSERT INTO friend_settings (user_id, findable, show_studying) VALUES (?, 1, 0)').bind(host.id).run();
    expect((await (await pal('/api/friends')).json()).friends.find((f) => f.userId === host.id).room).toBeUndefined();
  });

  it('is behind the friends maintenance switch', async () => {
    const host = await person('ro-mt');
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('maintenance', ?, 1) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify({ features: ['friends'], message: '' })).run();
    try {
      expect((await host('/api/rooms', { method: 'POST', body: { flow: FLOW } })).status).toBe(503);
    } finally {
      await env.DB.prepare("DELETE FROM app_meta WHERE key = 'maintenance'").run();
    }
  });
});

describe('a session studied in a room', () => {
  it('syncs its roomId, and an edit that leaves it out keeps it', async () => {
    const api = await person('ro-s');
    const body = { startedAt: T0, studyMinutes: 40, roomId: 'abcdefghij12' };
    expect((await api('/api/study_sessions/r-abcdefghij12', { method: 'PUT', body })).status).toBe(200);
    const edited = await (await api('/api/study_sessions/r-abcdefghij12', { method: 'PUT', body: { startedAt: T0, studyMinutes: 45, note: 'ch 4' } })).json();
    expect(edited).toMatchObject({ roomId: 'abcdefghij12', studyMinutes: 45 });
    const { study_sessions } = await feed(api);
    expect(study_sessions.find((s) => s.id === 'r-abcdefghij12')).toMatchObject({ roomId: 'abcdefghij12' });
    expect((await api('/api/study_sessions/x1', { method: 'PUT', body: { ...body, roomId: 'nope' } })).status).toBe(400);
  });
});
