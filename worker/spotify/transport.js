import { HttpError } from '../http.js';
import { cooldownRemaining, setCooldown, rateLimited } from '../limits.js';
export const unavailable = () => new HttpError(502, { error: 'spotify_unavailable' });

/** Share upstream cooldowns across users, tabs, and Worker isolates. */
export async function upstreamFetch(env, service, url, options) {
  const key = `upstream:${service}:${env.SPOTIFY_CLIENT_ID}`;
  const wait = await cooldownRemaining(env.DB, key);
  if (wait) throw rateLimited(wait);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (res.status === 429) {
      const raw = Number(res.headers.get('retry-after'));
      const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 604800) : 30;
      await setCooldown(env.DB, key, seconds);
      throw rateLimited(seconds);
    }
    // Read under the same deadline; a stalled response body must not hold a call open.
    const body = await res.arrayBuffer();
    return new Response(res.status === 204 ? null : body, { status: res.status, headers: res.headers });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}

export async function bodyOf(res) {
  try {
    const body = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw unavailable();
    return body;
  } catch { throw unavailable(); }
}

