import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { planOf, hasPro, planChange, setComp, purgeBillingEvents } from '../worker/plans.js';
import { createUser, signIn, PASSWORD } from './helpers.js';

const BASE = 'http://localhost';
const DAY = 24 * 60 * 60 * 1000;
const ON = { ...env, PAYWALL: 'on' };
const APP = { app: true };

let n = 0;
const event = (userId, extra = {}) => ({
  id: `evt-${++n}`, type: 'INITIAL_PURCHASE', app_user_id: userId, entitlement_ids: ['pro'], product_id: 'term_pro_yearly',
  event_timestamp_ms: Date.now(), expiration_at_ms: Date.now() + 365 * DAY, environment: 'PRODUCTION', ...extra,
});
const hook = (body, secret = 'test-revenuecat-secret') => SELF.fetch(`${BASE}/api/billing/revenuecat`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify(body),
});

describe('plans', () => {
  it('no row is the free plan, and the paywall off gives everyone Pro', async () => {
    const id = await createUser('freebie');
    const plan = await planOf(env, id);
    expect(plan).toMatchObject({ tier: 'free', source: null, paywall: false });
    expect(hasPro(plan)).toBe(true);
    expect(hasPro(await planOf(ON, id, APP))).toBe(false);
  });

  it('the paywall applies only in the app: the website stays open even with it on', async () => {
    const id = await createUser('webonly');
    const web = await planOf(ON, id);
    expect(web).toMatchObject({ tier: 'free', paywall: false });
    expect(hasPro(web)).toBe(true);
    expect(hasPro(await planOf(ON, id, APP))).toBe(false);
  });

  it('a comp is Pro until it ends, and can be taken back', async () => {
    const id = await createUser('comped');
    await setComp(env.DB, id, true, 30);
    expect(await planOf(ON, id, APP)).toMatchObject({ tier: 'pro', source: 'comp' });
    expect((await planOf(ON, id, { app: true, now: Date.now() + 31 * DAY })).tier).toBe('free');
    await setComp(env.DB, id, true, null);
    expect(await planOf(ON, id, { app: true, now: Date.now() + 9999 * DAY })).toMatchObject({ tier: 'pro', expiresAt: null });
    await setComp(env.DB, id, false);
    expect((await planOf(ON, id, APP)).tier).toBe('free');
  });

  it('/api/me and /api/plan say the plan', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    expect(me.plan).toMatchObject({ tier: 'free', paywall: false });
    expect(await (await api('/api/plan')).json()).toMatchObject({ tier: 'free' });
  });
});

describe('RevenueCat webhook', () => {
  it('needs the shared secret', async () => {
    expect((await hook({ event: event('u-x') }, 'wrong')).status).toBe(401);
  });

  it('a purchase gives Pro, a retry is skipped, a late older event is ignored', async () => {
    const id = await createUser('buyer');
    const first = event(id);
    expect(await (await hook({ event: first })).json()).toEqual({ ok: true, applied: true });
    expect(await planOf(ON, id, APP)).toMatchObject({ tier: 'pro', source: 'app_store', renews: true });
    expect(await (await hook({ event: first })).json()).toEqual({ ok: true, applied: false });
    // cancelled: still Pro to the end of the period, no longer renewing
    await hook({ event: event(id, { type: 'CANCELLATION', event_timestamp_ms: Date.now() + 1000 }) });
    expect(await planOf(ON, id, APP)).toMatchObject({ tier: 'pro', renews: false });
    // an older renewal arriving now changes nothing
    expect(await (await hook({ event: event(id, { type: 'RENEWAL', event_timestamp_ms: Date.now() - DAY }) })).json()).toMatchObject({ applied: false });
    expect((await planOf(ON, id, APP)).renews).toBe(false);
    // expired
    await hook({ event: event(id, { type: 'EXPIRATION', event_timestamp_ms: Date.now() + 2000, expiration_at_ms: Date.now() - 1 }) });
    expect((await planOf(ON, id, APP)).tier).toBe('free');
  });

  it('ignores the sandbox, other entitlements, unknown users and test events', async () => {
    const id = await createUser('ignored');
    for (const extra of [{ environment: 'SANDBOX' }, { entitlement_ids: ['other'] }, { app_user_id: 'u-nobody' }, { type: 'TEST' }, { app_user_id: '$RCAnonymousID:abc' }]) {
      const res = await hook({ event: event(id, extra) });
      expect(res.status).toBe(200);
    }
    expect((await planOf(ON, id, APP)).tier).toBe('free');
    expect(await env.DB.prepare("SELECT 1 FROM plans WHERE user_id = 'u-nobody'").first()).toBeNull();
  });

  it('leaves a comp alone', async () => {
    const id = await createUser('compkeep');
    await setComp(env.DB, id, true, null);
    await hook({ event: event(id, { type: 'EXPIRATION', expiration_at_ms: Date.now() - 1 }) });
    expect(await planOf(ON, id, APP)).toMatchObject({ tier: 'pro', source: 'comp' });
  });

  it('reads the parts of an event it needs', () => {
    expect(planChange({ type: 'NON_RENEWING_PURCHASE', app_user_id: 'u-a', event_timestamp_ms: 5 })).toMatchObject({ userId: 'u-a', expiresAt: null, renews: 0 });
    expect(planChange({ type: 'TRANSFER', app_user_id: 'u-a', event_timestamp_ms: 5 })).toBeNull();
    expect(planChange({ type: 'RENEWAL', app_user_id: 'u-a' })).toBeNull();
  });

  it('old delivery ids are purged', async () => {
    await env.DB.prepare('INSERT INTO billing_events (id, at) VALUES (?, ?)').bind('old-one', Date.now() - 31 * DAY).run();
    await purgeBillingEvents(env.DB);
    expect(await env.DB.prepare("SELECT 1 FROM billing_events WHERE id = 'old-one'").first()).toBeNull();
  });
});

describe('admin comp', () => {
  it('an admin can give and take Pro, and the account list shows it', async () => {
    const admin = await signIn();
    await env.DB.prepare("UPDATE users SET is_admin = 1 WHERE username = (SELECT username FROM users ORDER BY created_at DESC LIMIT 1)").run();
    const id = await createUser('compee');
    expect((await admin(`/api/admin/accounts/${id}/plan`, { method: 'PUT', body: { pro: true, days: 0 } })).status).toBe(400);
    expect((await admin(`/api/admin/accounts/${id}/plan`, { method: 'PUT', body: { pro: true, days: 90 } })).status).toBe(204);
    const { accounts } = await (await admin('/api/admin/accounts')).json();
    expect(accounts.find((a) => a.id === id).plan).toMatchObject({ source: 'comp' });
    expect((await admin(`/api/admin/accounts/${id}/plan`, { method: 'PUT', body: { pro: false } })).status).toBe(204);
    expect((await planOf(ON, id, APP)).tier).toBe('free');
  });
});

describe('DELETE /api/me', () => {
  it('needs the username and the password, then removes everything', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    await api('/api/quotes/q1', { method: 'PUT', body: { text: 'bye', source: '' } });
    await setComp(env.DB, me.id, true, null);
    expect((await api('/api/me', { method: 'DELETE', body: { confirm: 'nope', password: PASSWORD } })).status).toBe(400);
    expect((await api('/api/me', { method: 'DELETE', body: { confirm: me.username, password: 'wrong password' } })).status).toBe(403);
    const res = await api('/api/me', { method: 'DELETE', body: { confirm: me.username, password: PASSWORD } });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(me.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM quotes WHERE user_id = ?').bind(me.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM plans WHERE user_id = ?').bind(me.id).first()).toBeNull();
    expect((await api('/api/me')).status).toBe(401);
  });
});

describe('the theme in the profile', () => {
  it('saves Notebook in look, and the six in both columns; leaving it out keeps it', async () => {
    const api = await signIn();
    const me = await (await api('/api/me')).json();
    expect(me.bg).toBe('note');
    const save = async (extra) => (await api('/api/me', { method: 'PUT', body: { coat: me.coat, theme: 'system', termStart: null, displayName: '', ...extra } })).json();
    expect((await save({ bg: 'law' })).bg).toBe('law');
    expect(await env.DB.prepare('SELECT look, bg FROM users WHERE id = ?').bind(me.id).first()).toEqual({ look: 'law', bg: 'law' });
    expect((await save({ bg: 'note' })).bg).toBe('note');
    expect(await env.DB.prepare('SELECT look, bg FROM users WHERE id = ?').bind(me.id).first()).toEqual({ look: 'note', bg: 'law' });
    expect((await save({})).bg).toBe('note');
  });
});
