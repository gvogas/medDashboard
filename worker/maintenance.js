// Maintenance mode: the admins switch a feature off while they work on it, on the Admin
// page. Stored in app_meta under 'maintenance' as {features, message, updatedAt}, sent to
// everyone with GET /api/me (as the announcement is), and enforced here for the routes that
// are a feature of their own: Import with AI's reads and shared classes & projects answer
// non-admins 503 {error: 'maintenance', feature}. Personal data and sync are never stopped,
// so nobody loses an edit; the pages (week, month, …) are only the app's to hide.

import { HttpError } from './http.js';
import { requireUser } from './auth.js';

/* In the Admin page's order; 'app' is the whole app. */
export const FEATURES = ['app', 'week', 'month', 'table', 'study', 'spotify', 'import', 'classes'];
export const MESSAGE_MAX = 280;

/** The stored switches, {features, message, updatedAt}; nothing on when absent or unreadable. */
export async function readMaintenance(db) {
  const off = { features: [], message: '', updatedAt: null, updatedBy: '' };
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'maintenance'").first();
  if (!row) return off;
  try {
    const m = JSON.parse(row.value);
    if (!m || !Array.isArray(m.features)) return off;
    return {
      features: FEATURES.filter((f) => m.features.includes(f)),
      message: typeof m.message === 'string' ? m.message.slice(0, MESSAGE_MAX) : '',
      updatedAt: Number.isSafeInteger(m.updatedAt) ? m.updatedAt : null,
      updatedBy: typeof m.updatedBy === 'string' ? m.updatedBy.slice(0, 64) : '',
    };
  } catch {
    return off;
  }
}

/** What /api/me sends: the switches while any is on, else null. Who switched them is the admins' business. */
export async function publicMaintenance(db) {
  const { features, message, updatedAt } = await readMaintenance(db);
  return features.length ? { features, message, updatedAt } : null;
}

/** A PUT body as stored, or a 400: known feature ids only, a message of 280 characters at most.
    admin_log's CHECK names its actions, so rather than a migration the value keeps who set it. */
export function validateMaintenance(body, by, now = Date.now()) {
  const { features, message = '' } = body || {};
  if (!Array.isArray(features) || features.length > 32 || !features.every((f) => FEATURES.includes(f))) {
    throw new HttpError(400, { error: 'invalid', field: 'features' });
  }
  if (typeof message !== 'string') throw new HttpError(400, { error: 'invalid', field: 'message' });
  const text = message.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (text.length > MESSAGE_MAX) throw new HttpError(400, { error: 'invalid', field: 'message' });
  return { features: FEATURES.filter((f) => features.includes(f)), message: text, updatedAt: now, updatedBy: by };
}

/* The routes that belong to one feature. Join and invite routes are Stage 3's; they are
   listed now so the switch covers them when they land. */
const GUARDED = [
  [/^\/api\/(outline|school-calendar)$/, 'import'],
  [/^\/api\/ai\//, 'import'],
  [/^\/api\/(spaces|invites|join|inbox)(\/|$)/, 'classes'],
];

/**
 * Before a route runs: a 503 for a non-admin when its feature, or the whole app, is in
 * maintenance. One read of app_meta, and the admin check only when something is on.
 */
export async function guardMaintenance(request, env, pathname) {
  const feature = GUARDED.find(([pattern]) => pattern.test(pathname))?.[1];
  if (!feature) return;
  const { features } = await readMaintenance(env.DB);
  const on = features.includes('app') ? 'app' : features.includes(feature) ? feature : null;
  if (!on) return;
  const userId = await requireUser(request, env);
  const row = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(userId).first();
  if (row?.is_admin === 1) return;
  throw new HttpError(503, { error: 'maintenance', feature: on });
}
