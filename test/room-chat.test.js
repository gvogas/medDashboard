// Room chat (study together): the people in a room talk to each other. Only people in the room
// now can read or send; a message must be short and plain; a room that has ended takes none.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { signIn } from './helpers.js';
import { CHAT_PER_MINUTE, listMessages, sendMessage, createRoom } from '../worker/rooms.js';
import { createUser } from './helpers.js';

const FLOW = { steps: [['study', 25], ['break', 5]], rounds: 2 };

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
/** A host with a friend who has joined the room. */
async function pairInRoom(tag) {
  const host = await person(tag + '-h'), pal = await person(tag + '-p');
  await befriend(host.id, pal.id);
  const { room } = await (await host('/api/rooms', { method: 'POST', body: { flow: FLOW, invite: [pal.id] } })).json();
  const joined = await pal(`/api/rooms/${room.id}/join`, { method: 'POST', body: { courseLabel: 'Chem' } });
  expect(joined.status).toBe(200);
  return { host, pal, roomId: room.id };
}
const say = (who, roomId, body) => who(`/api/rooms/${roomId}/messages`, { method: 'POST', body: { body } });

describe('room chat', () => {
  it('lets everyone in the room send and read, oldest first, with names', async () => {
    const { host, pal, roomId } = await pairInRoom('cht-a');
    expect((await say(host, roomId, 'Ready when you are')).status).toBe(201);
    const reply = await (await say(pal, roomId, 'Go on')).json();
    expect(reply).toMatchObject({ userId: pal.id, body: 'Go on' });
    expect(typeof reply.id).toBe('number');
    const { messages } = await (await pal(`/api/rooms/${roomId}/messages`)).json();
    expect(messages.map((m) => [m.userId, m.body])).toEqual([[host.id, 'Ready when you are'], [pal.id, 'Go on']]);
    expect(messages[0]).toEqual(expect.objectContaining({ name: expect.any(String), at: expect.any(Number) }));
  });

  it('returns only what is new after the last id a poll saw', async () => {
    const { host, pal, roomId } = await pairInRoom('cht-after');
    const first = await (await say(host, roomId, 'one')).json();
    await say(pal, roomId, 'two');
    const next = await (await host(`/api/rooms/${roomId}/messages?after=${first.id}`)).json();
    expect(next.messages.map((m) => m.body)).toEqual(['two']);
    const none = await (await host(`/api/rooms/${roomId}/messages?after=${first.id + 1}`)).json();
    expect(none.messages).toEqual([]);
  });

  it('keeps the last 50 when there are more, in order', async () => {
    const { host, roomId } = await pairInRoom('cht-keep');
    for (let i = 0; i < 52; i++) {
      await env.DB.prepare('INSERT INTO room_messages (room_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(roomId, host.id, 'm' + i, i).run();
    }
    const { messages } = await (await host(`/api/rooms/${roomId}/messages`)).json();
    expect(messages).toHaveLength(50);
    expect(messages[0].body).toBe('m2');
    expect(messages.at(-1).body).toBe('m51');
  });

  it('refuses people who are not in the room now, and past members', async () => {
    const { host, pal, roomId } = await pairInRoom('cht-who');
    const stranger = await person('cht-who-s');
    expect((await stranger(`/api/rooms/${roomId}/messages`)).status).toBe(404);
    expect((await say(stranger, roomId, 'hi')).status).toBe(404);
    await pal(`/api/rooms/${roomId}/leave`, { method: 'POST' });
    expect((await pal(`/api/rooms/${roomId}/messages`)).status).toBe(404);
    expect((await say(pal, roomId, 'still here?')).status).toBe(404);
    expect((await host(`/api/rooms/${roomId}/messages`)).status).toBe(200);
  });

  it('refuses an empty, too long or non-text message, and strips control characters', async () => {
    const { host, roomId } = await pairInRoom('cht-bad');
    expect((await say(host, roomId, '   ')).status).toBe(400);
    expect((await say(host, roomId, 'x'.repeat(501))).status).toBe(400);
    expect((await host(`/api/rooms/${roomId}/messages`, { method: 'POST', body: { body: 42 } })).status).toBe(400);
    expect((await host(`/api/rooms/${roomId}/messages?after=-1`)).status).toBe(400);
    const ok = await (await say(host, roomId, 'a\u0007b  ')).json();
    expect(ok.body).toBe('ab');
    expect((await say(host, roomId, 'x'.repeat(500))).status).toBe(201);
  });

  it('takes no more messages once the room has ended, and keeps the history', async () => {
    const { host, pal, roomId } = await pairInRoom('cht-end');
    await say(host, roomId, 'before the end');
    expect((await host(`/api/rooms/${roomId}/clock`, { method: 'PUT', body: { action: 'end' } })).status).toBe(200);
    expect((await say(pal, roomId, 'after')).status).toBe(409);
    const { messages } = await (await host(`/api/rooms/${roomId}/messages`)).json();
    expect(messages.map((m) => m.body)).toEqual(['before the end']);
  });

  it('limits how fast one person can send', async () => {
    const { host, roomId } = await pairInRoom('cht-rate');
    for (let i = 0; i < CHAT_PER_MINUTE; i++) expect((await say(host, roomId, 'n' + i)).status).toBe(201);
    const res = await say(host, roomId, 'one too many');
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('chat_limit');
  });

  it('is deleted with its room', async () => {
    const host = await createUser('cht-del-h');
    const room = await createRoom(env.DB, host, { flow: FLOW }, Date.now());
    await sendMessage(env.DB, host, room.room.id, { body: 'gone soon' });
    await env.DB.prepare('DELETE FROM rooms WHERE id = ?').bind(room.room.id).run();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM room_messages WHERE room_id = ?').bind(room.room.id).first()).toEqual({ n: 0 });
  });

  it('works from the functions too, for the same checks', async () => {
    const host = await createUser('cht-fn-h');
    const r = await createRoom(env.DB, host, { flow: FLOW }, Date.now());
    const sent = await sendMessage(env.DB, host, r.room.id, { body: 'hello' });
    expect(await listMessages(env.DB, host, r.room.id)).toEqual({ messages: [expect.objectContaining({ id: sent.id, body: 'hello' })] });
    await expect(sendMessage(env.DB, 'nobody', r.room.id, { body: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});
