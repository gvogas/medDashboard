import { json, readJson, HttpError } from './http.js';
import { requireUser, requireSession, signSession, sessionCookie, clearCookie, RENEW_WITHIN_MS } from './auth.js';
import { verifyPassword, normalizeUsername } from './password.js';
import { lockedFor, recordFailure, recordSuccess } from './throttle.js';
import { validateProfile, validateCourse, validateItem, validateQuote, validateId } from './validate.js';
import { getUserForLogin, getProfile, updateProfile, getRow, upsertRow, deleteRow, courseExists, syncSince, bumpPasswordGen } from './db.js';

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
