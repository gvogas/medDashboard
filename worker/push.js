// Push reminders: a morning digest of what is due, sent to each device that asked for it.
//
// The push carries no payload, so nothing needs encrypting: the Worker sends an empty push
// signed with its VAPID key (an ES256 JWT, RFC 8292), and the service worker (public/sw.js)
// fetches GET /api/digest with the session cookie and shows what it says. Without the three
// VAPID secrets push is off: GET /api/push/key says so and the cron sends nothing.
//
// The cron runs hourly (wrangler.jsonc) and sends to each device whose local time is 07:00 to
// 09:59 and has not had today's digest, so an hour the cron missed is made up. Only a day with
// something due today or tomorrow, or overdue, sends anything. The free plan allows 50 outside
// requests per run, so one run sends at most MAX_PUSHES; the rest go the next hour.

import { HttpError, json, readJson } from './http.js';
import { requireUser } from './auth.js';
import { claimLimit, rateLimited } from './limits.js';
import { readRows } from './calendar.js';
import { HOUR_MS, TZ, addDays } from './time.js';

const MAX_DEVICES = 5;                    /* per person; the oldest goes when a sixth comes */
const MAX_PUSHES = 40;                    /* per cron run, under the free plan's 50 outside requests */
const MAX_FAILURES = 5;                   /* in a row, then the device is dropped */
const TEST_LIMIT = 5;                     /* test pushes an hour */
const SEND_FROM = 7, SEND_UNTIL = 9;      /* local hours the digest may go out in */
const OVERDUE_DAYS = 14;                  /* older than this, an open item is not news */
/* Events, not deadlines: they never make a digest. */
const NOT_DUE = { office: 1, tutoring: 1 };
const CLOSED = { done: 1, graded: 1, submitted: 1, missed: 1 };

/* The browsers' push services. Anything else is refused, so the Worker never posts to an address someone made up. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

/** Whether push is set up: the key pair and the subject the push services may write to. */
export const pushReady = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);

// ── VAPID ────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

let cachedKey = null;
/* The private key as a JWK: `d` is the secret, x and y come from the public key (0x04 ‖ x ‖ y). */
function signingKey(env) {
  if (cachedKey?.d !== env.VAPID_PRIVATE_KEY || cachedKey.pub !== env.VAPID_PUBLIC_KEY) {
    const pub = unb64u(env.VAPID_PUBLIC_KEY);
    if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
    const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)), d: env.VAPID_PRIVATE_KEY };
    const key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    cachedKey = { d: env.VAPID_PRIVATE_KEY, pub: env.VAPID_PUBLIC_KEY, key };
    key.catch(() => { if (cachedKey?.key === key) cachedKey = null; });
  }
  return cachedKey.key;
}

/** The Authorization header for a push to `endpoint`: a JWT for its origin, good for 12 hours. */
export async function vapidAuth(env, endpoint, now = Date.now()) {
  const part = (o) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT });
  /* WebCrypto's ECDSA signature is r ‖ s, 64 bytes: already the JWS form */
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(env), enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(new Uint8Array(sig))}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** One empty push. Returns 'ok', 'gone' (404 or 410: the browser unsubscribed) or 'failed'. */
export async function pushOnce(env, endpoint, now = Date.now()) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: await vapidAuth(env, endpoint, now), ttl: String(12 * 3600), urgency: 'normal', 'content-length': '0' },
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/* What a push did, written back: a success clears the failures, a gone device goes, five failures in a row and it goes too. */
function afterPush(db, endpoint, result, now) {
  if (result === 'gone') return [db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint)];
  if (result === 'ok') return [db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE endpoint = ?').bind(now, endpoint)];
  return [
    db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?').bind(endpoint),
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND failures >= ?').bind(endpoint, MAX_FAILURES),
  ];
}

// ── the digest ───────────────────────────────────────────────────────────────

/** The day and hour at `now` in the zone `tz`: { day: 'YYYY-MM-DD', hour: 0–23 }. */
export function localNow(tz, now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** A time zone the Worker can use, else null. */
export function validTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64 || !(TZ.test(tz) || tz === 'UTC')) return null;
  try { localNow(tz); return tz; } catch { return null; }
}

/**
 * What the morning says, from the feed's rows (worker/calendar.js readRows) and the local day:
 * { title, body, today, tomorrow, overdue } with the counts; nothing to say when all three are 0.
 * Open, dated, one-off items count; office hours and tutorials never do. Pure, for tests.
 */
export function digest({ courses, items }, today) {
  const tomorrow = addDays(today, 1), since = addDays(today, -OVERDUE_DAYS);
  const code = new Map(courses.map((c) => [c.id, c.code]));
  const due = items.filter((it) => !CLOSED[it.status] && !NOT_DUE[it.type] && it.recur !== 'weekly' && typeof it.date === 'string');
  const on = (day) => due.filter((it) => it.date === day).sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  const now = on(today), next = on(tomorrow), late = due.filter((it) => it.date < today && it.date >= since);
  const name = (it) => [code.get(it.course_id), it.title, it.start].filter(Boolean).join(' ');
  const list = (rows) => rows.slice(0, 3).map(name).join(' · ') + (rows.length > 3 ? ` · +${rows.length - 3} more` : '');
  const lines = [];
  if (now.length) lines.push('Today: ' + list(now));
  if (next.length) lines.push('Tomorrow: ' + list(next));
  if (late.length) lines.push(late.length === 1 ? 'Overdue: ' + name(late[0]) : `${late.length} overdue`);
  const title = now.length ? `${now.length} due today` : next.length ? `${next.length} due tomorrow` : late.length ? `${late.length} overdue` : 'Nothing due today';
  return { title, body: lines.join('\n') || 'Nothing due today or tomorrow.', today: now.length, tomorrow: next.length, overdue: late.length };
}

async function digestFor(env, userId, day) {
  const user = await env.DB.prepare('SELECT hidden_sources FROM users WHERE id = ?').bind(userId).first();
  if (!user) return null;
  return digest(await readRows(env, userId, user.hidden_sources), day);
}

/**
 * The hourly cron: each device whose morning it is and that has not had today's digest gets a
 * push, when its owner has something due. The day is marked before the push goes, so a run
 * that is retried never sends twice.
 */
export async function sendDigests(env, now = Date.now(), send = pushOnce) {
  if (!pushReady(env)) return { sent: 0 };
  const { results } = await env.DB.prepare('SELECT endpoint, user_id, tz, last_sent_day FROM push_subscriptions ORDER BY user_id, endpoint').all();
  const byUser = new Map();
  for (const s of results) {
    let t;
    try { t = localNow(s.tz, now); } catch { continue; }
    if (t.hour < SEND_FROM || t.hour > SEND_UNTIL || s.last_sent_day === t.day) continue;
    byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), { ...s, day: t.day }]);
  }
  let sent = 0;
  for (const [userId, subs] of byUser) {
    if (sent >= MAX_PUSHES) break;
    const d = await digestFor(env, userId, subs[0].day);
    const going = d && (d.today || d.tomorrow || d.overdue) ? subs.slice(0, MAX_PUSHES - sent) : [];
    /* a quiet morning is marked too, so the next hours do not read it again */
    const marked = d ? (going.length ? going : subs) : [];
    if (marked.length) await env.DB.batch(marked.map((s) => env.DB.prepare('UPDATE push_subscriptions SET last_sent_day = ? WHERE endpoint = ?').bind(s.day, s.endpoint)));
    const outcomes = await Promise.all(going.map(async (s) => afterPush(env.DB, s.endpoint, await send(env, s.endpoint, now), now)));
    sent += going.length;
    if (outcomes.length) await env.DB.batch(outcomes.flat());
  }
  return { sent };
}

// ── routes ───────────────────────────────────────────────────────────────────

/* A push endpoint the browser gave: https, on a known push service, at most 1,000 characters. */
function endpointOf(body) {
  const v = body?.endpoint;
  let url = null;
  try { url = typeof v === 'string' && v.length <= 1000 ? new URL(v) : null; } catch { /* not a URL */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !PUSH_HOSTS.some((h) => h.test(url.hostname))) {
    throw new HttpError(400, { error: 'invalid', field: 'endpoint' });
  }
  return url.href;
}

async function subscribe({ request, env }) {
  const userId = await requireUser(request, env);
  const body = await readJson(request);
  const endpoint = endpointOf(body);
  const tz = validTz(body.tz);
  if (!tz) throw new HttpError(400, { error: 'invalid', field: 'tz' });
  if (!pushReady(env)) throw new HttpError(503, { error: 'push_off' });
  const now = Date.now();
  await env.DB.batch([
    /* a device that changed hands moves to whoever signed in on it */
    env.DB.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, tz, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, tz = excluded.tz, created_at = excluded.created_at, failures = 0,
        last_sent_day = CASE WHEN push_subscriptions.user_id = excluded.user_id THEN push_subscriptions.last_sent_day END`).bind(endpoint, userId, tz, now),
    env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint NOT IN
      (SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY created_at DESC, endpoint LIMIT ${MAX_DEVICES})`).bind(userId),
  ]);
  return new Response(null, { status: 204 });
}

async function unsubscribe({ request, env }) {
  const userId = await requireUser(request, env);
  const endpoint = endpointOf(await readJson(request));
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).run();
  return new Response(null, { status: 204 });
}

/* A push now, to one of your own devices, so you can see that it works. */
async function testPush({ request, env }) {
  const userId = await requireUser(request, env);
  const endpoint = endpointOf(await readJson(request));
  if (!pushReady(env)) throw new HttpError(503, { error: 'push_off' });
  const mine = await env.DB.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).first();
  if (!mine) throw new HttpError(404, { error: 'not_found' });
  const wait = await claimLimit(env.DB, `pushtest:${userId}`, TEST_LIMIT, Date.now(), HOUR_MS);
  if (wait) throw rateLimited(wait);
  const now = Date.now(), result = await pushOnce(env, endpoint, now);
  await env.DB.batch(afterPush(env.DB, endpoint, result, now));
  return json({ result });
}

export const pushRoutes = [
  ['GET', /^\/api\/push\/key$/, async ({ request, env }) => {
    await requireUser(request, env);
    return json(pushReady(env) ? { enabled: true, key: env.VAPID_PUBLIC_KEY } : { enabled: false, key: null });
  }],
  ['POST', /^\/api\/push$/, subscribe],
  ['DELETE', /^\/api\/push$/, unsubscribe],
  ['POST', /^\/api\/push\/test$/, testPush],
  // What the service worker shows when a push arrives; `tz` is the device's zone.
  ['GET', /^\/api\/digest$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    const tz = validTz(url.searchParams.get('tz')) || 'UTC';
    return json(await digestFor(env, userId, localNow(tz).day));
  }],
];
