import { json, readJson, isLocalhost, HttpError } from './http.js';
import { requireUser, signSession, sessionCookie, clearCookie } from './auth.js';
import { validateProfile, validateCourse, validateItem, validateQuote, validateId } from './validate.js';
import { findOrCreateUser, getProfile, updateProfile, upsertRow, deleteRow, courseExists, syncSince, importAll } from './db.js';
import { verifyGoogleToken, emailAllowed } from './google.js';

async function startSession(env, url, email, displayName) {
  const profile = await findOrCreateUser(env.DB, email.trim().toLowerCase(), displayName);
  const token = await signSession(profile.id, env.SESSION_SECRET);
  return json(profile, 200, { 'set-cookie': sessionCookie(token, url) });
}

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

async function removeRow({ request, env, params: [table, id] }) {
  const userId = await requireUser(request, env);
  validateId(id);
  if (!(await deleteRow(env.DB, table, userId, id))) throw new HttpError(404, { error: 'not_found' });
  return new Response(null, { status: 204 });
}

/** Run a validator, prefixing any field it names, so `items[3].status` is reported. */
function at(prefix, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError && e.body.field) e.body.field = `${prefix}.${e.body.field}`;
    throw e;
  }
}

function validateRows(table, rows, validate) {
  if (!Array.isArray(rows)) throw new HttpError(400, { error: 'invalid', field: table });
  return rows.map((row, i) => at(`${table}[${i}]`, () => ({ id: validateId(row?.id), ...validate(row) })));
}

async function importRoute({ request, env }) {
  const userId = await requireUser(request, env);
  const body = await readJson(request);
  if (!body || typeof body !== 'object') throw new HttpError(400, { error: 'invalid', field: 'body' });
  const data = {
    profile: at('profile', () => validateProfile(body.profile)),
    courses: validateRows('courses', body.courses ?? [], validateCourse),
    items: validateRows('items', body.items ?? [], validateItem),
    quotes: validateRows('quotes', body.quotes ?? [], validateQuote),
  };
  const courseIds = new Set(data.courses.map((c) => c.id));
  for (const [i, item] of data.items.entries()) {
    if (item.courseId && !courseIds.has(item.courseId) && !(await courseExists(env.DB, userId, item.courseId))) {
      throw new HttpError(400, { error: 'invalid', field: `items[${i}].courseId` });
    }
  }
  if (!(await importAll(env.DB, userId, data))) throw new HttpError(409, { error: 'already_imported' });
  return json({ imported: { courses: data.courses.length, items: data.items.length, quotes: data.quotes.length } });
}

const ROW = /^\/api\/(courses|items|quotes)\/([^/]+)$/;

const devLoginEnabled = (env, url) => env.DEV_LOGIN === '1' && isLocalhost(url);

const routes = [
  // What the sign-in screen can offer. No session needed.
  ['GET', /^\/api\/config$/, async ({ env, url }) =>
    json({ googleClientId: env.GOOGLE_CLIENT_ID || null, devLogin: devLoginEnabled(env, url) })],

  // Development only: enabled by DEV_LOGIN=1 in .dev.vars, and only on localhost.
  ['POST', /^\/api\/dev-session$/, async ({ request, env, url }) => {
    if (!devLoginEnabled(env, url)) throw new HttpError(404, { error: 'not_found' });
    const body = await readJson(request);
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      throw new HttpError(400, { error: 'invalid', field: 'email' });
    }
    return startSession(env, url, body.email, body.displayName || '');
  }],

  // Sign in with Google: the button hands the page an ID token; we verify it here.
  ['POST', /^\/api\/session$/, async ({ request, env, url }) => {
    const body = await readJson(request);
    if (typeof body.credential !== 'string' || !body.credential) throw new HttpError(400, { error: 'invalid', field: 'credential' });
    if (!env.GOOGLE_CLIENT_ID) throw new HttpError(503, { error: 'google_not_configured' });
    const g = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
    if (!emailAllowed(g.email, env.ALLOWED_EMAILS)) throw new HttpError(403, { error: 'not_allowed' });
    return startSession(env, url, g.email, g.name);
  }],

  ['DELETE', /^\/api\/session$/, async ({ url }) =>
    new Response(null, { status: 204, headers: { 'set-cookie': clearCookie(url) } })],

  ['GET', /^\/api\/me$/, async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const profile = await getProfile(env.DB, userId);
    if (!profile) throw new HttpError(401, { error: 'unauthenticated' });
    return json(profile);
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

  ['PUT', ROW, putRow],
  ['DELETE', ROW, removeRow],

  ['POST', /^\/api\/import$/, importRoute],
];

export async function handleApi(request, env, url) {
  try {
    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && request.method === method) return await handler({ request, env, url, params: m.slice(1) });
    }
    const known = routes.some(([, pattern]) => pattern.test(url.pathname));
    throw new HttpError(known ? 405 : 404, { error: known ? 'method_not_allowed' : 'not_found' });
  } catch (e) {
    if (e instanceof HttpError) return json(e.body, e.status);
    console.error(e);
    return json({ error: 'internal' }, 500);
  }
}
