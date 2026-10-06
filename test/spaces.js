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
