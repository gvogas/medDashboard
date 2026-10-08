// Term Pro (docs/MONETIZATION.md). The `plans` table says who has it; this file reads it,
// takes the App Store's word for it from RevenueCat's webhook, and lets an admin give it.
//
// The paywall is off until PAYWALL is "on" (wrangler.jsonc vars): until then everyone gets
// what Pro gets, so the accounts made before it keep everything they have today. Even on, it
// applies only in the iPhone/iPad/Mac app (`app`, worker/app.js fromApp): the website stays
// open to everyone.

import { json, readJson, HttpError } from './http.js';
import { sameString } from './auth.js';

export const FREE = 'free', PRO = 'pro';
/* The RevenueCat entitlement that means Pro; the dashboard's must have the same id. */
export const ENTITLEMENT = 'pro';
const EVENT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export const paywallOn = (env) => env.PAYWALL === 'on';

/** {tier, source, expiresAt, renews, paywall}: the person's real tier, and whether the paywall
    applies to this request: only to the app's, and only while PAYWALL is on. */
export async function planOf(env, userId, { app = false, now = Date.now() } = {}) {
  const row = await env.DB.prepare('SELECT tier, source, expires_at, renews FROM plans WHERE user_id = ?').bind(userId).first();
  const live = row && (row.expires_at === null || row.expires_at > now);
  return {
    tier: live ? row.tier : FREE,
    source: live ? row.source : null,
    expiresAt: live ? row.expires_at : null,
    renews: !!(live && row.renews),
    paywall: paywallOn(env) && app,
  };
}

/** Whether the person gets Pro's features: they have it, or the paywall does not apply. */
export const hasPro = (plan) => !plan.paywall || plan.tier === PRO;

// ── RevenueCat ──────────────────────────────────────────────────────────────
// The app calls `Purchases.logIn(<user id>)`, so `app_user_id` is ours. Each event carries the
// entitlement's current expiry, which is all a row needs. A late, older event is ignored
// (event_at), and a delivered id is never applied twice (billing_events). A comp is the
// admin's and a store event leaves it alone.

const RENEWING = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED', 'REFUND_REVERSED'];
const STOPPED = ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED'];
const ONE_OFF = ['NON_RENEWING_PURCHASE', 'TEMPORARY_ENTITLEMENT_GRANT'];
const ms = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);

/** What an event does to the plans table: null when it changes nothing we keep. */
export function planChange(event) {
  if (!event || typeof event !== 'object') return null;
  const type = event.type;
  if (![...RENEWING, ...STOPPED, ...ONE_OFF].includes(type)) return null;     /* TEST, TRANSFER, invoices… */
  if (typeof event.app_user_id !== 'string' || !event.app_user_id || event.app_user_id.startsWith('$RCAnonymousID')) return null;
  if (Array.isArray(event.entitlement_ids) && !event.entitlement_ids.includes(ENTITLEMENT)) return null;
  const at = ms(event.event_timestamp_ms);
  if (!at) return null;
  return {
    userId: event.app_user_id.slice(0, 64),
    /* a lifetime purchase has no expiry */
    expiresAt: ms(event.expiration_at_ms),
    renews: RENEWING.includes(type) ? 1 : 0,
    product: typeof event.product_id === 'string' ? event.product_id.slice(0, 100) : '',
    at,
  };
}

async function revenueCatWebhook({ request, env }) {
  const secret = env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, { error: 'billing_not_configured' });
  const given = /^Bearer (.{1,200})$/.exec(request.headers.get('authorization') || '')?.[1] || '';
  if (!sameString(given, secret)) throw new HttpError(401, { error: 'unauthenticated' });
  const { event } = await readJson(request);
  if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 100) throw new HttpError(400, { error: 'invalid', field: 'event' });
  /* TestFlight buys in the sandbox; those count only where the sandbox is allowed */
  if (event.environment === 'SANDBOX' && env.BILLING_SANDBOX !== 'on') return json({ ok: true, applied: false });
  const change = planChange(event);
  const db = env.DB, now = Date.now();
  const claim = db.prepare('INSERT INTO billing_events (id, at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING').bind(event.id, now);
  if (!change) { await claim.run(); return json({ ok: true, applied: false }); }
  /* one transaction: the id is recorded only with its write, and a retry (changes() = 0 after the claim) writes nothing */
  const [, { meta }] = await db.batch([claim, db.prepare(`
    INSERT INTO plans (user_id, tier, source, expires_at, product, renews, event_at, updated_at)
    SELECT ?1, 'pro', 'app_store', ?2, ?3, ?4, ?5, ?6 WHERE changes() > 0 AND EXISTS (SELECT 1 FROM users WHERE id = ?1)
    ON CONFLICT (user_id) DO UPDATE SET source = 'app_store', expires_at = excluded.expires_at, product = excluded.product,
      renews = excluded.renews, event_at = excluded.event_at, updated_at = excluded.updated_at
    WHERE plans.source != 'comp' AND plans.event_at <= excluded.event_at`)
    .bind(change.userId, change.expiresAt, change.product, change.renews, change.at, now)]);
  return json({ ok: true, applied: meta.changes > 0 });
}

/** The nightly cron: forget delivered event ids after 30 days. */
export async function purgeBillingEvents(db, now = Date.now()) {
  await db.prepare('DELETE FROM billing_events WHERE at < ?').bind(now - EVENT_KEEP_MS).run();
}

/** An admin's comp: Pro for `days`, or with no end for null; `pro: false` takes a comp away. */
export async function setComp(db, userId, pro, days, now = Date.now()) {
  if (!pro) {
    await db.prepare("DELETE FROM plans WHERE user_id = ? AND source = 'comp'").bind(userId).run();
    return;
  }
  const expiresAt = days === null ? null : now + days * 24 * 60 * 60 * 1000;
  await db.prepare(`INSERT INTO plans (user_id, tier, source, expires_at, product, renews, event_at, updated_at)
    VALUES (?1, 'pro', 'comp', ?2, '', 0, 0, ?3)
    ON CONFLICT (user_id) DO UPDATE SET tier = 'pro', source = 'comp', expires_at = ?2, product = '', renews = 0, updated_at = ?3`)
    .bind(userId, expiresAt, now).run();
}

export const planRoutes = [
  ['POST', /^\/api\/billing\/revenuecat$/, revenueCatWebhook],
];
