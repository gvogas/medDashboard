import { HttpError } from './http.js';

export const API_LIMIT = 600;
export const SPOTIFY_LIMIT = 60;
export const LOGIN_IP_LIMIT = 30;
const WINDOW_MS = 60_000;

export function rateLimited(seconds, error = 'rate_limited') {
  const retryAfter = Math.max(1, Math.ceil(seconds));
  return new HttpError(429, { error, retryAfter }, { 'retry-after': String(retryAfter) });
}

/** An atomic fixed window; rejected requests cannot extend it or increment it. */
export async function claimLimit(db, key, limit, now = Date.now()) {
  const row = await db.prepare(`
    INSERT INTO request_limits (key, hits, reset_at) VALUES (?1, 1, ?2 + ?3)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN reset_at <= ?2 THEN 1 ELSE hits + 1 END,
      reset_at = CASE WHEN reset_at <= ?2 THEN ?2 + ?3 ELSE reset_at END
    WHERE reset_at <= ?2 OR hits < ?4
    RETURNING reset_at
  `).bind(key, now, WINDOW_MS, limit).first();
  if (row) return 0;
  return Math.max(1, await cooldownRemaining(db, key, now));
}

export async function cooldownRemaining(db, key, now = Date.now()) {
  const row = await db.prepare('SELECT reset_at FROM request_limits WHERE key = ?').bind(key).first();
  return Math.max(0, Math.ceil(((row?.reset_at || 0) - now) / 1000));
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

export async function limitUser(request, env, userId) {
  const wait = await claimLimit(env.DB, `api:${userId}`, API_LIMIT);
  if (wait) throw rateLimited(wait);
  const path = new URL(request.url).pathname;
  // SDK token retrieval and disconnect remain available during a Spotify API cooldown.
  if (path.startsWith('/api/spotify/') && !['/api/spotify/token', '/api/spotify/callback'].includes(path)) {
    const spotifyWait = await claimLimit(env.DB, `spotify:${userId}`, SPOTIFY_LIMIT);
    if (spotifyWait) throw rateLimited(spotifyWait);
  }
}

export async function purgeLimits(db, now = Date.now()) {
  await db.batch([
    db.prepare('DELETE FROM request_limits WHERE reset_at <= ?').bind(now),
    db.prepare('DELETE FROM spotify_oauth_states WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM spotify_refresh_locks WHERE expires_at <= ?').bind(now),
  ]);
}
