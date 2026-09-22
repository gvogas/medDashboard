import { json, readJson, HttpError } from './http.js';
import { requireUser, requireSession, signSession, sessionCookie, clearCookie, parseCookies, secureFlag, RENEW_WITHIN_MS } from './auth.js';
import { verifyPassword, normalizeUsername } from './password.js';
import { lockedFor, recordFailure, recordSuccess } from './throttle.js';
import { validateProfile, validateCourse, validateItem, validateQuote, validateId } from './validate.js';
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, courseExists, syncSince, bumpPasswordGen, saveSpotifyTokens, deleteSpotifyTokens } from './db.js';
import * as spotify from './spotify.js';

const VALIDATORS = { courses: validateCourse, items: validateItem, quotes: validateQuote };

async function putRow({ request, env, params: [table, id] }) {
  const userId = await requireUser(request, env);
  validateId(id);
  const fields = VALIDATORS[table](await readJson(request));
  if (table === 'items' && fields.courseId && !(await courseExists(env.DB, userId, fields.courseId))) {
    throw new HttpError(400, { error: 'invalid', field: 'courseId' });
  }
  return json(await upsertRow(env.DB, table, userId, id, fields));
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
  if (!(await deleteRow(env.DB, table, userId, id))) throw new HttpError(404, { error: 'not_found' });
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
  await requireUser(request, env);
  if (!spotify.configured(env)) throw new HttpError(503, { error: 'spotify_not_configured' });
  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    const t = await spotify.exchangeCode(env, code, callbackUri(url));
    await saveSpotifyTokens(env.DB, userId, {
      refreshToken: await spotify.encryptToken(env.SESSION_SECRET, t.refreshToken),
      accessToken: t.accessToken,
      expiresAt: t.expiresAt,
    });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return redirect(url, 'error', clear);
  }
  return redirect(url, 'connected', clear);
}

const routes = [
  // Username + password. Accounts are created with `npm run user:add`.
  ['POST', /^\/api\/login$/, async ({ request, env, url }) => {
    const body = await readJson(request);
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw new HttpError(400, { error: 'invalid', field: 'username' });
    }
    const bad = () => new HttpError(401, { error: 'bad_login' });
    const username = normalizeUsername(body.username);
    if (!username) throw bad();
    const wait = await lockedFor(env.DB, username);
    if (wait) throw new HttpError(429, { error: 'too_many_attempts', retryAfter: wait }, { 'retry-after': String(wait) });
    const user = await getUserForLogin(env.DB, username);
    // Verify even when the user is unknown, so timing does not reveal which usernames exist.
    const ok = await verifyPassword(body.password, user ? user.password_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    if (!user || !ok) { await recordFailure(env.DB, username); throw bad(); }
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
    return json(await updateProfile(env.DB, userId, fields));
  }],

  ['GET', /^\/api\/sync$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    const raw = url.searchParams.get('since') ?? '0';
    if (!/^[0-9]+$/.test(raw)) throw new HttpError(400, { error: 'invalid', field: 'since' });
    return json(await syncSince(env.DB, userId, Number(raw)));
  }],

  ['GET', ROW, readRow],
  ['PUT', ROW, putRow],
  ['DELETE', ROW, removeRow],

  ['GET', /^\/api\/spotify\/connect$/, spotifyConnect],
  ['GET', /^\/api\/spotify\/callback$/, spotifyCallback],
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
    const deviceId = deviceParam((await readJson(request)).deviceId);
    if (!deviceId) throw new HttpError(400, { error: 'invalid', field: 'deviceId' });
    await spotify.transfer(env, userId, deviceId);
    return new Response(null, { status: 204 });
  }],
  ['GET', /^\/api\/spotify\/search$/, async ({ request, env, url }) => {
    const userId = await requireUser(request, env);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 200) throw new HttpError(400, { error: 'invalid', field: 'q' });
    return json(await spotify.search(env, userId, q));
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
    if (!TRACK_URI.test(body.uri)) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    await spotify.addToQueue(env, userId, body.uri);
    return new Response(null, { status: 204 });
  }],
  ['POST', /^\/api\/spotify\/play$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    const uri = body.uri == null ? null : body.uri, contextUri = body.contextUri == null ? null : body.contextUri;
    if (uri !== null && !TRACK_URI.test(uri)) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    if (contextUri !== null && !CONTEXT_URI.test(contextUri)) throw new HttpError(400, { error: 'invalid', field: 'contextUri' });
    if (!uri && !contextUri) throw new HttpError(400, { error: 'invalid', field: 'uri' });
    await spotify.play(env, userId, { uri, contextUri, deviceId: deviceParam(body.deviceId) });
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
      if (m && request.method === method) { res = await handler({ request, env, url, params: m.slice(1) }); break; }
    }
    if (!res) {
      const known = routes.some(([, pattern]) => pattern.test(url.pathname));
      throw new HttpError(known ? 405 : 404, { error: known ? 'method_not_allowed' : 'not_found' });
    }
  } catch (e) {
    if (e instanceof HttpError) res = json(e.body, e.status, e.headers);
    else { console.error(e); res = json({ error: 'internal' }, 500); }
  }
  for (const [k, v] of Object.entries(API_HEADERS)) res.headers.set(k, v);
  return res;
}
