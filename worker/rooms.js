// Rooms (study together, spec §2, §5): one shared timer for up to 8 friends. The room keeps the
// solo timer's run record (src/core/timer.ts); every device works the clock out from it and polls
// only to catch changes. Only the host's Pause, Resume, Skip and End change the record.
//
// Each change reads the room and its members, works out the new state in plain JS (settle, and
// the action), and writes it back in one batch guarded by rooms.version, which the write bumps.
// Two changes at once: the second finds the version moved and starts again from a fresh read.
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { claimLimit, rateLimited } from './limits.js';
import { randomId } from './spaces.js';
import { studyFlow } from './validate.js';
import * as timer from '../src/core/timer.ts';

const MIN = 60_000;
const DAY_MS = 24 * 60 * MIN;
export const ROOM_SIZE = 8;
/** Rows a room may hold in all: the people in it and those invited. */
export const ROOM_ROWS = 24;
export const ROOMS_PER_DAY = 30;
export const FEED_KEEP = 20;
export const LABEL_MAX = 60;
/** No poll for this long: shown as away. For GONE_MS: taken out of the room. */
export const AWAY_MS = 2 * MIN;
export const GONE_MS = 10 * MIN;
/** last_seen is written at most this often. */
export const SEEN_EVERY_MS = 30_000;
const TRIES = 4;
const NAME = "COALESCE(NULLIF(u.display_name, ''), u.username)";

/* a friendship's key, smaller id first (as friends.js; not imported, since friends.js imports this file) */
const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);
const notFound = () => new HttpError(404, { error: 'not_found' });
const ended = () => new HttpError(409, { error: 'ended' });

/* ── the room in memory ── */

const MEMBER_COLS = ['state', 'invited_by', 'invited_at', 'joined_at', 'joined_study_ms', 'earlier_ms', 'left_at', 'last_seen', 'course_label'];
const MEMBER_FIELDS = ['state', 'invitedBy', 'invitedAt', 'joinedAt', 'joinedStudyMs', 'earlierMs', 'leftAt', 'lastSeen', 'courseLabel'];

function roomOf(r) {
  return {
    id: r.id, hostId: r.host_id, version: r.version, endedAt: r.ended_at, feed: JSON.parse(r.feed),
    run: { flow: JSON.parse(r.flow), startedAt: r.started_at, pausedAt: r.paused_at, pausedMs: r.paused_ms, skippedMs: r.skipped_ms, skippedStudyMs: r.skipped_study_ms },
  };
}
const memberOf = (r) => ({
  userId: r.user_id, name: r.name, username: r.username,
  ...Object.fromEntries(MEMBER_FIELDS.map((f, i) => [f, r[MEMBER_COLS[i]]])),
});

async function load(db, roomId) {
  const [room, members] = await db.batch([
    db.prepare('SELECT * FROM rooms WHERE id = ?').bind(roomId),
    db.prepare(`SELECT m.*, u.username, ${NAME} AS name FROM room_members AS m JOIN users AS u ON u.id = m.user_id WHERE m.room_id = ?`).bind(roomId),
  ]);
  const r = room.results[0];
  return r ? { room: roomOf(r), members: members.results.map(memberOf) } : null;
}

/** The room's study time at `at`: the record as it stood then, as long as no pause has come and gone since. */
export function studyAt(run, at) {
  const paused = run.pausedAt !== null && run.pausedAt <= at ? run.pausedAt : null;
  return timer.read({ ...run, pausedAt: paused }, at).studyMs;
}

/** When the flow ran out, or null while it still runs (or is paused short of the end). */
function doneAt(run) {
  if (run.pausedAt !== null) return null;
  return run.startedAt + run.pausedMs - run.skippedMs + timer.totalMs(run.flow);
}

function event(room, kind, name, at) {
  room.feed = [{ at, kind, name }, ...room.feed].slice(0, FEED_KEEP);
}

function end(room, at) {
  room.run = timer.pause(room.run, at);
  room.endedAt = at;
  event(room, 'ended', '', at);
}

/** Take someone out at `at`: their study so far is kept, the host passes on, an empty room ends. */
function takeOut(room, members, m, at) {
  if (m.state === 'in') {
    m.earlierMs += Math.max(0, studyAt(room.run, at) - (m.joinedStudyMs ?? 0));
    m.leftAt = at;
    event(room, 'left', m.name, at);
  }
  m.state = 'left';
  handOver(room, members, at);
}

/** A room whose host is no longer in it (left, or deleted their account) passes to whoever has been
    in longest; an empty room ends. */
function handOver(room, members, at) {
  if (room.endedAt !== null) return;
  const inside = members.filter((x) => x.state === 'in').sort((a, b) => a.joinedAt - b.joinedAt);
  if (!inside.length) { end(room, at); return; }
  if (!inside.some((x) => x.userId === room.hostId)) {
    room.hostId = inside[0].userId;
    event(room, 'host', inside[0].name, at);
  }
}

/** What time alone has done: a flow that ran out ends the room; someone gone quiet for 10 minutes is taken out. */
export function settle(room, members, now) {
  if (room.endedAt !== null) return;
  const done = doneAt(room.run);
  const until = done !== null && done <= now ? done : now;
  /* the quietest first, so the host passes on in order and an empty room ends at the last sign of life */
  const seen = (m) => m.lastSeen ?? m.joinedAt;
  const gone = members.filter((m) => m.state === 'in' && seen(m) < now - GONE_MS).sort((a, b) => seen(a) - seen(b));
  for (const m of gone) {
    takeOut(room, members, m, Math.min(seen(m), until));
    if (room.endedAt !== null) return;
  }
  handOver(room, members, until);
  if (room.endedAt === null && done !== null && done <= now) end(room, done);
}

/* ── writing it back ── */

const roomKey = (room) => JSON.stringify([room.hostId, room.run, room.endedAt, room.feed]);
const memberKey = (m) => JSON.stringify(MEMBER_FIELDS.filter((f) => f !== 'lastSeen').map((f) => m[f]));

/** Write what changed. False when someone else changed the room first. */
async function save(db, before, room, members) {
  const was = new Map(before.members.map((m) => [m.userId, memberKey(m)]));
  const changed = members.filter((m) => was.get(m.userId) !== memberKey(m));
  if (!changed.length && roomKey(before.room) === roomKey(room)) return true;
  const guard = '(SELECT version FROM rooms WHERE id = ?) = ?';
  const stmts = changed.map((m) => db.prepare(`INSERT INTO room_members (room_id, user_id, ${MEMBER_COLS.join(', ')})
    SELECT ?, ?, ${MEMBER_COLS.map(() => '?').join(', ')} WHERE ${guard}
    ON CONFLICT (room_id, user_id) DO UPDATE SET ${MEMBER_COLS.filter((c) => c !== 'last_seen').map((c) => `${c} = excluded.${c}`).join(', ')},
      last_seen = max(COALESCE(room_members.last_seen, 0), COALESCE(excluded.last_seen, 0))`)
    .bind(room.id, m.userId, ...MEMBER_FIELDS.map((f) => m[f] ?? null), room.id, before.room.version));
  const r = room.run;
  stmts.push(db.prepare(`UPDATE rooms SET host_id = ?, flow = ?, started_at = ?, paused_at = ?, paused_ms = ?, skipped_ms = ?, skipped_study_ms = ?,
    ended_at = ?, feed = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING version`)
    .bind(room.hostId, JSON.stringify(r.flow), r.startedAt, r.pausedAt, r.pausedMs, r.skippedMs, r.skippedStudyMs,
      room.endedAt, JSON.stringify(room.feed), room.id, before.room.version));
  const results = await db.batch(stmts);
  if (!results.at(-1).results.length) return false;
  room.version = results.at(-1).results[0].version;
  return true;
}

/**
 * Read the room, settle it, let `act` change it, and write it back; again from the top when
 * someone else wrote first. `act(room, members, me)` may throw an HttpError; what it returns
 * is passed on. 404 when the room does not exist.
 */
async function change(db, roomId, act, now, me) {
  for (let i = 0; i < TRIES; i++) {
    const before = await load(db, roomId);
    if (!before) throw notFound();
    const { room, members } = structuredClone(before);
    settle(room, members, now);
    const out = await act(room, members);
    if (await save(db, before, room, members)) {
      await touch(db, room, members.find((m) => m.userId === me), now);
      return { room, members, out };
    }
  }
  throw new HttpError(409, { error: 'busy' });
}

/* Any request from someone in the room counts as a sign of life: last_seen, every 30 s at most. */
async function touch(db, room, m, now) {
  if (!m || m.state !== 'in' || room.endedAt !== null || m.lastSeen > now - SEEN_EVERY_MS) return;
  await db.prepare("UPDATE room_members SET last_seen = max(COALESCE(last_seen, 0), ?) WHERE room_id = ? AND user_id = ? AND state = 'in'").bind(now, room.id, m.userId).run();
  m.lastSeen = now;
}

/* ── what a device is sent ── */

/* away members, in a short stable form, so a 304 still notices someone going quiet */
function tagOf(room, members, now) {
  const away = members.filter((m) => m.state === 'in' && (m.lastSeen ?? m.joinedAt) < now - AWAY_MS).map((m) => m.userId).sort();
  let h = 0;
  for (const c of away.join(',')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${room.version}.${away.length ? h.toString(36) : '0'}`;
}

export function view(room, members, now) {
  return {
    room: { id: room.id, hostId: room.hostId, run: room.run, endedAt: room.endedAt, feed: room.feed },
    /* the people who have been in it; an invite nobody took up is nobody's business */
    members: members.filter((m) => m.state === 'in' || (m.state === 'left' && m.joinedAt !== null)).map((m) => ({
      userId: m.userId, username: m.username, name: m.name, state: m.state, joinedAt: m.joinedAt, joinedStudyMs: m.joinedStudyMs,
      earlierMs: m.earlierMs, leftAt: m.leftAt, courseLabel: m.courseLabel,
      away: m.state === 'in' && (m.lastSeen ?? m.joinedAt) < now - AWAY_MS,
    })),
    tag: tagOf(room, members, now),
    now,
  };
}

/* ── checks ── */

function label(v) {
  if (v === undefined) return '';
  if (typeof v !== 'string') throw new HttpError(400, { error: 'invalid', field: 'courseLabel' });
  const text = v.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (text.length > LABEL_MAX) throw new HttpError(400, { error: 'invalid', field: 'courseLabel' });
  return text;
}

function userIds(v, field, max) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max || !v.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 64)) {
    throw new HttpError(400, { error: 'invalid', field });
  }
  return [...new Set(v)];
}

/** Which of `ids` are `me`'s friends. */
async function friendsAmong(db, me, ids) {
  if (!ids.length) return [];
  const pairs = ids.map((id) => pairOf(me, id));
  const { results } = await db.prepare(`SELECT user_lo, user_hi FROM friendships WHERE status = 'accepted' AND (${pairs.map(() => '(user_lo = ? AND user_hi = ?)').join(' OR ')})`)
    .bind(...pairs.flat()).all();
  const ok = new Set(results.map((r) => (r.user_lo === me ? r.user_hi : r.user_lo)));
  return ids.filter((id) => ok.has(id));
}

/** Whether someone not in the room may see or enter it: a friend of the host, invited by someone
    who is still their friend, or in it before and a friend of someone in it now (the host may have
    passed on). An invite or an earlier stint alone is not enough once the friendship ends. Someone
    in the room may always see it. */
async function mayEnter(db, me, room, members, m) {
  if (m?.state === 'in' || room.hostId === me) return true;
  const before = m?.joinedAt != null;
  const via = [room.hostId, m?.state === 'invited' || before ? m.invitedBy : null,
    ...(before ? members.filter((x) => x.state === 'in').map((x) => x.userId) : [])].filter(Boolean);
  return (await friendsAmong(db, me, [...new Set(via)])).length > 0;
}

/** Leave every other open room you are in (one room at a time). */
async function leaveOthers(db, me, keep, now) {
  const { results } = await db.prepare(`SELECT m.room_id FROM room_members AS m JOIN rooms AS r ON r.id = m.room_id
    WHERE m.user_id = ? AND m.state = 'in' AND r.ended_at IS NULL AND m.room_id != ?`).bind(me, keep).all();
  for (const { room_id } of results) await leaveRoom(db, me, room_id, now);
}

/** Someone who said Not now gets asked again only after this long. */
export const REINVITE_MS = 10 * MIN;

function invite(room, members, host, ids, now) {
  for (const id of ids) {
    const m = members.find((x) => x.userId === id);
    /* already asked or in it; someone who studied here may rejoin as they are (mayEnter) */
    if (m && (m.state !== 'left' || m.joinedAt !== null || m.invitedAt > now - REINVITE_MS)) continue;
    if (!m && members.length >= ROOM_ROWS) continue;
    if (m) Object.assign(m, { state: 'invited', invitedBy: host, invitedAt: now });
    else members.push({ userId: id, name: '', username: '', state: 'invited', invitedBy: host, invitedAt: now, joinedAt: null, joinedStudyMs: null, earlierMs: 0, leftAt: null, lastSeen: null, courseLabel: '' });
  }
}

/* ── the routes' work ── */

/** Start a room on `flow`: you are its host and in it; the friends in `invite` are invited. */
export async function createRoom(db, me, body, now = Date.now()) {
  const flow = studyFlow(body?.flow);
  const courseLabel = label(body?.courseLabel);
  const asked = userIds(body?.invite, 'invite', ROOM_SIZE - 1).filter((id) => id !== me);
  const wait = await claimLimit(db, `room:${me}`, ROOMS_PER_DAY, now, DAY_MS);
  if (wait) throw rateLimited(wait);
  await leaveOthers(db, me, '', now);
  const friends = await friendsAmong(db, me, asked);
  const who = await db.prepare(`SELECT ${NAME} AS name FROM users AS u WHERE u.id = ?`).bind(me).first();
  const id = randomId(12);
  const run = timer.start(flow, now);
  const feed = [{ at: now, kind: 'started', name: who?.name ?? '' }];
  await db.batch([
    db.prepare(`INSERT INTO rooms (id, host_id, flow, started_at, paused_ms, skipped_ms, skipped_study_ms, feed, created_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`).bind(id, me, JSON.stringify(run.flow), now, JSON.stringify(feed), now),
    db.prepare(`INSERT INTO room_members (room_id, user_id, state, joined_at, joined_study_ms, last_seen, course_label)
      VALUES (?, ?, 'in', ?, 0, ?, ?)`).bind(id, me, now, now, courseLabel),
    ...friends.map((f) => db.prepare(`INSERT INTO room_members (room_id, user_id, state, invited_by, invited_at) VALUES (?, ?, 'invited', ?, ?)`).bind(id, f, me, now)),
  ]);
  return getRoom(db, me, id, null, now);
}

/** The room as you see it; null for a 304 (`tag` matched). Writes your last_seen every 30 s. */
export async function getRoom(db, me, roomId, tag = null, now = Date.now()) {
  const first = await load(db, roomId);
  const listed = first?.members.find((m) => m.userId === me);
  if (!listed || !(await mayEnter(db, me, first.room, first.members, listed))) throw notFound();
  const { room, members } = await change(db, roomId, (room, members) => {
    if (!members.some((m) => m.userId === me)) throw notFound();
  }, now, me);
  const out = view(room, members, now);
  return tag !== null && tag === out.tag ? null : out;
}

/** Join: invited, in it before, or a friend of the host; while it is open and has room. */
export async function joinRoom(db, me, roomId, body, now = Date.now()) {
  const courseLabel = label(body?.courseLabel);
  const first = await load(db, roomId);
  if (!first) throw notFound();
  if (!(await mayEnter(db, me, first.room, first.members, first.members.find((m) => m.userId === me)))) throw notFound();
  if (first.room.endedAt !== null) throw ended();
  const who = await db.prepare(`SELECT u.username, ${NAME} AS name FROM users AS u WHERE u.id = ?`).bind(me).first();
  const { room, members } = await change(db, roomId, (room, members) => {
    if (room.endedAt !== null) throw ended();
    let m = members.find((x) => x.userId === me);
    if (m?.state === 'in') { m.courseLabel = courseLabel; return; }
    if (members.filter((x) => x.state === 'in').length >= ROOM_SIZE) throw new HttpError(409, { error: 'full' });
    if (!m) {
      m = { userId: me, invitedBy: null, invitedAt: null, joinedAt: null, earlierMs: 0, leftAt: null, lastSeen: null };
      members.push(m);
    }
    Object.assign(m, { name: who.name, username: who.username, state: 'in', joinedAt: m.joinedAt ?? now, joinedStudyMs: studyAt(room.run, now), leftAt: null, lastSeen: now, courseLabel });
    event(room, 'joined', who.name, now);
  }, now, me);
  /* only once you are in: a join that fails (full, ended) leaves you where you were */
  await leaveOthers(db, me, roomId, now);
  return view(room, members, now);
}

/** Leave: your study so far is kept for a later rejoin; an invite you have not taken up is dropped. */
export async function leaveRoom(db, me, roomId, now = Date.now()) {
  await change(db, roomId, (room, members) => {
    const m = members.find((x) => x.userId === me);
    if (!m) throw notFound();
    if (m.state !== 'left') takeOut(room, members, m, now);
  }, now);
}

/** The host's Pause, Resume, Skip and End, for everyone. */
export async function roomClock(db, me, roomId, body, now = Date.now()) {
  const action = body?.action;
  if (!['pause', 'resume', 'skip', 'end'].includes(action)) throw new HttpError(400, { error: 'invalid', field: 'action' });
  const { room, members } = await change(db, roomId, (room, members) => {
    const m = members.find((x) => x.userId === me);
    if (!m) throw notFound();
    if (room.endedAt !== null) throw ended();
    if (room.hostId !== me || m.state !== 'in') throw new HttpError(403, { error: 'not_host' });
    if (action === 'end') { end(room, now); return; }
    const next = action === 'pause' ? timer.pause(room.run, now) : action === 'resume' ? timer.resume(room.run, now) : timer.skip(room.run, now);
    if (JSON.stringify(next) === JSON.stringify(room.run)) return;
    room.run = next;
    event(room, action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'skipped', m.name, now);
  }, now, me);
  return view(room, members, now);
}

/** Invite more friends: the host only. */
export async function inviteToRoom(db, me, roomId, body, now = Date.now()) {
  const ids = userIds(body?.userIds, 'userIds', ROOM_SIZE).filter((id) => id !== me);
  const friends = await friendsAmong(db, me, ids);
  await change(db, roomId, (room, members) => {
    const m = members.find((x) => x.userId === me);
    if (!m) throw notFound();
    if (room.endedAt !== null) throw ended();
    if (room.hostId !== me || m.state !== 'in') throw new HttpError(403, { error: 'not_host' });
    invite(room, members, me, friends, now);
  }, now, me);
}

/** Change the class you show the room. */
export async function setRoomLabel(db, me, roomId, body, now = Date.now()) {
  const courseLabel = label(body?.courseLabel);
  const { room, members } = await change(db, roomId, (room, members) => {
    const m = members.find((x) => x.userId === me);
    if (!m || m.state !== 'in') throw notFound();
    m.courseLabel = courseLabel;
  }, now, me);
  return view(room, members, now);
}

/* An open room: not ended, and someone in it has polled in the last 10 minutes. */
const OPEN = (r) => `${r}.ended_at IS NULL AND EXISTS (SELECT 1 FROM room_members AS o WHERE o.room_id = ${r}.id AND o.state = 'in' AND o.last_seen > ?2)`;

/** Invites to open rooms, for the inbox: newest first. */
export async function roomInvites(db, me, now = Date.now()) {
  const { results } = await db.prepare(`SELECT r.*, u.username, ${NAME} AS name, m.invited_at,
      (SELECT count(*) FROM room_members AS c WHERE c.room_id = r.id AND c.state = 'in') AS size
    FROM room_members AS m JOIN rooms AS r ON r.id = m.room_id LEFT JOIN users AS u ON u.id = r.host_id
    WHERE m.user_id = ?1 AND m.state = 'invited' AND ${OPEN('r')} AND ${STILL_FRIENDS}
    ORDER BY m.invited_at DESC LIMIT 20`).bind(me, now - GONE_MS).all();
  return results.map((r) => ({ roomId: r.id, hostId: r.host_id, name: r.name ?? '', username: r.username ?? '', run: roomOf(r).run, size: r.size, at: r.invited_at }));
}

/* an invite counts only while the one who sent it, or the host, is still your friend (mayEnter) */
const FRIEND_OF = (other) => `EXISTS (SELECT 1 FROM friendships AS fo WHERE fo.status = 'accepted' AND fo.user_lo = min(?1, ${other}) AND fo.user_hi = max(?1, ${other}))`;
const STILL_FRIENDS = `(${FRIEND_OF('m.invited_by')} OR ${FRIEND_OF('r.host_id')})`;

/** How many open-room invites wait for you (the inbox's count). */
export const ROOM_INVITES_COUNT = `(SELECT count(*) FROM room_members AS m JOIN rooms AS r ON r.id = m.room_id
  WHERE m.user_id = ?1 AND m.state = 'invited' AND r.ended_at IS NULL AND ${STILL_FRIENDS}
    AND EXISTS (SELECT 1 FROM room_members AS o WHERE o.room_id = r.id AND o.state = 'in' AND o.last_seen > ?2 - ${GONE_MS}))`;

/* a friend who shows they are studying: the pair's row read with ?1 = me, joined to `extra` */
const showing = (extra = '') => `FROM friendships AS f
    JOIN users AS u ON u.id = CASE WHEN f.user_lo = ?1 THEN f.user_hi ELSE f.user_lo END
    LEFT JOIN friend_settings AS s ON s.user_id = u.id
    ${extra}
    WHERE (f.user_lo = ?1 OR f.user_hi = ?1) AND f.status = 'accepted' AND COALESCE(s.show_studying, 1) = 1`;

/**
 * Your friends who are studying now, for the Friends tab (spec §1): userId → {label, since, room}.
 * Only friends who show it (Show friends when I'm studying). `room` ({id, size}) is set when they
 * are in an open room you may join (as mayEnter: the host is you or your friend, you were in it before, or a friend invited you); a
 * room you may not join still shows them studying. A solo run comes from presence.
 */
export async function friendsLive(db, me, now = Date.now()) {
  const [rooms, solo] = await db.batch([
    db.prepare(`SELECT u.id AS user_id, r.id, m.course_label, m.joined_at,
        (SELECT count(*) FROM room_members AS c WHERE c.room_id = r.id AND c.state = 'in') AS size,
        (r.host_id = ?1 OR EXISTS (SELECT 1 FROM room_members AS mine WHERE mine.room_id = r.id AND mine.user_id = ?1
            AND (mine.joined_at IS NOT NULL OR (mine.state = 'invited' AND ${FRIEND_OF('mine.invited_by')})))
          OR EXISTS (SELECT 1 FROM friendships AS h WHERE h.status = 'accepted' AND h.user_lo = min(?1, r.host_id) AND h.user_hi = max(?1, r.host_id))) AS joinable
      ${showing("JOIN room_members AS m ON m.user_id = u.id AND m.state = 'in' JOIN rooms AS r ON r.id = m.room_id")}
        AND m.last_seen > ?2 AND ${OPEN('r')}`).bind(me, now - GONE_MS),
    db.prepare(`SELECT u.id AS user_id, p.course_label, p.started_at ${showing('JOIN presence AS p ON p.user_id = u.id')} AND p.ends_at > ?2`).bind(me, now),
  ]);
  const out = new Map();
  for (const r of solo.results) out.set(r.user_id, { label: r.course_label, since: r.started_at, room: null });
  for (const r of rooms.results) out.set(r.user_id, { label: r.course_label, since: r.joined_at, room: r.joinable ? { id: r.id, size: r.size } : null });
  return out;
}

/** When each friend who shows it last studied (the start of their latest session). */
export async function friendsLastStudied(db, me) {
  const { results } = await db.prepare(`SELECT u.id AS user_id,
      (SELECT max(ss.started_at) FROM study_sessions AS ss WHERE ss.user_id = u.id AND ss.deleted_at IS NULL) AS last
    ${showing()}`).bind(me).all();
  return new Map(results.filter((r) => r.last !== null).map((r) => [r.user_id, r.last]));
}

/* ── presence: a solo run, so friends see you studying ── */

/** How long past its planned end a solo run still shows (a pause, a slow tab). */
export const PRESENCE_SLACK_MS = 10 * MIN;

/** A solo run started or resumed: {courseLabel, startedAt, endsAt}. Nothing is kept while you
    hide that you are studying. */
export async function setPresence(db, me, body, now = Date.now()) {
  const courseLabel = label(body?.courseLabel);
  const time = (v, field) => {
    if (!Number.isSafeInteger(v)) throw new HttpError(400, { error: 'invalid', field });
    return v;
  };
  const startedAt = Math.min(now, Math.max(now - DAY_MS, time(body?.startedAt, 'startedAt')));
  const endsAt = Math.min(now + DAY_MS, Math.max(now, time(body?.endsAt, 'endsAt'))) + PRESENCE_SLACK_MS;
  await db.prepare(`INSERT INTO presence (user_id, course_label, started_at, ends_at)
    SELECT ?1, ?2, ?3, ?4 WHERE COALESCE((SELECT show_studying FROM friend_settings WHERE user_id = ?1), 1) = 1
    ON CONFLICT (user_id) DO UPDATE SET course_label = excluded.course_label, started_at = excluded.started_at, ends_at = excluded.ends_at`)
    .bind(me, courseLabel, startedAt, endsAt).run();
}

export const clearPresence = (db, me) => db.prepare('DELETE FROM presence WHERE user_id = ?').bind(me).run();

/* ── the group record ── */

/** Who was in the room and each person's minutes: the sum of their sessions that name it, so an
    edit or delete of your own session shows here too. Only people who were in it may read it. */
export async function groupRecord(db, me, roomId) {
  const [room, rows] = await db.batch([
    db.prepare('SELECT id, started_at, ended_at FROM rooms WHERE id = ?').bind(roomId),
    db.prepare(`SELECT m.user_id, u.username, ${NAME} AS name, m.joined_at,
        COALESCE((SELECT sum(ss.study_minutes) FROM study_sessions AS ss WHERE ss.user_id = m.user_id AND ss.room_id = m.room_id AND ss.deleted_at IS NULL), 0) AS minutes
      FROM room_members AS m JOIN users AS u ON u.id = m.user_id
      WHERE m.room_id = ? AND m.joined_at IS NOT NULL ORDER BY minutes DESC, m.joined_at`).bind(roomId),
  ]);
  const r = room.results[0];
  if (!r || !rows.results.some((x) => x.user_id === me)) throw notFound();
  return {
    roomId: r.id, startedAt: r.started_at, endedAt: r.ended_at,
    members: rows.results.map((x) => ({ userId: x.user_id, username: x.username, name: x.name, minutes: x.minutes })),
  };
}

/* ── the nightly cron ── */

export const STALE_MS = 30 * MIN;
export const ROOM_KEEP_MS = 90 * DAY_MS;

/** End rooms nobody has polled for 30 minutes (their people taken out, minutes kept), drop presence
    past its end, and delete rooms 90 days after they ended unless a session still names them. */
export async function purgeRooms(db, now = Date.now()) {
  const { results } = await db.prepare(`SELECT r.id FROM rooms AS r WHERE r.ended_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM room_members AS m WHERE m.room_id = r.id AND m.state = 'in' AND m.last_seen > ?) LIMIT 200`).bind(now - STALE_MS).all();
  for (const { id } of results) {
    try { await change(db, id, () => {}, now); } catch { /* the next night tries again */ }
  }
  await db.batch([
    db.prepare('DELETE FROM presence WHERE ends_at < ?').bind(now),
    db.prepare('DELETE FROM rooms WHERE ended_at < ? AND NOT EXISTS (SELECT 1 FROM study_sessions AS ss WHERE ss.room_id = rooms.id)').bind(now - ROOM_KEEP_MS),
  ]);
}

const route = (path) => new RegExp(`^/api/${path}$`);
const ID = '([a-z0-9]{12})';
const noContent = () => new Response(null, { status: 204 });

export const roomRoutes = [
  ['POST', route('rooms'), async ({ request, env }) => json(await createRoom(env.DB, await requireUser(request, env), await readJson(request)))],
  ['GET', route(`rooms/${ID}`), async ({ request, env, url, params: [id] }) => {
    const out = await getRoom(env.DB, await requireUser(request, env), id, url.searchParams.get('v'));
    return out ? json(out) : new Response(null, { status: 304 });
  }],
  ['POST', route(`rooms/${ID}/join`), async ({ request, env, params: [id] }) =>
    json(await joinRoom(env.DB, await requireUser(request, env), id, await readJson(request)))],
  ['POST', route(`rooms/${ID}/leave`), async ({ request, env, params: [id] }) => {
    await leaveRoom(env.DB, await requireUser(request, env), id);
    return noContent();
  }],
  ['PUT', route(`rooms/${ID}/clock`), async ({ request, env, params: [id] }) =>
    json(await roomClock(env.DB, await requireUser(request, env), id, await readJson(request)))],
  ['POST', route(`rooms/${ID}/invite`), async ({ request, env, params: [id] }) => {
    await inviteToRoom(env.DB, await requireUser(request, env), id, await readJson(request));
    return noContent();
  }],
  ['PUT', route(`rooms/${ID}/me`), async ({ request, env, params: [id] }) =>
    json(await setRoomLabel(env.DB, await requireUser(request, env), id, await readJson(request)))],
  ['GET', route(`rooms/${ID}/record`), async ({ request, env, params: [id] }) =>
    json(await groupRecord(env.DB, await requireUser(request, env), id))],
  ['PUT', route('presence'), async ({ request, env }) => {
    await setPresence(env.DB, await requireUser(request, env), await readJson(request));
    return noContent();
  }],
  ['DELETE', route('presence'), async ({ request, env }) => {
    await clearPresence(env.DB, await requireUser(request, env));
    return noContent();
  }],
];
