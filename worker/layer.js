// Your layer on a space (spec §4, §14): your mark on one of its items, and your prefs for
// it. Both are yours alone: read and written with your user id, and synced in your own
// scope. Deleting either is always yours to do.
import { json, readJson, revisionOf, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { roleOf } from './access.js';
import { validateChanged, validateId, validateMark, validatePref } from './validate.js';
import { deleteRow, getRow, upsertMark, upsertPref } from './db.js';

const MARK = /^\/api\/marks\/([a-z0-9]{12})\/([^/]+)$/;
const PREF = /^\/api\/space_prefs\/([a-z0-9]{12})$/;
const done = () => new Response(null, { status: 204 });

/* A row of yours, or 404 for none (or a deleted one). */
const own = (row) => {
  if (!row || row.deletedAt) throw new HttpError(404, { error: 'not_found' });
  return json(row);
};
async function remove(db, table, userId, id, revision) {
  if (!(await deleteRow(db, table, userId, id, Date.now(), revision))) throw new HttpError(404, { error: 'not_found' });
  return done();
}

export const layerRoutes = [
  ['GET', MARK, async ({ request, env, params: [sid, itemId] }) => own(await getRow(env.DB, 'marks', await requireUser(request, env), sid + ':' + validateId(itemId)))],
  ['PUT', MARK, async ({ request, env, params: [sid, itemId] }) => {
    const userId = await requireUser(request, env);
    validateId(itemId);
    const space = await roleOf(env.DB, userId, sid);
    if (!space) throw new HttpError(404, { error: 'not_found' });
    const body = await readJson(request);
    const fields = validateMark(body, space.kind);
    return json(await upsertMark(env.DB, userId, sid, itemId, fields, { revision: revisionOf(request), changed: validateChanged(body, 'marks') }));
  }],
  ['DELETE', MARK, async ({ request, env, params: [sid, itemId] }) =>
    remove(env.DB, 'marks', await requireUser(request, env), sid + ':' + validateId(itemId), revisionOf(request))],
  ['GET', PREF, async ({ request, env, params: [sid] }) => own(await getRow(env.DB, 'space_prefs', await requireUser(request, env), sid))],
  ['PUT', PREF, async ({ request, env, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const fields = validatePref(await readJson(request));
    return json(await upsertPref(env.DB, userId, sid, fields, Date.now(), revisionOf(request)));
  }],
  ['DELETE', PREF, async ({ request, env, params: [sid] }) => remove(env.DB, 'space_prefs', await requireUser(request, env), sid, revisionOf(request))],
];
