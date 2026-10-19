// The class routes (spec §11, §14): making a class, its members, its invites and its join
// code. Anyone signed in may make or join a class (spec §22, opened in Stage 6). A team
// project is made through the same POST /api/spaces (worker/projects.js), by admins only.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { validateSharedCourse } from './validate.js';
import { absorb, checkConvert, createClass, priorConvert, refreshSchool, setRole, spaceDetails, transfer } from './spaces.js';
import { deleteClass, keep, leave, removeMember, setArchived, shareItems } from './leaving.js';
import { acceptInvite, declineInvite, dropCode, invite, joinByCode, makeCode, myInvites, revokeInvite } from './invites.js';
import { assertProjectsOpen, createProject, deleteProject, linkProject, parentOf, projectBody } from './projects.js';

const SID = '([a-z0-9]{12})';
const UID = '([^/]{1,64})';
const route = (path) => new RegExp(`^/api/${path}$`);
const done = () => new Response(null, { status: 204 });
const bad = (field) => new HttpError(400, { error: 'invalid', field });

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

/** POST /api/spaces/:sid/absorb {items}: share items of yours filed under the class (1 to 50 ids, each once). */
export function shareBody(body) {
  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw bad('items');
  const out = items.map((id) => idOf(id, 'items'));
  if (new Set(out).size !== out.length) throw bad('items');
  return out;
}

export const classRoutes = [
  ['POST', route('spaces'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const raw = await readJson(request);
    if (raw.kind === 'project') {
      await assertProjectsOpen(env.DB, userId, 'project');
      return json({ space: await createProject(env.DB, userId, projectBody(raw)) }, 201);
    }
    const body = classBody(raw);
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
  /* {parent: {space, item}} links; parent null, or no parent at all, unlinks */
  ['POST', route(`spaces/${SID}/link`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    await linkProject(env.DB, userId, sid, parentOf((await readJson(request)).parent));
    return done();
  }],
  ['DELETE', route(`spaces/${SID}`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await optionalJson(request);
    const kind = (await env.DB.prepare('SELECT kind FROM spaces WHERE id = ? AND deleted_at IS NULL').bind(sid).first())?.kind;
    /* a project needs its title typed ({confirm}); a class takes keepCopy. Anyone outside either is 404 */
    if (kind === 'project') await deleteProject(env.DB, userId, sid, body.confirm);
    else await deleteClass(env.DB, userId, sid, keepOf(body.keepCopy));
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
  ['POST', route(`invites/${SID}/accept`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const kind = (await env.DB.prepare('SELECT kind FROM spaces WHERE id = ?').bind(sid).first())?.kind;
    await assertProjectsOpen(env.DB, userId, kind);
    return json({ space: await acceptInvite(env.DB, userId, sid) });
  }],
  ['POST', route(`invites/${SID}/decline`), async ({ request, env, params: [sid] }) => {
    await declineInvite(env.DB, await requireUser(request, env), sid);
    return done();
  }],
  ['POST', route(`spaces/${SID}/school`), async ({ request, env, params: [sid] }) => json(await refreshSchool(env.DB, await requireUser(request, env), sid))],
  ['POST', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => json(await makeCode(env.DB, await requireUser(request, env), sid), 201)],
  ['DELETE', route(`spaces/${SID}/code`), async ({ request, env, params: [sid] }) => {
    await dropCode(env.DB, await requireUser(request, env), sid);
    return done();
  }],
  ['POST', route('join'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    return json({ space: await joinByCode(env.DB, userId, (await readJson(request)).code) });
  }],
  ['POST', route(`spaces/${SID}/absorb`), async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const body = await readJson(request);
    if (body.items !== undefined) return json(await shareItems(env.DB, userId, sid, shareBody(body)));
    return json(await absorb(env.DB, userId, sid, absorbBody(body)));
  }],
  ['POST', route(`spaces/${SID}/items/([^/]{1,72})/keep`), async ({ request, env, params: [sid, itemId] }) => {
    await keep(env.DB, await requireUser(request, env), sid, idOf(itemId, 'id'));
    return done();
  }],
];
