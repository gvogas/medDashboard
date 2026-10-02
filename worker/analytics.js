// Traffic and free-tier usage for the Admin page, from Cloudflare's GraphQL Analytics
// API: no D1 writes, nothing counted by us. It needs CF_ACCOUNT_ID (a var) and
// CF_ANALYTICS_TOKEN (a secret: an API token with only "Account Analytics: Read").
// Without them the page says so and the rest of it still works.
//
// Each dataset is asked for on its own, so one that fails (a renamed field, a missing
// permission) leaves the others showing. Answers are cached for a minute per isolate's
// colo, which keeps a reloading page well inside the API's own limits.

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const SCRIPT = 'rounds';
const CACHE_S = 60;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* The free plan's daily allowances, account-wide; each resets at 00:00 UTC. Storage is the total. */
export const FREE = { requests: 100_000, neurons: 10_000, rowsRead: 5_000_000, rowsWritten: 100_000, storageBytes: 5 * 1024 ** 3 };

const QUERIES = {
  /* this Worker, hour by hour, for the chart */
  hourly: `query ($account: string!, $script: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    rows: workersInvocationsAdaptive(limit: 200, filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }) {
      dimensions { datetimeHour } sum { requests errors } } } } }`,
  /* every Worker on the account today: the free 100k is shared */
  requests: `query ($account: string!, $day: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    rows: workersInvocationsAdaptive(limit: 100, filter: { datetime_geq: $day, datetime_leq: $until }) { sum { requests } } } } }`,
  neurons: `query ($account: string!, $day: Time!, $until: Time!) { viewer { accounts(filter: { accountTag: $account }) {
    rows: aiInferenceAdaptiveGroups(limit: 100, filter: { datetime_geq: $day, datetime_leq: $until }) { sum { totalNeurons } } } } }`,
  d1: `query ($account: string!, $date: Date!) { viewer { accounts(filter: { accountTag: $account }) {
    rows: d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $date }) { sum { rowsRead rowsWritten } } } } }`,
  storage: `query ($account: string!, $date: Date!) { viewer { accounts(filter: { accountTag: $account }) {
    rows: d1StorageAdaptiveGroups(limit: 100, filter: { date_geq: $date }) { dimensions { date databaseId } max { databaseSizeBytes } } } } }`,
};

export const configured = (env) => !!(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN);

async function ask(env, query, variables, fetchImpl) {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, ...variables } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`HTTP ${res.status}`);
  if (body.errors?.length) throw new Error(String(body.errors[0]?.message || 'query failed').slice(0, 200));
  return body.data?.viewer?.accounts?.[0]?.rows ?? [];
}

const sum = (rows, field) => rows.reduce((n, r) => n + (Number(r.sum?.[field]) || 0), 0);

/** The latest size of each database, added up. */
function storageBytes(rows) {
  const latest = new Map();
  for (const r of rows) {
    const id = r.dimensions?.databaseId, at = r.dimensions?.date || '';
    if (!latest.has(id) || latest.get(id).at < at) latest.set(id, { at, bytes: Number(r.max?.databaseSizeBytes) || 0 });
  }
  return [...latest.values()].reduce((n, d) => n + d.bytes, 0);
}

/**
 * {configured, hours: [{hour, requests, errors}], today: {requests, neurons, rowsRead,
 * rowsWritten, storageBytes}, free, failed: {part: message}}. A part that failed is null.
 */
export async function trafficReport(env, now = Date.now(), fetchImpl = fetch) {
  if (!configured(env)) return { configured: false, free: FREE };
  const day = now - (now % DAY_MS);
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const until = iso(now), date = iso(day).slice(0, 10);
  const parts = {
    hourly: () => ask(env, QUERIES.hourly, { script: SCRIPT, since: iso(now - 7 * DAY_MS), until }, fetchImpl),
    requests: () => ask(env, QUERIES.requests, { day: iso(day), until }, fetchImpl),
    neurons: () => ask(env, QUERIES.neurons, { day: iso(day), until }, fetchImpl),
    d1: () => ask(env, QUERIES.d1, { date }, fetchImpl),
    storage: () => ask(env, QUERIES.storage, { date: iso(day - 2 * DAY_MS).slice(0, 10) }, fetchImpl),
  };
  const names = Object.keys(parts);
  const settled = await Promise.allSettled(names.map((n) => parts[n]()));
  const got = {}, failed = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') got[names[i]] = s.value;
    else failed[names[i]] = s.reason?.message || 'failed';
  });
  const hours = got.hourly
    ? got.hourly
      .map((r) => ({ hour: r.dimensions?.datetimeHour, requests: Number(r.sum?.requests) || 0, errors: Number(r.sum?.errors) || 0 }))
      .filter((h) => h.hour)
      .sort((a, b) => (a.hour < b.hour ? -1 : 1))
    : null;
  return {
    configured: true,
    free: FREE,
    hours,
    today: {
      requests: got.requests ? sum(got.requests, 'requests') : null,
      neurons: got.neurons ? Math.round(sum(got.neurons, 'totalNeurons')) : null,
      rowsRead: got.d1 ? sum(got.d1, 'rowsRead') : null,
      rowsWritten: got.d1 ? sum(got.d1, 'rowsWritten') : null,
      storageBytes: got.storage ? storageBytes(got.storage) : null,
    },
    failed,
  };
}

/** trafficReport, cached for a minute. */
export async function cachedTrafficReport(env, now = Date.now(), fetchImpl = fetch) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request('https://rounds.internal/admin/traffic');
  const hit = await cache?.match(key).catch(() => null);
  if (hit) return hit.json();
  const report = await trafficReport(env, now, fetchImpl);
  /* a report with failures is not kept, so a fixed token shows at once */
  if (cache && report.configured && !Object.keys(report.failed).length) {
    await cache.put(key, new Response(JSON.stringify(report), { headers: { 'cache-control': `max-age=${CACHE_S}` } })).catch(() => {});
  }
  return report;
}
