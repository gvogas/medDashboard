import { HttpError } from './http.js';
import { DAY_MS } from './time.js';

export const API_LIMIT = 600;
export const SPOTIFY_LIMIT = 60;
// Course outlines use Workers AI's free daily allowance; a few a day each is plenty.
export const OUTLINE_DAILY_LIMIT = 10;
const LOGIN_IP_LIMIT = 30;
const WINDOW_MS = 60_000;
const SPOTIFY_EXEMPT = ['/api/spotify/token', '/api/spotify/status', '/api/spotify/connect', '/api/spotify/callback'];

export function rateLimited(seconds, error = 'rate_limited') {
  const retryAfter = Math.max(1, Math.ceil(seconds));
  return new HttpError(429, { error, retryAfter }, { 'retry-after': String(retryAfter) });
}

/**
 * An atomic fixed window; rejected requests cannot extend it or increment it. `guard`
 * is SQL that must hold for the hit to count at all, with its own bindings from ?5.
 */
function claimStmt(db, key, limit, now, windowMs, guard = 'true', ...guardArgs) {
  return db.prepare(`
    INSERT INTO request_limits (key, hits, reset_at) SELECT ?1, 1, ?2 + ?3 WHERE ${guard}
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN reset_at <= ?2 THEN 1 ELSE hits + 1 END,
      reset_at = CASE WHEN reset_at <= ?2 THEN ?2 + ?3 ELSE reset_at END
    WHERE reset_at <= ?2 OR hits < ?4
    RETURNING reset_at
  `).bind(key, now, windowMs, limit, ...guardArgs);
}

export async function claimLimit(db, key, limit, now = Date.now(), windowMs = WINDOW_MS) {
  const row = await claimStmt(db, key, limit, now, windowMs).first();
  if (row) return 0;
  return Math.max(1, await cooldownRemaining(db, key, now));
}

export const cooldownStmt = (db, key) => db.prepare('SELECT reset_at FROM request_limits WHERE key = ?').bind(key);
/** Whole seconds until a request_limits row resets; 0 for none. */
export const secondsLeft = (row, now) => Math.max(0, Math.ceil(((row?.reset_at || 0) - now) / 1000));

export async function cooldownRemaining(db, key, now = Date.now()) {
  return secondsLeft(await cooldownStmt(db, key).first(), now);
}

export async function setCooldown(db, key, seconds, now = Date.now()) {
  await db.prepare(`INSERT INTO request_limits (key, hits, reset_at) VALUES (?, 0, ?)
    ON CONFLICT (key) DO UPDATE SET reset_at = max(reset_at, excluded.reset_at)`)
    .bind(key, now + seconds * 1000).run();
}

export async function limitLogin(request, env) {
  // Cloudflare supplies this header. Do not trust X-Forwarded-For supplied by a client.
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return; // Local development and direct unit tests have no edge address.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  const key = 'login-ip:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const wait = await claimLimit(env.DB, key, LOGIN_IP_LIMIT);
  if (wait) throw rateLimited(wait, 'too_many_attempts');
}

/** Whether a request counts toward the Spotify budget as well as the API's. */
function spotifyCounted(request) {
  const path = new URL(request.url).pathname;
  // SDK token retrieval and disconnect remain available during a Spotify API cooldown.
  // The player poll is exempt too: it is the steady background read. The API limit still bounds it.
  return path.startsWith('/api/spotify/') && !SPOTIFY_EXEMPT.includes(path) && !(request.method === 'GET' && path === '/api/spotify/player');
}

/**
 * Check the session's generation, then count the request. False when the user is gone or
 * signed out everywhere (nothing is counted then); a 429 when a budget is spent.
 *
 * The counting is Cloudflare's rate-limiting bindings (API_LIMITER, SPOTIFY_LIMITER in
 * wrangler.jsonc), so a request reads D1 once and writes nothing. They count per Cloudflare
 * location and settle in the background, so a burst can pass the limit a little: they bound
 * abuse, not exact use. Without them (a config that leaves them out) the windows are D1 rows.
 */
export async function limitUser(request, env, userId, gen, now = Date.now()) {
  const spotify = spotifyCounted(request);
  if (!env.API_LIMITER || (spotify && !env.SPOTIFY_LIMITER)) return limitUserInD1(env.DB, userId, gen, spotify, now);
  const user = await env.DB.prepare('SELECT pw_gen FROM users WHERE id = ?').bind(userId).first();
  if (user?.pw_gen !== gen) return false;
  if (!(await env.API_LIMITER.limit({ key: userId })).success) throw rateLimited(WINDOW_MS / 1000);
  // Counted only when the API hit was.
  if (spotify && !(await env.SPOTIFY_LIMITER.limit({ key: userId })).success) throw rateLimited(WINDOW_MS / 1000);
  return true;
}

/* The same in D1: the generation check and the windows in one round trip, one write each. */
async function limitUserInD1(db, userId, gen, spotify, now) {
  const keys = [`api:${userId}`, ...(spotify ? [`spotify:${userId}`] : [])];
  const [user, api, spotifyClaim, windows] = await db.batch([
    db.prepare('SELECT pw_gen FROM users WHERE id = ?').bind(userId),
    claimStmt(db, keys[0], API_LIMIT, now, WINDOW_MS, 'EXISTS (SELECT 1 FROM users WHERE id = ?5 AND pw_gen = ?6)', userId, gen),
    // Counted only when the API hit above was: changes() is that statement's row count.
    spotify ? claimStmt(db, keys[1], SPOTIFY_LIMIT, now, WINDOW_MS, 'changes() > 0') : db.prepare('SELECT 1'),
    db.prepare(`SELECT key, reset_at FROM request_limits WHERE key IN (${keys.map(() => '?').join(', ')})`).bind(...keys),
  ]);
  if (user.results[0]?.pw_gen !== gen) return false;
  const wait = (key) => Math.max(1, Math.ceil(((windows.results.find((r) => r.key === key)?.reset_at || 0) - now) / 1000));
  if (!api.results.length) throw rateLimited(wait(keys[0]));
  if (spotify && !spotifyClaim.results.length) throw rateLimited(wait(keys[1]));
  return true;
}

export async function limitOutline(env, userId) {
  const wait = await claimLimit(env.DB, `outline:${userId}`, OUTLINE_DAILY_LIMIT, Date.now(), DAY_MS);
  if (wait) throw rateLimited(wait, 'outline_limit');
}

/** A read claimed by limitOutline handed back: the model never answered. */
export async function giveBackOutline(env, userId, now = Date.now()) {
  await env.DB.prepare('UPDATE request_limits SET hits = hits - 1 WHERE key = ? AND hits > 0 AND reset_at > ?')
    .bind(`outline:${userId}`, now).run();
}

/** The AI reads (outlines, calendars, timetables) left in the person's window: { left, limit }. */
export async function readsLeft(db, userId, now = Date.now()) {
  const row = await db.prepare('SELECT hits, reset_at FROM request_limits WHERE key = ?').bind(`outline:${userId}`).first();
  const used = row && row.reset_at > now ? row.hits : 0;
  return { left: Math.max(0, OUTLINE_DAILY_LIMIT - used), limit: OUTLINE_DAILY_LIMIT };
}

export async function purgeLimits(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM request_limits WHERE reset_at <= ?').bind(now),
    db.prepare('DELETE FROM spotify_oauth_states WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM spotify_refresh_locks WHERE expires_at <= ?').bind(now),
  ]);
}
