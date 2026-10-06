// The class routes (spec §11, §14): making a class, its members, its invites and its join
// code. Until classes open to everyone (Stage 6), making or joining a space is for admins
// only; the other routes act inside a space, which only admins can be in until then.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { requireAdmin } from './admin.js';
import { validateSharedCourse } from './validate.js';
import { ADMINS_ONLY, checkConvert, createClass, setRole, spaceDetails, transfer } from './spaces.js';

const SID = '([a-z0-9]{12})';
const UID = '([^/]{1,64})';
const route = (path) => new RegExp(`^/api/${path}$`);
const done = () => new Response(null, { status: 204 });
const bad = (field) => new HttpError(400, { error: 'invalid', field });

/** Who may make or join a space: an admin while ADMINS_ONLY (spec §22), else anyone signed in. */
const joiner = async (request, env) => (ADMINS_ONLY ? (await requireAdmin(request, env)).id : requireUser(request, env));

/* An id as these routes take it: 1 to `max` characters, no control characters. */
function idOf(v, field, max = 24) {
  if (typeof v !== 'string' || v.length < 1 || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw bad(field);
  return v;
}

/** POST /api/spaces in Stage 3: a class, blank (`course`) or from a course of yours (`convertCourseId`, `items`). */
export function classBody(body) {
  if (body.kind !== 'class') throw bad('kind');
  if (body.convertCourseId == null) {
    if (!body.course || typeof body.course !== 'object' || Array.isArray(body.course)) throw bad('course');
    return { course: validateSharedCourse(body.course) };
  }
  const items = body.items ?? [];
  if (!Array.isArray(items) || items.length > 500) throw bad('items');
  return { convertCourseId: idOf(body.convertCourseId, 'convertCourseId'), items: [...new Set(items.map((id) => idOf(id, 'items')))] };
}

export const classRoutes = [
  ['POST', route('spaces'), async ({ request, env }) => {
    const userId = await joiner(request, env);
    const body = classBody(await readJson(request));
    if (body.convertCourseId) await checkConvert(env.DB, userId, body.convertCourseId, body.items);
    const { created, space } = await createClass(env.DB, userId, body);
    return json({ space }, created ? 201 : 200);
  }],
  ['GET', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => json(await spaceDetails(env.DB, await requireUser(request, env), sid))],
  ['PUT', route(`spaces/${SID}/members/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    const userId = await requireUser(request, env);
    const { role } = await readJson(request);
    if (role !== 'editor' && role !== 'member') throw bad('role');
    return json(await setRole(env.DB, userId, sid, uid, role));
  }],
  ['POST', route(`spaces/${SID}/transfer`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await transfer(env.DB, userId, sid, idOf((await readJson(request)).userId, 'userId', 64));
    return done();
  }],
];
