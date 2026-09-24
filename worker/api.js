import { json, readJson, HttpError } from './http.js';
import { requireUser, requireSession, signSession, sessionCookie, clearCookie, parseCookies, secureFlag, RENEW_WITHIN_MS } from './auth.js';
import { verifyPassword, normalizeUsername } from './password.js';
import { claimAttempt, recordSuccess } from './throttle.js';
import { limitLogin, limitOutline } from './limits.js';
import { readOutline, MAX_BYTES } from './outline.js';
import { validateProfile, validateCourse, validateItem, validateQuote, validateId } from './validate.js';
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, courseExists, syncPage, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';
import * as spotify from './spotify.js';

function revisionOf(request) {
  const raw = request.headers.get('if-match');
  if (raw === null) throw new HttpError(428, { error: 'reload_required' });
  if (!/^"\d{1,16}"$/.test(raw) || !Number.isSafeInteger(Number(raw.slice(1, -1)))) throw new HttpError(400, { error: 'invalid', field: 'revision' });
  return Number(raw.slice(1, -1));
}

const VALIDATORS = { courses: validateCourse, items: validateItem, quotes: validateQuote };

async function putRow({ request, env, params: [table, id] }) {
  const userId = await requireUser(request, env);
  validateId(id);
  const fields = VALIDATORS[table](await readJson(request));
  if (table === 'items' && fields.courseId && !(await courseExists(env.DB, userId, fields.courseId))) {
    throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  }
  return json(await upsertRow(env.DB, table, userId, id, fields, Date.now(), revisionOf(request)));
}

async function readRow({ request, env, params: [table, id] }) {
  const userId = await requireUser(request, env);
  validateId(id);
  const row = await getRow(env.DB, table, userId, id);
  if (!row || row.deletedAt) throw new HttpError(404, { error: 'not_found' });
  return json(row);
}

async function removeRow({ request, env, params: [table, id] }) {
  const userId = await requireUser(request, env);
  validateId(id);
  if (!(await deleteRow(env.DB, table, userId, id, Date.now(), revisionOf(request)))) throw new HttpError(404, { error: 'not_found' });
  return new Response(null, { status: 204 });
}

const ROW = /^\/api\/(courses|items|quotes)\/([^/]+)$/;

// ── Spotify ─────────────────────────────────────────────────────────────────
// The consent round trip is two browser navigations, so its failures are
// redirects to the app with a hash, not JSON. The state cookie is the CSRF guard.

const STATE_COOKIE = 'rounds_spotify_state';
const stateCookie = (value, url, maxAge) =>
  `${STATE_COOKIE}=${value}; Path=/api/spotify; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(url)}`;
const redirect = (url, hash, headers = {}) =>
  new Response(null, { status: 302, headers: { location: `${url.origin}/#spotify=${hash}`, ...headers } });
const callbackUri = (url) => `${url.origin}/api/spotify/callback`;
const TRACK_URI = /^spotify:(track|episode):[A-Za-z0-9]{1,64}$/;
const CONTEXT_URI = /^spotify:(album|playlist|artist):[A-Za-z0-9]{1,64}$/;
const DEVICE_ID = /^[A-Za-z0-9]{1,64}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
/** An optional Spotify device id: null when absent, 400 when malformed. */
function deviceParam(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DEVICE_ID.test(value)) throw new HttpError(400, { error: 'invalid', field: 'deviceId' });
  return value;
}
function offsetParam(url) {
  const raw = url.searchParams.get('offset') ?? '0';
  if (!/^[0-9]{1,6}$/.test(raw)) throw new HttpError(400, { error: 'invalid', field: 'offset' });
  return Number(raw);
}

async function spotifyConnect({ request, env, url }) {
  const userId = await requireUser(request, env);
  if (!spotify.configured(env)) throw new HttpError(503, { error: 'spotify_not_configured' });
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(`INSERT INTO spotify_oauth_states (user_id, state, expires_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET state = excluded.state, expires_at = excluded.expires_at`)
    .bind(userId, state, Date.now() + 600_000).run();
  return new Response(null, {
    status: 302,
    headers: { location: spotify.authorizeUrl(env, callbackUri(url), state), 'set-cookie': stateCookie(state, url, 600) },
  });
}

async function spotifyCallback({ request, env, url }) {
  const clear = { 'set-cookie': stateCookie('', url, 0) };
  let userId;
  try { userId = await requireUser(request, env); } catch { return redirect(url, 'error', clear); }
  const state = url.searchParams.get('state'), code = url.searchParams.get('code');
  const expected = parseCookies(request.headers.get('cookie'))[STATE_COOKIE];
  if (!state || !expected || state !== expected || !code || url.searchParams.get('error') || !spotify.configured(env)) {
    return redirect(url, 'error', clear);
  }
  try {
    const attempt = await env.DB.prepare('DELETE FROM spotify_oauth_states WHERE user_id = ? AND state = ? AND expires_at > ? RETURNING user_id')
      .bind(userId, state, Date.now()).first();
    if (!attempt) return redirect(url, 'error', clear);
    const t = await spotify.exchangeCode(env, code, callbackUri(url));
    await saveSpotifyTokens(env.DB, userId, {
      refreshToken: await spotify.sealToken(env, t.refreshToken),
      accessToken: t.accessToken,
      expiresAt: t.expiresAt,
    });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return redirect(url, 'error', clear);
  }
  return redirect(url, 'connected', clear);
}

/** The raw request body, refused over `limit` bytes. */
async function readBytes(request, limit) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new HttpError(413, { error: 'too_large' });
  const reader = request.body?.getReader();
  const parts = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => {}); throw new HttpError(413, { error: 'too_large' }); }
      parts.push(value);
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* Read a course outline with Workers AI. The body is the file itself; ?name= is its
   file name and ?today= / ?termStart= help the model place "Week 3" on a date. */
async function postOutline({ request, env, url }) {
  const userId = await requireUser(request, env);
  const bytes = await readBytes(request, MAX_BYTES);
  if (!bytes.byteLength) throw new HttpError(400, { error: 'invalid', field: 'body' });
  await limitOutline(env, userId);
  const today = DATE.test(url.searchParams.get('today') || '') ? url.searchParams.get('today') : new Date().toISOString().slice(0, 10);
  const termStart = DATE.test(url.searchParams.get('termStart') || '') ? url.searchParams.get('termStart') : null;
  const name = (url.searchParams.get('name') || 'outline').slice(0, 120);
  try {
    return json(await readOutline(env.AI, { bytes, type: request.headers.get('content-type') || '', name, today, termStart }));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error('outline:', e?.message || e);
    throw new HttpError(503, { error: 'outline_unavailable' });
  }
}

const routes = [
  ['POST', /^\/api\/outline$/, postOutline],
  // Username + password. Accounts are created with `npm run user:add`.
  ['POST', /^\/api\/login$/, async ({ request, env, url }) => {
    await limitLogin(request, env);
    const body = await readJson(request);
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(400, { error: 'invalid', field: 'username' });
    }
    const bad = () => new HttpError(401, { error: 'bad_login' });
    const username = normalizeUsername(body.username);
    if (!username) throw bad();
    // Counted before the password is checked; see worker/throttle.js.
    const wait = await claimAttempt(env.DB, username);
    if (wait) throw new HttpError(429, { error: 'too_many_attempts', retryAfter: wait }, { 'retry-after': String(wait) });
    const user = await getUserForLogin(env.DB, username);
    // Verify even when the user is unknown, so timing does not reveal which usernames exist.
    const ok = await verifyPassword(body.password, user ? user.password_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || !ok) throw bad();
    await recordSuccess(env.DB, username);
    const profile = await getProfile(env.DB, user.id);
    const token = await signSession(profile.id, user.pw_gen, env.SESSION_SECRET);
    return json(profile, 200, { 'set-cookie': sessionCookie(token, url) });
  }],

  // Sign out on every device: bump the generation, drop this cookie too.
  ['POST', /^\/api\/session\/revoke-all$/, async ({ request, env, url }) => {
    const { userId } = await requireSession(request, env);
    await bumpPasswordGen(env.DB, userId);
    return new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(url) } });
  }],

  ['DELETE', /^\/api\/session$/, async ({ url }) =>
    new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(url) } })],

  ['GET', /^\/api\/me$/, async ({ request, env, url }) => {
    const session = await requireSession(request, env);
    const profile = await getProfile(env.DB, session.userId);
    if (!profile) throw new HttpError(401, { error: 'unauthenticated' });
    // Keep a regular user signed in: a cookie in its last week is re-issued.
    const headers = {};
    if (session.expiresAt - Date.now() < RENEW_WITHIN_MS) {
      headers['set-cookie'] = sessionCookie(await signSession(session.userId, session.gen, env.SESSION_SECRET), url);
    }
    return json(profile, 200, headers);
  }],

  ['PUT', /^\/api\/me$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const fields = validateProfile(await readJson(request));
    return json(await updateProfile(env.DB, userId, fields, Date.now(), revisionOf(request)));
  }],

  ['GET', /^\/api\/sync$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    // The client still sends v=2; the timestamp feed it replaced is gone.
    const cursor = url.searchParams.get('cursor') || '0';
    if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new HttpError(400, { error: 'invalid', field: 'cursor' });
    return json(await syncPage(env.DB, userId, Number(cursor)));
  }],

  ['GET', ROW, readRow],
  ['PUT', ROW, putRow],
  ['DELETE', ROW, removeRow],

  ['GET', /^\/api\/spotify\/connect$/, spotifyConnect],
  ['GET', /^\/api\/spotify\/callback$/, spotifyCallback],
  ['GET', /^\/api\/spotify\/status$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    // Connection state is local; checking it must not call a throttled Spotify API.
    const row = await env.DB.prepare('SELECT 1 AS connected FROM spotify_tokens WHERE user_id = ?').bind(userId).first();
    return json({ connected: !!row });
  }],
  ['GET', /^\/api\/spotify\/player$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.playerState(env, userId));
  }],
  ['POST', /^\/api\/spotify\/player\/(play|pause|next|previous|restart)$/, async ({ request, env, url, params: [action] }) => {
    const userId = await requireUser(request, env);
    await spotify.control(env, userId, action, deviceParam(url.searchParams.get('deviceId')));
    return new Response(null, { status: 204 });
  }],
  /* The Web Playback SDK in the page needs a bearer token of its own; the refresh token stays here. */
  ['GET', /^\/api\/spotify\/token$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const { token, expiresAt } = await spotify.freshAccessToken(env, userId);
    return json({ token, expiresAt });
  }],
  ['POST', /^\/api\/spotify\/transfer$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    const deviceId = deviceParam(body.deviceId);
    if (!deviceId) throw new HttpError(400, { error: 'invalid', field: 'deviceId' });
    if (body.play != null && typeof body.play !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'play' });
    await spotify.transfer(env, userId, deviceId, body.play !== false);
    return new Response(null, { status: 204 });
  }],
  ['GET', /^\/api\/spotify\/devices$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json({ devices: await spotify.devices(env, userId) });
  }],
  ['PUT', /^\/api\/spotify\/shuffle$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const { state } = await readJson(request);
    if (typeof state !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'state' });
    await spotify.setShuffle(env, userId, state);
    return new Response(null, { status: 204 });
  }],
  ['PUT', /^\/api\/spotify\/repeat$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const { state } = await readJson(request);
    if (!['off', 'context', 'track'].includes(state)) throw new HttpError(400, { error: 'invalid', field: 'state' });
    await spotify.setRepeat(env, userId, state);
    return new Response(null, { status: 204 });
  }],
  ['GET', /^\/api\/spotify\/me$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.me(env, userId));
  }],
  ['GET', /^\/api\/spotify\/recent$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.recent(env, userId));
  }],
  ['GET', /^\/api\/spotify\/search$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 200) throw new HttpError(400, { error: 'invalid', field: 'q' });
    const type = url.searchParams.get('type') || null;
    if (type !== null && !spotify.SEARCH_TYPES.includes(type)) throw new HttpError(400, { error: 'invalid', field: 'type' });
    const offset = offsetParam(url);
    return json(await spotify.search(env, userId, q, type, type ? offset : 0));
  }],
  ['GET', /^\/api\/spotify\/albums\/([A-Za-z0-9]{1,64})\/tracks$/, async ({ request, env, url, params: [id] }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.albumTracks(env, userId, id, offsetParam(url)));
  }],
  ['GET', /^\/api\/spotify\/artists\/([A-Za-z0-9]{1,64})\/albums$/, async ({ request, env, url, params: [id] }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.artistAlbums(env, userId, id, offsetParam(url)));
  }],
  ['GET', /^\/api\/spotify\/playlists$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.playlists(env, userId, offsetParam(url)));
  }],
  ['GET', /^\/api\/spotify\/playlists\/(liked|[A-Za-z0-9]{1,64})\/tracks$/, async ({ request, env, url, params: [id] }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.playlistTracks(env, userId, id, offsetParam(url)));
  }],
  ['GET', /^\/api\/spotify\/queue$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json(await spotify.queue(env, userId));
  }],
  ['POST', /^\/api\/spotify\/queue$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (!matches(TRACK_URI, body.uri)) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    await spotify.addToQueue(env, userId, body.uri);
    return new Response(null, { status: 204 });
  }],
  ['POST', /^\/api\/spotify\/play$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    const uri = body.uri == null ? null : body.uri, contextUri = body.contextUri == null ? null : body.contextUri;
    if (uri !== null && !matches(TRACK_URI, uri)) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    if (contextUri !== null && !matches(CONTEXT_URI, contextUri)) throw new HttpError(400, { error: 'invalid', field: 'contextUri' });
    const uris = body.uris == null ? null : body.uris;
    if (uris !== null && (contextUri || !Array.isArray(uris) || !uris.length || uris.length > 100 || !uris.every((u) => matches(TRACK_URI, u)) || (uri && !uris.includes(uri)))) {
      throw new HttpError(400, { error: 'invalid', field: 'uris' });
    }
    if (!uri && !contextUri && !uris) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    await spotify.play(env, userId, { uri, contextUri, uris, deviceId: deviceParam(body.deviceId) });
    return new Response(null, { status: 204 });
  }],
  ['PUT', /^\/api\/spotify\/volume$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (!Number.isInteger(body.percent) || body.percent < 0 || body.percent > 100) throw new HttpError(400, { error: 'invalid', field: 'percent' });
    await spotify.setVolume(env, userId, body.percent);
    return new Response(null, { status: 204 });
  }],
  ['DELETE', /^\/api\/spotify$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    await deleteSpotifyTokens(env.DB, userId);
    return new Response(null, { status: 204 });
  }],

];

/**
 * A browser tells us where a request came from. Anything that changes state must
 * come from this site itself: the cookie is SameSite=Lax, and this closes the rest.
 */
function assertSameOrigin(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, { error: 'cross_site' });
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, { error: 'cross_site' });
}

const API_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export async function handleApi(request, env, url) {
  let res = null;
  try {
    assertSameOrigin(request, url);
    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && request.method === method) {
        let params;
        try { params = m.slice(1).map(decodeURIComponent); }
        catch { throw new HttpError(400, { error: 'invalid', field: 'path' }); }
        res = await handler({ request, env, url, params });
        break;
      }
    }
    if (!res) {
      const allowed = routes.filter(([, pattern]) => pattern.test(url.pathname)).map(([method]) => method);
      throw new HttpError(allowed.length ? 405 : 404,
        { error: allowed.length ? 'method_not_allowed' : 'not_found' },
        allowed.length ? { allow: allowed.join(', ') } : {});
    }
  } catch (e) {
    if (e instanceof HttpError) res = json(e.body, e.status, e.headers);
    else {
      // A schema the code expects but D1 lacks means a migration was not applied remotely.
      if (/no such (table|column)/i.test(e?.message || '')) console.error('D1 schema is behind the code; run `npm run db:remote`.');
      console.error(e);
      res = json({ error: 'internal' }, 500);
    }
  }
  for (const [k, v] of Object.entries(API_HEADERS)) res.headers.set(k, v);
  return res;
}
