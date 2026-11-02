// AI study material, Generate here (spec §6): one gateway for every study-AI route. It picks a
// provider (the slot: Stage 4 registers `workers`; a `chatgpt` one would join it, nothing else
// changing), enforces the caps (per user a day, extras bought with coins, a global neuron
// ceiling), builds the prompt from src/core/study-prompts.ts, asks with askJson, and keeps what
// fits by src/core/study-answers.ts. A failed call gives the use back. Use your own AI never
// reaches here: the browser builds the same prompt and reads the pasted answer itself.

import { json, readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';
import { requireAdmin } from './admin.js';
import { claimLimit } from './limits.js';
import { askJson, modelAnswer } from './ai.js';
import { DAY_MS } from './time.js';
import { cardsPrompt, HERE_LIMIT, LEVELS, TOPIC_MAX } from '../src/core/study-prompts.ts';
import { checkCards, CARDS_MAX, parseLoose } from '../src/core/study-answers.ts';
import { dayOf } from './buddy.js';

export const DEFAULT_CAPS = { perUser: 3, extraMax: 2, ceiling: 4000 };
export const CAP_LIMITS = { perUser: [0, 20], extraMax: [0, 5], ceiling: [0, 9000] };
export const MODEL = '@cf/openai/gpt-oss-120b';
/* gpt-oss-120b's price (developers.cloudflare.com/workers-ai/platform/pricing): neurons per million tokens */
const NEURONS_IN = 31_818, NEURONS_OUT = 68_182;
export const neuronsOf = (u) => Math.ceil(((u.prompt_tokens || 0) * NEURONS_IN + (u.completion_tokens || 0) * NEURONS_OUT) / 1_000_000);

const utcDay = (now) => new Date(now).toISOString().slice(0, 10);
const limitKey = (userId) => 'studyai:' + userId;

/* ── the provider slot ── */
/** Workers AI on Cloudflare's free allowance: the model outline reads use. */
export const workersProvider = {
  id: 'workers',
  available: (env) => !!env.AI,
  async run(env, prompt, clean, what) {
    const usage = { prompt_tokens: 0, completion_tokens: 0 };
    const answer = await askJson(env.AI, MODEL, {
      messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      max_tokens: 6000,
    }, clean, what, { onUsage: (u) => { usage.prompt_tokens += u.prompt_tokens || 0; usage.completion_tokens += u.completion_tokens || 0; } });
    return { answer, usage, model: MODEL };
  },
};
/** The registered providers, first available first. Tests add a fake one; nothing else changes. */
export const PROVIDERS = [workersProvider];

/* ── caps, usage and the ceiling, kept in app_meta ── */
export async function readCaps(db) {
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'studyai_caps'").first();
  try {
    const v = row ? JSON.parse(row.value) : {};
    return Object.fromEntries(Object.entries(DEFAULT_CAPS).map(([k, d]) => [k, Number.isInteger(v?.[k]) ? v[k] : d]));
  } catch { return { ...DEFAULT_CAPS }; }
}
export function validateCaps(body) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(CAP_LIMITS)) {
    const v = body?.[k];
    if (!Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, { error: 'invalid', field: k });
    out[k] = v;
  }
  return out;
}
const usageKey = (day) => 'studyai_usage:' + day;
async function usageOn(db, day) {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key = ?').bind(usageKey(day)).first();
  try { const v = JSON.parse(row?.value || '{}'); return { neurons: v.neurons || 0, generations: v.generations || 0, byProvider: v.byProvider || {} }; } catch { return { neurons: 0, generations: 0, byProvider: {} }; }
}
/** Add one generation to the day's usage, in one statement (two at once both count). */
const recordUsage = (db, day, provider, neurons, now) => db.prepare(`INSERT INTO app_meta (key, value, updated_at)
    VALUES (?1, json_object('neurons', ?2, 'generations', 1, 'byProvider', json_object(?3, 1)), ?4)
    ON CONFLICT (key) DO UPDATE SET updated_at = ?4, value = json_set(value,
      '$.neurons', COALESCE(json_extract(value, '$.neurons'), 0) + ?2,
      '$.generations', COALESCE(json_extract(value, '$.generations'), 0) + 1,
      '$.byProvider.' || ?3, COALESCE(json_extract(value, '$.byProvider.' || ?3), 0) + 1)`).bind(usageKey(day), neurons, provider, now).run();

/** Extra uses bought today (`buy:ai:<day>:<n>` in the ledger), in the person's own day. */
async function extrasToday(db, userId, now) {
  const s = await db.prepare('SELECT tz FROM buddy_settings WHERE user_id = ?').bind(userId).first();
  const day = dayOf(now, s?.tz || 'UTC');
  const row = await db.prepare("SELECT count(*) AS n FROM buddy_ledger WHERE user_id = ? AND source GLOB ?").bind(userId, `buy:ai:${day}:*`).first();
  return { day, n: row?.n ?? 0, gameplay: !!s };
}

/** The uses left in the person's 24-hour window, with what the extras add. */
async function usesLeft(db, userId, caps, extras, now) {
  const row = await db.prepare('SELECT hits, reset_at FROM request_limits WHERE key = ?').bind(limitKey(userId)).first();
  const used = row && row.reset_at > now ? row.hits : 0;
  return { left: Math.max(0, caps.perUser + extras - used), resetAt: row && row.reset_at > now ? row.reset_at : null };
}

/** GET /api/study-ai/status: which providers, uses left today, extras still buyable, and whether the day's ceiling is open. */
export async function studyAiStatus(env, userId, now = Date.now()) {
  const caps = await readCaps(env.DB);
  const extras = await extrasToday(env.DB, userId, now);
  const { left } = await usesLeft(env.DB, userId, caps, extras.n, now);
  const usage = await usageOn(env.DB, utcDay(now));
  return {
    providers: PROVIDERS.filter((p) => p.available(env)).map((p) => p.id),
    left, perUser: caps.perUser, extraLeft: Math.max(0, caps.extraMax - extras.n), globalOpen: usage.neurons < caps.ceiling,
  };
}

/* What the browser sends for cards: the material as text (it has the class's rows itself), the count and the level. */
function cardRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, { error: 'invalid', field: 'body' });
  const src = body.sources && typeof body.sources === 'object' ? body.sources : {};
  const text = (v, field, max) => {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v !== 'string') throw new HttpError(400, { error: 'invalid', field });
    if (v.length > max) throw new HttpError(413, { error: 'material_too_large' });
    return v;
  };
  const sources = { classData: text(src.classData, 'classData', 60_000), text: text(src.text, 'text', 60_000), topic: text(src.topic, 'topic', TOPIC_MAX) };
  if (!sources.classData.trim() && !sources.text.trim() && !sources.topic.trim()) throw new HttpError(400, { error: 'invalid', field: 'sources' });
  const count = body.count;
  if (!Number.isInteger(count) || count < 1 || count > CARDS_MAX) throw new HttpError(400, { error: 'invalid', field: 'count' });
  const level = body.level ?? 'exam';
  if (!LEVELS.includes(level)) throw new HttpError(400, { error: 'invalid', field: 'level' });
  if (body.provider !== undefined && typeof body.provider !== 'string') throw new HttpError(400, { error: 'invalid', field: 'provider' });
  return { sources, count, level, provider: body.provider };
}

/* failures where the model never gave a usable answer: the use comes back */
const GIVEN_BACK = new Set(['outline_quota', 'outline_unavailable', 'ai_timeout', 'outline_unreadable']);
const giveBack = (db, userId, now) => db.prepare('UPDATE request_limits SET hits = hits - 1 WHERE key = ? AND hits > 0 AND reset_at > ?').bind(limitKey(userId), now).run();

/**
 * POST /api/study-ai/cards: flashcards, a preview (nothing is saved). Claims a use, checks the
 * day's ceiling first, runs the provider, records the neurons; gives the use back when the
 * model fails. Spent: 429 study_ai_cap {retryAfter, extra}; the ceiling: 429 study_ai_busy. Both
 * say `paste: true`, so the browser offers Use your own AI at once.
 */
export async function generateCards(env, userId, body, now = Date.now(), providers = PROVIDERS) {
  const req = cardRequest(body);
  const provider = providers.find((p) => (!req.provider || p.id === req.provider) && p.available(env));
  if (!provider) throw new HttpError(503, { error: 'study_ai_unavailable', paste: true });
  const caps = await readCaps(env.DB);
  const day = utcDay(now);
  if ((await usageOn(env.DB, day)).neurons >= caps.ceiling) throw new HttpError(429, { error: 'study_ai_busy', paste: true });
  const extras = await extrasToday(env.DB, userId, now);
  const wait = await claimLimit(env.DB, limitKey(userId), caps.perUser + extras.n, now, DAY_MS);
  if (wait) throw new HttpError(429, { error: 'study_ai_cap', retryAfter: wait, extra: extras.gameplay && extras.n < caps.extraMax, paste: true });
  let result;
  try {
    const prompt = cardsPrompt(req.sources, { count: req.count, level: req.level }, HERE_LIMIT);
    result = await provider.run(env, prompt, (answer) => {
      const read = checkCards(safeParse(answer), req.count);
      if (!read.items.length) throw new HttpError(502, { error: 'outline_unreadable' });
      return read;
    }, 'study-ai:cards');
  } catch (e) {
    const code = e instanceof HttpError ? e.body?.error : 'outline_unavailable';
    if (GIVEN_BACK.has(code)) await giveBack(env.DB, userId, now).catch(() => {});
    throw e instanceof HttpError ? Object.assign(e, { body: { ...e.body, paste: true } }) : new HttpError(503, { error: 'outline_unavailable', paste: true });
  }
  const neurons = neuronsOf(result.usage);
  await recordUsage(env.DB, day, provider.id, neurons, now);
  console.log(`study-ai:cards ${provider.id} ${result.model} in=${result.usage.prompt_tokens} out=${result.usage.completion_tokens} neurons≈${neurons}`);
  const { left } = await usesLeft(env.DB, userId, caps, extras.n, now);
  return { cards: result.answer.items, provider: provider.id, left };
}
/* askJson hands `clean` the model's reply: an object in JSON mode, else text; study-answers reads the text */
function safeParse(answer) {
  const a = modelAnswer(answer);
  return typeof a === 'string' ? parseLoose(a) : a;
}

/** GET /api/admin/study-ai: today's usage against the ceiling, the last 14 days, and the caps. */
export async function studyAiAdmin(db, now = Date.now()) {
  const caps = await readCaps(db);
  const days = Array.from({ length: 14 }, (_, i) => utcDay(now - i * DAY_MS));
  const rows = (await db.prepare(`SELECT key, value FROM app_meta WHERE key IN (${days.map(() => '?').join(', ')})`).bind(...days.map(usageKey)).all()).results;
  const byDay = new Map(rows.map((r) => { try { return [r.key.slice(usageKey('').length), JSON.parse(r.value)]; } catch { return [r.key, {}]; } }));
  const of = (d) => ({ day: d, neurons: byDay.get(d)?.neurons || 0, generations: byDay.get(d)?.generations || 0, byProvider: byDay.get(d)?.byProvider || {} });
  return { today: { ...of(days[0]), ceiling: caps.ceiling }, last14: days.map(of), caps };
}

const route = (path) => new RegExp(`^/api/${path}$`);
export const studyAiRoutes = [
  ['GET', route('study-ai/status'), async ({ request, env }) => json(await studyAiStatus(env, await requireUser(request, env)))],
  ['POST', route('study-ai/cards'), async ({ request, env }) => json(await generateCards(env, await requireUser(request, env), await readJson(request)))],
  ['GET', route('admin/study-ai'), async ({ request, env }) => { await requireAdmin(request, env); return json(await studyAiAdmin(env.DB)); }],
  ['PUT', route('admin/study-ai/caps'), async ({ request, env }) => {
    await requireAdmin(request, env);
    const caps = validateCaps(await readJson(request));
    await env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('studyai_caps', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?1, updated_at = ?2")
      .bind(JSON.stringify(caps), Date.now()).run();
    return json(await studyAiAdmin(env.DB));
  }],
];
