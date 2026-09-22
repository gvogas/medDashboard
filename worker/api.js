import { json, readJson, isLocalhost, HttpError } from './http.js';
import { requireUser, signSession, sessionCookie, clearCookie } from './auth.js';
import { validateProfile } from './validate.js';
import { findOrCreateUser, getProfile, updateProfile } from './db.js';

async function startSession(env, url, email, displayName) {
  const profile = await findOrCreateUser(env.DB, email.trim().toLowerCase(), displayName);
  const token = await signSession(profile.id, env.SESSION_SECRET);
  return json(profile, 200, { 'set-cookie': sessionCookie(token, url) });
}

const routes = [
  // Development only: enabled by DEV_LOGIN=1 in .dev.vars, and only on localhost.
  ['POST', /^\/api\/dev-session$/, async ({ request, env, url }) => {
    if (env.DEV_LOGIN !== '1' || !isLocalhost(url)) throw new HttpError(404, { error: 'not_found' });
    const body = await readJson(request);
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      throw new HttpError(400, { error: 'invalid', field: 'email' });
    }
    return startSession(env, url, body.email, body.displayName || '');
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
