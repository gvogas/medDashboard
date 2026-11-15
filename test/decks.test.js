// Study Buddy, Stage 3: decks, cards, card_state and card_reviews as rows, and sync v4.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createUser, signIn } from './helpers.js';
import { makeSpace } from './spaces.js';
import { personal, syncPageV3, V4_KINDS } from '../worker/db.js';

const deck = (api, id, body = {}) => api(`/api/decks/${id}`, { method: 'PUT', body: { title: 'Pharmacology', courseId: null, ...body } });
const card = (api, id, deckId, body = {}) => api(`/api/cards/${id}`, { method: 'PUT', body: { deckId, front: 'Beta blocker suffix?', back: '-olol', ...body } });
const state = (api, id, body = {}) => api(`/api/card_state/${id}`, { method: 'PUT', body: { due: '2026-11-03', interval: 1, ease: 2.5, reps: 1, lapses: 0, ...body } });
const review = (api, id, body = {}) => api(`/api/card_reviews/${id}`, { method: 'PUT', body: { cardRef: 'k1', deckRef: 'd1', day: '2026-11-02', grade: 'good', at: Date.now(), ...body } });

describe('decks and cards', () => {
  it('saves a deck and its cards with you as the author, and reads them back', async () => {
    const api = await signIn('dk-save');
    const d = await (await deck(api, 'd1', { courseId: 'pharm' })).json();
    expect(d).toMatchObject({ id: 'd1', title: 'Pharmacology', courseId: 'pharm', classId: null, authorId: 'u-dk-save', revision: expect.any(Number) });
    const c = await (await card(api, 'k1', 'd1')).json();
    expect(c).toMatchObject({ id: 'k1', deckId: 'd1', front: 'Beta blocker suffix?', back: '-olol', source: 'hand', authorId: 'u-dk-save' });
    expect((await api('/api/cards/k1')).status).toBe(200);
  });

  it('puts a card only in a live deck of yours', async () => {
    const api = await signIn('dk-guard'), other = await signIn('dk-guard-o');
    await deck(other, 'theirs');
    expect(await (await card(api, 'k1', 'theirs')).json()).toEqual({ error: 'invalid', field: 'deckId' });
    expect((await card(api, 'k2', 'nope')).status).toBe(400);
  });

  it('checks the fields', async () => {
    const api = await signIn('dk-valid');
    expect((await deck(api, 'd1', { title: '' })).status).toBe(400);
    expect((await deck(api, 'd2', { title: 'x'.repeat(81) })).status).toBe(400);
    await deck(api, 'd3');
    expect((await card(api, 'k1', 'd3', { front: 'x'.repeat(501) })).status).toBe(400);
    expect((await card(api, 'k2', 'd3', { source: 'magic' })).status).toBe(400);
    expect((await state(api, 'k3', { ease: 1.2 })).status).toBe(400);
    expect((await state(api, 'k4', { interval: 181 })).status).toBe(400);
    expect((await review(api, 'r1', { grade: 'hard' })).status).toBe(400);
  });

  it('deleting a deck deletes its cards and your schedule for them; deleting a card deletes its schedule', async () => {
    const api = await signIn('dk-del');
    await deck(api, 'd1');
    await card(api, 'k1', 'd1'); await card(api, 'k2', 'd1');
    await state(api, 'k1'); await state(api, 'k2');
    expect((await api('/api/cards/k2', { method: 'DELETE' })).status).toBe(204);
    const live = async (t, col = 'user_id', who = 'u-dk-del') => (await env.DB.prepare(`SELECT id FROM ${t} WHERE ${col} = ? AND deleted_at IS NULL ORDER BY id`).bind(who).all()).results.map((r) => r.id);
    expect(await live('card_state')).toEqual(['k1']);
    expect((await api('/api/decks/d1', { method: 'DELETE' })).status).toBe(204);
    expect(await live('cards', 'scope', 'u:u-dk-del')).toEqual([]);
    expect(await live('card_state')).toEqual([]);
  });

  it('does not count a schedule as due once its card is gone: a first review that syncs after another device deleted the card', async () => {
    const { flashcardDays } = await import('../worker/calendar.js');
    const api = await signIn('dk-orphan');
    await api('/api/buddy/settings', { method: 'PUT', body: { enabled: true, tz: 'UTC', cardsInFeed: true } });
    await deck(api, 'd1'); await card(api, 'k1', 'd1'); await card(api, 'k2', 'd1');
    expect((await api('/api/cards/k1', { method: 'DELETE' })).status).toBe(204);            /* device B deletes k1 */
    expect((await state(api, 'k1')).status).toBe(200);                                      /* device A uploads its schedule for it afterwards */
    expect((await state(api, 'k2')).status).toBe(200);                                      /* and for a card that is still there */
    const now = Date.UTC(2026, 10, 20, 12);
    expect(await flashcardDays(env.DB, 'u-dk-orphan', now)).toEqual([{ day: '2026-11-20', n: 1 }]);   /* k2 alone */
    expect((await (await api('/api/buddy')).json()).due).toBe(1);
    /* a class's card counts for a member, and stops counting when they leave the class */
    const cls = await makeSpace({ members: { 'u-dk-orphan': 'member' } });
    await env.DB.prepare("INSERT INTO cards (scope, id, deck_id, author_id, front, back, created_at, updated_at) VALUES (?, 'k9', 'sd1', 'u-x', 'Q', 'A', 1, 1)").bind(cls.scope).run();
    expect((await state(api, 'k9')).status).toBe(200);
    expect(await flashcardDays(env.DB, 'u-dk-orphan', now)).toEqual([{ day: '2026-11-20', n: 2 }]);
    await env.DB.prepare("UPDATE members SET deleted_at = 1 WHERE space_id = ? AND user_id = 'u-dk-orphan'").bind(cls.id).run();
    expect(await flashcardDays(env.DB, 'u-dk-orphan', now)).toEqual([{ day: '2026-11-20', n: 1 }]);
  });

  it('goes with the account', async () => {
    const api = await signIn('dk-gone');
    await deck(api, 'd1'); await card(api, 'k1', 'd1'); await state(api, 'k1'); await review(api, 'r1');
    const { DELETE_ACCOUNT } = await import('../worker/accounts.js');
    await env.DB.batch(DELETE_ACCOUNT.map((q) => env.DB.prepare(q).bind(...[...Array(5)].map((_, i) => ['u-dk-gone', Date.now(), 'dk-gone', 'test', ''][i]).slice(0, (q.match(/\?(\d)/g) || []).reduce((m, x) => Math.max(m, +x.slice(1)), 0)))));
    for (const t of ['decks', 'cards']) expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE scope = 'u:u-dk-gone'`).first()).n).toBe(0);
    for (const t of ['card_state', 'card_reviews']) expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE user_id = 'u-dk-gone'`).first()).n).toBe(0);
  });
});

describe('sync v4', () => {
  it('sends the flashcard kinds on v4 only; v3 keeps its seven', async () => {
    const api = await signIn('dk-sync');
    await deck(api, 'd1'); await card(api, 'k1', 'd1'); await state(api, 'k1'); await review(api, 'r1');
    const kinds = async (v) => (await (await api(`/api/sync?v=${v}&cursors=`)).json()).changes.map((c) => c.kind);
    expect(await kinds(3)).toEqual([]);
    expect(await kinds(4)).toEqual(['decks', 'cards', 'card_state', 'card_reviews']);
    const page = await (await api('/api/sync?v=4&cursors=')).json();
    expect(page.changes[1]).toMatchObject({ scope: personal('u-dk-sync'), row: { id: 'k1', deckId: 'd1', front: 'Beta blocker suffix?' } });
  });

  it("carries a class's shared decks and cards to its members on v4, never on v3", async () => {
    const ana = await createUser('dk-class'), owner = await createUser('dk-class-o');
    const web = await makeSpace({ members: { [owner]: 'owner', [ana]: 'member' } });
    const now = Date.now();
    await env.DB.prepare('INSERT INTO decks (scope, id, author_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(web.scope, 'sd1', owner, 'Shared', now, now).run();
    await env.DB.prepare('INSERT INTO cards (scope, id, deck_id, author_id, front, back, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(web.scope, 'sk1', 'sd1', owner, 'Q', 'A', now, now).run();
    const pick = (p) => p.changes.filter((c) => c.scope === web.scope && c.kind !== 'courses').map((c) => `${c.kind}:${c.row.id}`);
    expect(pick(await syncPageV3(env.DB, ana, [], 0))).toEqual([]);
    const v4 = await syncPageV3(env.DB, ana, [], 0, 100, { kinds: V4_KINDS });
    expect(pick(v4)).toEqual(['decks:sd1', 'cards:sk1']);
    expect(v4.changes.find((c) => c.kind === 'decks').row).toMatchObject({ scope: web.scope, title: 'Shared', authorId: owner });
  });
});
