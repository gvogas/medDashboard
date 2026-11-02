// Study Buddy (docs/superpowers/specs/2026-10-14-study-buddy-spec.md §4): the Gameplay switch,
// coins, XP, tier, health and streak, the shop and the custom buddy. XP, health and streak are worked out on every read from
// synced rows; coins are ledger rows that the same read writes for anything not yet paid, keyed
// by source so nothing pays twice. The first half is the rules on plain rows, with no D1; the second
// reads and writes D1 and serves /api/buddy.

import {
  BIG_FINISH_COINS, BIG_TYPES, COSMETICS, DAY_MINUTES, FINISH_COINS, FINISH_XP, FINISHED, FINISHER_COINS, FOCUS_RATE, GRADE_BONUS,
  HEALTH, HEALTH_DAYS, LOG_WINDOW_MS, LOOK_BUDDIES, MINUTES_PER_COIN, NAME_MAX, PERSONAL_FINISH_LIMIT, REVIEW_FINISH_LIMIT, REVIEW_ID,
  STREAK_COINS, STREAK_MAX, STREAK_MINUTES, TIERS, UPGRADES, checkCustom, isReview, moodOf, nextTier, tierOf, upgradeCost,
} from '../src/core/buddy-rules.ts';
import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { localNow, validTz } from './push.js';
import { DAY_MS, addDays } from './time.js';

/** The local YYYY-MM-DD of a time in the zone `tz`. */
export const dayOf = (ms, tz) => localNow(tz, ms).day;

/**
 * Each timed session's minutes that count, filling every local day up to DAY_MINUTES in start
 * order: [{id, day, counted}]. Typed-in logs, deleted sessions, sessions from before `since`,
 * and sessions saved more than LOG_WINDOW_MS after they began count for nothing.
 */
export function countSessions(rows, tz, since) {
  const live = rows
    .filter((s) => !s.manual && !s.deleted_at && s.started_at >= since && s.created_at - s.started_at <= LOG_WINDOW_MS)
    .sort((a, b) => a.started_at - b.started_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Map();
  const out = [];
  for (const s of live) {
    const day = dayOf(s.started_at, tz);
    const left = DAY_MINUTES - (used.get(day) || 0);
    const counted = Math.max(0, Math.min(left, s.study_minutes));
    used.set(day, (used.get(day) || 0) + counted);
    if (counted > 0) out.push({ id: s.id, day, counted });
  }
  return out;
}

/**
 * Coins for counted sessions: one per MINUTES_PER_COIN minutes, plus FOCUS_RATE for each Focus
 * Engine level `focusOf(id)` returns (the level when that session was first paid).
 */
export function sessionAwards(counted, focusOf = () => 0) {
  const pct = Math.round(FOCUS_RATE * 100);
  return counted
    .map(({ id, day, counted: m }) => ({ source: 'session:' + id, amount: Math.floor((Math.floor(m / MINUTES_PER_COIN) * (100 + pct * focusOf(id))) / 100), day }))
    .filter((a) => a.amount > 0);
}

/**
 * Grade bonuses not yet paid for class items: rows {key: 'c:<space>:<id>', grade}; each step of
 * GRADE_BONUS the grade has reached pays once (`grade80:<key>`, `grade90:<key>`).
 */
export function gradeAwards(rows, paid, day) {
  const out = [];
  for (const r of rows) for (const g of GRADE_BONUS) {
    const source = `${g.key}:${r.key}`;
    if (r.grade >= g.min && !paid.has(source)) out.push({ source, amount: g.coins, day });
  }
  return out;
}

/** An upgrade's level at time `t`, from its buy:<sku>:<level> spends: one level per spend written by then. */
export const levelAt = (ledger, sku, t) => ledger.filter((l) => l.source.startsWith(`buy:${sku}:`) && l.at <= t).length;

/**
 * Coins for finishes not yet paid. Rows: {key, scope: 'u'|'c', id, type, title, completed_at};
 * `key` is 'u:<id>' or 'c:<space>:<id>'. Each is dated by its completed_at clamped to [from, now],
 * so it can't be backdated past the Worker's last look. Personal finishes share
 * PERSONAL_FINISH_LIMIT a day and lecture reviews have REVIEW_FINISH_LIMIT apart from that, both
 * counted on from `used` ({day: {personal, review}}, what earlier reads already paid); class
 * finishes have no limit. Each paying finish gets FINISHER_COINS per Finisher level. Over a limit
 * the amount is 0, which still records the finish.
 */
export function finishAwards(rows, { tz, from, now, used = {}, finisher = 0 }) {
  const dated = rows
    .map((r) => ({ ...r, t: Math.min(now, Math.max(from, r.completed_at ?? now)) }))
    .sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const count = Object.fromEntries(Object.entries(used).map(([d, c]) => [d, { personal: c.personal || 0, review: c.review || 0 }]));
  return dated.map((r) => {
    const day = dayOf(r.t, tz);
    const c = (count[day] ||= { personal: 0, review: 0 });
    let amount = (r.scope === 'c' && BIG_TYPES.includes(r.type) ? BIG_FINISH_COINS : FINISH_COINS) + FINISHER_COINS * finisher;
    if (r.scope === 'u') {
      const kind = isReview(r.id, r.title || '') ? 'review' : 'personal';
      const limit = kind === 'review' ? REVIEW_FINISH_LIMIT : PERSONAL_FINISH_LIMIT;
      if (c[kind] >= limit) amount = 0;
      else c[kind]++;
    }
    return { source: 'item:' + r.key, amount, day };
  });
}

/** XP: counted minutes, 10 per paid finish still finished, and the admin bonus. */
export function xpOf({ counted, finishes, bonus = 0 }) {
  return counted.reduce((s, c) => s + c.counted, 0) + FINISH_XP * finishes + bonus;
}

/**
 * Health over `window` (days in order) from 100: each day's events, then the idle rule (the
 * HEALTH.idleFrom-th day in a row with no timed minutes and every one after costs HEALTH.idle),
 * then +1 per 10 timed minutes; clamped to 0-100 after each step.
 */
export function healthOf({ window, minutesByDay, events }) {
  const clamp = (h) => Math.max(0, Math.min(100, h));
  let h = 100, idle = 0;
  for (const day of window) {
    for (const e of events) if (e.day === day) h = clamp(h + e.change);
    const m = minutesByDay[day] || 0;
    idle = m > 0 ? 0 : idle + 1;
    if (idle >= HEALTH.idleFrom) h = clamp(h + HEALTH.idle);
    h = clamp(h + Math.floor(m / 10) * HEALTH.perTenMinutes);
  }
  return h;
}

/**
 * The streak from `fromDay` to `today`: a day with STREAK_MINUTES or more extends it and pays
 * min(STREAK_MAX, STREAK_COINS × length); a past day under it resets the run. Today counts once
 * it qualifies and, while it doesn't yet, leaves the run standing. Returns {awards, streak}.
 */
export function streakAwards(minutesByDay, fromDay, today) {
  const awards = [];
  let run = 0;
  for (let day = fromDay; day <= today; day = addDays(day, 1)) {
    if ((minutesByDay[day] || 0) >= STREAK_MINUTES) {
      run++;
      awards.push({ source: 'streak:' + day, amount: Math.min(STREAK_MAX, STREAK_COINS * run), day });
    } else if (day !== today) {
      run = 0;
    }
  }
  return { awards, streak: run };
}

// ── D1: settings, reconcile, the Buddy read, claim and look ─────────────────────────────────

const DEFAULT_LOOK = { buddy: 'auto', bg: 'none', frame: 'none', name: '' };
const DONE_SQL = `(${FINISHED.map((s) => `'${s}'`).join(', ')})`;
const off = () => new HttpError(409, { error: 'gameplay_off' });
const parseCustom = (v) => { try { return v ? checkCustom(JSON.parse(v)) : null; } catch { return null; } };
const parseLook = (v) => { try { const l = JSON.parse(v); return l && typeof l === 'object' ? { ...DEFAULT_LOOK, ...l } : DEFAULT_LOOK; } catch { return DEFAULT_LOOK; } };

export const settingsStmt = (db, userId) => db.prepare('SELECT * FROM buddy_settings WHERE user_id = ?').bind(userId);

/** Everything reconcile and the read need, in one batch: sessions, finishes, the ledger, health items. */
function reads(db, userId, s, from, to) {
  return db.batch([
    db.prepare('SELECT id, started_at, study_minutes, manual, created_at, deleted_at FROM study_sessions WHERE user_id = ? AND started_at >= ?')
      .bind(userId, s.since),
    db.prepare(`SELECT id, type, title, completed_at FROM items WHERE scope = 'u:' || ? AND deleted_at IS NULL AND recur IS NULL AND status IN ${DONE_SQL}`)
      .bind(userId),
    /* your marks on a class's items; a project's tasks earn nothing yet */
    db.prepare(`SELECT m.space_id, m.item_id AS id, i.type, i.title, m.completed_at FROM marks AS m
        JOIN items AS i ON i.scope = 'c:' || m.space_id AND i.id = m.item_id AND i.deleted_at IS NULL
        WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.hidden = 0 AND m.status IN ${DONE_SQL}`).bind(userId),
    db.prepare('SELECT source, amount, day, at FROM buddy_ledger WHERE user_id = ?').bind(userId),
    /* health: labs and office hours missed, assignments left open, in the window */
    db.prepare(`SELECT type, status, date FROM items WHERE scope = 'u:' || ? AND deleted_at IS NULL AND recur IS NULL
        AND type IN ('lab', 'office', 'assignment') AND date BETWEEN ? AND ?`).bind(userId, from, to),
    db.prepare(`SELECT i.type, COALESCE(m.status, 'todo') AS status, i.date FROM members AS mb
        JOIN items AS i ON i.scope = 'c:' || mb.space_id AND i.deleted_at IS NULL AND i.recur IS NULL
          AND i.type IN ('lab', 'office', 'assignment') AND i.date BETWEEN ?2 AND ?3
        LEFT JOIN marks AS m ON m.user_id = ?1 AND m.space_id = mb.space_id AND m.item_id = i.id AND m.deleted_at IS NULL
        WHERE mb.user_id = ?1 AND mb.deleted_at IS NULL AND COALESCE(m.hidden, 0) = 0`).bind(userId, from, to),
    /* grade bonus: your grades on a class's items, set or changed while gameplay was on */
    db.prepare(`SELECT m.space_id, m.item_id AS id, m.grade FROM marks AS m
        JOIN items AS i ON i.scope = 'c:' || m.space_id AND i.id = m.item_id AND i.deleted_at IS NULL
        WHERE m.user_id = ? AND m.deleted_at IS NULL AND m.grade >= ? AND m.updated_at >= ?`).bind(userId, GRADE_BONUS[0].min, s.on_at),
    db.prepare('SELECT sku, level FROM buddy_owned WHERE user_id = ?').bind(userId),
  ]);
}

/* -10 for a lab or office hour missed on its date, and for an assignment still open the day after it */
function healthEvents(rows, today) {
  const out = [];
  for (const r of rows) {
    if ((r.type === 'lab' || r.type === 'office') && r.status === 'missed') out.push({ day: r.date, change: HEALTH.missed });
    if (r.type === 'assignment' && r.status === 'todo' && r.date < today) out.push({ day: addDays(r.date, 1), change: HEALTH.missed });
  }
  return out;
}

/**
 * The Buddy for someone with gameplay on: pays what is unpaid (one insert, safe to run twice at
 * once), then answers the state. Null when gameplay is off or was never on.
 */
export async function reconcile(db, userId, now = Date.now()) {
  const s = await settingsStmt(db, userId).first();
  if (!s || !s.enabled) return null;
  const tz = s.tz, today = dayOf(now, tz);
  const startDay = dayOf(Math.max(s.since, now - (HEALTH_DAYS - 1) * DAY_MS), tz);
  const [sessions, personal, marks, ledger, ownHealth, classHealth, grades, owned] = (await reads(db, userId, s, startDay, today)).map((r) => r.results);
  const paid = new Map(ledger.map((l) => [l.source, l]));

  /* sessions: XP counts every timed minute since `since`; coins only from when gameplay was last turned on */
  const counted = countSessions(sessions, tz, s.since);
  const startedOf = new Map(sessions.map((x) => [x.id, x.started_at]));
  /* Focus Engine at the level it had when each session was first paid, so buying it never re-pays old sessions */
  const focusOf = (id) => levelAt(ledger, 'focus', paid.get('session:' + id)?.at ?? now);
  const sessionPay = sessionAwards(counted.filter((c) => startedOf.get(c.id) >= s.on_at), focusOf)
    .filter((a) => !paid.has(a.source) || paid.get(a.source).amount < a.amount);

  /* finishes not yet recorded; one finished while gameplay was off never pays */
  const finished = [
    ...personal.map((r) => ({ ...r, scope: 'u', key: 'u:' + r.id })),
    ...marks.map((r) => ({ ...r, scope: 'c', key: `c:${r.space_id}:${r.id}` })),
  ];
  const fresh = finished.filter((r) => !paid.has('item:' + r.key) && !(r.completed_at != null && r.completed_at < s.on_at));
  const used = {};
  for (const l of ledger) {
    if (!l.source.startsWith('item:u:') || l.amount <= 0) continue;
    const kind = REVIEW_ID.test(l.source.slice(7)) ? 'review' : 'personal';
    (used[l.day] ||= { personal: 0, review: 0 })[kind]++;
  }
  const finisher = owned.find((o) => o.sku === 'finisher')?.level ?? 0;
  const finishPay = finishAwards(fresh, { tz, from: Math.max(s.reconciled_at, s.on_at), now, used, finisher });
  const gradePay = gradeAwards(grades.map((g) => ({ key: `c:${g.space_id}:${g.id}`, grade: g.grade })), paid, today);

  /* the streak runs from `since`; its coins only for days from when gameplay was last turned on */
  const minutesByDay = {};
  for (const c of counted) minutesByDay[c.day] = (minutesByDay[c.day] || 0) + c.counted;
  const onDay = dayOf(s.on_at, tz);
  const { awards: streakAll, streak } = streakAwards(minutesByDay, dayOf(s.since, tz), today);
  const streakPay = streakAll.filter((a) => a.day >= onDay && !paid.has(a.source));

  const pay = [...sessionPay, ...finishPay, ...gradePay, ...streakPay];
  if (pay.length) {
    await db.batch([
      db.prepare(`INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at)
          SELECT ?1, json_extract(value, '$.source'), 'earn', json_extract(value, '$.amount'), json_extract(value, '$.day'), ?2 FROM json_each(?3) WHERE true
          ON CONFLICT (user_id, source) DO UPDATE SET amount = max(buddy_ledger.amount, excluded.amount) WHERE buddy_ledger.source GLOB 'session:*'`)
        .bind(userId, now, JSON.stringify(pay)),
      db.prepare('UPDATE buddy_settings SET reconciled_at = ? WHERE user_id = ?').bind(now, userId),
    ]);
  } else {
    await db.prepare('UPDATE buddy_settings SET reconciled_at = ? WHERE user_id = ?').bind(now, userId).run();
  }

  /* the state, from the ledger as it now stands */
  const rows = (await db.prepare('SELECT source, amount, day, at FROM buddy_ledger WHERE user_id = ? ORDER BY at DESC, source').bind(userId).all()).results;
  const finishedKeys = new Set(finished.map((r) => 'item:' + r.key));
  const finishes = rows.filter((r) => r.source.startsWith('item:') && r.amount > 0 && finishedKeys.has(r.source)).length;
  const xp = xpOf({ counted, finishes, bonus: s.xp_bonus });
  const window = [];
  for (let d = startDay; d <= today; d = addDays(d, 1)) window.push(d);
  const health = healthOf({ window, minutesByDay, events: healthEvents([...ownHealth, ...classHealth], today) });
  const claimed = new Set(rows.filter((r) => r.source.startsWith('claim:')).map((r) => r.source.slice(6)));
  const tier = tierOf(xp), next = nextTier(xp);
  return {
    enabled: true,
    xp, tier: tier.id, next: next ? { tier: next.id, xp: next.minXp } : null,
    health, mood: moodOf(health), streak,
    coins: rows.reduce((sum, r) => sum + r.amount, 0),
    look: parseLook(s.look), tz,
    custom: parseCustom(s.custom),
    owned: owned.filter((o) => COSMETICS.some((c) => c.sku === o.sku)).map((o) => o.sku).sort(),
    tiers: TIERS.map((t) => ({ id: t.id, minXp: t.minXp, reward: t.reward, reached: xp >= t.minXp, claimed: claimed.has(t.id) })),
    recent: rows.filter((r) => r.amount !== 0).slice(0, 10).map((r) => ({ source: r.source, amount: r.amount, at: r.at })),
    due: 0,
  };
}

const OFF = { enabled: false };
export const buddyState = async (db, userId, now = Date.now()) => (await reconcile(db, userId, now)) ?? OFF;

/** Turn gameplay on or off; the first time on sets `since`, each time on from off sets `on_at` and `reconciled_at`. */
export async function saveSettings(db, userId, body, now = Date.now()) {
  if (typeof body.enabled !== 'boolean') throw new HttpError(400, { error: 'invalid', field: 'enabled' });
  const tz = body.tz === undefined ? null : validTz(body.tz);
  const on = body.enabled ? 1 : 0;
  await db.prepare(`INSERT INTO buddy_settings (user_id, enabled, since, on_at, reconciled_at, tz)
      VALUES (?1, ?2, CASE WHEN ?2 = 1 THEN ?3 END, CASE WHEN ?2 = 1 THEN ?3 END, ?3, COALESCE(?4, 'UTC'))
      ON CONFLICT (user_id) DO UPDATE SET
        since = CASE WHEN ?2 = 1 THEN COALESCE(buddy_settings.since, ?3) ELSE buddy_settings.since END,
        on_at = CASE WHEN ?2 = 1 AND buddy_settings.enabled = 0 THEN ?3 ELSE buddy_settings.on_at END,
        reconciled_at = CASE WHEN ?2 = 1 AND buddy_settings.enabled = 0 THEN ?3 ELSE buddy_settings.reconciled_at END,
        enabled = ?2,
        tz = COALESCE(?4, buddy_settings.tz)`).bind(userId, on, now, tz).run();
  return buddyState(db, userId, now);
}

async function enabledSettings(db, userId) {
  const s = await settingsStmt(db, userId).first();
  if (!s || !s.enabled) throw off();
  return s;
}

/** Claim a reached tier's reward; a second claim pays nothing. */
export async function claimTier(db, userId, body, now = Date.now()) {
  const s = await enabledSettings(db, userId);
  const t = TIERS.find((x) => x.id === body.tier);
  if (!t) throw new HttpError(400, { error: 'invalid', field: 'tier' });
  const state = await buddyState(db, userId, now);
  if (state.xp < t.minXp) throw new HttpError(409, { error: 'tier_not_reached' });
  await db.prepare("INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at) VALUES (?, ?, 'earn', ?, ?, ?) ON CONFLICT (user_id, source) DO NOTHING")
    .bind(userId, 'claim:' + t.id, t.reward, dayOf(now, s.tz), now).run();
  return buddyState(db, userId, now);
}

const ownedSkus = async (db, userId) => new Set((await db.prepare('SELECT sku FROM buddy_owned WHERE user_id = ?').bind(userId).all()).results.map((r) => r.sku));
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** The look: which buddy ('auto', a theme's or 'custom'), a background and a frame you own, and a name. */
export async function saveLook(db, userId, body, now = Date.now()) {
  const s = await enabledSettings(db, userId);
  const look = parseLook(s.look);
  if (body.buddy !== undefined) {
    if (!LOOK_BUDDIES.includes(body.buddy)) throw new HttpError(400, { error: 'invalid', field: 'buddy' });
    if (body.buddy === 'custom' && !parseCustom(s.custom)) throw new HttpError(409, { error: 'not_owned', field: 'buddy' });
    look.buddy = body.buddy;
  }
  for (const kind of ['bg', 'frame']) {
    const v = body[kind];
    if (v === undefined) continue;
    if (v !== 'none' && !COSMETICS.some((c) => c.sku === v && c.kind === kind)) throw new HttpError(400, { error: 'invalid', field: kind });
    if (v !== 'none' && !(await ownedSkus(db, userId)).has(v)) throw new HttpError(409, { error: 'not_owned', field: kind });
    look[kind] = v;
  }
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : null;
    if (name === null || [...name].length > NAME_MAX || CONTROL.test(name)) throw new HttpError(400, { error: 'invalid', field: 'name' });
    look.name = name;
  }
  await db.prepare('UPDATE buddy_settings SET look = ? WHERE user_id = ?').bind(JSON.stringify(look), userId).run();
  return buddyState(db, userId, now);
}

/** Save the custom buddy made in the browser (only its grid and palette), or delete it. */
export async function saveCustom(db, userId, body, now = Date.now()) {
  await enabledSettings(db, userId);
  const custom = checkCustom(body);
  if (!custom) throw new HttpError(400, { error: 'invalid', field: 'custom' });
  await db.prepare('UPDATE buddy_settings SET custom = ? WHERE user_id = ?').bind(JSON.stringify(custom), userId).run();
  return buddyState(db, userId, now);
}
export async function deleteCustom(db, userId, now = Date.now()) {
  const s = await enabledSettings(db, userId);
  const look = parseLook(s.look);
  if (look.buddy === 'custom') look.buddy = 'auto';
  await db.prepare('UPDATE buddy_settings SET custom = NULL, look = ? WHERE user_id = ?').bind(JSON.stringify(look), userId).run();
  return buddyState(db, userId, now);
}

/* ── the shop ── */
const SHOP = [
  ...UPGRADES.filter((u) => u.open).map((u) => ({ sku: u.sku, kind: 'upgrade', name: u.name, effect: u.effect, max: u.max, cost: (n) => upgradeCost(u, n) })),
  ...COSMETICS.map((c) => ({ sku: c.sku, kind: c.kind, name: c.name, effect: 'Cosmetic', max: 1, cost: () => c.cost })),
];
const shopItem = (it, level) => ({ sku: it.sku, kind: it.kind, name: it.name, effect: it.effect, level, max: it.max, cost: level < it.max ? it.cost(level + 1) : null });

/** The shop: each item with the level you have and the next level's cost (null at the top). */
export async function shopState(db, userId, now = Date.now()) {
  await enabledSettings(db, userId);
  const state = await buddyState(db, userId, now);
  const levels = new Map((await db.prepare('SELECT sku, level FROM buddy_owned WHERE user_id = ?').bind(userId).all()).results.map((r) => [r.sku, r.level]));
  return { coins: state.coins, items: SHOP.map((it) => shopItem(it, levels.get(it.sku) ?? 0)) };
}

/**
 * Buy `level` of `sku`. One statement writes the spend only while the balance covers it and the
 * level is the next one, so too few coins writes nothing and two quick taps buy one level; the
 * owned row follows in the same batch, only if that spend is there.
 */
export async function buy(db, userId, body, now = Date.now()) {
  const s = await enabledSettings(db, userId);
  const it = SHOP.find((x) => x.sku === body.sku);
  if (!it) throw new HttpError(400, { error: 'invalid', field: 'sku' });
  if (!Number.isSafeInteger(body.level) || body.level < 1 || body.level > it.max) throw new HttpError(400, { error: 'invalid', field: 'level' });
  await reconcile(db, userId, now);                 /* pay what is due first, so the balance is current */
  const cost = it.cost(body.level), source = `buy:${it.sku}:${body.level}`;
  const [spent] = await db.batch([
    db.prepare(`INSERT INTO buddy_ledger (user_id, source, kind, amount, day, at)
        SELECT ?1, ?2, 'spend', -?3, ?4, ?5
        WHERE (SELECT COALESCE(SUM(amount), 0) FROM buddy_ledger WHERE user_id = ?1) >= ?3
          AND COALESCE((SELECT level FROM buddy_owned WHERE user_id = ?1 AND sku = ?6), 0) = ?7 - 1
        ON CONFLICT (user_id, source) DO NOTHING`).bind(userId, source, cost, dayOf(now, s.tz), now, it.sku, body.level),
    db.prepare(`INSERT INTO buddy_owned (user_id, sku, level, at)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM buddy_ledger WHERE user_id = ?1 AND source = ?5)
        ON CONFLICT (user_id, sku) DO UPDATE SET level = excluded.level, at = excluded.at WHERE excluded.level > buddy_owned.level`)
      .bind(userId, it.sku, body.level, now, source),
  ]);
  const [{ coins }, own] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS coins FROM buddy_ledger WHERE user_id = ?').bind(userId).first(),
    db.prepare('SELECT level FROM buddy_owned WHERE user_id = ? AND sku = ?').bind(userId, it.sku).first(),
  ]);
  const level = own?.level ?? 0;
  if (!spent.meta.changes) {
    if (level !== body.level - 1) throw new HttpError(409, { error: 'stale_level', level });
    throw new HttpError(409, { error: 'not_enough_coins', coins, cost });
  }
  return { coins, item: shopItem(it, level) };
}

const route = (path) => new RegExp(`^/api/${path}$`);
export const buddyRoutes = [
  ['GET', route('buddy'), async ({ request, env }) => json(await buddyState(env.DB, await requireUser(request, env)))],
  ['PUT', route('buddy/settings'), async ({ request, env }) =>
    json(await saveSettings(env.DB, await requireUser(request, env), await readJson(request)))],
  ['POST', route('buddy/claim'), async ({ request, env }) =>
    json(await claimTier(env.DB, await requireUser(request, env), await readJson(request)))],
  ['PUT', route('buddy/look'), async ({ request, env }) =>
    json(await saveLook(env.DB, await requireUser(request, env), await readJson(request)))],
  ['PUT', route('buddy/custom'), async ({ request, env }) =>
    json(await saveCustom(env.DB, await requireUser(request, env), await readJson(request)))],
  ['DELETE', route('buddy/custom'), async ({ request, env }) => json(await deleteCustom(env.DB, await requireUser(request, env)))],
  ['GET', route('buddy/shop'), async ({ request, env }) => json(await shopState(env.DB, await requireUser(request, env)))],
  ['POST', route('buddy/buy'), async ({ request, env }) =>
    json(await buy(env.DB, await requireUser(request, env), await readJson(request)))],
];
