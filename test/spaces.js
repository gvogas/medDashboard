// Spaces made straight in D1, the way Stage 3's routes will make them: no route creates
// one yet. Storage is per test file, so a counter keeps ids apart.
import { env } from 'cloudflare:test';
import { NEXT_SPACE_REVISION, touchSpace } from '../worker/spaces.js';
import { signIn } from './helpers.js';

let n = 0;
/** A fresh space id: 12 characters of [a-z0-9]. */
export const newSpaceId = () => 'sp' + String(++n).padStart(10, '0');

/**
 * A space with its members ({userId: role}) and its class course (id `course`) or its
 * project item (id 'project'). Returns {id, scope, course}.
 */
export async function makeSpace({ kind = 'class', members = {}, archived = 0, course = 'web' } = {}) {
  const id = newSpaceId(), scope = (kind === 'class' ? 'c:' : 'p:') + id;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO spaces (id, kind, archived, created_at, updated_at, revision) VALUES (?, ?, ?, 1, 1, ${NEXT_SPACE_REVISION})`).bind(id, kind, archived),
    ...Object.entries(members).map(([userId, role]) =>
      env.DB.prepare('INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 1, 1)').bind(id, userId, role)),
    kind === 'class'
      ? env.DB.prepare("INSERT INTO courses (scope, id, code, name, color, created_at, updated_at) VALUES (?, ?, 'WEB', 'Web Services', '#17B3AE', 1, 1)").bind(scope, course)
      : env.DB.prepare("INSERT INTO items (scope, id, type, title, date, status, created_at, updated_at) VALUES (?, 'project', 'project', 'Fire Response API', '2026-10-15', 'todo', 1, 1)").bind(scope),
  ]);
  return { id, scope, course };
}

/** Join (a role), change role, or leave (null), moving the space's revision on in the same batch. */
export function setMember(spaceId, userId, role) {
  return env.DB.batch([
    role === null
      ? env.DB.prepare('UPDATE members SET deleted_at = 2, updated_at = 2, revision = revision + 1 WHERE space_id = ? AND user_id = ?').bind(spaceId, userId)
      : env.DB.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, 2, 2)
          ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = NULL, updated_at = 2, revision = revision + 1`).bind(spaceId, userId, role),
    touchSpace(env.DB, spaceId, 2),
  ]);
}

/** A shared item written raw (class rows need the class course). */
export function sharedItem(scope, id, cols = {}) {
  const row = { type: scope.startsWith('p:') ? 'task' : 'assignment', title: id, date: '2026-10-15', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`)
    .bind(scope, id, ...Object.values(row)).run();
}

export const spaceRevision = async (id) => (await env.DB.prepare('SELECT revision FROM spaces WHERE id = ?').bind(id).first()).revision;

/** Sign in as a new admin (classes are open to admins only until Stage 6). `api.id` is the user id. */
export async function signInAdmin(username) {
  const api = await signIn(username);
  await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').bind(username).run();
  api.id = 'u-' + username;
  return api;
}

/** A POST with a JSON body. */
export const post = (api, path, body = {}) => api(path, { method: 'POST', body });

/* Raw rows of a person's layer and labels, as Stage 5's tests need them. */
export function mark(userId, spaceId, itemId, cols = {}) {
  const row = { id: spaceId + ':' + itemId, space_id: spaceId, item_id: itemId, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO marks (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).bind(userId, ...Object.values(row)).run();
}
export const pref = (userId, spaceId, cols = {}) => {
  const row = { id: spaceId, space_id: spaceId, color: '#4F74D9', term: 'Fall 2026', target: 85, created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO space_prefs (user_id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`).bind(userId, ...Object.values(row)).run();
};
export const ownItem = (userId, id, cols = {}) => {
  const row = { type: 'assignment', title: id, date: '2026-10-20', status: 'todo', created_at: 1, updated_at: 1, ...cols };
  const names = Object.keys(row);
  return env.DB.prepare(`INSERT INTO items (scope, id, ${names.join(', ')}) VALUES (?, ?, ${names.map(() => '?').join(', ')})`).bind('u:' + userId, id, ...Object.values(row)).run();
};
export const session = (userId, id, cols) => env.DB.prepare(`INSERT INTO study_sessions (user_id, id, course_id, item_id, space_id, started_at, study_minutes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 1700000000000, 25, 1, 1)`).bind(userId, id, cols.course_id ?? null, cols.item_id ?? null, cols.space_id ?? null).run();
export const achievement = (userId, id, cols) => env.DB.prepare(`INSERT INTO achievements (user_id, id, name, sticker, rule, course_id, item_id, space_id, target, created_at, updated_at)
  VALUES (?, ?, 'Ace', 'data:image/png;base64,AA', ?, ?, ?, ?, ?, 1, 1)`).bind(userId, id, cols.rule, cols.course_id ?? null, cols.item_id ?? null, cols.space_id ?? null, cols.target ?? 90).run();
