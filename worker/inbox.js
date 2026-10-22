// The inbox and a space's Activity tab (spec §12, §14). Reads only: activity is written by
// triggers and by the routes that change members and spaces.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { myInvites } from './invites.js';
import { inboxRows, markSeen, spaceActivity } from './activity.js';
import { incomingRequests } from './friends.js';
import { roomInvites } from './rooms.js';

const route = (path) => new RegExp(`^/api/${path}$`);
const seqOf = (v, field) => {
  const n = typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, { error: 'invalid', field });
  return n;
};

export const inboxRoutes = [
  ['GET', route('inbox'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    const [invites, box, friendRequests, rooms] = await Promise.all([myInvites(env.DB, userId), inboxRows(env.DB, userId), incomingRequests(env.DB, userId), roomInvites(env.DB, userId)]);
    return json({ invites, friendRequests, roomInvites: rooms, ...box });
  }],
  ['PUT', route('inbox/seen'), async ({ request, env }) => {
    const userId = await requireUser(request, env);
    await markSeen(env.DB, userId, seqOf((await readJson(request)).seq, 'seq'));
    return new Response(null, { status: 204 });
  }],
  ['GET', route('spaces/([a-z0-9]{12})/activity'), async ({ request, env, url, params: [sid] }) => {
    const userId = await requireUser(request, env);
    const raw = url.searchParams.get('before');
    return json(await spaceActivity(env.DB, userId, sid, raw === null || raw === '' ? null : seqOf(raw, 'before')));
  }],
];
