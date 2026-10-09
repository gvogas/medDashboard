// The class routes (spec §11, §14): making a class, its members, its invites and its join
// code. Until classes open to everyone (Stage 6), making or joining a space is for admins
// only; the other routes act inside a space, which only admins can be in until then.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { requireAdmin } from './admin.js';
import { validateSharedCourse } from './validate.js';
import { ADMINS_ONLY, absorb, checkConvert, createClass, priorConvert, setRole, spaceDetails, transfer } from './spaces.js';
import { deleteClass, leave, removeMember, setArchived } from './leaving.js';
import { acceptInvite, declineInvite, dropCode, invite, joinByCode, makeCode, myInvites, revokeInvite } from './invites.js';

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

/* keepCopy: on unless false is sent. */
function keepOf(v) {
  if (v == null) return true;
  if (typeof v !== 'boolean') throw bad('keepCopy');
  return v;
}

/* A body that may be left out (only keepCopy): none, or an empty one, reads as {}. */
const optionalJson = (request) => (request.body && request.headers.get('content-length') !== '0' ? readJson(request) : {});

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

/** POST /api/spaces/:sid/absorb: {courseId, pairs: [[your item id, the class's item id]], fromCourse?}; each id once. */
export function absorbBody(body) {
  const courseId = idOf(body.courseId, 'courseId');
  const pairs = body.pairs ?? [];
  if (!Array.isArray(pairs) || pairs.length > 500) throw bad('pairs');
  const out = pairs.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw bad('pairs');
    return [idOf(p[0], 'pairs'), idOf(p[1], 'pairs')];
  });
  if (new Set(out.map((p) => p[0])).size !== out.length || new Set(out.map((p) => p[1])).size !== out.length) throw bad('pairs');
  if (body.fromCourse != null && typeof body.fromCourse !== 'boolean') throw bad('fromCourse');
  return { courseId, pairs: out, fromCourse: body.fromCourse === true };
}

export const classRoutes = [
  ['POST', route('spaces'), async ({ request, env }) => {
    const userId = await joiner(request, env);
    const body = classBody(await readJson(request));
    if (body.convertCourseId) {
      /* a convert repeated after it moved your course: the course is gone, so answer the class first */
      const prior = await priorConvert(env.DB, userId, body.convertCourseId);
      if (prior) return json({ space: prior }, 200);
      await checkConvert(env.DB, userId, body.convertCourseId, body.items);
    }
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
  ['POST', route(`spaces/${SID}/archive`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const { archived } = await readJson(request);
    if (typeof archived !== 'boolean') throw bad('archived');
    await setArchived(env.DB, userId, sid, archived);
    return done();
  }],
  ['DELETE', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await deleteClass(env.DB, userId, sid, keepOf((await optionalJson(request)).keepCopy));
    return done();
  }],
  ['POST', route(`spaces/${SID}/leave`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await leave(env.DB, userId, sid, keepOf((await optionalJson(request)).keepCopy));
    return done();
  }],
  ['DELETE', route(`spaces/${SID}/members/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    await removeMember(env.DB, await requireUser(request, env), sid, uid);
    return done();
  }],
  ['POST', route(`spaces/${SID}/invites`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (typeof body.username !== 'string') throw bad('username');
    if (body.role != null && body.role !== 'editor' && body.role !== 'member') throw bad('role');
    return json(await invite(env.DB, userId, sid, { username: body.username, role: body.role ?? null }), 201);
  }],
  ['DELETE', route(`spaces/${SID}/invites/${UID}`), async ({ request, env, params: [sid, uid] }) => {
    await revokeInvite(env.DB, await requireUser(request, env), sid, uid);
    return done();
  }],
  ['GET', route('invites'), async ({ request, env }) => json({ invites: await myInvites(env.DB, await requireUser(request, env)) })],
  ['POST', route(`invites/${SID}/accept`), async ({ request, env, params: [sid] }) =>
    json({ space: await acceptInvite(env.DB, await joiner(request, env), sid) })],
  ['POST', route(`invites/${SID}/decline`), async ({ request, env, params: [sid] }) => {
    await declineInvite(env.DB, await requireUser(request, env), sid);
    return done();
  }],
  ['POST', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => json(await makeCode(env.DB, await requireUser(request, env), sid), 201)],
  ['DELETE', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => {
    await dropCode(env.DB, await requireUser(request, env), sid);
    return done();
  }],
  ['POST', route('join'), async ({ request, env }) => {
    const userId = await joiner(request, env);
    return json({ space: await joinByCode(env.DB, userId, (await readJson(request)).code) });
  }],
  ['POST', route(`spaces/${SID}/absorb`), async ({ request, env, params: [sid] }) =>
    json(await absorb(env.DB, await requireUser(request, env), sid, absorbBody(await readJson(request))))],
];
