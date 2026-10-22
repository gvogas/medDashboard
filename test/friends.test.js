// Friends (study together, Stage 1): the schema, requests, search, settings, the inbox.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';

describe('the friendships table', () => {
  it('keeps one row per pair, smaller id first, and drops it with either account', async () => {
    const a = await createUser('fs-a'), b = await createUser('fs-b');
    const ins = (lo, hi, by) => env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at) VALUES (?, ?, ?, 'pending', 1)").bind(lo, hi, by).run();
    await expect(ins(b, a, a)).rejects.toThrow(/CHECK constraint failed/);           /* u-fs-b > u-fs-a */
    await expect(ins(a, b, 'u-someone')).rejects.toThrow(/CHECK constraint failed/);  /* requester not in the pair */
    await ins(a, b, a);
    await expect(ins(a, b, b)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(b).run();
    expect(await env.DB.prepare('SELECT count(*) AS n FROM friendships WHERE user_lo = ?').bind(a).first()).toEqual({ n: 0 });
  });

  it('defaults the settings to on for someone with no row', async () => {
    const api = await signIn('fs-c');
    const body = await (await api('/api/friends')).json();
    expect(body.settings).toEqual({ findable: true, showStudying: true });
  });
});

/* a signed-in user who knows their own username and id (helpers.js makes ids 'u-' + username) */
async function person(name) {
  const api = await signIn(name);
  api.username = name;
  api.id = 'u-' + name;
  return api;
}

describe('GET /api/friends', () => {
  it('lists friends, requests to you and from you, by name', async () => {
    const ann = await person('fr-ann'), bob = await person('fr-bob'), cat = await person('fr-cat'), dan = await person('fr-dan');
    await env.DB.prepare("UPDATE users SET display_name = 'Bob B' WHERE id = ?").bind(bob.id).run();
    await ann('/api/friends', { method: 'POST', body: { username: 'fr-bob' } });
    await bob(`/api/friends/${ann.id}`, { method: 'PUT', body: { accept: true } });
    await cat('/api/friends', { method: 'POST', body: { username: 'fr-ann' } });
    await ann('/api/friends', { method: 'POST', body: { username: 'fr-dan' } });
    const body = await (await ann('/api/friends')).json();
    expect(body.friends.map((f) => [f.userId, f.username, f.name])).toEqual([[bob.id, 'fr-bob', 'Bob B']]);
    expect(body.incoming.map((f) => f.userId)).toEqual([cat.id]);
    expect(body.sent.map((f) => f.userId)).toEqual([dan.id]);
  });

  it('saves the two switches', async () => {
    const eve = await person('fr-eve');
    expect((await eve('/api/friends/settings', { method: 'PUT', body: { findable: false, showStudying: true } })).status).toBe(204);
    expect((await (await eve('/api/friends')).json()).settings).toEqual({ findable: false, showStudying: true });
    expect((await eve('/api/friends/settings', { method: 'PUT', body: { findable: 'no' } })).status).toBe(400);
  });
});

describe('friend requests', () => {
  const ask = (api, username) => api('/api/friends', { method: 'POST', body: { username } });
  const answer = (api, id, accept) => api(`/api/friends/${encodeURIComponent(id)}`, { method: 'PUT', body: { accept } });
  const drop = (api, id) => api(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const lists = async (api) => (await api('/api/friends')).json();

  it('asks, and the other person accepts', async () => {
    const a = await person('rq-a'), b = await person('rq-b');
    const res = await ask(a, 'rq-b');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: b.id, username: 'rq-b', name: 'rq-b', state: 'requested' });
    expect((await answer(b, a.id, true)).status).toBe(204);
    expect((await lists(a)).friends.map((f) => f.userId)).toEqual([b.id]);
    expect((await lists(b)).friends.map((f) => f.userId)).toEqual([a.id]);
    expect((await ask(a, 'rq-b')).status).toBe(409);
  });

  it('accepts when the other person already asked', async () => {
    const a = await person('rq-c'), b = await person('rq-d');
    await ask(a, 'rq-d');
    const res = await ask(b, 'rq-c');
    expect((await res.json()).state).toBe('friends');
  });

  it('declines silently: the asker still sees Requested, and may cancel', async () => {
    const a = await person('rq-e'), b = await person('rq-f');
    await ask(a, 'rq-f');
    const before = (await lists(a)).sent;
    expect((await answer(b, a.id, false)).status).toBe(204);
    expect((await lists(a)).sent).toEqual(before);             /* nothing changes for the asker, not even the time */
    expect(before.map((f) => f.userId)).toEqual([b.id]);
    expect((await lists(b)).incoming).toEqual([]);
    expect((await ask(a, 'rq-f')).status).toBe(200);           /* asking again changes nothing */
    expect((await lists(b)).incoming).toEqual([]);
    expect((await drop(a, b.id)).status).toBe(204);
    expect((await lists(a)).sent).toEqual([]);
  });

  it('lets the one who declined ask later', async () => {
    const a = await person('rq-g'), b = await person('rq-h');
    await ask(a, 'rq-h');
    await answer(b, a.id, false);
    expect((await (await ask(b, 'rq-g')).json()).state).toBe('requested');
    expect((await lists(a)).incoming.map((f) => f.userId)).toEqual([b.id]);
  });

  it('removes a friend, and refuses what does not fit', async () => {
    const a = await person('rq-i'), b = await person('rq-j');
    expect((await ask(a, 'nobody-here')).status).toBe(404);
    expect((await ask(a, 'rq-i')).status).toBe(400);           /* yourself */
    expect((await answer(a, b.id, true)).status).toBe(404);    /* nothing to answer */
    await ask(a, 'rq-j');
    expect((await answer(a, b.id, true)).status).toBe(404);    /* you cannot accept your own */
    expect((await drop(b, a.id)).status).toBe(404);            /* answer it instead */
    await answer(b, a.id, true);
    expect((await drop(b, a.id)).status).toBe(204);
    expect((await lists(a)).friends).toEqual([]);
  });

  it('allows 20 requests a day', async () => {
    const a = await person('rq-k');
    for (let i = 0; i < 20; i++) await ask(a, 'nobody-' + i);   /* unknown names count too */
    expect((await ask(a, 'nobody-x')).status).toBe(429);
  });

  const fill = async (a, tag) => {
    const stmts = [];
    for (let i = 0; i < 200; i++) {
      const id = await createUser(`${tag}-${i}`);
      const [lo, hi] = [a.id, id].sort();
      stmts.push(env.DB.prepare("INSERT INTO friendships (user_lo, user_hi, requested_by, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', 1, 1)").bind(lo, hi, lo));
    }
    await env.DB.batch(stmts);
  };

  it('stops at 200 friends', async () => {
    const a = await person('rq-l'), b = await person('rq-m');
    await fill(a, 'rq-many');
    await ask(b, 'rq-l');
    const res = await answer(a, b.id, true);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('friend_limit');
  });

  it('stops at 200 friends when the one who asked is full', async () => {
    const a = await person('rq-n'), b = await person('rq-o');
    await ask(a, 'rq-o');
    await fill(a, 'rq-full');
    const res = await answer(b, a.id, true);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('friend_limit');
  });

  it('refuses an auto-accept when one side is full', async () => {
    const a = await person('rq-p'), b = await person('rq-q');
    await ask(a, 'rq-q');
    await fill(b, 'rq-fullb');
    const res = await ask(b, 'rq-p');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('friend_limit');
  });

  it('keeps a third person out of another pair', async () => {
    const a = await person('rq-r'), b = await person('rq-s'), c = await person('rq-t');
    await ask(a, 'rq-s');
    expect((await answer(c, a.id, true)).status).toBe(404);
    expect((await drop(c, a.id)).status).toBe(404);
    expect((await drop(c, b.id)).status).toBe(404);
    await answer(b, a.id, true);
    expect((await drop(c, a.id)).status).toBe(404);
    expect((await lists(a)).friends.map((f) => f.userId)).toEqual([b.id]);
  });
});
