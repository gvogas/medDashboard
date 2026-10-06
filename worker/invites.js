// Invites by username (spec §11); join codes follow. An invite is one row per person and
// space, upserted, so a repeat refreshes it. Every statement that makes a membership carries
// the 20-spaces and 30-members limits inside itself (Stage 3 plan, Decision 12).
import { HttpError } from './http.js';
import { claimLimit, rateLimited } from './limits.js';
import { normalizeUsername } from './password.js';
import { assertAllowed, editorGuard, ownerGuard } from './access.js';
import { ADMINS_ONLY, LIVE_MEMBERS, MEMBER_LIMIT, MY_SPACES, SPACE_LIMIT, spaceSummary, touchSpace } from './spaces.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Invites one person may send in an hour, and how long an invite stays open (spec §11). */
export const INVITE_LIMIT = 20;
export const INVITE_TTL_MS = 30 * DAY_MS;
const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";
const SPACE_NAME = `CASE s.kind WHEN 'class' THEN (SELECT name FROM courses WHERE scope = 'c:' || s.id AND deleted_at IS NULL LIMIT 1)
  ELSE (SELECT title FROM items WHERE scope = 'p:' || s.id AND id = 'project') END`;

/* Make the membership, or revive one that was left (a rejoin); a live one is left as it is. */
const REVIVE = `ON CONFLICT (space_id, user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at,
    updated_at = excluded.updated_at, deleted_at = NULL, revision = revision + 1 WHERE members.deleted_at IS NOT NULL`;
/* The person's pending invite to the space, marked accepted once they are a live member. */
const acceptedStmt = (db, spaceId, userId) => db.prepare(`UPDATE invites SET status = 'accepted'
    WHERE space_id = ? AND user_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL)`).bind(spaceId, userId, spaceId, userId);

/**
 * Invite someone by username: the owner or an editor, with the space's default role (a
 * class's is member, a project's editor); only the owner gives the other. 404 no_user for
 * a name with no account, 409 member for someone already in, 409 not_admin for someone who
 * cannot join yet (ADMINS_ONLY). 20 an hour per inviter, counted before the name is looked
 * up, so unknown names count too.
 */
export async function invite(db, userId, spaceId, { username, role = null }, now = Date.now()) {
  const me = await assertAllowed(db, userId, spaceId, 'editor');
  const standard = me.kind === 'class' ? 'member' : 'editor', give = role ?? standard, other = give !== standard;
  if (other && me.role !== 'owner') throw new HttpError(403, { error: 'forbidden' });
  const wait = await claimLimit(db, `invite:${userId}`, INVITE_LIMIT, now, HOUR_MS);
  if (wait) throw rateLimited(wait);
  const name = normalizeUsername(username);
  const who = name && await db.prepare(`SELECT u.id, u.username, u.is_admin, ${NAME} AS name,
      EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = u.id AND deleted_at IS NULL) AS member
    FROM users AS u WHERE u.username = ?`).bind(spaceId, name).first();
  if (!who) throw new HttpError(404, { error: 'no_user' });
  if (who.member) throw new HttpError(409, { error: 'member' });
  if (ADMINS_ONLY && who.is_admin !== 1) throw new HttpError(409, { error: 'not_admin' });
  const g = (other ? ownerGuard : editorGuard)(spaceId, userId), expires = now + INVITE_TTL_MS;
  const saved = await db.prepare(`INSERT INTO invites (space_id, user_id, invited_by, role, status, created_at, expires_at)
      SELECT ?, ?, ?, ?, 'pending', ?, ? WHERE ${g.sql}
        AND NOT EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND deleted_at IS NULL)
      ON CONFLICT (space_id, user_id) DO UPDATE SET invited_by = excluded.invited_by, role = excluded.role, status = 'pending',
        created_at = excluded.created_at, expires_at = excluded.expires_at
      RETURNING user_id`).bind(spaceId, who.id, userId, give, now, expires, ...g.binds, spaceId, who.id).first();
  if (!saved) {
    /* since the checks above: lost access, lost the owner's role, or they joined */
    const again = await assertAllowed(db, userId, spaceId, 'editor');
    throw other && again.role !== 'owner' ? new HttpError(403, { error: 'forbidden' }) : new HttpError(409, { error: 'member' });
  }
  return { userId: who.id, username: who.username, name: who.name, role: give, status: 'pending', createdAt: now, expiresAt: expires, invitedBy: userId };
}

/** Withdraw an invite not yet accepted: whoever sent it, or the owner. 403 for someone else's; 404 when there is none. */
export async function revokeInvite(db, userId, spaceId, targetId) {
  await assertAllowed(db, userId, spaceId, 'editor');
  const g = editorGuard(spaceId, userId);
  const gone = await db.prepare(`DELETE FROM invites WHERE space_id = ? AND user_id = ? AND status != 'accepted' AND ${g.sql}
      AND (invited_by = ? OR EXISTS (SELECT 1 FROM members WHERE space_id = ? AND user_id = ? AND role = 'owner' AND deleted_at IS NULL))
    RETURNING user_id`).bind(spaceId, targetId, ...g.binds, userId, spaceId, userId).first();
  if (gone) return;
  const there = await db.prepare("SELECT 1 AS x FROM invites WHERE space_id = ? AND user_id = ? AND status != 'accepted'").bind(spaceId, targetId).first();
  throw there ? new HttpError(403, { error: 'forbidden' }) : new HttpError(404, { error: 'not_found' });
}

/** Your invites not yet answered, newest first: the space's name, who sent it, and whether it has expired. */
export async function myInvites(db, userId, now = Date.now()) {
  const { results } = await db.prepare(`SELECT i.space_id, i.role, i.created_at, i.expires_at, s.kind, ${NAME} AS sender, ${SPACE_NAME} AS name
    FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL LEFT JOIN users AS u ON u.id = i.invited_by
    WHERE i.user_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 50`).bind(userId).all();
  return results.map((r) => ({
    spaceId: r.space_id, kind: r.kind, name: r.name ?? '', role: r.role, from: r.sender ?? 'A former member',
    createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at <= now,
  }));
}

/** Decline an invite to you; the owner and editors see it as declined. 404 when none is pending. */
export async function declineInvite(db, userId, spaceId) {
  const r = await db.prepare("UPDATE invites SET status = 'declined' WHERE space_id = ? AND user_id = ? AND status = 'pending' RETURNING user_id")
    .bind(spaceId, userId).first();
  if (!r) throw new HttpError(404, { error: 'not_found' });
}

/**
 * Accept an invite (spec §11), in one batch: the membership with the invite's role (made, or
 * revived after leaving), the space's revision moved on, the invite marked accepted; the
 * next sync pages the class from 0. A class you are in already answers as it is. 404 with no
 * pending invite (withdrawn, declined, never sent, or the class deleted), 410 expired,
 * 409 limit or full; the invite stays pending after a 409 or 410.
 */
export async function acceptInvite(db, userId, spaceId, now = Date.now()) {
  const [joined] = await db.batch([
    db.prepare(`INSERT INTO members (space_id, user_id, role, joined_at, updated_at)
      SELECT i.space_id, i.user_id, i.role, ?, ? FROM invites AS i JOIN spaces AS s ON s.id = i.space_id
      WHERE i.space_id = ? AND i.user_id = ? AND i.status = 'pending' AND i.expires_at > ? AND s.deleted_at IS NULL
        AND ${MY_SPACES} < ? AND ${LIVE_MEMBERS('i.space_id')} < ?
      ${REVIVE}`).bind(now, now, spaceId, userId, now, userId, SPACE_LIMIT, MEMBER_LIMIT),
    touchSpace(db, spaceId, now, { ifChanged: true }),
    acceptedStmt(db, spaceId, userId),
  ]);
  const held = await spaceSummary(db, userId, spaceId);
  if (joined.meta.changes || held) return held;
  const why = await db.prepare(`SELECT i.status, i.expires_at, ${MY_SPACES} AS mine, ${LIVE_MEMBERS('i.space_id')} AS n
    FROM invites AS i JOIN spaces AS s ON s.id = i.space_id AND s.deleted_at IS NULL WHERE i.space_id = ? AND i.user_id = ?`)
    .bind(userId, spaceId, userId).first();
  if (!why || why.status !== 'pending') throw new HttpError(404, { error: 'not_found' });
  if (why.expires_at <= now) throw new HttpError(410, { error: 'expired' });
  if (why.mine >= SPACE_LIMIT) throw new HttpError(409, { error: 'limit' });
  if (why.n >= MEMBER_LIMIT) throw new HttpError(409, { error: 'full' });
  throw new HttpError(409, { error: 'conflict' });
}
